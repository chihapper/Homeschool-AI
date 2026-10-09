/**
 * Assessor Agent: transcript + observations + course -> MasteryReport.
 *
 * Runs offline at the end of a session. Also performs a grounding audit of the tutor's claims.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import { config } from "../config.js";
import { MasteryExtractionSchema, type Concept, type Course, type CourseKnowledge, type Learner, type Lesson, type MasteryExtraction, type MasteryReport, type Session } from "../domain/types.js";
import { walkedConceptIds } from "../domain/focus.js";
import { buildSystem, type AgentSpec } from "./base.js";

export const assessorAgent: AgentSpec = {
  name: "Assessor Agent",
  role:
    "You evaluate a tutoring session after the fact. You are fair, evidence-driven, and specific. " +
    "You never infer mastery the transcript does not show, and you audit the tutor for claims the material does not support.",
  skills: ["mastery-assessment", "grounding"],
  get model() {
    return config.model;
  },
  get effort() {
    return config.analysisEffort;
  },
};

/**
 * What the assessor audits the tutor against: the walked concepts with their passages, plus any passage
 * the tutor looked up elsewhere in the course during the session. Without the second part, a fact the
 * tutor fetched from another lesson was reported to the parent as invented (2026-09-24).
 */
export function assessmentMaterial(session: Session, course: Course, lesson: Lesson): { concepts: Concept[]; material: string; wholeCourse: boolean } {
  // Only what the session walked: a concept the parent skipped gets no "not reached" row in the report.
  const walked = new Set(walkedConceptIds(session, course, lesson));
  const concepts = course.concepts.filter((c) => walked.has(c.id));
  const chunkById = new Map(course.chunks.map((ch) => [ch.id, ch] as const));
  const shown = new Set<string>();
  const conceptBlocks = concepts.map((c) => {
    const passages = c.sourceChunkIds
      .map((id) => chunkById.get(id))
      .filter((ch): ch is NonNullable<typeof ch> => Boolean(ch))
      .map((ch) => {
        shown.add(ch.id);
        return ch.text;
      })
      .join("\n---\n");
    return `<concept id="${c.id}" name="${c.name}">\n${c.summary}\nKey facts:\n${c.keyFacts.map((f) => `- ${f}`).join("\n")}\nSource:\n${passages}\n</concept>`;
  });
  const retrieved = (session.retrievedChunkIds ?? [])
    .filter((id) => !shown.has(id))
    .map((id) => chunkById.get(id))
    .filter((ch): ch is NonNullable<typeof ch> => Boolean(ch));
  const passage = (ch: (typeof course.chunks)[number]): string => `<passage id="${ch.id}" heading="${ch.headingPath.join(" > ")}">\n${ch.text}\n</passage>`;
  const retrievedBlock = retrieved.length
    ? `\n\n<retrieved_passages>\nPassages from elsewhere in the same course that the tutor looked up during this session. A claim supported by one of these is grounded.\n${retrieved.map(passage).join("\n")}\n</retrieved_passages>`
    : "";
  // The rest of the course, when it fits: "the material" a parent means is the whole course, and without it
  // the assessor told a parent the book does not mention coinage when another lesson does (2026-09-24).
  for (const ch of retrieved) shown.add(ch.id);
  const rest = course.chunks.filter((ch) => !shown.has(ch.id));
  const restChars = rest.reduce((a, ch) => a + ch.text.length, 0);
  const restBlock =
    rest.length && restChars <= REST_OF_COURSE_BUDGET_CHARS
      ? `\n\n<rest_of_course>\nThe remainder of the family's material for this course, for checking the tutor's claims. A claim supported here is grounded too.\n${rest.map(passage).join("\n")}\n</rest_of_course>`
      : "";
  return { concepts, material: conceptBlocks.join("\n\n") + retrievedBlock + restBlock, wholeCourse: rest.length === 0 || restBlock.length > 0 };
}

/** About 50k tokens: a unit-sized course fits; a whole textbook does not, and then only what the tutor read is added. */
export const REST_OF_COURSE_BUDGET_CHARS = 200_000;

const STANCE_WORDS: Record<string, string> = { confirmed: "agreed", corrected: "corrected it", unsure: "said it was not sure", deferred: "pointed back to the reading" };

/**
 * The facts from outside the material that came up, with what the tutor said and what the reference check
 * found. Without it the assessor filed a correct one as a misconception (2026-09-25: "Aeneas the Trojan, son of
 * Aphrodite" was listed as blending outside knowledge into the material).
 */
export function outsideClaimsBlock(session: Session, learnerName: string): string {
  const claims = session.outsideClaims ?? [];
  if (!claims.length) return "";
  const lines = claims.map((c) => {
    const who = c.raisedBy === "learner" ? learnerName : "the tutor";
    const check =
      c.status === "checked"
        ? `check: ${c.verdict}${c.explanation ? ` (${c.explanation})` : ""}`
        : c.status === "pending"
          ? "check: still running when the session ended"
          : `not checked${c.statusNote ? ` (${c.statusNote})` : ""}`;
    return `- "${c.claim}" raised by ${who}; the tutor ${STANCE_WORDS[c.tutorStance] ?? c.tutorStance}${c.materialSays ? `; the material says: "${c.materialSays}"` : ""}; ${check}`;
  });
  return `\n\n<outside_the_material>\nFacts from outside the family's material that came up in this session, with the reference check's verdict where there was one. The parent sees this list in the report. Follow the mastery-assessment skill's "Outside the material" section.\n${lines.join("\n")}\n</outside_the_material>`;
}

/**
 * Where the student started on this lesson's concepts, from the course intake: what they could say before any
 * teaching. With it the report can tell what was learned here from what was already known.
 */
export function startingPointsBlock(knowledge: CourseKnowledge | undefined, concepts: Concept[], learnerName: string): string {
  const starts = (knowledge?.starts ?? []).filter((s) => concepts.some((c) => c.id === s.conceptId));
  // What else was on record before this session. The intake and earlier sessions are conversations the assessor is
  // not shown, and a student who says "like I said earlier" was once reported as citing something never said (2026-10-05).
  const notes = [...(knowledge?.priorKnowledge ?? []).map((n) => `- knew: ${n}`), ...(knowledge?.observedGaps ?? []).map((n) => `- had mixed up: ${n}`)].slice(0, 16);
  if (!starts.length && !notes.length) return "";
  const lines = starts.map(
    (s) =>
      `- ${s.conceptId}: ${s.estimate === "none" ? "nothing yet" : s.estimate === "some" ? "some knowledge" : "could already explain it"}` +
      (s.said ? `; said "${s.said}"` : "; said they did not know") +
      (s.confidence !== undefined ? ` (sure ${s.confidence} out of 10)` : "") +
      (s.materialSays ? `; the material says: ${s.materialSays}` : ""),
  );
  return (
    `\n\n<before_this_session>\nFollow the mastery-assessment skill's "Before and after" section.\n` +
    (starts.length ? `What ${learnerName} said about this lesson's concepts before the course began, with no teaching${knowledge?.intakeAt ? ` (asked ${knowledge.intakeAt.slice(0, 10)})` : ""}:\n${lines.join("\n")}\n` : "") +
    (notes.length ? `Also on record about ${learnerName} and this course, from that conversation and earlier sessions, none of which you are shown:\n${notes.join("\n")}\n` : "") +
    `</before_this_session>`
  );
}

/** Token usage of one assessor run, for a cost line in the log or an experiment. */
export interface AssessUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

export async function assessSession(args: { session: Session; learner: Learner; course: Course; lesson: Lesson; knowledge?: CourseKnowledge; onUsage?: (u: AssessUsage) => void }): Promise<MasteryReport> {
  const { session, learner, course, lesson } = args;
  const { concepts, material, wholeCourse } = assessmentMaterial(session, course, lesson);
  const transcript = session.transcript
    .map((t) => `${t.role === "user" ? learner.name : "Tutor"}${t.expressions?.length ? ` [${t.expressions.join(", ")}]` : ""}: ${t.content}`)
    .join("\n");
  const observations = session.observations.map((o) => `- ${o.at} [${o.conceptId}/${o.kind}] ${o.evidence} :: ${o.note}`).join("\n") || "(none recorded)";

  const system = buildSystem(assessorAgent, [
    `<learner name="${learner.name}">${learner.profile ? `Demonstration preferences: ${learner.profile.demonstrationPreferences.join(", ")}` : "No profile."}\n` +
      "Nothing here states the learner's gender. Refer to them by name; use a pronoun only if the transcript itself uses one for them, otherwise write around it or use they. Never write \"your son\" or \"your daughter\".</learner>",
  ]);

  // Streamed for the same reason as the curriculum extraction: a long session at high effort can run past
  // the request timeout of a non-streaming call.
  const { message, parsed: out } = await streamParsed<MasteryExtraction>({
    model: assessorAgent.model,
    max_tokens: 32_000, // streamed, so a long session's report has room (the model allows far more)
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: assessorAgent.effort, format: zodOutputFormat(MasteryExtractionSchema) },
    messages: [
      {
        role: "user",
        content:
          `Assess this session on lesson "${lesson.title}". Produce one entry in concepts for EVERY concept listed in the material, even if level is 0.\n\n` +
          "The tutor may draw on any passage in the course, not only this lesson's. The material below holds the lesson's passages, then in <retrieved_passages> whatever the tutor looked up elsewhere in the course during the session" +
          (wholeCourse
            ? ", then in <rest_of_course> everything else in the course, so you have the family's whole material. A claim supported anywhere in it is grounded; flag only claims nothing in it supports.\n\n"
            : ". The course is too large to include whole, so you do not have all of it: a claim supported by any passage here is grounded, flag only claims none of them support, and never assert that the material does not say something.\n\n") +
          (session.narrationFirst
            ? `This session opened with ${learner.name} telling back the material unprompted, before the tutor had asked anything. That first exchange is independent evidence: weigh it like any unhinted answer.\n\n`
            : "") +
          `<material>\n${material}\n</material>\n\n<tutor_observations>\n${observations}\n</tutor_observations>` +
          startingPointsBlock(args.knowledge, concepts, learner.name) +
          outsideClaimsBlock(session, learner.name) +
          `\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  args.onUsage?.(message.usage as AssessUsage);
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("Assessment was cut off at the output limit; the report is incomplete and was not saved.");
  if (!out) throw new Error("Assessment returned no parsable output.");

  // Clamp and complete: every lesson concept gets an entry.
  const byId = new Map(out.concepts.map((c) => [c.conceptId, { ...c, level: Math.max(0, Math.min(4, Math.round(c.level))) }]));
  for (const c of concepts) if (!byId.has(c.id)) byId.set(c.id, { conceptId: c.id, level: 0, evidence: [], misconceptions: [], nextStep: "Not reached this session." });

  return {
    ...out,
    concepts: concepts.map((c) => byId.get(c.id)!),
    sessionId: session.id,
    learnerId: learner.id,
    courseId: course.id,
    lessonId: lesson.id,
    ...(session.outsideClaims?.length ? { outsideClaims: session.outsideClaims } : {}),
    createdAt: new Date().toISOString(),
  };
}

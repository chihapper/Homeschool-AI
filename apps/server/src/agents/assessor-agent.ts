/**
 * Assessor Agent: transcript + observations + course -> MasteryReport.
 *
 * Runs offline at the end of a session. Also performs a grounding audit of the tutor's claims.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import { config } from "../config.js";
import { MasteryExtractionSchema, type Concept, type Course, type Learner, type Lesson, type MasteryExtraction, type MasteryReport, type Session } from "../domain/types.js";
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
export function assessmentMaterial(session: Session, course: Course, lesson: Lesson): { concepts: Concept[]; material: string } {
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
  const retrievedBlock = retrieved.length
    ? `\n\n<retrieved_passages>\nPassages from elsewhere in the same course that the tutor looked up during this session. A claim supported by one of these is grounded.\n${retrieved
        .map((ch) => `<passage id="${ch.id}" heading="${ch.headingPath.join(" > ")}">\n${ch.text}\n</passage>`)
        .join("\n")}\n</retrieved_passages>`
    : "";
  return { concepts, material: conceptBlocks.join("\n\n") + retrievedBlock };
}

export async function assessSession(args: { session: Session; learner: Learner; course: Course; lesson: Lesson }): Promise<MasteryReport> {
  const { session, learner, course, lesson } = args;
  const { concepts, material } = assessmentMaterial(session, course, lesson);
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
          "The tutor may draw on any passage in the course, not only this lesson's: the material below holds the lesson's passages and, in <retrieved_passages>, whatever the tutor looked up elsewhere in the course during the session. A claim supported by any of them is grounded; flag only claims none of them support.\n\n" +
          (session.narrationFirst
            ? `This session opened with ${learner.name} telling back the material unprompted, before the tutor had asked anything. That first exchange is independent evidence: weigh it like any unhinted answer.\n\n`
            : "") +
          `<material>\n${material}\n</material>\n\n<tutor_observations>\n${observations}\n</tutor_observations>\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
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
    createdAt: new Date().toISOString(),
  };
}

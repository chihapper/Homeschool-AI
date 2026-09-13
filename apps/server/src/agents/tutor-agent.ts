/**
 * Tutor Agent: the live Socratic teacher. Runs behind both the text chat API and the Hume voice bridge.
 *
 * Tools:
 *  - lookup_source        retrieve verbatim passages from the course material (grounding)
 *  - record_observation   log evidence of understanding / misconception for the Assessor
 *  - advance              request a phase change or move to the next concept (validated by the orchestrator)
 */
import { config } from "../config.js";
import type { Concept, Course, Learner, Lesson, Observation, Session, SessionPhase } from "../domain/types.js";
import { ChunkIndex } from "../ingest/retrieval.js";
import { buildSystem, streamTurn, transcriptToMessages, type AgentTool, type AgentSpec, type TurnResult } from "./base.js";

export const tutorAgent: AgentSpec = {
  name: "Socratic Tutor",
  role:
    "You are a one-on-one teacher for a homeschool student, working from the course material the parent chose. " +
    "You teach by questioning, you stay inside the material, and you never do the student's thinking for them. " +
    "Your aim is durable understanding the student can demonstrate, not coverage.",
  skills: ["socratic-method", "learner-adaptation", "grounding", "voice-conversation"],
  model: config.tutorModel,
  effort: config.tutorEffort,
};

export type AdvanceTarget = "inquire" | "assess" | "next-concept";

export interface TutorContext {
  session: Session;
  learner: Learner;
  course: Course;
  lesson: Lesson;
  concept: Concept;
  index: ChunkIndex;
  /** Orchestrator hooks; return a message the model will see as the tool result. */
  onObservation: (o: Observation) => string;
  onAdvance: (to: AdvanceTarget, rationale: string) => string;
}

const PHASE_GUIDANCE: Record<SessionPhase, string> = {
  intake: "",
  teach: "Phase: TEACH. Elicit what the learner already thinks, then build the concept through questions grounded in the material. Call advance to 'inquire' once the learner has stated the core idea in their own words.",
  inquire: "Phase: INQUIRE. Invite the learner's own questions about the concept. Answer accurately from the material, then turn each answer into a question back. Call advance to 'assess' once their questions are answered or after a few exchanges.",
  assess: "Phase: ASSESS. No more scaffolding. Ask for demonstrations (own words, apply to a new case, predict, teach back). Record at least two observations. Then call advance to 'next-concept'.",
  "wrap-up": "Phase: WRAP-UP. Summarise what the learner figured out today in two or three sentences, name one thing to think about before next time, and say goodbye.",
  complete: "The session is complete. Say a brief goodbye.",
};

export function buildTutorContext(ctx: TutorContext): string[] {
  const { learner, course, lesson, concept, session } = ctx;
  const profile = learner.profile;
  const blocks: string[] = [];

  // Course-level block is stable for the whole session (good cache hit rate).
  const lessonConcepts = course.concepts.filter((c) => lesson.conceptIds.includes(c.id));
  blocks.push(
    `<course title="${course.title}" subject="${course.subject}" level="${course.level}">\n${course.description}\n</course>\n\n` +
      `<lesson title="${lesson.title}">\nObjectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}\n\n` +
      `Concepts in this lesson (teach in order):\n${lessonConcepts.map((c, i) => `${i + 1}. ${c.name} (${c.id}): ${c.summary}`).join("\n")}\n\n` +
      (lesson.guidingQuestions.length ? `Guiding questions:\n${lesson.guidingQuestions.map((q) => `- ${q}`).join("\n")}\n\n` : "") +
      (lesson.practiceItems.length ? `Practice items from the material:\n${lesson.practiceItems.map((q) => `- ${q}`).join("\n")}\n` : "") +
      `</lesson>`,
  );

  if (profile) {
    blocks.push(
      `<learner_profile name="${learner.name}">\n` +
        `Intake preferences: ${profile.intakePreferences.join(", ")}\n` +
        `Demonstration preferences: ${profile.demonstrationPreferences.join(", ")}\n` +
        `Challenge tolerance: ${profile.challengeTolerance}. Pace: ${profile.pace}. Verbal level: ${profile.verbalLevel}\n` +
        `Interests: ${profile.interests.join(", ")}\n` +
        `Prior knowledge: ${profile.priorKnowledge.map((p) => `- ${p}`).join("\n")}\n` +
        `Observed gaps: ${profile.observedGaps.map((p) => `- ${p}`).join("\n")}\n` +
        `Tutoring guidance (follow literally):\n${profile.tutoringGuidance.map((p) => `- ${p}`).join("\n")}\n</learner_profile>`,
    );
  } else {
    blocks.push(`<learner name="${learner.name}"${learner.gradeLevel ? ` grade="${learner.gradeLevel}"` : ""}>No profile yet: start with a concrete example, keep steps small, and watch how they respond.</learner>`);
  }

  // Current concept: the part that changes as the session advances.
  const sourceText = concept.sourceChunkIds
    .map((id) => course.chunks.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 4)
    .map((c) => `<passage id="${c.id}">\n${c.text}\n</passage>`)
    .join("\n");
  blocks.push(
    `<current_concept id="${concept.id}" name="${concept.name}">\n${concept.summary}\n\nKey facts the learner should be able to state:\n${concept.keyFacts.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Common misconceptions to listen for:\n${concept.commonMisconceptions.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Source passages:\n${sourceText || "(none linked; use lookup_source)"}\n</current_concept>`,
  );

  const recent = session.observations.filter((o) => o.conceptId === concept.id).slice(-6);
  if (recent.length) {
    blocks.push(`<observations_so_far>\n${recent.map((o) => `- [${o.kind}] ${o.evidence} (${o.note})`).join("\n")}\n</observations_so_far>`);
  }

  blocks.push(PHASE_GUIDANCE[session.phase]);
  if (session.pendingDirectives.length) blocks.push(`<orchestrator>\n${session.pendingDirectives.join("\n")}\n</orchestrator>`);
  blocks.push("Speak to the learner first. Call tools after your spoken words, in the same turn. Never mention tools, phases, or the profile out loud.");
  return blocks;
}

export function tutorTools(ctx: TutorContext): AgentTool<never>[] {
  const lookup: AgentTool<{ query: string }> = {
    definition: {
      name: "lookup_source",
      description:
        "Search the course material for passages about a topic. Call this whenever the learner asks something not covered by the current concept's passages, or before stating any fact you are not certain is in the material.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "What to look for, in plain words." } },
        required: ["query"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ query }) => {
      const hits = ctx.index.search(query, 4);
      if (!hits.length) return "No passages in the course material match that. Tell the learner the material does not cover it.";
      return hits.map((h) => `<passage id="${h.chunk.id}" heading="${h.chunk.headingPath.join(" > ")}">\n${h.chunk.text}\n</passage>`).join("\n\n");
    },
  };

  const record: AgentTool<Omit<Observation, "at">> = {
    definition: {
      name: "record_observation",
      description:
        "Record evidence about the learner's understanding of a concept, for the assessment report. Call this every time the learner demonstrates understanding, partial understanding, a misconception, a gap, or a notable change in engagement. Quote what they said.",
      input_schema: {
        type: "object",
        properties: {
          conceptId: { type: "string", description: "Concept id, usually the current concept." },
          kind: { type: "string", enum: ["understanding", "partial", "misconception", "gap", "engagement"] },
          evidence: { type: "string", description: "What the learner said or did, briefly quoted." },
          note: { type: "string", description: "Why this matters for mastery." },
        },
        required: ["conceptId", "kind", "evidence", "note"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: (o) => ctx.onObservation({ ...o, at: new Date().toISOString() }),
  };

  const advance: AgentTool<{ to: AdvanceTarget; rationale: string }> = {
    definition: {
      name: "advance",
      description:
        "Move the session forward: 'inquire' after the learner has stated the concept in their own words; 'assess' when their questions are answered; 'next-concept' after you have recorded assessment observations. The orchestrator may refuse and tell you what is missing.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", enum: ["inquire", "assess", "next-concept"] },
          rationale: { type: "string", description: "One sentence of evidence for why the learner is ready." },
        },
        required: ["to", "rationale"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ to, rationale }) => ctx.onAdvance(to, rationale),
  };

  return [lookup as AgentTool<never>, record as AgentTool<never>, advance as AgentTool<never>];
}

export function tutorTurn(ctx: TutorContext, signal?: AbortSignal): AsyncGenerator<string, TurnResult, void> {
  const system = buildSystem(tutorAgent, buildTutorContext(ctx));
  let messages = transcriptToMessages(ctx.session.transcript);
  if (!messages.length) messages = [{ role: "user", content: "(The student has just joined the lesson. Open with a warm one-line greeting and your first eliciting question.)" }];
  return streamTurn({ spec: tutorAgent, system, messages, tools: tutorTools(ctx), maxTokens: 700, signal });
}

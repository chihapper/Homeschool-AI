/**
 * The course intake: the conversation that finds out what a student already knows about a course, and the
 * extraction that writes their course-knowledge record from it (docs/INTAKE.md §4, skill `course-intake`).
 *
 * Once per student per course, before the first lesson: an open "tell me everything you know", then one
 * first-step question on each of a handful of central concepts (domain/intake.ts chooses them), each with "how
 * sure are you, 0 to 10?". It teaches nothing and corrects nothing: an answer given here would spoil the lesson,
 * and being asked helps learning only when the answer comes afterwards, in the reading. The record is written
 * from the transcript in the background while the lesson starts.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import type { SdkUsage } from "../domain/cost.js";
import { config } from "../config.js";
import { CourseIntakeExtractionSchema, type Concept, type Course, type CourseIntakeExtraction, type Learner, type Session } from "../domain/types.js";
import { buildSystem, streamTurn, transcriptToMessages, type AgentTool, type AgentSpec, type TurnResult } from "./base.js";
import { genderNote, handOverWords, type NextStep } from "./profiler-agent.js";
import { withoutAssignedGender } from "./pronouns.js";

export const courseIntakeAgent: AgentSpec = {
  name: "Intake (course)",
  role:
    "You ask a homeschool student what they already know about a course they are about to start, one plain question at a time, without teaching or correcting anything. " +
    "You are warm and neutral, and you are the same voice that will tutor them afterwards.",
  skills: ["course-intake", "voice-conversation"],
  // Getters: a change in the Settings tab applies on the next turn without a restart.
  get model() {
    return config.tutorModel;
  },
  get effort() {
    return config.tutorEffort;
  },
  get thinking() {
    return config.tutorThinking;
  },
};

export interface CourseIntakeContext {
  session: Session;
  learner: Learner;
  course: Course;
  /** The concepts to ask about, in order (the session's probeConceptIds, resolved). */
  concepts: Concept[];
  /** What the sitting goes on to. Absent: the conversation ends there. */
  next?: NextStep;
  /** The last words of the general intake, when this one follows it in the same sitting: no second greeting. */
  carriedOn?: string;
  /** Called when the agent signals the intake is done. */
  onFinish: (reason: string) => void;
}

function contextBlock(ctx: Pick<CourseIntakeContext, "learner" | "course" | "concepts" | "next">, forExtraction = false): string {
  const l = ctx.learner;
  const head = [
    `<learner name="${l.name}"${l.age ? ` age="${l.age}"` : ""}${l.gradeLevel ? ` grade="${l.gradeLevel}"` : ""}/>`,
    `<course title="${ctx.course.title}" subject="${ctx.course.subject}" level="${ctx.course.level}"/>`,
  ];
  if (forExtraction) {
    // The extraction compares answers with the family's material, so it gets the key facts; the conversation never does.
    const concepts = ctx.concepts
      .map((c) => `<concept id="${c.id}" name="${c.name}">\n${c.summary}\nKey facts in the material:\n${c.keyFacts.map((f) => `- ${f}`).join("\n")}\nCommon misconceptions:\n${c.commonMisconceptions.map((f) => `- ${f}`).join("\n") || "- (none listed)"}\n</concept>`)
      .join("\n");
    return [...head, `<concepts_asked_about>\n${concepts}\n</concepts_asked_about>`].join("\n\n");
  }
  return [
    ...head,
    `<concepts_to_ask_about>\nAsk about these, in this order, one per turn. The summaries are notes for you: never put a fact from them into a question.\n` +
      ctx.concepts.map((c, i) => `${i + 1}. ${c.name}: ${c.summary}`).join("\n") +
      `\n</concepts_to_ask_about>`,
    `<what_happens_next>\n${handOverWords(ctx.next)}\n</what_happens_next>`,
    "When you have asked about every concept on the list (or stopped early, as the skill says), speak the hand-over and call finish_intake in the same turn: speak first, then call the tool. " +
      "The hand-over asks no question. Nothing you write after finish_intake reaches the learner. On every other turn, end with your single question and call no tool.",
  ].join("\n\n");
}

export function courseIntakeTurn(ctx: CourseIntakeContext, signal?: AbortSignal): AsyncGenerator<string, TurnResult, void> {
  const finish: AgentTool<{ reason: string }> = {
    definition: {
      name: "finish_intake",
      description: "Call this once, after your hand-over words, when you have asked about every concept on your list, or stopped early as the skill describes, or the learner asked to stop.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "One sentence on why the intake is complete." } },
        required: ["reason"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ reason }) => {
      ctx.onFinish(reason);
      return "Intake marked complete.";
    },
    endsSpeech: "always",
  };
  const system = buildSystem(courseIntakeAgent, [contextBlock(ctx)]);
  let messages = transcriptToMessages(ctx.session.transcript);
  if (!messages.length) {
    messages = [
      {
        role: "user",
        content: ctx.carriedOn
          ? `(The learner is already with you. You have just said to them: "${ctx.carriedOn}" Carry straight on from those words with the opening question, without greeting them again and without repeating that sentence.)`
          : `(The student has just joined. Greet them by name in a few words, say you would like to hear what they already know about ${ctx.course.title} before starting it, and ask the opening question.)`,
      },
    ];
  }
  return streamTurn({ spec: courseIntakeAgent, system, messages, tools: [finish as AgentTool<never>], maxTokens: 1000, signal });
}

/** Turn the course-intake transcript into the starting points and first notes of a course-knowledge record (offline, high effort). */
export async function extractCourseKnowledge(ctx: Pick<CourseIntakeContext, "session" | "learner" | "course" | "concepts">, onUsage?: (u: SdkUsage, model: string) => void): Promise<CourseIntakeExtraction> {
  const system = buildSystem({ ...courseIntakeAgent, model: config.model, effort: config.analysisEffort }, [contextBlock(ctx, true)]);
  const transcript = ctx.session.transcript.map((t) => `${t.role === "user" ? ctx.learner.name : "Tutor"}: ${t.content}`).join("\n");
  const { message, parsed } = await streamParsed<CourseIntakeExtraction>({
    model: config.model,
    max_tokens: 32_000, // thinking at high effort counts against it; streamed, so a large ceiling costs nothing
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: config.analysisEffort, format: zodOutputFormat(CourseIntakeExtractionSchema) },
    messages: [
      {
        role: "user",
        content:
          `Here is the whole course-intake conversation with ${ctx.learner.name} about "${ctx.course.title}". Produce the record, following "Producing the record" in the skill. ` +
          `Use only the concept ids given above. Every entry must rest on something ${ctx.learner.name} said. ${genderNote(ctx.learner)}\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  onUsage?.(message.usage, config.model);
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("The course-intake extraction was cut off at the output limit.");
  if (!parsed) throw new Error("The course-intake extraction returned no parsable output.");
  // The student's own words (`said`) are left alone; everything the record says in its own voice is checked.
  return withoutAssignedGender(parsed, CourseIntakeExtractionSchema, {
    name: ctx.learner.name,
    parentNotes: ctx.learner.parentNotes,
    texts: (r) => [r.baselineSummary, ...r.priorKnowledge, ...r.observedGaps, ...r.guidance, ...r.starts.map((s) => s.materialSays)],
  });
}

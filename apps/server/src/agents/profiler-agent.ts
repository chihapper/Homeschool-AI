/**
 * The general intake: the conversation that learns how to work with a student, and the extraction that writes
 * their learner profile from it (docs/INTAKE.md §3, skill `initial-assessment`).
 *
 * It runs once per student, on a short passage that ships with the app (domain/intake.ts), never on the
 * family's course: the intake it replaces probed the course's first concepts and taught lesson one before the
 * lesson (sessions of 2026-09-15 and 2026-09-21). The conversation streams, voice or text. The agent asks for
 * the passage with `read_passage` and the orchestrator reads it out word for word, so every student hears the
 * same text; when the agent is done it hands over and calls `finish_intake`, and the profile is written from the
 * transcript in the background while the sitting goes on.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import type { SdkUsage } from "../domain/cost.js";
import { config } from "../config.js";
import { LearnerProfileExtractionSchema, type Learner, type LearnerProfile, type Session } from "../domain/types.js";
import { BAND_ORDER, BANDS, gradeBand, PASSAGE, RETELL_PROMPT, type Band } from "../domain/intake.js";
import { buildSystem, streamTurn, transcriptToMessages, type AgentTool, type AgentSpec, type TurnResult } from "./base.js";
import { licensedBy, withoutAssignedGender } from "./pronouns.js";
import type { z } from "zod";

/** What an extraction is told about pronouns: none, unless the parent's notes used one for their child. */
export function genderNote(learner: Learner): string {
  const first = learner.name.split(/\s+/)[0];
  const licensed = [...licensedBy(learner.parentNotes)];
  return licensed.length
    ? `The parent's notes refer to ${first} as "${licensed[0]}", so you may; otherwise use the name.`
    : `Nobody has stated ${first}'s gender: write "${first}" or "they", never "he" or "she", whatever the name suggests.`;
}

export const profilerAgent: AgentSpec = {
  name: "Intake (general)",
  role:
    "You run a short, friendly first conversation with a homeschool student to learn how to work with them: what they enjoy, how they tell back something they have just heard, and what they do when a question is hard. " +
    "You are warm, plain and observant, and you are the same voice that will tutor them afterwards.",
  skills: ["initial-assessment", "voice-conversation"],
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

/** What the sitting goes on to when an intake ends, so its last words can say so. */
export interface NextStep {
  kind: "course-intake" | "lesson";
  courseTitle: string;
  lessonTitle?: string;
}

/** The hand-over an intake is asked to make. The next thing starts in the same breath, so it is never a goodbye. */
export function handOverWords(next: NextStep | undefined): string {
  if (!next) return 'Nothing follows this conversation. Thank them and say that is everything for now, for example: "Thanks, that\'s everything for now."';
  if (next.kind === "course-intake") {
    return (
      `Next comes a few questions about what they already know about "${next.courseTitle}", and the first of them follows straight after your words, in the same breath. ` +
      `So lead into it without asking anything and without naming the course, for example: "Thanks. Before we start the reading, I have a few quick questions for you."`
    );
  }
  return `Next comes the lesson${next.lessonTitle ? ` "${next.lessonTitle}"` : ""}. Say so in your own words, for example: "Thanks. Now let's start today's reading." Do not start the lesson yourself: it follows straight after your words.`;
}

export interface ProfilerContext {
  session: Session;
  learner: Learner;
  /** What the sitting goes on to. Absent: the conversation ends there. */
  next?: NextStep;
  /** Called when the agent signals the intake is done. */
  onFinish: (reason: string) => void;
  /** Called when the agent asks for the passage: the orchestrator reads it out after the agent's words. */
  onReadPassage: () => void;
}

/** The band this intake starts with: frozen on the session when it was created, else worked out from the grade. */
export function startBand(session: Session, learner: Learner): Band {
  return session.intakeBand ?? gradeBand(learner.gradeLevel, learner.age);
}

/** The passage and the three bands of questions, with the answers the tutor judges against (and gives, after the hard one only). */
export function passageBlock(band: Band): string {
  const bands = BAND_ORDER.map(
    (b) =>
      `Band ${b} (${BANDS[b].grades})\n  apply: ${BANDS[b].apply}\n  a sound answer: ${BANDS[b].applyAnswer}\n  hard: ${BANDS[b].hard}\n  the answer, from the passage: ${BANDS[b].hardAnswer}`,
  ).join("\n");
  return (
    `<passage title="${PASSAGE.title}">\n${PASSAGE.text}\n</passage>\n\n` +
    `<questions start_band="${band}">\nStart with band ${band}'s apply question. The answers are for your judgement; the learner hears one only after the hard question, as the skill says.\n${bands}\n</questions>`
  );
}

function contextBlock(ctx: Pick<ProfilerContext, "session" | "learner" | "next">, forExtraction = false): string {
  const l = ctx.learner;
  const parts = [`<learner name="${l.name}"${l.age ? ` age="${l.age}"` : ""}${l.gradeLevel ? ` grade="${l.gradeLevel}"` : ""}/>`, passageBlock(startBand(ctx.session, l))];
  if (forExtraction) return parts.join("\n\n");
  parts.push(
    `<what_happens_next>\n${handOverWords(ctx.next)}\n</what_happens_next>`,
    (passageWasRead(ctx.session)
      ? "The passage has been read to the learner, once, and is not read again: however short their retelling, go on from it. "
      : "In step 2, say your one sentence and call read_passage in the same turn; the passage and the request to tell it back are then read out for you, and that turn is over. " +
        `The request is always these words, so never ask it yourself: "${RETELL_PROMPT}" `) +
      "When the five steps are done (six to eight exchanges), speak the hand-over and call finish_intake in the same turn: speak first, then call the tool. " +
      "The hand-over asks no question. Nothing you write after finish_intake reaches the learner. " +
      "On every other turn, end with your single question and call no tool.",
  );
  return parts.join("\n\n");
}

export function profilerTurn(ctx: ProfilerContext, signal?: AbortSignal): AsyncGenerator<string, TurnResult, void> {
  const read: AgentTool<Record<string, never>> = {
    definition: {
      name: "read_passage",
      description:
        `Have the passage "${PASSAGE.title}" read to the learner, word for word, followed by the request to tell it back. Call it once, in step 2, after one sentence saying you are about to read them something short. ` +
        "Never read or paraphrase the passage yourself: every student hears the same words.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
    run: () => {
      ctx.onReadPassage();
      return "The passage is being read to the learner now, followed by the request to tell it back. Say nothing more this turn.";
    },
    endsSpeech: "always",
  };
  const finish: AgentTool<{ reason: string }> = {
    definition: {
      name: "finish_intake",
      description:
        "Call this once, after your hand-over words, when the five steps are done. " +
        "Do not call it before the hard question has been asked and answered, unless the learner asks to stop.",
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
  const system = buildSystem(profilerAgent, [contextBlock(ctx)]);
  let messages = transcriptToMessages(ctx.session.transcript);
  if (!messages.length) messages = [{ role: "user", content: "(The student has just joined. Greet them by name in a few words and begin with the warm-up.)" }];
  // The passage is read once. Told so in the tool's description, the model still asked for it a second time when
  // a quiet student's retelling was thin (2026-10-05), so once it has been read the tool is simply not offered.
  const tools = passageWasRead(ctx.session) ? [finish as AgentTool<never>] : [read as AgentTool<never>, finish as AgentTool<never>];
  // Room for a little thinking before a short turn: max_tokens covers both.
  return streamTurn({ spec: profilerAgent, system, messages, tools, maxTokens: 1000, signal });
}

/** The passage has already been read to the learner in this session. */
export function passageWasRead(session: Session): boolean {
  return session.transcript.some((t) => t.role === "assistant" && t.content.includes(PASSAGE.text));
}

/** The passage as it is read out after the agent's lead-in: title, text, and the request to tell it back. */
export function passageReading(): string {
  return `${PASSAGE.title}. ${PASSAGE.text} ${RETELL_PROMPT}`;
}

/** Turn the intake transcript into a structured profile (offline, high effort). */
export async function finalizeProfile(ctx: Pick<ProfilerContext, "session" | "learner">, onUsage?: (u: SdkUsage, model: string) => void): Promise<LearnerProfile> {
  const system = buildSystem({ ...profilerAgent, model: config.model, effort: config.analysisEffort }, [contextBlock(ctx, true)]);
  const transcript = ctx.session.transcript.map((t) => `${t.role === "user" ? ctx.learner.name : "Tutor"}: ${t.content}`).join("\n");
  // Streamed, like the other offline extractions: never lose a long high-effort generation to the request timeout.
  const { message, parsed } = await streamParsed<z.infer<typeof LearnerProfileExtractionSchema>>({
    model: config.model,
    // The profile is short, but thinking at high effort counts against this too (8,000 was cut off, 2026-09-27).
    max_tokens: 32_000,
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: config.analysisEffort, format: zodOutputFormat(LearnerProfileExtractionSchema) },
    messages: [
      {
        role: "user",
        content:
          `Here is the whole intake conversation with ${ctx.learner.name}. Produce the learner profile, following "Producing the profile" in the skill. ` +
          `Every field must rest on something in the transcript. ${genderNote(ctx.learner)}\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  onUsage?.(message.usage, config.model);
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("Profile extraction was cut off at the output limit.");
  if (!parsed) throw new Error("Profile extraction returned no parsable output.");
  // Checked in code, because the skill's rule alone did not hold: see agents/pronouns.ts.
  return withoutAssignedGender(parsed, LearnerProfileExtractionSchema, {
    name: ctx.learner.name,
    parentNotes: ctx.learner.parentNotes,
    texts: (p) => [p.verbalLevel, p.parentSummary, ...p.interests, ...p.tutoringGuidance],
  });
}

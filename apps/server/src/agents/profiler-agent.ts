/**
 * Profiler Agent: runs the initial-assessment conversation and produces a LearnerProfile.
 *
 * The conversation itself streams (voice or text). When the agent decides the intake is complete it
 * calls `finish_intake`; the orchestrator then asks for the structured profile.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import { config } from "../config.js";
import { LearnerProfileSchema, type Course, type Learner, type LearnerProfile, type Session } from "../domain/types.js";
import { buildSystem, streamTurn, transcriptToMessages, type AgentTool, type AgentSpec, type TurnResult } from "./base.js";

export const profilerAgent: AgentSpec = {
  name: "Profiler Agent",
  role:
    "You run a short, friendly intake conversation with a homeschool student to learn how they learn and how they best show what they know. " +
    "You are warm, curious, and observant. You are also the same voice that will tutor them later, so be consistent.",
  skills: ["initial-assessment", "voice-conversation", "grounding"],
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

export interface ProfilerContext {
  session: Session;
  learner: Learner;
  course?: Course;
  /** Called when the agent signals the intake is done. */
  onFinish: (reason: string) => void;
}

function contextBlock(ctx: ProfilerContext): string {
  const l = ctx.learner;
  const parts = [
    `<learner name="${l.name}"${l.age ? ` age="${l.age}"` : ""}${l.gradeLevel ? ` grade="${l.gradeLevel}"` : ""}/>`,
  ];
  if (ctx.course) {
    const sample = ctx.course.concepts.slice(0, 3).map((c) => `- ${c.name}: ${c.summary}`).join("\n");
    parts.push(`<course title="${ctx.course.title}" subject="${ctx.course.subject}" level="${ctx.course.level}">\nUse these concepts for the intake probes:\n${sample}\n</course>`);
  }
  parts.push(
    "When you have enough evidence for every field of the learner profile (usually after 8-12 exchanges), " +
      "say a warm goodbye for now and call finish_intake in the same turn. Speak first, then call the tool. " +
      "The closing turn asks no question: it thanks them and names one specific thing they did well. Nothing you write after finish_intake reaches the learner. " +
      "On every other turn, end with your single question and call no tool.",
  );
  return parts.join("\n\n");
}

export function profilerTurn(ctx: ProfilerContext, signal?: AbortSignal): AsyncGenerator<string, TurnResult, void> {
  const finish: AgentTool<{ reason: string }> = {
    definition: {
      name: "finish_intake",
      description:
        "Call this once, after your closing words, when you have gathered enough evidence to fill every field of the learner profile. " +
        "Do not call it before at least eight exchanges unless the learner asks to stop.",
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
  if (!messages.length) messages = [{ role: "user", content: "(The student has just joined. Greet them and begin the intake.)" }];
  return streamTurn({ spec: profilerAgent, system, messages, tools: [finish as AgentTool<never>], maxTokens: 600, signal });
}

/** Turn the intake transcript into a structured profile (offline, high effort). */
export async function finalizeProfile(ctx: Omit<ProfilerContext, "onFinish">): Promise<LearnerProfile> {
  const system = buildSystem({ ...profilerAgent, model: config.model, effort: config.analysisEffort }, [contextBlock({ ...ctx, onFinish: () => {} })]);
  const transcript = ctx.session.transcript.map((t) => `${t.role === "user" ? ctx.learner.name : "Tutor"}: ${t.content}`).join("\n");
  // Streamed, like the other offline extractions: never lose a long high-effort generation to the request timeout.
  const { message, parsed } = await streamParsed<LearnerProfile>({
    model: config.model,
    max_tokens: 8_000,
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: config.analysisEffort, format: zodOutputFormat(LearnerProfileSchema) },
    messages: [
      {
        role: "user",
        content: `Here is the full intake conversation. Produce the learner profile. Every field must be justified by something in the transcript.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("Profile extraction was cut off at the output limit.");
  if (!parsed) throw new Error("Profile extraction returned no parsable output.");
  return parsed;
}

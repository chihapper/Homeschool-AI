/**
 * One Anthropic client for the whole server, plus small helpers shared by the agents.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamParams } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { config } from "../config.js";

export const anthropic = new Anthropic();

export type { Effort } from "../config.js";
import type { Effort } from "../config.js";

/** Beta flag + value for server-side refusal fallbacks (see Anthropic docs, "server-side fallback"). */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function fallbackParams(): { betas: string[]; fallbacks: "default" } | Record<string, never> {
  return config.refusalFallbacks ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" } : {};
}

import { modelRules, thinkingOffAllowed, vendorOf } from "./models.js";
import { streamParsedOpenAI } from "./openai.js";
export { MODEL_OPTIONS, modelRules, normalizeModelId, parseModelId } from "./models.js";

/** `output_config.effort` and adaptive thinking are accepted by this model. The rules live in llm/models.ts. */
export function supportsEffort(model: string): boolean {
  return modelRules(model).effort;
}

/**
 * Request params for thinking + effort that the given model accepts (rules in llm/models.ts).
 *
 * "disabled" means "as little thinking as this model allows": `{type: "disabled"}` where the model takes it
 * (Opus 5, Sonnet 5, the 4.6 to 4.8 family), Sonnet 5.5's `{type: "between_tools"}` (no thinking before the
 * first words, which is what a speaking call needs), or plain adaptive at the given effort on the models that
 * never turn thinking off (Opus 5.5, Fable, Mythos), where low effort is the control. Above the effort at
 * which a model allows thinking off, adaptive is sent rather than a 400.
 */
export function reasoningParams(model: string, effort: Effort, thinking: "adaptive" | "disabled" = "adaptive"): Record<string, unknown> {
  const rules = modelRules(model);
  if (!rules.effort) return {}; // Haiku 4.5 and older: no thinking (fastest), no effort param. Haiku 5.5 has both.
  const params: Record<string, unknown> = { output_config: { effort } };
  if (thinking === "disabled" && thinkingOffAllowed(rules, effort)) {
    params.thinking = { type: rules.thinkingOff };
  } else {
    params.thinking = { type: "adaptive" };
  }
  return params;
}

/** Per-turn latency measurements, recorded on every assistant turn. */
export interface TurnLatency {
  /** ms from request start to first streamed text delta. */
  ttftMs: number;
  /** ms from request start to end of the turn (all tool iterations). */
  totalMs: number;
  /** Number of model round-trips (1 + tool iterations). */
  iterations: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Characters the model wrote after a state-changing tool call, which were dropped rather than spoken. */
  suppressedChars: number;
  /** Characters of private reasoning (adaptive thinking) the model produced before speaking. The usual cause of a slow first word. */
  thinkingChars?: number;
  /** The model called tools before saying anything, costing an extra round trip before the first word. */
  toolsBeforeSpeech?: boolean;
  /** Tutor turns: ms the reflect pass took (notes and phase change), which ran while the learner listened. */
  reflectMs?: number;
  /** Characters of private reasoning in the reflect pass. Costs nobody any waiting. */
  reflectThinkingChars?: number;
  /** Voice turns only: ms from the student's end of speech to the first audio byte sent back. */
  firstAudioMs?: number;
  /** Voice turns only: ms from end of speech to the final transcript (0 for streaming transcription). */
  transcriptMs?: number;
  /** The learner barged in; the reply was cut short and what was spoken is what the transcript holds. */
  interrupted?: boolean;
  /** The meter (domain/cost.ts): the model that spoke, the reflect pass's model and tokens, the voice's characters and the seconds listened. */
  model?: string;
  reflectModel?: string;
  reflectInputTokens?: number;
  reflectCacheReadTokens?: number;
  reflectCacheWriteTokens?: number;
  reflectOutputTokens?: number;
  ttsChars?: number;
  ttsProvider?: string;
  ttsModel?: string;
  sttSeconds?: number;
}

/**
 * A structured-output request that streams, so a long generation is not lost to the request timeout.
 *
 * The SDK's timeout covers the wait for the first bytes of a response; on a non-streaming call the whole
 * generation has to fit inside it, and a big extraction does not (measured 2026-09-23: a 94-chunk
 * curriculum extraction at high effort ran fifteen minutes and failed with "Request timed out"). Streaming
 * keeps bytes flowing and the SDK clears its timer once the response starts. The final message carries
 * `parsed_output`, validated against the schema exactly as `messages.parse` would. Callers still check
 * `stop_reason` before trusting the result.
 */
export async function streamParsed<T>(
  params: MessageStreamParams,
  opts: { onProgress?: (charsSoFar: number) => void; timeout?: number; signal?: AbortSignal } = {},
): Promise<{ message: Anthropic.Message; parsed: T | null }> {
  // The one seam with a second vendor behind it: an OpenAI model ID goes to the Responses API (llm/openai.ts).
  if (vendorOf(params.model) === "openai") return streamParsedOpenAI<T>(params, opts);
  // The signal lets a parent cancel a course build: the request is dropped and its tokens stop with it.
  const stream = anthropic.messages.stream(params, { timeout: opts.timeout ?? 30 * 60 * 1000, ...(opts.signal ? { signal: opts.signal } : {}) });
  // When the first text arrived, kept on usage beside the token counts (see llm/openai.ts for the same on that side).
  const t0 = performance.now();
  let firstDeltaMs: number | undefined;
  stream.on("text", () => {
    firstDeltaMs ??= Math.round(performance.now() - t0);
  });
  if (opts.onProgress) {
    let chars = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      opts.onProgress?.(chars);
    });
  }
  // The SDK parses the JSON inside finalMessage(); when the output was cut off at max_tokens that parse
  // throws an "unterminated string" error before the caller can read stop_reason, so the reason is caught
  // here from the stream itself and named.
  let stopReason: string | null = null;
  stream.on("streamEvent", (event) => {
    if (event.type === "message_delta" && event.delta.stop_reason) stopReason = event.delta.stop_reason;
  });
  let message: Anthropic.Message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    if (stopReason === "max_tokens") {
      throw new Error(`The model hit its output limit (max_tokens ${params.max_tokens}) before finishing, so the structured output is cut off. Ask for less at a time.`);
    }
    throw err;
  }
  const parsed = (message as { parsed_output?: unknown }).parsed_output ?? null;
  if (firstDeltaMs !== undefined) (message.usage as unknown as Record<string, unknown>).first_delta_ms = firstDeltaMs;
  return { message, parsed: parsed as T | null };
}

/** Extract concatenated text from a response's content blocks. */
export function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/** Throw a readable error if the model refused. Callers should check stop_reason before reading content. */
export function assertNotRefused(msg: { stop_reason: string | null; stop_details?: unknown }): void {
  if (msg.stop_reason === "refusal") {
    const details = msg.stop_details as { category?: string | null; explanation?: string } | null | undefined;
    throw new Error(
      `Model declined the request${details?.category ? ` (${details.category})` : ""}${details?.explanation ? `: ${details.explanation}` : ""}`,
    );
  }
}

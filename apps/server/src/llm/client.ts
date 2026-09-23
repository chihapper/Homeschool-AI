/**
 * One Anthropic client for the whole server, plus small helpers shared by the agents.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic();

export type { Effort } from "../config.js";
import type { Effort } from "../config.js";

/** Beta flag + value for server-side refusal fallbacks (see Anthropic docs, "server-side fallback"). */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function fallbackParams(): { betas: string[]; fallbacks: "default" } | Record<string, never> {
  return config.refusalFallbacks ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" } : {};
}

/**
 * `output_config.effort` and adaptive thinking exist on Opus 4.6+ / Sonnet 4.6+ / Opus 5 / Sonnet 5 / Fable.
 * Haiku 4.5 and older models reject them, so callers must gate on this.
 */
export function supportsEffort(model: string): boolean {
  return /claude-(opus|sonnet|fable|mythos)-(4-[6-9]|5|4-[6-9]-|5-)/.test(model) || /claude-(opus|sonnet)-5\b/.test(model);
}

/** Request params for thinking + effort that are valid for the given model. */
export function reasoningParams(model: string, effort: Effort, thinking: "adaptive" | "disabled" = "adaptive"): Record<string, unknown> {
  if (!supportsEffort(model)) return {}; // Haiku 4.5: no thinking (fastest), no effort param.
  const params: Record<string, unknown> = { output_config: { effort } };
  if (thinking === "disabled" && (effort === "low" || effort === "medium" || effort === "high")) {
    params.thinking = { type: "disabled" };
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

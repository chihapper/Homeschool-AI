/**
 * One Anthropic client for the whole server, plus small helpers shared by the agents.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic();

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Beta flag + value for server-side refusal fallbacks (see Anthropic docs, "server-side fallback"). */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function fallbackParams(): { betas: string[]; fallbacks: "default" } | Record<string, never> {
  return config.refusalFallbacks ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" } : {};
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

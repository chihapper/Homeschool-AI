/**
 * What each Claude model accepts, in one place, so a new model is one row here and one entry in MODEL_OPTIONS.
 *
 * Source: Anthropic's migration guides (platform.claude.com/docs/en/models/<model>/migration-guide) and the
 * bundled `claude-api` skill (`/claude-api migrate`). The rules that matter to this app, as of 2026-10-08:
 *  - Model IDs have no date suffix and use hyphens: `claude-sonnet-5-5`, never `claude-sonnet-5.5` (a 404 with
 *    "Did you mean claude-sonnet-5-5?" is what the user hit on 2026-09-30).
 *  - `output_config.effort` exists on Opus and Sonnet 4.6 and later, on Haiku 5.5 (the first Haiku with it), and
 *    on the Fable and Mythos models; Haiku 4.5 and older models reject it, and get no `thinking` field either.
 *  - Turning thinking off differs by generation: Opus 5 and Sonnet 5 (and the 4.6 to 4.8 family) accept
 *    `{type: "disabled"}` (Opus 5 only at effort high or below); Haiku 5.5 accepts it at high or below and
 *    rejects `between_tools` (checked against the API 2026-10-08); Sonnet 5.5 rejects `disabled` and takes
 *    `{type: "between_tools"}` at high or below, with no other field; Opus 5.5, Fable and Mythos cannot turn
 *    thinking off at all, and low effort is the control. `budget_tokens`, `temperature`, `top_p`, `top_k`
 *    and forced `tool_choice` are never sent.
 *  - Opus 5.5's and Haiku 5.5's default effort is medium, so effort is always set explicitly.
 *  - Haiku 5.5 has no server-side refusal fallback (the beta flag is accepted and ignored): a refusal comes back
 *    as `stop_reason: "refusal"` and the client handles it (agents/base.ts). Its prompting guide warns that
 *    reasoning-like text can leak into the reply with thinking off at low effort, which is how the speaking call
 *    runs; watch for it.
 * When a model ships: add its ID to MODEL_OPTIONS, add or adjust its row in `modelRules`, run the tests, and
 * check the guide for anything new (thinking, tool_choice, betas). Nothing else in the app names a model.
 */
import type { Effort } from "../config.js";

/** Models offered in the Settings tab. Any model ID can still be typed in; it is normalised and checked on save. */
export const MODEL_OPTIONS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"] as const;

/** OpenAI models the report may run on (llm/openai.ts; prices checked 2026-10-08: Sol is Sonnet 5.5's, Luna is Haiku 5.5's). */
export const OPENAI_MODEL_OPTIONS = ["gpt-6.1-sol", "gpt-6-luna"] as const;

export type Vendor = "anthropic" | "openai";

/** Which API an ID belongs to. OpenAI's start with "gpt-"; everything else goes to the Claude API. */
export function vendorOf(model: string): Vendor {
  return /^gpt-/i.test(model.trim()) ? "openai" : "anthropic";
}

/** Code defaults when the environment sets nothing: the offline agents on Opus 5.5, the live tutor on Sonnet 5.5 (its lowest thinking setting keeps the first word fast). */
export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_TUTOR_MODEL = "claude-sonnet-5-5";

export interface ModelRules {
  /** `output_config.effort` (and adaptive thinking) are accepted. */
  effort: boolean;
  /**
   * How to run with thinking off: "disabled" (`{type: "disabled"}`), "between_tools" (Sonnet 5.5's lowest
   * setting), or "never" (thinking is always on; low effort is the only control).
   */
  thinkingOff: "disabled" | "between_tools" | "never";
  /** Highest effort at which thinking may be off ("disabled" or "between_tools" is a 400 above it). */
  thinkingOffMaxEffort: "high" | "max";
}

const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

/** A model ID as a person might type it, made canonical: lower case, hyphens, "5.5" as "5-5". */
export function normalizeModelId(input: string): string {
  let id = input.trim().toLowerCase().replace(/\s+/g, "");
  if (vendorOf(id) === "openai") return id; // OpenAI's IDs keep their dots: gpt-6.1-sol
  id = id.replace(/(\d)\.(\d)/g, "$1-$2"); // claude-sonnet-5.5 -> claude-sonnet-5-5
  if (/^(opus|sonnet|haiku|fable|mythos)\b/.test(id)) id = `claude-${id}`; // "sonnet-5-5" -> "claude-sonnet-5-5"
  return id;
}

/** Family and version ("claude-sonnet-5-5" -> sonnet 5.5; "claude-opus-4-8" -> opus 4.8; "claude-opus-5" -> opus 5.0). */
export function parseModelId(model: string): { family: string; version: number } | undefined {
  const m = normalizeModelId(model).match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d))?(?:-\d{8})?$/);
  if (!m) return undefined;
  return { family: m[1], version: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
}

/** The rules for a model. An unrecognised ID gets the newest rules (effort on, thinking never off), the safe default for anything future. */
export function modelRules(model: string): ModelRules {
  const parsed = parseModelId(model);
  if (!parsed) return { effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" };
  const { family, version } = parsed;
  if (family === "haiku") {
    // Haiku 5.5 (2026-10-07) is the first Haiku with effort; thinking off is allowed up to high, like Opus 5.
    if (version >= 5.5) return { effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "high" };
    return { effort: false, thinkingOff: "disabled", thinkingOffMaxEffort: "max" };
  }
  if (family === "fable" || family === "mythos") return { effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" };
  if (version < 4.6) return { effort: false, thinkingOff: "disabled", thinkingOffMaxEffort: "max" };
  if (family === "sonnet") {
    if (version >= 6) return { effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" }; // not yet shipped: the safe rules until its guide is read
    if (version >= 5.5) return { effort: true, thinkingOff: "between_tools", thinkingOffMaxEffort: "high" };
    return { effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "max" };
  }
  // opus
  if (version >= 5.5) return { effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" };
  if (version >= 5) return { effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "high" };
  return { effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "max" };
}

/** True when thinking may be off at this effort on this model. */
export function thinkingOffAllowed(rules: ModelRules, effort: Effort): boolean {
  return rules.thinkingOff !== "never" && EFFORT_RANK[effort] <= EFFORT_RANK[rules.thinkingOffMaxEffort];
}

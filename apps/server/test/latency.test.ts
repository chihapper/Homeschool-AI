import { describe, expect, it } from "vitest";
import { reasoningParams, supportsEffort } from "../src/llm/client.js";
import { buildSystem } from "../src/agents/base.js";
import { latencySummary } from "../src/orchestrator/session.js";
import type { Session } from "../src/domain/types.js";

describe("model-aware reasoning params", () => {
  it("uses effort + adaptive thinking on Opus 5 / Sonnet 5 / Opus 4.6+, nothing on Haiku 4.5", () => {
    expect(supportsEffort("claude-opus-5")).toBe(true);
    expect(supportsEffort("claude-sonnet-5")).toBe(true);
    expect(supportsEffort("claude-opus-4-6")).toBe(true);
    expect(supportsEffort("claude-fable-5-1")).toBe(true);
    expect(supportsEffort("claude-haiku-4-5")).toBe(false);
    expect(reasoningParams("claude-haiku-4-5", "low")).toEqual({});
    expect(reasoningParams("claude-opus-5", "low")).toEqual({ output_config: { effort: "low" }, thinking: { type: "adaptive" } });
    expect(reasoningParams("claude-opus-5", "low", "disabled")).toEqual({ output_config: { effort: "low" }, thinking: { type: "disabled" } });
    // disabled is rejected at xhigh/max: fall back to adaptive
    expect(reasoningParams("claude-opus-5", "xhigh", "disabled").thinking).toEqual({ type: "adaptive" });
  });

  it("turns thinking off the way each 5.5 model allows (Anthropic migration guides, 2026-09-30)", () => {
    // Sonnet 5.5 rejects {type: "disabled"}; its lowest setting is between_tools, accepted up to high effort.
    expect(reasoningParams("claude-sonnet-5-5", "low", "disabled")).toEqual({ output_config: { effort: "low" }, thinking: { type: "between_tools" } });
    expect(reasoningParams("claude-sonnet-5-5", "high", "disabled").thinking).toEqual({ type: "between_tools" });
    expect(reasoningParams("claude-sonnet-5-5", "xhigh", "disabled").thinking).toEqual({ type: "adaptive" });
    expect(reasoningParams("claude-sonnet-5-5", "low")).toEqual({ output_config: { effort: "low" }, thinking: { type: "adaptive" } });
    // Opus 5.5 and Fable never turn thinking off: adaptive at the given effort is the whole control.
    expect(reasoningParams("claude-opus-5-5", "low", "disabled")).toEqual({ output_config: { effort: "low" }, thinking: { type: "adaptive" } });
    expect(reasoningParams("claude-fable-5-1", "medium", "disabled").thinking).toEqual({ type: "adaptive" });
    // Sonnet 5 keeps "disabled" at every effort; Opus 5 only up to high (unchanged).
    expect(reasoningParams("claude-sonnet-5", "max", "disabled").thinking).toEqual({ type: "disabled" });
    // The ID as a person types it still gets the right rules.
    expect(reasoningParams("claude-sonnet-5.5", "low", "disabled").thinking).toEqual({ type: "between_tools" });
    expect(reasoningParams("Claude-Opus-5.5", "low", "disabled").thinking).toEqual({ type: "adaptive" });
  });
});

describe("buildSystem cache breakpoints", () => {
  const spec = { name: "T", role: "r", skills: [] as string[], model: "m", effort: "low" as const };
  it("marks the stable block and optionally the last stable dynamic block", () => {
    const blocks = buildSystem(spec, ["course", "learner", "concept"], 2);
    expect(blocks.map((b) => Boolean(b.cache_control))).toEqual([true, false, true, false]);
    expect(buildSystem(spec, ["a", "b"]).map((b) => Boolean(b.cache_control))).toEqual([true, false, false]);
  });
});

describe("latencySummary", () => {
  it("computes p50 / max / cache hit rate over assistant turns", () => {
    const s: Session = {
      id: "s", learnerId: "l", conceptIndex: 0, phase: "teach", observations: [], pendingDirectives: [], startedAt: "",
      transcript: [
        { role: "assistant", content: "a", at: "", latency: { ttftMs: 400, totalMs: 1200, iterations: 1, cacheReadTokens: 0, cacheWriteTokens: 1000, inputTokens: 100, outputTokens: 50 } },
        { role: "user", content: "u", at: "" },
        { role: "assistant", content: "b", at: "", latency: { ttftMs: 250, totalMs: 900, iterations: 2, cacheReadTokens: 1000, cacheWriteTokens: 0, inputTokens: 150, outputTokens: 60 } },
        { role: "assistant", content: "c", at: "", latency: { ttftMs: 900, totalMs: 2000, iterations: 1, cacheReadTokens: 1000, cacheWriteTokens: 0, inputTokens: 200, outputTokens: 40 } },
      ],
    };
    const r = latencySummary(s);
    expect(r).toEqual({ turns: 3, ttftP50Ms: 400, ttftMaxMs: 900, totalP50Ms: 1200, cacheHitRate: 0.58 });
  });
});

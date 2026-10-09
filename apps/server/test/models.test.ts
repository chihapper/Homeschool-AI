import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, DEFAULT_TUTOR_MODEL, MODEL_OPTIONS, modelRules, normalizeModelId, parseModelId, thinkingOffAllowed } from "../src/llm/models.js";

describe("model IDs", () => {
  it("normalises what a person types into the API spelling", () => {
    expect(normalizeModelId("claude-sonnet-5.5")).toBe("claude-sonnet-5-5"); // the 2026-09-30 slip: a 404 from the API
    expect(normalizeModelId("  Claude-Opus-5.5 ")).toBe("claude-opus-5-5");
    expect(normalizeModelId("sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(normalizeModelId("claude-opus-4-1-20250805")).toBe("claude-opus-4-1-20250805");
  });

  it("reads family and version, with or without a date suffix", () => {
    expect(parseModelId("claude-sonnet-5-5")).toEqual({ family: "sonnet", version: 5.5 });
    expect(parseModelId("claude-opus-5")).toEqual({ family: "opus", version: 5 });
    expect(parseModelId("claude-opus-4-8")).toEqual({ family: "opus", version: 4.8 });
    expect(parseModelId("claude-fable-5-1")).toEqual({ family: "fable", version: 5.1 });
    expect(parseModelId("claude-opus-4-1-20250805")).toEqual({ family: "opus", version: 4.1 });
    expect(parseModelId("gpt-5")).toBeUndefined();
  });

  it("offers the 5.5 models first and defaults to them", () => {
    expect(MODEL_OPTIONS.slice(0, 3)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(DEFAULT_MODEL).toBe("claude-opus-5-5");
    expect(DEFAULT_TUTOR_MODEL).toBe("claude-sonnet-5-5");
    for (const id of MODEL_OPTIONS) expect(normalizeModelId(id)).toBe(id);
  });
});

describe("model rules", () => {
  it("knows how each generation turns thinking off", () => {
    expect(modelRules("claude-sonnet-5-5")).toEqual({ effort: true, thinkingOff: "between_tools", thinkingOffMaxEffort: "high" });
    expect(modelRules("claude-opus-5-5")).toEqual({ effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" });
    expect(modelRules("claude-opus-5")).toEqual({ effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "high" });
    expect(modelRules("claude-sonnet-5")).toEqual({ effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "max" });
    expect(modelRules("claude-opus-4-6")).toEqual({ effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "max" });
    expect(modelRules("claude-fable-5-1").thinkingOff).toBe("never");
    expect(modelRules("claude-haiku-5-5")).toEqual({ effort: true, thinkingOff: "disabled", thinkingOffMaxEffort: "high" }); // checked against the API 2026-10-08
    expect(modelRules("claude-haiku-4-5")).toEqual({ effort: false, thinkingOff: "disabled", thinkingOffMaxEffort: "max" });
    expect(modelRules("claude-sonnet-4-5").effort).toBe(false);
  });

  it("gives an unknown ID the newest rules: effort and adaptive thinking, never a 400 for disabled", () => {
    expect(modelRules("claude-sonnet-6")).toEqual({ effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" });
    expect(modelRules("something-else")).toEqual({ effort: true, thinkingOff: "never", thinkingOffMaxEffort: "max" });
  });

  it("allows thinking off only up to the model ceiling", () => {
    const sonnet55 = modelRules("claude-sonnet-5-5");
    expect(thinkingOffAllowed(sonnet55, "high")).toBe(true);
    expect(thinkingOffAllowed(sonnet55, "xhigh")).toBe(false);
    expect(thinkingOffAllowed(modelRules("claude-opus-5-5"), "low")).toBe(false);
    expect(thinkingOffAllowed(modelRules("claude-haiku-5-5"), "high")).toBe(true);
    expect(thinkingOffAllowed(modelRules("claude-haiku-5-5"), "xhigh")).toBe(false); // a 400: "use effort 'high' or below, or enable thinking"
    expect(thinkingOffAllowed(modelRules("claude-sonnet-5"), "max")).toBe(true);
  });
});

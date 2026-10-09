import { describe, expect, it } from "vitest";
import { courseBuildCost, monthlyUsage, sessionCost, usageRecord } from "../src/domain/cost.js";
import { priceOf, sttUsd, tokensUsd, ttsUsd } from "../src/llm/prices.js";
import type { Course, Learner, MasteryReport, Session } from "../src/domain/types.js";

describe("prices", () => {
  it("prices tokens by model and ignores a dated snapshot suffix", () => {
    expect(tokensUsd("claude-sonnet-5-5", { inputTokens: 1_000_000 })).toBe(2);
    expect(tokensUsd("claude-haiku-5-5", { cacheReadTokens: 12_400, outputTokens: 100 })).toBeCloseTo(0.000124 + 0.00005, 5);
    expect(priceOf("claude-haiku-4-5-20251001")).toEqual(priceOf("claude-haiku-4-5"));
    expect(tokensUsd("gpt-9-nova", { inputTokens: 10 })).toBeUndefined();
    expect(tokensUsd(undefined, { inputTokens: 10 })).toBeUndefined();
  });

  it("prices speech by provider and model, and listening by the hour", () => {
    expect(ttsUsd("inworld", "inworld-tts-2", 10_000)).toBeCloseTo(0.25, 6);
    expect(ttsUsd("elevenlabs", "eleven_flash_v2_5", 1_000)).toBeCloseTo(0.05, 6);
    expect(ttsUsd("inworld", "inworld-tts-9", 1_000)).toBeUndefined();
    expect(ttsUsd("inworld", "inworld-tts-2", 0)).toBe(0);
    expect(sttUsd(3600)).toBeCloseTo(0.15, 6);
  });
});

const lat = (over: Record<string, unknown> = {}) => ({
  ttftMs: 1000, totalMs: 2000, iterations: 1, cacheReadTokens: 12_000, cacheWriteTokens: 0, inputTokens: 400, outputTokens: 100, suppressedChars: 0,
  model: "claude-haiku-5-5",
  reflectModel: "claude-sonnet-5-5", reflectInputTokens: 400, reflectCacheReadTokens: 12_000, reflectCacheWriteTokens: 0, reflectOutputTokens: 300,
  ...over,
});

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: "s1", learnerId: "l1", kind: "lesson", courseId: "c1", lessonId: "lesson-1", conceptIndex: 0, phase: "teach", observations: [], pendingDirectives: [],
    startedAt: "2026-10-09T15:00:00.000Z",
    transcript: [
      { role: "assistant", content: "Hi.", at: "2026-10-09T15:00:05.000Z", latency: lat({ ttsChars: 500, ttsProvider: "inworld", ttsModel: "inworld-tts-2" }) },
      { role: "user", content: "Hello.", at: "2026-10-09T15:00:30.000Z" },
      { role: "assistant", content: "Good.", at: "2026-10-09T15:01:00.000Z", latency: lat({ ttsChars: 500, ttsProvider: "inworld", ttsModel: "inworld-tts-2", sttSeconds: 20 }) },
    ],
    ...over,
  }) as unknown as Session;

describe("what a session cost", () => {
  it("adds the speaking calls, the reflect passes, the voice and the report", () => {
    const report = { sessionId: "s1", usage: { model: "claude-sonnet-5-5", inputTokens: 50_000, outputTokens: 5_000, cacheReadTokens: 0, cacheWriteTokens: 5_000 } } as unknown as MasteryReport;
    const c = sessionCost(session(), { report });
    // speak: 2 turns of (400 in at $0.1 + 12,000 cached at $0.01 + 100 out at $0.5) per million
    expect(c.speak).toBeCloseTo(2 * (400 * 0.1 + 12_000 * 0.01 + 100 * 0.5) / 1e6, 5);
    // reflect: 2 turns of (400 in at $2 + 12,000 cached at $0.1 + 300 out at $10)
    expect(c.reflect).toBeCloseTo(2 * (400 * 2 + 12_000 * 0.1 + 300 * 10) / 1e6, 5);
    // voice: 1,000 characters at $25 per million, plus 20 s of listening at $0.15 an hour
    expect(c.voice).toBeCloseTo(1_000 * 25 / 1e6 + (20 / 3600) * 0.15, 5);
    expect(c.report).toBeCloseTo((50_000 * 2 + 5_000 * 10 + 5_000 * 2.5) / 1e6, 5);
    expect(c.total).toBeCloseTo(c.speak + c.reflect + c.voice + c.report, 5);
    expect(c.turns).toBe(2);
    expect(c.minutes).toBe(1);
    expect(c.listenedSeconds).toBe(20);
    expect(c.unpriced).toEqual([]);
  });

  it("names what it could not price instead of guessing", () => {
    const c = sessionCost(session({ transcript: [{ role: "assistant", content: "Hi.", at: "2026-10-09T15:00:05.000Z", latency: lat({ model: "claude-future-7", reflectModel: undefined, reflectOutputTokens: undefined }) }] } as never));
    expect(c.speak).toBe(0);
    expect(c.unpriced).toEqual(["claude-future-7"]);
    const old = sessionCost(session({ transcript: [{ role: "assistant", content: "Hi.", at: "2026-10-09T15:00:05.000Z", latency: lat({ model: undefined, reflectModel: undefined, reflectOutputTokens: undefined }) }] } as never));
    expect(old.unpriced).toEqual(["a model not recorded"]); // turns recorded before the meter existed
  });

  it("totals a student's month, intakes included, and prices a course build", () => {
    const learners = [{ id: "l1", name: "Sam", profileHistory: [{ sessionId: "s1", usage: { model: "claude-opus-5-5", inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 } }] }] as unknown as Learner[];
    const sessions = [session(), session({ id: "s2", kind: "general-intake", startedAt: "2026-10-09T16:00:00.000Z", transcript: [] }), session({ id: "s3", startedAt: "2026-09-30T16:00:00.000Z" })];
    const m = monthlyUsage("2026-10", sessions, [], learners);
    expect(m.learners).toHaveLength(1);
    expect(m.learners[0]).toMatchObject({ learnerId: "l1", name: "Sam", sessions: 2, lessons: 1, minutes: 1 });
    expect(m.learners[0].usd).toBeCloseTo(sessionCost(sessions[0]).total + (10_000 * 4 + 2_000 * 20) / 1e6, 5);
    expect(m.usd).toBe(m.learners[0].usd);
    const build = courseBuildCost({ usage: [usageRecord("claude-opus-5-5", { input_tokens: 45_000, output_tokens: 40_000 }), usageRecord("mystery-9", { input_tokens: 1, output_tokens: 1 })] } as unknown as Course);
    expect(build.total).toBeCloseTo((45_000 * 4 + 40_000 * 20) / 1e6, 5);
    expect(build.unpriced).toEqual(["mystery-9"]);
  });
});

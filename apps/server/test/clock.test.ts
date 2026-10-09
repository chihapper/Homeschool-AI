import { describe, expect, it } from "vitest";
import { AFTER_CLOSE, CLOSE_INSTRUCTION, clockCall, clockStage, secondsLeft, wrappingUp, wrapUpInstruction } from "../src/domain/clock.js";
import type { Session } from "../src/domain/types.js";

const startedAt = "2026-10-09T15:00:00.000Z";
const at = (minutes: number): Date => new Date(new Date(startedAt).getTime() + minutes * 60_000);
const lesson = { kind: "lesson" as const, startedAt, limitMinutes: 30 };

describe("the session clock", () => {
  it("says nothing while there is time, warns with two minutes left, and closes at the limit", () => {
    expect(clockCall(lesson, at(10))).toBeNull();
    expect(clockCall(lesson, at(27.9))).toBeNull();
    expect(clockCall(lesson, at(28.2))).toEqual({ kind: "warn", minutesLeft: 2 });
    expect(clockCall(lesson, at(29.4))).toEqual({ kind: "warn", minutesLeft: 1 });
    expect(clockCall(lesson, at(30))).toEqual({ kind: "close" });
    expect(clockCall(lesson, at(45))).toEqual({ kind: "close" });
  });

  it("warns once and never closes twice", () => {
    expect(clockCall({ ...lesson, timeWarnedAt: "2026-10-09T15:28:10.000Z" }, at(29))).toBeNull();
    expect(clockCall({ ...lesson, timeWarnedAt: "2026-10-09T15:28:10.000Z" }, at(31))).toEqual({ kind: "close" });
    expect(clockCall({ ...lesson, timeUpAt: "2026-10-09T15:30:05.000Z" }, at(35))).toBeNull();
  });

  it("leaves intakes and unclocked sessions alone", () => {
    expect(clockCall({ ...lesson, kind: "general-intake" }, at(45))).toBeNull();
    expect(clockCall({ ...lesson, kind: "course-intake" }, at(45))).toBeNull();
    expect(clockCall({ kind: "lesson", startedAt }, at(45))).toBeNull();
    expect(clockCall({ kind: undefined, startedAt, limitMinutes: 30 }, at(31))).toEqual({ kind: "close" }); // older sessions have no kind
  });

  it("counts the seconds left for the clock on screen", () => {
    expect(secondsLeft(lesson, at(29.5))).toBe(30);
    expect(secondsLeft(lesson, at(31))).toBe(0);
    expect(secondsLeft({ startedAt }, at(5))).toBeUndefined();
  });

  it("reads the stage back from the session's marks, and announces the warning once", () => {
    const base = { kind: "lesson" as const, transcript: [] as Session["transcript"] };
    expect(clockStage(base)).toBeNull();
    const warned = { ...base, timeWarnedAt: "2026-10-09T15:28:10.000Z" };
    expect(clockStage(warned)).toEqual({ kind: "wrap-up", announce: true });
    // The warning turn has been spoken: the constraint stays, the announcement does not repeat.
    const spokenSince = { ...warned, transcript: [{ role: "assistant" as const, content: "Two minutes left, so one last question.", at: "2026-10-09T15:28:14.000Z" }] };
    expect(clockStage(spokenSince)).toEqual({ kind: "wrap-up", announce: false });
    expect(clockStage({ ...spokenSince, timeUpAt: "2026-10-09T15:30:05.000Z" })).toEqual({ kind: "close" });
    expect(clockStage({ ...warned, kind: "course-intake" })).toBeNull();
    expect(wrappingUp(warned)).toBe(true);
    expect(wrappingUp(base)).toBe(false);
    expect(wrappingUp({ ...warned, kind: "general-intake" })).toBe(false);
  });

  it("tells the tutor what to do in plain words", () => {
    expect(wrapUpInstruction(true)).toMatch(/about two minutes left: tell the learner/);
    expect(wrapUpInstruction(false)).not.toMatch(/tell the learner/);
    expect(wrapUpInstruction(false)).toMatch(/no new concept/);
    expect(CLOSE_INSTRUCTION).toMatch(/Ask no question/);
    expect(AFTER_CLOSE).toMatch(/report/);
  });
});

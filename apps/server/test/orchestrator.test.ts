import { describe, expect, it } from "vitest";
import { applyAdvance } from "../src/orchestrator/session.js";
import type { Course, Lesson, Session } from "../src/domain/types.js";

const lesson: Lesson = { id: "l1", title: "L1", objectives: [], conceptIds: ["a", "b"], guidingQuestions: [], practiceItems: [], order: 0 };
const course: Course = {
  id: "c1", title: "C", subject: "S", level: "7", description: "", lessons: [lesson], chunks: [], sourceFiles: [], createdAt: "",
  concepts: ["a", "b"].map((id) => ({ id, name: id.toUpperCase(), summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] })),
};
function session(over: Partial<Session> = {}): Session {
  return { id: "s", learnerId: "x", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "", ...over };
}

describe("applyAdvance", () => {
  it("walks teach -> inquire -> assess", () => {
    const s = session();
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^OK/); // teach -> assess allowed
    const s2 = session();
    expect(applyAdvance(s2, course, lesson, "inquire", "r")).toMatch(/^OK/);
    expect(s2.phase).toBe("inquire");
    expect(applyAdvance(s2, course, lesson, "inquire", "r")).toMatch(/^Refused/);
    expect(applyAdvance(s2, course, lesson, "assess", "r")).toMatch(/^OK/);
    expect(s2.phase).toBe("assess");
  });

  it("refuses next-concept without recorded evidence", () => {
    const s = session({ phase: "assess" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/Refused: only 0/);
    s.observations.push({ at: "", conceptId: "a", kind: "engagement", evidence: "", note: "" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/Refused: only 0/);
    s.observations.push({ at: "", conceptId: "a", kind: "understanding", evidence: "", note: "" }, { at: "", conceptId: "a", kind: "partial", evidence: "", note: "" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/^OK: moved to concept 2/);
    expect(s.phase).toBe("teach");
    expect(s.conceptIndex).toBe(1);
  });

  it("wraps up after the last concept", () => {
    const s = session({ phase: "assess", conceptIndex: 1, observations: [
      { at: "", conceptId: "b", kind: "understanding", evidence: "", note: "" },
      { at: "", conceptId: "b", kind: "understanding", evidence: "", note: "" },
    ] });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/wrap-up/);
    expect(s.phase).toBe("wrap-up");
  });
});

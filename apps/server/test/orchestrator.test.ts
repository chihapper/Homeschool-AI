import { describe, expect, it } from "vitest";
import { applyAdvance, retrievalDirective, sameEvidence } from "../src/orchestrator/session.js";
import type { Course, Lesson, Session } from "../src/domain/types.js";

const lesson: Lesson = { id: "l1", title: "L1", objectives: [], conceptIds: ["a", "b"], guidingQuestions: [], practiceItems: [], order: 0 };
const course: Course = {
  id: "c1", title: "C", subject: "S", level: "7", description: "", lessons: [lesson], chunks: [], sourceFiles: [], createdAt: "",
  concepts: ["a", "b"].map((id) => ({ id, name: id.toUpperCase(), summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] })),
};
function session(over: Partial<Session> = {}): Session {
  return { id: "s", learnerId: "x", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "", ...over };
}

const taught = (conceptId: string) => ({ at: "", conceptId, kind: "partial" as const, evidence: "said something", note: "" });

describe("applyAdvance", () => {
  it("walks teach -> inquire -> assess", () => {
    const s = session({ observations: [taught("a")] });
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^OK/); // teach -> assess allowed once something is recorded
    const s2 = session({ observations: [taught("a")] });
    expect(applyAdvance(s2, course, lesson, "inquire", "r")).toMatch(/^OK/);
    expect(s2.phase).toBe("inquire");
    expect(applyAdvance(s2, course, lesson, "inquire", "r")).toMatch(/^Refused/);
    expect(applyAdvance(s2, course, lesson, "assess", "r")).toMatch(/^OK/);
    expect(s2.phase).toBe("assess");
  });

  it("refuses to assess a concept nothing has been recorded for, so an untaught concept is never assessed", () => {
    const s = session();
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^Refused: nothing is recorded for a/);
    expect(s.phase).toBe("teach");
    // Engagement alone is not teaching evidence.
    s.observations.push({ at: "", conceptId: "a", kind: "engagement", evidence: "asked for the answer", note: "" });
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^Refused/);
    // Nor is a fact the tutor told them: that is the tutor talking, not the learner showing anything.
    s.observations.push({ at: "", conceptId: "a", kind: "told", evidence: "merged around 753 B.C.", note: "" });
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^Refused/);
    s.observations.push(taught("a"));
    expect(applyAdvance(s, course, lesson, "assess", "r")).toMatch(/^OK/);
  });

  it("refuses next-concept without recorded evidence", () => {
    const s = session({ phase: "assess" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/Refused: only 0/);
    s.observations.push({ at: "", conceptId: "a", kind: "engagement", evidence: "", note: "" }, { at: "", conceptId: "a", kind: "told", evidence: "", note: "" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/Refused: only 0/);
    s.observations.push({ at: "", conceptId: "a", kind: "understanding", evidence: "", note: "" }, { at: "", conceptId: "a", kind: "partial", evidence: "", note: "" });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/^OK: moved to concept 2/);
    expect(s.phase).toBe("teach");
    expect(s.conceptIndex).toBe(1);
  });

  it("walks only the session's frozen concept list, so a concept the parent skipped is never reached", () => {
    // The lesson has a and b; b was skipped in the course's focus before this session started.
    const s = session({ phase: "assess", conceptIds: ["a"], observations: [
      { at: "", conceptId: "a", kind: "understanding", evidence: "", note: "" },
      { at: "", conceptId: "a", kind: "partial", evidence: "", note: "" },
    ] });
    expect(applyAdvance(s, course, lesson, "next-concept", "r")).toMatch(/last concept.*wrap-up/);
    expect(s.phase).toBe("wrap-up");
    expect(s.conceptIndex).toBe(0);
    // The frozen order wins over the lesson's, and the count the tutor hears is the walk's.
    const t = session({ phase: "assess", conceptIds: ["b", "a"], observations: [
      { at: "", conceptId: "b", kind: "understanding", evidence: "", note: "" },
      { at: "", conceptId: "b", kind: "understanding", evidence: "", note: "" },
    ] });
    expect(applyAdvance(t, course, lesson, "next-concept", "r")).toBe("OK: moved to concept 2 of 2: A.");
  });

  it("treats a re-quoted piece of evidence as the same observation", () => {
    const q = '"Romulus kills Remus, and thus the city is named after Romulus."';
    expect(sameEvidence(q, "Romulus kills Remus, and thus the city is named after Romulus")).toBe(true);
    expect(sameEvidence(q, '"Romulus kills Remus, and thus the city is named after Romulus." and "That it was 2 villages that eventually merged."')).toBe(true);
    expect(sameEvidence("it was found in the 750s BC, I believe 752", '"it was found in the 750s BC, I believe 752."')).toBe(true);
    expect(sameEvidence(q, "That it was 2 villages that eventually merged.")).toBe(false);
    // Short quotes only match exactly, so "yes" and "yes, the Senate" stay distinct.
    expect(sameEvidence("yes", "yes, the Senate")).toBe(false);
    expect(sameEvidence("", "")).toBe(true);
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

describe("spaced retrieval", () => {
  it("tells the speaking call to ask one question and names no tool it does not have", () => {
    const d = retrievalDirective("Cell walls", "2026-09-20");
    expect(d).toMatch(/ONE quick retrieval question about "Cell walls"/);
    expect(d).toMatch(/move on to today's concept/);
    expect(d).not.toMatch(/record_observation|record the result/i);
  });
});

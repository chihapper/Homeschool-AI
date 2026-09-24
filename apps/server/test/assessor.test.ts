import { describe, expect, it } from "vitest";
import { assessmentMaterial, REST_OF_COURSE_BUDGET_CHARS } from "../src/agents/assessor-agent.js";
import type { Course, Lesson, Session } from "../src/domain/types.js";

const chunk = (id: string, heading: string, text: string) => ({ id, source: "rome.pdf", headingPath: [heading], text, order: Number(id.slice(-1)) });
const concept = (id: string, chunks: string[]) => ({ id, name: id, summary: `${id} summary`, keyFacts: [`${id} fact`], commonMisconceptions: [], sourceChunkIds: chunks, prerequisites: [] });
const lesson = (id: string, conceptIds: string[], order: number): Lesson => ({ id, title: id, objectives: [], conceptIds, guidingQuestions: [], practiceItems: [], order });
const course: Course = {
  id: "rome", title: "Rome", subject: "History", level: "7", description: "", sourceFiles: [], createdAt: "",
  chunks: [chunk("c0", "WHO WERE THE ROMANS", "Rome was founded in 753 B.C."), chunk("c1", "WHO WERE THE ROMANS", "The Etruscans ruled for a century."), chunk("c5", "GOVERNMENT", "The Etruscans gave Rome coinage and public buildings.")],
  concepts: [concept("founding", ["c0"]), concept("etruscans", ["c1"]), concept("gifts", ["c5"])],
  lessons: [lesson("who", ["founding", "etruscans"], 0), lesson("gov", ["gifts"], 1)],
};
const session = (over: Partial<Session> = {}): Session => ({ id: "s", learnerId: "l", courseId: "rome", lessonId: "who", conceptIndex: 0, phase: "assess", transcript: [], observations: [], pendingDirectives: [], startedAt: "", ...over });

describe("what the assessor audits the tutor against", () => {
  it("gives the lesson's concepts with their own passages, and the rest of a small course after them", () => {
    const { concepts, material, wholeCourse } = assessmentMaterial(session(), course, course.lessons[0]);
    expect(concepts.map((c) => c.id)).toEqual(["founding", "etruscans"]);
    expect(material).toContain("Rome was founded in 753 B.C.");
    expect(material).not.toContain("<retrieved_passages>");
    // The other lesson's passage is there too, so "the book does not mention coinage" cannot be said of a book that does.
    expect(material).toContain("<rest_of_course>");
    expect(material).toContain("coinage and public buildings");
    expect(wholeCourse).toBe(true);
  });

  it("marks the passages the tutor looked up elsewhere in the course, each passage shown once", () => {
    const { material } = assessmentMaterial(session({ retrievedChunkIds: ["c5", "c1"] }), course, course.lessons[0]);
    expect(material).toContain("<retrieved_passages>");
    expect(material.split("coinage and public buildings").length - 1).toBe(1);
    expect(material.split("The Etruscans ruled for a century.").length - 1).toBe(1);
    expect(material).not.toContain("<rest_of_course>"); // nothing left over once every chunk is shown
  });

  it("leaves the rest of a course out when it would not fit, and says so", () => {
    const big: Course = { ...course, chunks: [...course.chunks, chunk("c9", "APPENDIX", "x".repeat(REST_OF_COURSE_BUDGET_CHARS + 1))] };
    const { material, wholeCourse } = assessmentMaterial(session({ retrievedChunkIds: ["c5"] }), big, big.lessons[0]);
    expect(material).toContain("<retrieved_passages>");
    expect(material).not.toContain("<rest_of_course>");
    expect(wholeCourse).toBe(false);
  });

  it("ignores retrieved ids that are no longer in the course and respects the parent's focus", () => {
    const skipped: Course = { ...course, focus: { skippedLessonIds: [], skippedConceptIds: ["etruscans"] } };
    const { concepts, material } = assessmentMaterial(session({ conceptIds: ["founding"], retrievedChunkIds: ["ghost"] }), skipped, skipped.lessons[0]);
    expect(concepts.map((c) => c.id)).toEqual(["founding"]);
    expect(material).not.toContain("<retrieved_passages>");
    expect(material).toContain("<rest_of_course>");
  });
});

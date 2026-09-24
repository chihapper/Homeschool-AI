import { describe, expect, it } from "vitest";
import { assessmentMaterial } from "../src/agents/assessor-agent.js";
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
  it("gives the lesson's concepts with their own passages, and nothing from other lessons by default", () => {
    const { concepts, material } = assessmentMaterial(session(), course, course.lessons[0]);
    expect(concepts.map((c) => c.id)).toEqual(["founding", "etruscans"]);
    expect(material).toContain("Rome was founded in 753 B.C.");
    expect(material).not.toContain("coinage");
    expect(material).not.toContain("<retrieved_passages>");
  });

  it("adds the passages the tutor looked up elsewhere in the course, so a fact fetched from another lesson is not called invented", () => {
    const { material } = assessmentMaterial(session({ retrievedChunkIds: ["c5", "c1"] }), course, course.lessons[0]);
    expect(material).toContain("<retrieved_passages>");
    expect(material).toContain("coinage and public buildings");
    // A passage already shown under a lesson concept is not repeated.
    expect(material.split("The Etruscans ruled for a century.").length - 1).toBe(1);
  });

  it("ignores retrieved ids that are no longer in the course and respects the parent's focus", () => {
    const skipped: Course = { ...course, focus: { skippedLessonIds: [], skippedConceptIds: ["etruscans"] } };
    const { concepts, material } = assessmentMaterial(session({ conceptIds: ["founding"], retrievedChunkIds: ["ghost"] }), skipped, skipped.lessons[0]);
    expect(concepts.map((c) => c.id)).toEqual(["founding"]);
    expect(material).not.toContain("<retrieved_passages>");
  });
});

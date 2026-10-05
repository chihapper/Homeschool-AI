import { describe, expect, it } from "vitest";
import { BANDS, COURSE_PROBES, gradeBand, PASSAGE, planSitting, selectProbeConcepts, stepBand, toCourseKnowledge, UNIT_PROBES } from "../src/domain/intake.js";
import type { Concept, Course, Lesson } from "../src/domain/types.js";

/** A course of `sizes.length` lessons, lesson i holding sizes[i] concepts named l<i>c<j>. */
function courseOf(sizes: number[], prerequisites: Record<string, string[]> = {}, focus?: Course["focus"]): Course {
  const concepts: Concept[] = [];
  const lessons: Lesson[] = sizes.map((n, i) => {
    const ids = Array.from({ length: n }, (_, j) => `l${i + 1}c${j + 1}`);
    for (const id of ids) concepts.push({ id, name: id, summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: prerequisites[id] ?? [] });
    return { id: `l${i + 1}`, title: `Lesson ${i + 1}`, objectives: [], conceptIds: ids, guidingQuestions: [], practiceItems: [], order: i };
  });
  return { id: "c", title: "Course", subject: "History", level: "7", description: "", lessons, concepts, chunks: [], sourceFiles: [], focus, createdAt: "" };
}

describe("the general intake's passage and question bands", () => {
  it("is one short passage, with every band's answers found in it", () => {
    const words = PASSAGE.text.split(/\s+/).length;
    expect(words).toBeGreaterThan(110);
    expect(words).toBeLessThan(170);
    // Each answer leans on a phrase the passage itself uses, so the tutor never has to step outside it.
    for (const band of Object.values(BANDS)) {
      expect(`${band.applyAnswer} ${band.hardAnswer}`).toMatch(/takes up more room|lighter than the same amount|freeze from the bottom up/);
      expect(band.apply.endsWith("?")).toBe(true);
      expect(band.hard.endsWith("?") || band.hard.endsWith(".")).toBe(true);
    }
  });

  it("starts a student in the band for their grade, or their age, or the middle one", () => {
    expect(gradeBand("4")).toBe("A");
    expect(gradeBand("6")).toBe("A");
    expect(gradeBand("Grade 7")).toBe("B");
    expect(gradeBand("9th")).toBe("B");
    expect(gradeBand("10")).toBe("C");
    expect(gradeBand("K")).toBe("A");
    expect(gradeBand(undefined, 9)).toBe("A");
    expect(gradeBand("", 13)).toBe("B");
    expect(gradeBand(undefined, 16)).toBe("C");
    expect(gradeBand()).toBe("B");
    expect(gradeBand("seventh", 16)).toBe("C"); // no number in the grade: the age decides
  });

  it("moves one band at a time and stays inside the three", () => {
    expect(stepBand("B", 1)).toBe("C");
    expect(stepBand("B", -1)).toBe("A");
    expect(stepBand("C", 1)).toBe("C");
    expect(stepBand("A", -1)).toBe("A");
    expect(stepBand("A", 0)).toBe("A");
  });
});

describe("which concepts a course intake asks about", () => {
  it("asks six on a unit: half from the first two lessons, then one from each later stretch", () => {
    const picked = selectProbeConcepts(courseOf([3, 3, 2, 2, 2, 2, 2, 2]));
    expect(picked).toHaveLength(UNIT_PROBES);
    // Two from lesson 1, one from lesson 2 (three for the opening), then lessons 3-8 in three stretches of two.
    expect(picked).toEqual(["l1c1", "l1c2", "l2c1", "l3c1", "l5c1", "l7c1"]);
  });

  it("asks eight on a longer course", () => {
    const picked = selectProbeConcepts(courseOf(Array.from({ length: 14 }, () => 2)));
    expect(picked).toHaveLength(COURSE_PROBES);
    expect(picked.slice(0, 4)).toEqual(["l1c1", "l1c2", "l2c1", "l2c2"]);
    expect(new Set(picked).size).toBe(COURSE_PROBES);
  });

  it("uses every question on the first two lessons when there is nothing after them, and fewer when the course is small", () => {
    expect(selectProbeConcepts(courseOf([4, 4]))).toEqual(["l1c1", "l1c2", "l1c3", "l2c1", "l2c2", "l2c3"]);
    expect(selectProbeConcepts(courseOf([2]))).toEqual(["l1c1", "l1c2"]);
    expect(selectProbeConcepts(courseOf([1, 1, 1]))).toEqual(["l1c1", "l2c1", "l3c1"]);
    expect(selectProbeConcepts(courseOf([]))).toEqual([]);
  });

  it("prefers the concept other concepts build on", () => {
    // In lesson 1 the third concept is a prerequisite of two others; in the later stretch, the second of lesson 3.
    const picked = selectProbeConcepts(courseOf([3, 2, 2, 2], { l1c1: ["l1c3"], l2c1: ["l1c3"], l4c1: ["l3c2"] }));
    expect(picked.slice(0, 2)).toEqual(["l1c3", "l1c1"]);
    expect(picked).toContain("l3c2");
    expect(picked).not.toContain("l3c1");
  });

  it("never asks about a lesson or a concept the parent unticked", () => {
    const course = courseOf([3, 3, 2, 2], {}, { skippedLessonIds: ["l2"], skippedConceptIds: ["l1c1"] });
    const picked = selectProbeConcepts(course);
    expect(picked).not.toContain("l1c1");
    expect(picked.some((id) => id.startsWith("l2"))).toBe(false);
    // The first two KEPT lessons are 1 and 3.
    expect(picked.slice(0, 3)).toEqual(["l1c2", "l1c3", "l3c1"]);
  });

  it("leaves out a concept the caller rules out, and asks about its neighbour instead", () => {
    const course = courseOf([2, 2, 2]);
    const picked = selectProbeConcepts(course, (c) => c.id === "l1c1" || c.id === "l2c1");
    expect(picked).toEqual(["l1c2", "l2c2", "l3c1"]);
    expect(selectProbeConcepts(course, () => true)).toEqual([]);
  });
});

describe("what a sitting consists of", () => {
  it("is the general intake, the course intake and the lesson for a new student", () => {
    expect(planSitting({ hasProfile: false, hasCourse: true, hasCourseRecord: false })).toEqual(["general-intake", "course-intake", "lesson"]);
  });
  it("skips what is already known", () => {
    expect(planSitting({ hasProfile: true, hasCourse: true, hasCourseRecord: false })).toEqual(["course-intake", "lesson"]);
    expect(planSitting({ hasProfile: true, hasCourse: true, hasCourseRecord: true })).toEqual(["lesson"]);
    expect(planSitting({ hasProfile: false, hasCourse: true, hasCourseRecord: true })).toEqual(["general-intake", "lesson"]);
  });
  it("is only the general intake without a course, and nothing at all for a known student without one", () => {
    expect(planSitting({ hasProfile: false, hasCourse: false, hasCourseRecord: false })).toEqual(["general-intake"]);
    expect(planSitting({ hasProfile: true, hasCourse: false, hasCourseRecord: false })).toEqual([]);
  });
  it("goes straight to the lesson when the intakes are skipped", () => {
    expect(planSitting({ hasProfile: false, hasCourse: true, hasCourseRecord: false, skipIntake: true })).toEqual(["lesson"]);
    expect(planSitting({ hasProfile: false, hasCourse: false, hasCourseRecord: false, skipIntake: true })).toEqual([]);
  });
});

describe("the record a course intake leaves behind", () => {
  const meta = { id: "maya__c", learnerId: "maya", courseId: "c", probeConceptIds: ["a", "b", "c"], sessionId: "s1", at: "2026-10-05T10:00:00Z" };
  const extraction = {
    starts: [
      { conceptId: "b", estimate: "some" as const, said: "  two   brothers and a wolf ", confidence: 8, materialSays: "", from: "probe" as const },
      { conceptId: "a", estimate: "none" as const, said: "", confidence: -1, materialSays: "", from: "probe" as const },
      { conceptId: "b", estimate: "can-explain" as const, said: "a second entry for the same concept", confidence: 3, materialSays: "", from: "probe" as const },
      { conceptId: "zzz", estimate: "some" as const, said: "not a concept it was sent to ask about", confidence: 5, materialSays: "", from: "narration" as const },
      { conceptId: "c", estimate: "some" as const, said: "one man built it", confidence: 42, materialSays: " Two villages merged. ", from: "narration" as const },
    ],
    priorKnowledge: ["Knows the legend", "Knows the legend"],
    observedGaps: ["Thinks one man built Rome"],
    guidance: ["Start from the two villages"],
    baselineSummary: " Before starting Rome, Maya knew the legend. ",
  };

  it("keeps one starting point per concept asked about, in the order asked, and treats a missing number as not given", () => {
    const k = toCourseKnowledge(extraction, meta);
    expect(k.starts).toEqual([
      { conceptId: "a", estimate: "none", said: "", from: "probe" },
      { conceptId: "b", estimate: "some", said: "two brothers and a wolf", confidence: 8, from: "probe" },
      { conceptId: "c", estimate: "some", said: "one man built it", materialSays: "Two villages merged.", from: "narration" },
    ]);
    expect(k).toMatchObject({ id: "maya__c", intakeSessionId: "s1", intakeAt: meta.at, createdAt: meta.at, baselineSummary: "Before starting Rome, Maya knew the legend." });
    expect(k.priorKnowledge).toEqual(["Knows the legend"]);
    expect(k.pending).toBeUndefined();
  });

  it("adds its notes to a record that already has some, replaces old starting points, and clears the pending mark", () => {
    const existing = { ...toCourseKnowledge(extraction, { ...meta, sessionId: "s0", at: "2026-09-01T00:00:00Z" }), priorKnowledge: ["Knows the Tiber"], pending: { sessionId: "s1", since: meta.at } };
    const k = toCourseKnowledge({ ...extraction, starts: [extraction.starts[1]] }, meta, existing);
    expect(k.starts.map((s) => s.conceptId)).toEqual(["a"]);
    expect(k.priorKnowledge).toEqual(["Knows the Tiber", "Knows the legend"]);
    expect(k.createdAt).toBe("2026-09-01T00:00:00Z");
    expect(k.intakeSessionId).toBe("s1");
    expect(k.pending).toBeUndefined();
  });
});

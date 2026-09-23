import { describe, expect, it } from "vitest";
import { buildProgress, wasAssessed } from "../src/domain/progress.js";
import type { ConceptMastery, Course, MasteryReport } from "../src/domain/types.js";

const course: Course = {
  id: "c1", title: "Rome", subject: "History", level: "7", description: "", chunks: [], sourceFiles: [], createdAt: "",
  lessons: [{ id: "gov", title: "Government", objectives: [], conceptIds: ["senate", "consuls"], guidingQuestions: [], practiceItems: [], order: 0 }],
  concepts: [
    { id: "senate", name: "The Senate", summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] },
    { id: "consuls", name: "Two consuls", summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] },
  ],
};
const mastery = (conceptId: string, level: number, over: Partial<ConceptMastery> = {}): ConceptMastery => ({ conceptId, level, evidence: level ? ["said something"] : [], misconceptions: [], nextStep: "", ...over });
const report = (createdAt: string, concepts: ConceptMastery[], over: Partial<MasteryReport> = {}): MasteryReport => ({
  sessionId: `s-${createdAt}`, learnerId: "maya", courseId: "c1", lessonId: "gov", concepts, effectiveFormats: [], parentSummary: `summary ${createdAt}`, studentSummary: "",
  recommendedNext: [`next after ${createdAt}`], ungroundedClaims: [], answerSeekingTurns: 0, tutorAnswerGiveaways: 0, createdAt, ...over,
});

describe("progress: where the learner stands across sessions", () => {
  it("is undefined until there is a report for this learner and course", () => {
    expect(buildProgress([], course, "maya", "c1")).toBeUndefined();
    expect(buildProgress([report("2026-09-01", [mastery("senate", 2)], { learnerId: "sam" })], course, "maya", "c1")).toBeUndefined();
    expect(buildProgress([report("2026-09-01", [mastery("senate", 2)], { courseId: "other" })], course, "maya", "c1")).toBeUndefined();
  });

  it("takes the latest level per concept and remembers the one before as the trend, whatever order the reports arrive in", () => {
    const p = buildProgress(
      [report("2026-09-08", [mastery("senate", 3, { misconceptions: ["thinks senators were elected"] })]), report("2026-09-01", [mastery("senate", 1), mastery("consuls", 2)])],
      course, "maya", "c1",
    )!;
    expect(p.sessionsAssessed).toBe(2);
    expect(p.latestSessionAt).toBe("2026-09-08");
    expect(p.concepts).toEqual([
      { conceptId: "senate", name: "The Senate", level: 3, previousLevel: 1, asOf: "2026-09-08", misconceptions: ["thinks senators were elected"] },
      { conceptId: "consuls", name: "Two consuls", level: 2, previousLevel: undefined, asOf: "2026-09-01", misconceptions: [] },
    ]);
    expect(p.latestRecommendedNext).toEqual(["next after 2026-09-08"]);
    expect(p.latestParentSummary).toBe("summary 2026-09-08");
  });

  it("does not let a session that never reached a concept erase the level earned earlier", () => {
    const notReached = mastery("consuls", 0, { nextStep: "Not reached this session." });
    expect(wasAssessed(notReached)).toBe(false);
    expect(wasAssessed(mastery("consuls", 0, { evidence: ["could not say what a consul was"] }))).toBe(true);
    const p = buildProgress([report("2026-09-01", [mastery("consuls", 3)]), report("2026-09-08", [mastery("senate", 1), notReached])], course, "maya", "c1")!;
    expect(p.concepts.find((c) => c.conceptId === "consuls")).toMatchObject({ level: 3, asOf: "2026-09-01", previousLevel: undefined });
  });

  it("lists only the latest session's misconceptions as the things to revisit", () => {
    const p = buildProgress(
      [report("2026-09-01", [mastery("senate", 1, { misconceptions: ["old confusion"] })]), report("2026-09-08", [mastery("senate", 2), mastery("consuls", 1, { misconceptions: ["thinks there was one consul"] })])],
      course, "maya", "c1",
    )!;
    expect(p.misconceptionsAtLatestSession).toEqual([{ conceptId: "consuls", name: "Two consuls", misconceptions: ["thinks there was one consul"] }]);
  });

  it("sums the grounding and answer-seeking counts across sessions and keeps the latest separately", () => {
    const p = buildProgress(
      [
        report("2026-09-01", [mastery("senate", 1)], { ungroundedClaims: ["a", "b"], tutorAnswerGiveaways: 1, answerSeekingTurns: 2 }),
        report("2026-09-08", [mastery("senate", 2)], { ungroundedClaims: [], tutorAnswerGiveaways: 0, answerSeekingTurns: 1 }),
      ],
      course, "maya", "c1",
    )!;
    expect(p.totals).toEqual({ ungroundedClaims: 2, tutorAnswerGiveaways: 1, answerSeekingTurns: 3 });
    expect(p.latest).toEqual({ ungroundedClaims: 0, tutorAnswerGiveaways: 0, answerSeekingTurns: 1 });
  });

  it("still shows a concept the course no longer lists, by id, after the ones it does", () => {
    const p = buildProgress([report("2026-09-01", [mastery("ghost", 2), mastery("senate", 1)])], course, "maya", "c1")!;
    expect(p.concepts.map((c) => [c.conceptId, c.name])).toEqual([["senate", "The Senate"], ["ghost", "ghost"]]);
  });
});

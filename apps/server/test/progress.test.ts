import { describe, expect, it } from "vitest";
import { START_LEVEL, buildProgress, wasAssessed } from "../src/domain/progress.js";
import type { ConceptMastery, Course, CourseKnowledge, MasteryReport } from "../src/domain/types.js";

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

  it("does not let a session that never reached a concept erase the level earned earlier, or show it as a zero", () => {
    const notReached = mastery("consuls", 0, { evidence: ["Not reached. The session ended before this concept."], nextStep: "Not reached this session." });
    expect(wasAssessed(notReached)).toBe(false); // the assessor's scale defines 0 as "no evidence"
    expect(wasAssessed(mastery("consuls", 1))).toBe(true);
    const p = buildProgress([report("2026-09-01", [mastery("consuls", 3)]), report("2026-09-08", [mastery("senate", 1), notReached])], course, "maya", "c1")!;
    expect(p.concepts.find((c) => c.conceptId === "consuls")).toMatchObject({ level: 3, asOf: "2026-09-01", previousLevel: undefined });
    // A concept never reached in any session does not appear at all.
    const q = buildProgress([report("2026-09-08", [mastery("senate", 2), notReached])], course, "maya", "c1")!;
    expect(q.concepts.map((c) => c.conceptId)).toEqual(["senate"]);
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

  it("puts each concept's starting point beside where the student stands now, and lists the ones still to come", () => {
    const knowledge: CourseKnowledge = {
      id: "maya__c1", learnerId: "maya", courseId: "c1", priorKnowledge: [], observedGaps: [], guidance: [], createdAt: "", updatedAt: "", intakeAt: "2026-08-30T09:00:00Z",
      baselineSummary: "Before starting Rome, Maya knew there was a senate.",
      starts: [
        { conceptId: "senate", estimate: "some", said: "old men who voted", confidence: 6, from: "probe" },
        { conceptId: "consuls", estimate: "none", said: "", from: "probe" },
      ],
    };
    const p = buildProgress([report("2026-09-01", [mastery("senate", 3)])], course, "maya", "c1", knowledge)!;
    expect(p.concepts).toHaveLength(1);
    expect(p.concepts[0]).toMatchObject({ conceptId: "senate", level: 3, start: { estimate: "some", said: "old men who voted", confidence: 6 } });
    // Asked about before the course, not yet reached by any session.
    expect(p.startsNotYetTaught).toEqual([{ conceptId: "consuls", name: "Two consuls", estimate: "none", said: "", from: "probe" }]);
    expect(p.baselineSummary).toBe("Before starting Rome, Maya knew there was a senate.");
    // Without a record there is nothing to show, and nothing breaks.
    const bare = buildProgress([report("2026-09-01", [mastery("senate", 3)])], course, "maya", "c1")!;
    expect(bare.concepts[0].start).toBeUndefined();
    expect(bare.startsNotYetTaught).toEqual([]);
    expect(bare.baselineSummary).toBeUndefined();
  });
});

describe("growth: where the student started against where they are now", () => {
  const knowledge = (starts: CourseKnowledge["starts"]): CourseKnowledge => ({
    id: "maya__c1", learnerId: "maya", courseId: "c1", priorKnowledge: [], observedGaps: [], guidance: [], createdAt: "", updatedAt: "", starts,
  });

  it("places the three starting estimates on the mastery ladder the levels define", () => {
    expect(START_LEVEL).toEqual({ none: 0, some: 1, "can-explain": 2 });
  });

  it("calls it movement only when the level passed where they started", () => {
    const k = knowledge([
      { conceptId: "senate", estimate: "none", said: "", from: "probe" },
      { conceptId: "consuls", estimate: "can-explain", said: "two of them, a year each", confidence: 8, from: "probe" },
    ]);
    const g = buildProgress([report("2026-09-01", [mastery("senate", 2), mastery("consuls", 2)])], course, "maya", "c1", k)!.growth;
    // Knew nothing, now explains it: two rungs.
    expect(g.concepts.find((c) => c.conceptId === "senate")).toMatchObject({ move: "gained", startLevel: 0, level: 2, rungs: 2 });
    // Could already explain it and is still explaining it: the session demonstrated, but nothing moved.
    // This is the case a bare "2/4 · Explains" reads as success (Andy on density, 2026-10-12).
    expect(g.concepts.find((c) => c.conceptId === "consuls")).toMatchObject({ move: "held", startLevel: 2, level: 2, rungs: 0 });
    expect(g).toMatchObject({ gained: 1, held: 1, below: 0, untested: 0, rungsGained: 2 });
    expect(g.biggestMove).toMatchObject({ conceptId: "senate", rungs: 2 });
  });

  it("flags a concept the student is now demonstrating below where they said they started", () => {
    const k = knowledge([{ conceptId: "senate", estimate: "can-explain", said: "they made the laws", confidence: 9, from: "probe" }]);
    const g = buildProgress([report("2026-09-01", [mastery("senate", 1)])], course, "maya", "c1", k)!.growth;
    expect(g.concepts[0]).toMatchObject({ move: "below", startLevel: 2, level: 1, rungs: -1 });
    expect(g).toMatchObject({ below: 1, gained: 0, rungsGained: -1 });
    expect(g.biggestMove).toBeUndefined();
  });

  it("separates not-taught-yet from no-baseline, and counts coverage against what the parent still teaches", () => {
    const k = knowledge([{ conceptId: "consuls", estimate: "some", said: "two leaders", confidence: 4, from: "narration" }]);
    const g = buildProgress([report("2026-09-01", [mastery("senate", 2)])], course, "maya", "c1", k)!.growth;
    // Assessed but the intake never asked: no reference point, so no claim about movement.
    const senate = g.concepts.find((c) => c.conceptId === "senate")!;
    expect(senate).toMatchObject({ move: "no-baseline", level: 2 });
    expect(senate.startLevel).toBeUndefined();
    expect(senate.rungs).toBeUndefined();
    // Asked before the course, no session has reached it.
    const consuls = g.concepts.find((c) => c.conceptId === "consuls")!;
    expect(consuls).toMatchObject({ move: "untested", startLevel: 1 });
    expect(consuls.level).toBeUndefined();
    expect(g).toMatchObject({ conceptsKept: 2, conceptsAssessed: 1, conceptsWithBaseline: 1, untested: 1, rungsGained: 0 });
  });

  it("leaves a skipped concept out of coverage, and keeps the history of one skipped after it was taught", () => {
    const narrowed: Course = { ...course, focus: { skippedLessonIds: [], skippedConceptIds: ["consuls"] } };
    const g = buildProgress([report("2026-09-01", [mastery("senate", 2), mastery("consuls", 3)])], narrowed, "maya", "c1")!.growth;
    expect(g.conceptsKept).toBe(1); // the parent teaches one of the two
    expect(g.concepts.find((c) => c.conceptId === "consuls")).toMatchObject({ level: 3, dropped: true });
    expect(g.concepts.find((c) => c.conceptId === "senate")?.dropped).toBeUndefined();
  });

  it("counts what is still wrong, and says nothing about concepts neither asked nor taught", () => {
    const g = buildProgress([report("2026-09-01", [mastery("senate", 2, { misconceptions: ["thinks senators were elected"] })])], course, "maya", "c1")!.growth;
    expect(g.stillMisconceived).toBe(1);
    // consuls was never asked and never reached: it is in the denominator, not a row.
    expect(g.concepts.map((c) => c.conceptId)).toEqual(["senate"]);
    expect(g.conceptsKept).toBe(2);
  });
});

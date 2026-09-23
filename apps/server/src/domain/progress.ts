/**
 * Progress: where a learner stands on a course, read across every mastery report so far.
 *
 * Reports are per session. A parent deciding what to revisit this week needs the latest level per concept,
 * whether it moved since the previous time, and what the child still gets wrong, in one place. This is a
 * pure read-model over reports that already exist: nothing new is stored.
 */
import type { ConceptMastery, Course, MasteryReport } from "./types.js";

export interface ConceptProgress {
  conceptId: string;
  name: string;
  /** Latest mastery level (0-4) from the most recent report that assessed this concept. */
  level: number;
  /** The level the time before, when there was one; the parent reads the pair as a trend. */
  previousLevel?: number;
  /** When the latest level was assessed. */
  asOf: string;
  /** Misconceptions listed at that latest assessment. */
  misconceptions: string[];
}

export interface Counts {
  ungroundedClaims: number;
  tutorAnswerGiveaways: number;
  answerSeekingTurns: number;
}

export interface ProgressSummary {
  learnerId: string;
  courseId: string;
  sessionsAssessed: number;
  latestSessionAt: string;
  /** Latest level per concept, in course order; concepts the course no longer lists come last. */
  concepts: ConceptProgress[];
  /** Concepts with misconceptions still listed in the latest session: what to revisit this week. */
  misconceptionsAtLatestSession: Array<{ conceptId: string; name: string; misconceptions: string[] }>;
  latestRecommendedNext: string[];
  latestParentSummary: string;
  /** Running counts across every report. */
  totals: Counts;
  /** The latest report's counts alone. */
  latest: Counts;
}

/**
 * The assessor writes an entry for every concept the session walked, level 0 with no evidence when the
 * session ended before reaching it. That is "not assessed", not "lost", so it must not overwrite a level
 * earned earlier.
 */
export function wasAssessed(c: ConceptMastery): boolean {
  return c.level > 0 || c.evidence.length > 0 || c.misconceptions.length > 0;
}

const counts = (r: MasteryReport): Counts => ({
  ungroundedClaims: r.ungroundedClaims.length,
  tutorAnswerGiveaways: r.tutorAnswerGiveaways,
  answerSeekingTurns: r.answerSeekingTurns,
});

/** Undefined when this learner has no completed session on this course yet. */
export function buildProgress(reports: MasteryReport[], course: Course, learnerId: string, courseId: string): ProgressSummary | undefined {
  const mine = reports.filter((r) => r.learnerId === learnerId && r.courseId === courseId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!mine.length) return undefined;
  const nameOf = (id: string): string => course.concepts.find((c) => c.id === id)?.name ?? id;

  const seen = new Map<string, ConceptProgress>();
  for (const r of mine) {
    for (const c of r.concepts) {
      if (!wasAssessed(c)) continue;
      const prev = seen.get(c.conceptId);
      seen.set(c.conceptId, { conceptId: c.conceptId, name: nameOf(c.conceptId), level: c.level, previousLevel: prev?.level, asOf: r.createdAt, misconceptions: c.misconceptions });
    }
  }
  const rank = new Map(course.concepts.map((c, i) => [c.id, i] as const));
  const concepts = [...seen.values()].sort((a, b) => (rank.get(a.conceptId) ?? Infinity) - (rank.get(b.conceptId) ?? Infinity));

  const latest = mine[mine.length - 1];
  const totals = mine.map(counts).reduce(
    (a, b) => ({ ungroundedClaims: a.ungroundedClaims + b.ungroundedClaims, tutorAnswerGiveaways: a.tutorAnswerGiveaways + b.tutorAnswerGiveaways, answerSeekingTurns: a.answerSeekingTurns + b.answerSeekingTurns }),
    { ungroundedClaims: 0, tutorAnswerGiveaways: 0, answerSeekingTurns: 0 },
  );
  return {
    learnerId,
    courseId,
    sessionsAssessed: mine.length,
    latestSessionAt: latest.createdAt,
    concepts,
    misconceptionsAtLatestSession: latest.concepts
      .filter((c) => c.misconceptions.length > 0)
      .map((c) => ({ conceptId: c.conceptId, name: nameOf(c.conceptId), misconceptions: c.misconceptions })),
    latestRecommendedNext: latest.recommendedNext,
    latestParentSummary: latest.parentSummary,
    totals,
    latest: counts(latest),
  };
}

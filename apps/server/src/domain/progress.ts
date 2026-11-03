/**
 * Progress: where a learner stands on a course, read across every mastery report so far.
 *
 * Reports are per session. A parent deciding what to revisit this week needs the latest level per concept,
 * whether it moved since the previous time, and what the child still gets wrong, in one place. This is a
 * pure read-model over reports that already exist: nothing new is stored.
 */
import { isConceptKept } from "./focus.js";
import type { ConceptMastery, ConceptStart, Course, CourseKnowledge, MasteryReport, StartingEstimate } from "./types.js";

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
  /** Where the student started on this concept, from the course intake, when it asked about it. */
  start?: ConceptStart;
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
  /** Concepts the course intake asked about that no session has assessed yet: where the student starts on what is still to come. */
  startsNotYetTaught: Array<ConceptStart & { name: string }>;
  /** For the parent: what the student could do before starting the course, in the course intake's words. */
  baselineSummary?: string;
  /** Start against now, per concept and over the unit: the pre/post view (buildGrowth). */
  growth: GrowthSummary;
}

/**
 * The assessor writes an entry for every concept the session walked, level 0 when the session ended before
 * reaching it (its scale defines 0 as "no evidence"). That is "not assessed", not "lost": it must not
 * overwrite a level earned earlier, and it must not appear to a parent as a failing grade.
 */
export function wasAssessed(c: ConceptMastery): boolean {
  return c.level > 0;
}

const counts = (r: MasteryReport): Counts => ({
  ungroundedClaims: r.ungroundedClaims.length,
  tutorAnswerGiveaways: r.tutorAnswerGiveaways,
  answerSeekingTurns: r.answerSeekingTurns,
});

/** Undefined when this learner has no completed session on this course yet. */
export function buildProgress(reports: MasteryReport[], course: Course, learnerId: string, courseId: string, knowledge?: CourseKnowledge): ProgressSummary | undefined {
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
  const starts = knowledge?.starts ?? [];
  const concepts = [...seen.values()]
    .map((c) => {
      const start = starts.find((s) => s.conceptId === c.conceptId);
      return start ? { ...c, start } : c;
    })
    .sort((a, b) => (rank.get(a.conceptId) ?? Infinity) - (rank.get(b.conceptId) ?? Infinity));

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
    startsNotYetTaught: starts.filter((s) => !seen.has(s.conceptId)).map((s) => ({ ...s, name: nameOf(s.conceptId) })),
    ...(knowledge?.baselineSummary ? { baselineSummary: knowledge.baselineSummary } : {}),
    growth: buildGrowth(course, seen, starts),
  };
}

// ---------------------------------------------------------------------------
// Growth: where the student started against where they are now
// ---------------------------------------------------------------------------

/**
 * Where a starting point sits on the mastery ladder, so "before" and "now" can be compared at all.
 *
 * A starting point is NOT an assessed level: it is what the student said about a concept before any
 * teaching, as the course intake read their own words, plus their own confidence number. So this is an
 * approximation, and the parent is told so where it is shown. The ladder's own definitions make the
 * mapping the obvious one — level 1 is "recalls / states facts from the material", level 2 is
 * "explains", and the three estimates are "nothing yet", "some knowledge", "could already explain it".
 *
 * The consequence that matters to a parent: a concept the student could already explain before the
 * course has to reach level 3 to count as movement. Holding at 2 is not learning, and the view says so
 * rather than showing a reassuring "2/4 · Explains" with no reference point.
 */
export const START_LEVEL: Record<StartingEstimate, number> = { none: 0, some: 1, "can-explain": 2 };

export type GrowthMove = "gained" | "held" | "below" | "untested" | "no-baseline";

export interface ConceptGrowth {
  conceptId: string;
  name: string;
  /** What they said before any teaching, when the course intake asked about this concept. */
  start?: ConceptStart;
  /** `start.estimate` on the mastery ladder (START_LEVEL). Absent when there is no starting point. */
  startLevel?: number;
  /** Latest assessed level; absent when no session has assessed this concept. */
  level?: number;
  move: GrowthMove;
  /** Levels climbed since the start, negative when they are now below it. Only when both ends are known. */
  rungs?: number;
  /** Misconceptions at the latest assessment. */
  misconceptions: string[];
  asOf?: string;
  /** The concept is no longer taught in this course: the parent skipped it after it was assessed. */
  dropped?: boolean;
}

/** The unit-level answer: across this course, where did the student start and where are they now. */
export interface GrowthSummary {
  /** Concepts the parent is still teaching: the denominator for coverage. */
  conceptsKept: number;
  /** Of the whole course, how many concepts any session has assessed. */
  conceptsAssessed: number;
  /** Of the kept concepts, how many the course intake recorded a starting point for. */
  conceptsWithBaseline: number;
  gained: number;
  held: number;
  below: number;
  untested: number;
  /** Levels climbed across every concept with both ends known, drops included. */
  rungsGained: number;
  /** The largest single gain, for the one sentence a parent remembers. */
  biggestMove?: ConceptGrowth;
  /** Concepts whose latest assessment still lists something they get wrong. */
  stillMisconceived: number;
  /** One row per concept with a starting point or an assessment, in course order. */
  concepts: ConceptGrowth[];
}

/**
 * Pure: the growth view over reports and starting points that already exist. Nothing new is stored.
 *
 * Rows cover the union of kept concepts, concepts some session assessed, and concepts the intake asked
 * about — so a concept the parent skipped after teaching it keeps its history (marked `dropped`) instead
 * of vanishing, while coverage counts only what they are still teaching.
 */
export function buildGrowth(course: Course, assessed: Map<string, ConceptProgress>, starts: ConceptStart[]): GrowthSummary {
  const keptIds = new Set(course.concepts.filter((c) => isConceptKept(course, c.id)).map((c) => c.id));
  const startOf = new Map(starts.map((s) => [s.conceptId, s] as const));
  const nameOf = (id: string): string => course.concepts.find((c) => c.id === id)?.name ?? id;
  const rank = new Map(course.concepts.map((c, i) => [c.id, i] as const));

  const ids = [...new Set([...keptIds, ...assessed.keys(), ...startOf.keys()])].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));

  const rows: ConceptGrowth[] = [];
  for (const id of ids) {
    const start = startOf.get(id);
    const now = assessed.get(id);
    // Neither asked nor taught: it counts towards coverage but there is nothing to say about it.
    if (!start && !now) continue;
    const startLevel = start ? START_LEVEL[start.estimate] : undefined;
    const move: GrowthMove =
      now === undefined ? "untested" : startLevel === undefined ? "no-baseline" : now.level > startLevel ? "gained" : now.level < startLevel ? "below" : "held";
    rows.push({
      conceptId: id,
      name: nameOf(id),
      ...(start ? { start, startLevel } : {}),
      ...(now ? { level: now.level, asOf: now.asOf } : {}),
      ...(now && startLevel !== undefined ? { rungs: now.level - startLevel } : {}),
      move,
      misconceptions: now?.misconceptions ?? [],
      ...(keptIds.has(id) ? {} : { dropped: true }),
    });
  }

  const count = (m: GrowthMove): number => rows.filter((r) => r.move === m).length;
  const gains = rows.filter((r) => r.move === "gained");
  return {
    conceptsKept: keptIds.size,
    conceptsAssessed: assessed.size,
    conceptsWithBaseline: rows.filter((r) => r.start && keptIds.has(r.conceptId)).length,
    gained: gains.length,
    held: count("held"),
    below: count("below"),
    untested: count("untested"),
    rungsGained: rows.reduce((a, r) => a + (r.rungs ?? 0), 0),
    ...(gains.length ? { biggestMove: gains.reduce((a, b) => ((b.rungs ?? 0) > (a.rungs ?? 0) ? b : a)) } : {}),
    stillMisconceived: rows.filter((r) => r.level !== undefined && r.misconceptions.length > 0).length,
    concepts: rows,
  };
}

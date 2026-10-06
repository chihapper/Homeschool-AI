/**
 * The two intakes, the parts that are plain rules (docs/INTAKE.md): the passage the general intake reads and its
 * questions, which band of questions a student starts with, which concepts a course intake asks about, and
 * what a sitting consists of. Nothing here talks to the model or the store.
 *
 *  - The general intake runs once per student and never uses the parent's course: it reads the same short
 *    passage to every student, so two students can be compared and a parent can read it first.
 *  - The course intake runs once per student per course: one first-step question on each of a handful of
 *    central concepts, with no teaching.
 */
import type { Concept, ConceptStart, Course, CourseIntakeExtraction, CourseKnowledge, SessionKind } from "./types.js";
import { effectiveConceptIds, effectiveLessons } from "./focus.js";
import { normalizeCourseNotes } from "./profile.js";

// ---------------------------------------------------------------------------
// The general intake: one passage, three bands of questions
// ---------------------------------------------------------------------------

/**
 * About 150 words on the physical world, so it carries no worldview. The tutor teaches nothing beyond it, and
 * every question below can be answered from it alone. The parent can read it on the Students tab.
 */
export const PASSAGE = {
  title: "Why ice floats",
  text:
    "Most things shrink a little as they get colder, and a solid usually sinks in its own liquid. Water is the odd one out. " +
    "As water cools toward freezing, its molecules line up in an open pattern that takes up more room, so ice is lighter than the same amount of liquid water, and it floats. " +
    "That is why ice cubes sit at the top of a glass, and why a lake freezes from the top down. " +
    "The ice on top works like a lid: it slows the cold from reaching the water underneath, so fish and plants can live through the winter in the liquid water below. " +
    "If ice sank instead, a lake would freeze from the bottom up, and could freeze solid.",
} as const;

/** What the student is asked after hearing the passage. Said by the orchestrator, so every student hears the same words. */
export const RETELL_PROMPT = "Now tell me about it in your own words, everything you remember.";

export type Band = "A" | "B" | "C";
export const BAND_ORDER: readonly Band[] = ["A", "B", "C"];

export interface BandQuestions {
  /** The grades the band is written for, as a parent reads it. */
  grades: string;
  /** Step 3: use the passage on a case it does not mention. */
  apply: string;
  applyAnswer: string;
  /** Step 4: the hard one. Asked with "it is fine to say you don't know", then "how sure are you, 0 to 10?", then answered. */
  hard: string;
  hardAnswer: string;
}

/**
 * Each band asks for a further inference from the same passage (user, 2026-09-28). The intake starts at the
 * student's grade band; a strong, sure answer earns the next band's question and a weak one the band below, two
 * moves at most. It is adaptive placement in miniature: the band a student reaches is evidence for `depth`.
 * The answers are here so the tutor can judge an answer and, after the hard question only, give the answer
 * from the passage (being asked first and told after is what makes the question worth asking).
 */
export const BANDS: Record<Band, BandQuestions> = {
  A: {
    grades: "grades 4 to 6",
    apply: "You drop an ice cube into a full glass of water. Where does it end up, and what does the passage say is the reason?",
    applyAnswer: "At the top. Ice is lighter than the same amount of liquid water, because as water freezes its molecules line up in an open pattern that takes up more room.",
    hard: "Fish live through the winter under the ice. If ice sank instead of floating, what would happen to the lake, and to the fish?",
    hardAnswer: "The lake would freeze from the bottom up and could freeze solid, so there would be no liquid water left for the fish to live in.",
  },
  B: {
    grades: "grades 7 to 9",
    apply: "Someone fills a bottle to the very top with water, seals it, and puts it in the freezer. What happens to the bottle, and why?",
    applyAnswer: "Water takes up more room as it freezes, because its molecules line up in an open pattern, so the ice pushes on the bottle and it bulges or cracks.",
    hard: "The passage says the ice on top of a lake works like a lid. Walk me through it step by step: why does the ice form on top in the first place, and how does that keep the fish alive?",
    hardAnswer:
      "As water cools toward freezing its molecules line up in an open pattern that takes up more room, so ice is lighter than the same amount of water and floats; the lake freezes from the top down; the ice on top slows the cold from reaching the water underneath, so it stays liquid and the fish live in it through the winter.",
  },
  C: {
    grades: "grade 10 and up",
    apply: "A water pipe runs through an unheated garage, and on a freezing night it bursts. Using only what the passage says, explain why. Then tell me: would it burst if water behaved like most other things when it got cold?",
    applyAnswer: "Water takes up more room as it freezes, so the ice forces the pipe apart. Most things shrink a little as they get colder, so a liquid like that would take up less room and the pipe would not burst.",
    hard: "The passage calls water the odd one out. Suppose it were not. Take me through a winter in that lake, step by step, and then tell me which one fact in the passage everything else depends on.",
    hardAnswer:
      "Ice would be heavier than the water and sink, so the lake would freeze from the bottom up and could freeze solid, with no lid of ice to slow the cold; the fish and plants would not survive. It all rests on one fact: freezing water's molecules line up in an open pattern that takes up more room, which makes ice lighter than the same amount of water.",
  },
};

/**
 * The band a student starts with: from the grade the parent gave, else the age, else the middle band. Grade 5 and
 * below also start in the first band; nothing below it exists.
 */
export function gradeBand(gradeLevel?: string, age?: number): Band {
  const grade = /\d+/.exec(gradeLevel ?? "")?.[0];
  if (grade !== undefined) {
    const g = Number(grade);
    return g <= 6 ? "A" : g <= 9 ? "B" : "C";
  }
  if (/^\s*(k|kindergarten|pre-?k)\b/i.test(gradeLevel ?? "")) return "A";
  if (age !== undefined) return age <= 11 ? "A" : age <= 14 ? "B" : "C";
  return "B";
}

/** One band up or down, staying inside the three. */
export function stepBand(band: Band, move: -1 | 0 | 1): Band {
  return BAND_ORDER[Math.max(0, Math.min(BAND_ORDER.length - 1, BAND_ORDER.indexOf(band) + move))];
}

// ---------------------------------------------------------------------------
// The course intake: which concepts it asks about
// ---------------------------------------------------------------------------

/** A unit (up to about twelve lessons) gets six questions, a longer course eight: ten minutes of a child's patience, not a placement test. */
export const UNIT_LESSONS = 12;
export const UNIT_PROBES = 6;
export const COURSE_PROBES = 8;

/**
 * The concepts a course intake asks about, in the order it asks: the central concepts of the first two kept
 * lessons (they are taught first, so their answers are heard soonest), then one from each later stretch of the
 * course. Within a lesson or a stretch, the concept the most other concepts build on comes first (the curriculum
 * agent records prerequisites), then the order they are taught in. Lessons and concepts the parent unticked are
 * never asked about, and neither is a concept `skip` rules out: the orchestrator passes the faith guard, because
 * a child is not quizzed on faith before the family's material has spoken (docs/INTAKE.md §5), and an answer
 * there must never be filed as "contradicts the material".
 */
export function selectProbeConcepts(course: Course, skip: (concept: Concept) => boolean = () => false): string[] {
  const lessons = effectiveLessons(course);
  if (!lessons.length) return [];
  const askable = new Set(course.concepts.filter((c) => !skip(c)).map((c) => c.id));
  const keptByLesson = lessons.map((l) => effectiveConceptIds(course, l).filter((id) => askable.has(id)));
  const kept = new Set(keptByLesson.flat());
  // How many kept concepts name this one as a prerequisite: a rough measure of how much rests on it.
  const dependents = new Map<string, number>();
  for (const c of course.concepts) {
    if (!kept.has(c.id)) continue;
    for (const p of c.prerequisites ?? []) if (kept.has(p)) dependents.set(p, (dependents.get(p) ?? 0) + 1);
  }
  const central = (ids: string[]): string[] =>
    ids
      .map((id, order) => ({ id, order, weight: dependents.get(id) ?? 0 }))
      .sort((a, b) => b.weight - a.weight || a.order - b.order)
      .map((x) => x.id);

  const total = lessons.length <= UNIT_LESSONS ? UNIT_PROBES : COURSE_PROBES;
  const chosen: string[] = [];
  const take = (ids: string[], n: number): void => {
    for (const id of ids) {
      if (n <= 0) return;
      if (chosen.includes(id)) continue;
      chosen.push(id);
      n -= 1;
    }
  };

  if (!kept.size) return [];
  const opening = keptByLesson.slice(0, 2);
  const later = keptByLesson.slice(2);
  // Half the questions go to the first two lessons, all of them when there is nothing after.
  const fromOpening = later.length ? Math.ceil(total / 2) : total;
  const perLesson = Math.ceil(fromOpening / opening.length);
  for (const ids of opening) take(central(ids), Math.min(perLesson, fromOpening - chosen.length));
  // A short first lesson leaves room: fill it from the same two lessons before moving on.
  take(central(opening.flat()), fromOpening - chosen.length);

  // The rest of the course in equal stretches, one question each.
  const stretches = Math.min(total - chosen.length, later.length);
  for (let i = 0; i < stretches; i++) {
    const from = Math.floor((i * later.length) / stretches);
    const to = Math.floor(((i + 1) * later.length) / stretches);
    take(central(later.slice(from, to).flat()), 1);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// A sitting
// ---------------------------------------------------------------------------

export interface SittingFacts {
  /** The student has a profile, or one is being written from an intake that already happened. */
  hasProfile: boolean;
  /** A course was chosen for the sitting. */
  hasCourse: boolean;
  /** The student already has a record for that course. */
  hasCourseRecord: boolean;
  /** Go straight to the lesson (tests, personas, a parent in a hurry). */
  skipIntake?: boolean;
  /** Leave the general intake out (the parent runs it from the Students tab); the course intake still runs on a new course. */
  skipGeneralIntake?: boolean;
}

/**
 * What a sitting consists of, in order. A new student's first session on a course is the general intake, then
 * the course intake, then the lesson; a known student on a new course skips the first; on a course they have a
 * record for, it is just the lesson. Without a course there is only the general intake to run.
 */
export function planSitting(f: SittingFacts): SessionKind[] {
  if (f.skipIntake) return f.hasCourse ? ["lesson"] : [];
  const plan: SessionKind[] = [];
  if (!f.hasProfile && !f.skipGeneralIntake) plan.push("general-intake");
  if (f.hasCourse && !f.hasCourseRecord) plan.push("course-intake");
  if (f.hasCourse) plan.push("lesson");
  return plan;
}

// ---------------------------------------------------------------------------
// From a course intake's extraction to the record
// ---------------------------------------------------------------------------

/**
 * The course-knowledge record a course intake leaves behind. The starting points are the intake's (asked again,
 * they replace the old ones); the notes are added to whatever the record already held, since a student who has
 * had sessions on the course before the intake has notes worth keeping. Only concepts the intake was sent to ask
 * about are kept, one starting point each; a confidence that is not a number from 0 to 10 was not given.
 */
export function toCourseKnowledge(
  extraction: CourseIntakeExtraction,
  meta: { id: string; learnerId: string; courseId: string; probeConceptIds: string[]; sessionId: string; at: string },
  existing?: CourseKnowledge,
): CourseKnowledge {
  const asked = new Set(meta.probeConceptIds);
  const starts: ConceptStart[] = [];
  for (const s of extraction.starts) {
    if (!asked.has(s.conceptId) || starts.some((x) => x.conceptId === s.conceptId)) continue;
    const said = s.said.replace(/\s+/g, " ").trim();
    const materialSays = s.materialSays.replace(/\s+/g, " ").trim();
    starts.push({
      conceptId: s.conceptId,
      estimate: s.estimate,
      said,
      ...(Number.isInteger(s.confidence) && s.confidence >= 0 && s.confidence <= 10 ? { confidence: s.confidence } : {}),
      ...(materialSays ? { materialSays } : {}),
      from: s.from,
    });
  }
  // In the order the intake asked, whatever order the extraction listed them in.
  starts.sort((a, b) => meta.probeConceptIds.indexOf(a.conceptId) - meta.probeConceptIds.indexOf(b.conceptId));
  const notes = normalizeCourseNotes({
    priorKnowledge: [...(existing?.priorKnowledge ?? []), ...extraction.priorKnowledge],
    observedGaps: [...(existing?.observedGaps ?? []), ...extraction.observedGaps],
    guidance: [...(existing?.guidance ?? []), ...extraction.guidance],
  });
  return {
    id: meta.id,
    learnerId: meta.learnerId,
    courseId: meta.courseId,
    starts,
    ...notes,
    baselineSummary: extraction.baselineSummary.replace(/\s+/g, " ").trim() || undefined,
    intakeSessionId: meta.sessionId,
    intakeAt: meta.at,
    createdAt: existing?.createdAt ?? meta.at,
    updatedAt: meta.at,
  };
}

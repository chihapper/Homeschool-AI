/**
 * Focus: the parent's decision about how much of a course the tutor teaches.
 *
 * Homeschool parents skip and substitute parts of any curriculum as a matter of course, so which lessons
 * and concepts get taught is their call, recorded on the Course (one per family) and never made by an
 * agent. A session reads the focus ONCE, at creation, into `Session.conceptIds`; everything inside a
 * running session walks that frozen list, so a mid-session edit can change neither the walk nor the
 * tutor's cached prompt prefix.
 *
 * Pure functions with no store access, so agents and the orchestrator can both import them.
 */
import type { Course, CourseFocus, Lesson, Session } from "./types.js";

export const EMPTY_FOCUS: CourseFocus = { skippedLessonIds: [], skippedConceptIds: [] };

/** A course built before focus existed, or never edited, teaches everything. */
export function focusOf(course: Course): CourseFocus {
  return course.focus ?? EMPTY_FOCUS;
}

export function isLessonKept(course: Course, lessonId: string): boolean {
  return !focusOf(course).skippedLessonIds.includes(lessonId);
}

/** The concepts of a lesson the tutor should walk: none if the lesson is skipped, else minus the skipped concepts. */
export function effectiveConceptIds(course: Course, lesson: Lesson): string[] {
  const focus = focusOf(course);
  if (focus.skippedLessonIds.includes(lesson.id)) return [];
  return lesson.conceptIds.filter((id) => !focus.skippedConceptIds.includes(id));
}

/** Lessons in the parent's order: the ids they listed first, then the rest in ingested order. */
export function orderedLessons(course: Course): Lesson[] {
  const byIngest = [...course.lessons].sort((a, b) => a.order - b.order);
  const order = focusOf(course).lessonOrder;
  if (!order?.length) return byIngest;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const listed = byIngest.filter((l) => rank.has(l.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...byIngest.filter((l) => !rank.has(l.id))];
}

/** Lessons a session can start on: kept, with at least one kept concept, in the parent's order. */
export function effectiveLessons(course: Course): Lesson[] {
  return orderedLessons(course).filter((l) => effectiveConceptIds(course, l).length > 0);
}

/** Whether a concept is still taught somewhere in the course; keeps spaced retrieval off skipped material. */
export function isConceptKept(course: Course, conceptId: string): boolean {
  return course.lessons.some((l) => effectiveConceptIds(course, l).includes(conceptId));
}

/** What a running session walks: its frozen list, or a live filter for sessions that predate the field. */
export function walkedConceptIds(session: Session, course: Course, lesson: Lesson): string[] {
  return session.conceptIds ?? effectiveConceptIds(course, lesson);
}

/** Drop ids that are not in the course and duplicates, so a stale client cannot leave garbage in the focus. */
export function sanitizeFocus(course: Course, focus: CourseFocus): CourseFocus {
  const lessonIds = new Set(course.lessons.map((l) => l.id));
  const conceptIds = new Set(course.concepts.map((c) => c.id));
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  const out: CourseFocus = {
    skippedLessonIds: uniq(focus.skippedLessonIds.filter((id) => lessonIds.has(id))),
    skippedConceptIds: uniq(focus.skippedConceptIds.filter((id) => conceptIds.has(id))),
  };
  const order = focus.lessonOrder ? uniq(focus.lessonOrder.filter((id) => lessonIds.has(id))) : [];
  if (order.length) out.lessonOrder = order;
  return out;
}

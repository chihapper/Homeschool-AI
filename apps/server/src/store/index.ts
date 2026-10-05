import { CourseKnowledgeSchema, CourseSchema, LearnerSchema, MasteryReportSchema, SessionSchema } from "../domain/types.js";
import type { Course, CourseKnowledge, Learner, MasteryReport, Session } from "../domain/types.js";
import { JsonStore } from "./json-store.js";

export const courses = new JsonStore<Course>("courses", CourseSchema);
export const learners = new JsonStore<Learner>("learners", LearnerSchema);
export const sessions = new JsonStore<Session>("sessions", SessionSchema);
export const reports = new JsonStore<MasteryReport & { id: string }>(
  "reports",
  MasteryReportSchema.extend({ id: MasteryReportSchema.shape.sessionId }),
);
/** What one student knows about one course: starting points from the course intake, and notes the profile pass keeps current. */
export const courseKnowledge = new JsonStore<CourseKnowledge>("course-knowledge", CourseKnowledgeSchema);

/** The id of a learner's record for a course. */
export function knowledgeId(learnerId: string, courseId: string): string {
  return `${learnerId}__${courseId}`;
}

/** A learner's record for a course, if one exists. */
export function knowledgeFor(learnerId: string, courseId: string): CourseKnowledge | undefined {
  return courseKnowledge.get(knowledgeId(learnerId, courseId));
}

/** Every course record a learner has. */
export function knowledgeOf(learnerId: string): CourseKnowledge[] {
  return courseKnowledge.list().filter((k) => k.learnerId === learnerId);
}

/** Save a course record's notes, starting the record if the student has none for the course yet. */
export function putCourseNotes(learnerId: string, courseId: string, notes: Pick<CourseKnowledge, "priorKnowledge" | "observedGaps" | "guidance">): CourseKnowledge {
  const now = new Date().toISOString();
  const existing = knowledgeFor(learnerId, courseId);
  return courseKnowledge.put({
    ...(existing ?? { id: knowledgeId(learnerId, courseId), learnerId, courseId, starts: [], createdAt: now }),
    priorKnowledge: notes.priorKnowledge,
    observedGaps: notes.observedGaps,
    guidance: notes.guidance,
    updatedAt: now,
  });
}

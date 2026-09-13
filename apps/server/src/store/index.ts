import { CourseSchema, LearnerSchema, MasteryReportSchema, SessionSchema } from "../domain/types.js";
import type { Course, Learner, MasteryReport, Session } from "../domain/types.js";
import { JsonStore } from "./json-store.js";

export const courses = new JsonStore<Course>("courses", CourseSchema);
export const learners = new JsonStore<Learner>("learners", LearnerSchema);
export const sessions = new JsonStore<Session>("sessions", SessionSchema);
export const reports = new JsonStore<MasteryReport & { id: string }>(
  "reports",
  MasteryReportSchema.extend({ id: MasteryReportSchema.shape.sessionId }),
);

/**
 * Course builds as background jobs. A build takes from one to ten minutes, so the parent starts it and goes on
 * using the app: the browser asks `GET /api/jobs` every couple of seconds for the stage and an estimated
 * percentage (domain/build-progress.ts) and shows a ring in the corner, then a notification when it is done.
 * Held in memory: a server restart ends a build anyway. A finished job stays listed until the parent dismisses
 * its notification, so a reload of the page still shows it.
 */
import { randomUUID } from "node:crypto";
import { buildPercent, STAGE_LABEL, type BuildStage, type BuildState } from "../domain/build-progress.js";
import type { Course } from "../domain/types.js";

export interface CourseJobView {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  stage: BuildStage;
  label: string;
  percent: number;
  courseId?: string;
  lessons?: number;
  concepts?: number;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

/** What a build reports as it goes. */
export interface BuildTracker {
  structuring(partSourceChars: number[]): void;
  part(index: number, outChars: number): void;
  saving(): void;
}

interface Job {
  id: string;
  title: string;
  state: BuildState;
  course?: Course;
  error?: string;
  endedAt?: number;
}

const jobs = new Map<string, Job>();
/** Finished jobs kept for their notifications; older ones are forgotten first. */
const KEEP_FINISHED = 20;

function view(j: Job, now: number): CourseJobView {
  const percent = buildPercent(j.state, now);
  j.state.shown = percent;
  const status = j.state.stage === "done" ? "done" : j.state.stage === "failed" ? "failed" : "running";
  return {
    id: j.id,
    title: j.course?.title ?? j.title,
    status,
    stage: j.state.stage,
    label: STAGE_LABEL[j.state.stage],
    percent,
    ...(j.course ? { courseId: j.course.id, lessons: j.course.lessons.length, concepts: j.course.concepts.length } : {}),
    ...(j.error ? { error: j.error } : {}),
    startedAt: new Date(j.state.startedAt).toISOString(),
    ...(j.endedAt ? { endedAt: new Date(j.endedAt).toISOString() } : {}),
  };
}

/** Start a build and return at once. `work` reads the files and builds the course, reporting through the tracker. */
export function startCourseJob(title: string, work: (t: BuildTracker) => Promise<Course>, log?: (msg: string) => void): CourseJobView {
  const finished = [...jobs.values()].filter((j) => j.endedAt).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED + 1))) jobs.delete(old.id);
  const job: Job = { id: randomUUID(), title, state: { stage: "reading", startedAt: Date.now(), partSourceChars: [], partOutChars: [] } };
  jobs.set(job.id, job);
  const tracker: BuildTracker = {
    structuring(partSourceChars) {
      job.state.stage = "structuring";
      job.state.structuringAt = Date.now();
      job.state.partSourceChars = partSourceChars;
      job.state.partOutChars = partSourceChars.map(() => 0);
    },
    part(index, outChars) {
      job.state.partOutChars[index] = outChars;
    },
    saving() {
      job.state.stage = "saving";
    },
  };
  // Started on the next tick so the caller has the job's id before any work (or failure) happens.
  setImmediate(() => {
    work(tracker)
      .then((course) => {
        job.course = course;
        job.state.stage = "done";
      })
      .catch((err: unknown) => {
        job.error = err instanceof Error ? err.message : String(err);
        job.state.shown = buildPercent(job.state, Date.now());
        job.state.stage = "failed";
        log?.(`Course build "${title}" failed: ${job.error}`);
      })
      .finally(() => {
        job.endedAt = Date.now();
      });
  });
  return view(job, Date.now());
}

export function listCourseJobs(now = Date.now()): CourseJobView[] {
  return [...jobs.values()].sort((a, b) => a.state.startedAt - b.state.startedAt).map((j) => view(j, now));
}

/** The parent closed the notification: forget a finished job. A running one stays. */
export function dismissCourseJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || !j.endedAt) return false;
  return jobs.delete(id);
}

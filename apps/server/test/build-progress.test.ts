import { describe, expect, it } from "vitest";
import { buildPercent, expectedOutChars, type BuildState } from "../src/domain/build-progress.js";
import { dismissCourseJob, listCourseJobs, startCourseJob } from "../src/ingest/jobs.js";
import type { Course } from "../src/domain/types.js";

const t0 = 1_000_000;
const base = (over: Partial<BuildState> = {}): BuildState => ({ stage: "reading", startedAt: t0, partSourceChars: [], partOutChars: [], ...over });

describe("how far a course build has got", () => {
  it("reads the files between 5 and 15 percent", () => {
    expect(buildPercent(base(), t0)).toBe(5);
    expect(buildPercent(base(), t0 + 600_000)).toBe(15);
  });

  it("moves with the characters each part has written, never reaching 100 before the save", () => {
    const s = base({ stage: "structuring", structuringAt: t0, partSourceChars: [50_000, 50_000], partOutChars: [0, 0] });
    expect(buildPercent(s, t0)).toBe(15);
    const halfway = buildPercent({ ...s, partOutChars: [30_000, 30_000] }, t0);
    expect(halfway).toBeGreaterThan(40);
    expect(halfway).toBeLessThan(80);
    expect(buildPercent({ ...s, partOutChars: [500_000, 500_000] }, t0 + 3_600_000)).toBe(96);
    expect(buildPercent({ ...s, stage: "saving" }, t0)).toBe(97);
    expect(buildPercent({ ...s, stage: "done" }, t0)).toBe(100);
  });

  it("creeps while the model thinks before writing, and never moves backwards", () => {
    const s = base({ stage: "structuring", structuringAt: t0, partSourceChars: [10_000], partOutChars: [0] });
    expect(buildPercent(s, t0 + 60_000)).toBeGreaterThan(15);
    expect(buildPercent({ ...s, shown: 60 }, t0)).toBe(60);
    expect(buildPercent({ ...s, stage: "failed", shown: 42 }, t0)).toBe(42);
  });

  it("expects a small part to write a fair amount", () => {
    expect(expectedOutChars(1_000)).toBe(20_000);
    expect(expectedOutChars(100_000)).toBe(120_000);
  });
});

describe("course builds as background jobs", () => {
  it("returns at once, finishes in the background, and is forgotten only once dismissed", async () => {
    let finish!: (c: Course) => void;
    const job = startCourseJob("Marine Biology", (t) => {
      t.structuring([10_000]);
      return new Promise<Course>((r) => (finish = r));
    });
    expect(job.status).toBe("running");
    expect(dismissCourseJob(job.id)).toBe(false); // a running build cannot be dismissed
    await new Promise((r) => setImmediate(r));
    finish({ id: "marine", title: "Marine Biology 3-8", lessons: [{}, {}], concepts: [{}] } as unknown as Course);
    await new Promise((r) => setTimeout(r, 0));
    const done = listCourseJobs().find((j) => j.id === job.id);
    expect(done).toMatchObject({ status: "done", percent: 100, courseId: "marine", title: "Marine Biology 3-8", lessons: 2, concepts: 1 });
    expect(dismissCourseJob(job.id)).toBe(true);
    expect(listCourseJobs().some((j) => j.id === job.id)).toBe(false);
  });

  it("keeps the reason a build failed", async () => {
    const job = startCourseJob("Bad scan", async () => {
      throw new Error("No text could be extracted from the uploaded material.");
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(listCourseJobs().find((j) => j.id === job.id)).toMatchObject({ status: "failed", error: "No text could be extracted from the uploaded material." });
    dismissCourseJob(job.id);
  });
});

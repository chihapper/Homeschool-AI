import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { courseForEntry, migrateIntakeSplit } from "../src/store/migrate.js";
import { CourseKnowledgeSchema, LearnerSchema } from "../src/domain/types.js";

/** A throwaway data directory holding these records. */
function dataDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hs-migrate-"));
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  return dir;
}
const read = (dir: string, rel: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));

const courses = [
  { id: "plants-1", title: "Unit 3: Plants and photosynthesis" },
  { id: "rome-1", title: "Ancient Rome" },
];
const legacyProfile = {
  intakePreferences: ["analogies"],
  demonstrationPreferences: ["explain-in-own-words"],
  challengeTolerance: "medium",
  pace: "moderate",
  verbalLevel: "casual",
  interests: ["soccer"],
  priorKnowledge: ["Believes plants feed from soil: 'the roots suck up the nutrients'", "Rome: Retold the founding legend unprompted"],
  observedGaps: ["Cannot yet see light as an energy source", "Rome: Could not give the founding date"],
  parentSummary: "Sam learns from examples.",
  tutoringGuidance: ["Open with an example"],
  depth: "simple",
};
const sam = { id: "sam", name: "Sam", gradeLevel: "7", profile: legacyProfile, createdAt: "2026-09-15T00:00:00Z" };
const store = () => ({
  "learners/sam.json": sam,
  "courses/plants-1.json": courses[0],
  "courses/rome-1.json": courses[1],
  // The old intake ran on the plants course, the student's first session; Rome came later.
  "sessions/s1.json": { id: "s1", learnerId: "sam", courseId: "plants-1", startedAt: "2026-09-15T10:00:00Z" },
  "sessions/s2.json": { id: "s2", learnerId: "sam", courseId: "rome-1", startedAt: "2026-09-23T10:00:00Z" },
});

describe("which course an old profile entry belongs to", () => {
  it("follows a tag that names exactly one course, and drops the tag", () => {
    expect(courseForEntry("Rome: Retold the founding legend unprompted", courses)).toEqual({ courseId: "rome-1", text: "Retold the founding legend unprompted" });
    expect(courseForEntry("Plants: thinks soil is food", courses)).toEqual({ courseId: "plants-1", text: "thinks soil is food" });
  });

  it("leaves an entry alone when its opening words are not a course, or fit more than one", () => {
    const quoted = "Believes plants feed from soil: 'the roots suck up the nutrients'";
    expect(courseForEntry(quoted, courses)).toEqual({ text: quoted });
    expect(courseForEntry("No colon here", courses)).toEqual({ text: "No colon here" });
    const two = [...courses, { id: "rome-2", title: "Rome and Greece" }];
    expect(courseForEntry("Rome: knows the legend", two)).toEqual({ text: "Rome: knows the legend" });
  });
});

describe("splitting an old profile into a profile and course records", () => {
  it("moves each entry to its course, drops the preference label, keeps the original, and leaves the rest of the profile alone", () => {
    const dir = dataDir(store());
    const reports = migrateIntakeSplit(dir, "2026-10-05T00:00:00Z");
    expect(reports).toEqual([
      { learnerId: "sam", name: "Sam", unplaced: 0, moved: [{ courseId: "plants-1", priorKnowledge: 1, observedGaps: 1 }, { courseId: "rome-1", priorKnowledge: 1, observedGaps: 1 }] },
    ]);
    const learner = LearnerSchema.parse(read(dir, "learners/sam.json"));
    expect(Object.keys(learner.profile ?? {}).sort()).toEqual(["challengeTolerance", "demonstrationPreferences", "depth", "interests", "pace", "parentSummary", "tutoringGuidance", "verbalLevel"]);
    expect(learner.profile?.interests).toEqual(["soccer"]);
    const plants = CourseKnowledgeSchema.parse(read(dir, "course-knowledge/sam__plants-1.json"));
    expect(plants).toMatchObject({ id: "sam__plants-1", learnerId: "sam", courseId: "plants-1", starts: [], guidance: [], createdAt: "2026-10-05T00:00:00Z" });
    expect(plants.priorKnowledge).toEqual(["Believes plants feed from soil: 'the roots suck up the nutrients'"]);
    expect(plants.observedGaps).toEqual(["Cannot yet see light as an energy source"]);
    const rome = CourseKnowledgeSchema.parse(read(dir, "course-knowledge/sam__rome-1.json"));
    expect(rome.priorKnowledge).toEqual(["Retold the founding legend unprompted"]);
    expect(rome.observedGaps).toEqual(["Could not give the founding date"]);
    expect(rome.intakeAt).toBeUndefined(); // no course intake ran: these are notes, not starting points
    // The untouched original is kept beside the data.
    expect(read(dir, "backups/intake-split/sam.json")).toEqual(sam);
  });

  it("does nothing the second time, and nothing to a record that never had the old fields", () => {
    const dir = dataDir({ ...store(), "learners/new.json": { id: "new", name: "Maya", createdAt: "" } });
    migrateIntakeSplit(dir, "2026-10-05T00:00:00Z");
    const after = fs.readFileSync(path.join(dir, "learners/sam.json"), "utf8");
    expect(migrateIntakeSplit(dir, "2026-10-06T00:00:00Z")).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "learners/sam.json"), "utf8")).toBe(after);
    expect(read(dir, "learners/new.json")).toEqual({ id: "new", name: "Maya", createdAt: "" });
    expect(read(dir, "course-knowledge/sam__rome-1.json").updatedAt).toBe("2026-10-05T00:00:00Z");
    expect(migrateIntakeSplit(path.join(dir, "nowhere"))).toEqual([]);
  });

  it("adds to a course record that already exists without repeating entries or losing its starting points", () => {
    const starts = [{ conceptId: "founding", estimate: "some", said: "two brothers", from: "probe" }];
    const dir = dataDir({
      ...store(),
      "course-knowledge/sam__rome-1.json": { id: "sam__rome-1", learnerId: "sam", courseId: "rome-1", starts, priorKnowledge: ["Retold the founding legend unprompted", "Knows the Tiber"], observedGaps: [], guidance: ["Start from the villages"], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    });
    migrateIntakeSplit(dir, "2026-10-05T00:00:00Z");
    const rome = CourseKnowledgeSchema.parse(read(dir, "course-knowledge/sam__rome-1.json"));
    expect(rome.priorKnowledge).toEqual(["Retold the founding legend unprompted", "Knows the Tiber"]);
    expect(rome.observedGaps).toEqual(["Could not give the founding date"]);
    expect(rome.guidance).toEqual(["Start from the villages"]);
    expect(rome.starts).toHaveLength(1);
    expect(rome.createdAt).toBe("2026-10-01T00:00:00Z");
  });

  it("counts entries no course can be found for, and still keeps them in the backup", () => {
    // No sessions at all, so an untagged entry has nowhere to go.
    const dir = dataDir({ "learners/sam.json": sam, "courses/rome-1.json": courses[1] });
    const [report] = migrateIntakeSplit(dir, "2026-10-05T00:00:00Z");
    expect(report.unplaced).toBe(2);
    expect(report.moved).toEqual([{ courseId: "rome-1", priorKnowledge: 1, observedGaps: 1 }]);
    expect((read(dir, "backups/intake-split/sam.json").profile as { priorKnowledge: string[] }).priorKnowledge).toHaveLength(2);
    expect(LearnerSchema.parse(read(dir, "learners/sam.json")).profile).toBeDefined();
  });
});

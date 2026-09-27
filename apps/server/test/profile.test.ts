import { describe, expect, it } from "vitest";
import { applyRevision, depthOf, describeChange, diffProfile, MAX_GAPS, MAX_GUIDANCE, MAX_INTERESTS, MAX_PRIOR_KNOWLEDGE, normalizeProfile, studentLevel, undoProfileUpdate, type ProfileRevision } from "../src/domain/profile.js";
import { reviseContext } from "../src/agents/profile-agent.js";
import type { Course, Learner, LearnerProfile, MasteryReport, ProfileUpdate, Session } from "../src/domain/types.js";

const profile: LearnerProfile = {
  intakePreferences: ["analogies"],
  demonstrationPreferences: ["explain-in-own-words"],
  challengeTolerance: "medium",
  pace: "moderate",
  verbalLevel: "Casual, short sentences.",
  interests: ["soccer"],
  priorKnowledge: ["Plants: believes plants eat soil"],
  observedGaps: ["Thinks soil is the plant's food"],
  parentSummary: "Sam learns from examples.",
  tutoringGuidance: ["Open with an example"],
};
const learner: Learner = { id: "l", name: "Sam", gradeLevel: "7", profile, createdAt: "" };
const meta = { sessionId: "s1", courseId: "c1", courseTitle: "Rome", at: "2026-09-27T10:00:00Z" };
const revision = (changes: Partial<LearnerProfile>, reasons: ProfileRevision["reasons"] = [], summary = "This session showed steady recall."): ProfileRevision => ({
  profile: { ...profile, ...changes },
  reasons,
  summary,
});

describe("revising the profile after a session", () => {
  it("lands fast-field changes with their reasons, and keeps the parent summary out of the change list", () => {
    const r = revision(
      { priorKnowledge: [...profile.priorKnowledge, "Rome: knows Romulus and Remus were raised by a she-wolf"], observedGaps: [], parentSummary: "Sam now recalls the founding legend." },
      [{ field: "priorKnowledge", why: 'Said unprompted: "they were raised by a wolf".' }, { field: "observedGaps", why: "The soil gap was resolved at level 2 with independent evidence." }],
    );
    const { learner: after, update } = applyRevision(learner, r, meta);
    expect(update?.changes).toEqual([
      { field: "priorKnowledge", from: "", to: "Rome: knows Romulus and Remus were raised by a she-wolf", why: 'Said unprompted: "they were raised by a wolf".' },
      { field: "observedGaps", from: "Thinks soil is the plant's food", to: "", why: "The soil gap was resolved at level 2 with independent evidence." },
    ]);
    expect(update?.held).toEqual([]);
    expect(update?.summary).toBe("This session showed steady recall.");
    expect(update?.previous).toEqual(profile);
    expect(after.profile?.parentSummary).toBe("Sam now recalls the founding legend.");
    expect(after.profileHistory).toHaveLength(1);
    expect(after.profileReviewedAt).toBe(meta.at);
    expect(describeChange(update!.changes[0])).toBe("prior knowledge: + Rome: knows Romulus and Remus were raised by a she-wolf");
    expect(describeChange(update!.changes[1])).toBe("observed gaps: − Thinks soil is the plant's food");
  });

  it("holds a slow field on one session, and lands it when the next session proposes the same", () => {
    const faster = revision({ pace: "fast" }, [{ field: "pace", why: "Answered every question in one try, twice running." }]);
    const first = applyRevision(learner, faster, meta);
    expect(first.learner.profile?.pace).toBe("moderate");
    expect(first.update?.changes).toEqual([]);
    expect(first.update?.held).toEqual([{ field: "pace", from: "moderate", to: "fast", why: "Answered every question in one try, twice running." }]);
    expect(first.update?.summary).toMatch(/Held until another session agrees: pace: moderate → fast\.$/);

    const second = applyRevision(first.learner, faster, { ...meta, sessionId: "s2", at: "2026-09-28T10:00:00Z" });
    expect(second.learner.profile?.pace).toBe("fast");
    expect(second.update?.changes).toEqual([{ field: "pace", from: "moderate", to: "fast", why: "Answered every question in one try, twice running." }]);
    expect(second.update?.held).toEqual([]);
    expect(second.learner.profileHistory).toHaveLength(2);
  });

  it("holds a change to a slow field right after it moved, so one session cannot flip it back", () => {
    const moved: Learner = {
      ...learner,
      profile: { ...profile, pace: "fast" },
      profileHistory: [{ ...meta, summary: "", changes: [{ field: "pace", from: "moderate", to: "fast", why: "" }], held: [], previous: profile }],
    };
    const back = applyRevision(moved, revision({ pace: "moderate" }), { ...meta, sessionId: "s2" });
    expect(back.learner.profile?.pace).toBe("fast");
    expect(back.update?.held).toEqual([{ field: "pace", from: "fast", to: "moderate", why: "" }]);
    // A different value than the one held does not count as agreement either.
    const other = applyRevision(back.learner, revision({ pace: "slow" }), { ...meta, sessionId: "s3" });
    expect(other.learner.profile?.pace).toBe("fast");
    expect(other.update?.held.map((h) => h.to)).toEqual(["slow"]);
  });

  it("holds a rewritten verbal level once, then lands the next session's wording even when the words differ", () => {
    // Live 2026-09-27: two sessions in a row proposed the same rewrite in slightly different words, and an exact match held it both times.
    const first = applyRevision(learner, revision({ verbalLevel: "Two registers: casual in science, full sentences in history." }, [{ field: "verbalLevel", why: "Full sentences in every Rome session." }]), meta);
    expect(first.learner.profile?.verbalLevel).toBe(profile.verbalLevel);
    expect(first.update?.held.map((h) => h.field)).toEqual(["verbalLevel"]);
    const second = applyRevision(first.learner, revision({ verbalLevel: "Two registers so far: casual in science, full punctuated sentences in history." }), { ...meta, sessionId: "s2" });
    expect(second.learner.profile?.verbalLevel).toBe("Two registers so far: casual in science, full punctuated sentences in history.");
    expect(second.update?.held).toEqual([]);
    // The enum fields still need the same value twice.
    const slow = applyRevision(first.learner, revision({ pace: "fast" }), { ...meta, sessionId: "s2" });
    expect(slow.learner.profile?.pace).toBe("moderate");
    // A long rewrite is cut short in a summary line.
    const long = { field: "verbalLevel", from: "x".repeat(200), to: "y".repeat(200), why: "" };
    expect(describeChange(long, 40)).toBe(`verbal level: ${"x".repeat(39)}… → ${"y".repeat(39)}…`);
    expect(describeChange({ field: "pace", from: "moderate", to: "fast", why: "" })).toBe("pace: moderate → fast");
  });

  it("records nothing when nothing changed, apart from when it was reviewed", () => {
    const { learner: after, update } = applyRevision(learner, revision({}), meta);
    expect(update).toBeUndefined();
    expect(after.profileHistory).toBeUndefined();
    expect(after.profileReviewedAt).toBe(meta.at);
    expect(after.profile).toEqual(profile);
  });

  it("keeps the guidance list short, drops repeats and blanks, and fills a missing depth from the old profile", () => {
    const long = Array.from({ length: MAX_GUIDANCE + 3 }, (_, i) => `Rule ${i}`);
    const n = normalizeProfile({ ...profile, tutoringGuidance: long, interests: [" soccer", "soccer", "", "Minecraft "] }, { ...profile, depth: "some-nuance" });
    expect(n.tutoringGuidance).toHaveLength(MAX_GUIDANCE);
    expect(n.interests).toEqual(["soccer", "Minecraft"]);
    // The other lists have ceilings too (nine replayed sessions grew prior knowledge to 40 entries), keeping the first entries.
    const many = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix} ${i}`);
    const capped = normalizeProfile({ ...profile, priorKnowledge: many("fact", 30), observedGaps: many("gap", 30), interests: many("likes", 30) });
    expect(capped.priorKnowledge).toHaveLength(MAX_PRIOR_KNOWLEDGE);
    expect(capped.priorKnowledge[0]).toBe("fact 0");
    expect(capped.observedGaps).toHaveLength(MAX_GAPS);
    expect(capped.interests).toHaveLength(MAX_INTERESTS);
    expect(n.depth).toBe("some-nuance");
    expect(normalizeProfile(profile).depth).toBe("simple");
    expect(diffProfile(profile, { ...profile, parentSummary: "different" })).toEqual([]);
  });

  it("undoes the latest revision and refuses when there is none", () => {
    const { learner: after } = applyRevision(learner, revision({ interests: ["soccer", "Rome"] }), meta);
    const undone = undoProfileUpdate(after);
    expect(undone.profile).toEqual(profile);
    expect(undone.profileHistory).toEqual([]);
    expect(() => undoProfileUpdate(undone)).toThrow(/no revision to undo/);
  });

  it("reads an older profile as simple depth, and tells the checker the grade and the depth", () => {
    expect(depthOf(profile)).toBe("simple");
    expect(depthOf(undefined)).toBe("simple");
    const course = { id: "c1", title: "Rome", subject: "History", level: "Grade 6-8", description: "", lessons: [], concepts: [], chunks: [], sourceFiles: [], createdAt: "" } as Course;
    expect(studentLevel(learner, course)).toBe("Grade 7; ready for the plain version");
    expect(studentLevel({ ...learner, gradeLevel: undefined, profile: { ...profile, depth: "full" } }, course)).toBe("Grade 6-8; ready for the full picture");
  });

  it("shows the pass what was held last time, the session's evidence, and the learner's own words", () => {
    const held: ProfileUpdate = { ...meta, summary: "Quick session.", changes: [], held: [{ field: "pace", from: "moderate", to: "fast", why: "" }], previous: profile };
    const course = { id: "c1", title: "Rome", subject: "History", level: "7", description: "", lessons: [{ id: "l1", title: "Founding", objectives: [], conceptIds: ["founding"], guidingQuestions: [], practiceItems: [], order: 0 }], concepts: [{ id: "founding", name: "The founding legend", summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] }], chunks: [], sourceFiles: [], createdAt: "" } as Course;
    const session: Session = {
      id: "s2", learnerId: "l", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "complete", pendingDirectives: [], startedAt: "",
      transcript: [{ role: "assistant", content: "Who founded Rome?", at: "" }, { role: "user", content: "romulus and remus, raised by a wolf", at: "" }],
      observations: [{ at: "", conceptId: "founding", kind: "understanding", evidence: "raised by a wolf", note: "recalled unprompted" }],
      outsideClaims: [{ id: "o", at: "", claim: "Aphrodite saved Aeneas.", raisedBy: "learner", tutorStance: "confirmed", query: "Aeneas", status: "checked", verdict: "supported" }],
    };
    const report: MasteryReport = { sessionId: "s2", learnerId: "l", courseId: "c1", lessonId: "l1", concepts: [{ conceptId: "founding", level: 2, evidence: ["raised by a wolf"], misconceptions: [], nextStep: "Order the story." }], effectiveFormats: ["explain-in-own-words"], parentSummary: "Sam recalled the legend.", studentSummary: "", recommendedNext: [], ungroundedClaims: [], answerSeekingTurns: 0, tutorAnswerGiveaways: 0, createdAt: "2026-09-28T00:00:00Z" };
    const ctx = reviseContext({ learner: { ...learner, profileHistory: [held] }, course, session, report, priorReports: [{ report: { ...report, sessionId: "s0", createdAt: "2026-09-20T00:00:00Z" }, course }] });
    expect(ctx).toContain("HELD, lands if this session proposes the same: pace: moderate → fast");
    expect(ctx).toContain("- The founding legend: level 2; evidence: raised by a wolf");
    expect(ctx).toContain('"Aphrodite saved Aeneas." (raised by Sam; check: supported)');
    expect(ctx).toContain("<learner_words>\nromulus and remus, raised by a wolf\n</learner_words>");
    expect(ctx).toContain('<earlier_reports>\n<report date="2026-09-20"');
    expect(ctx).toContain("depth: simple");
  });
});

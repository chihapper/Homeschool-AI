import { describe, expect, it } from "vitest";
import { applyRevision, depthOf, describeChange, diffCourseNotes, diffProfile, EMPTY_NOTES, keepWording, MAX_COURSE_GUIDANCE, MAX_GAPS, MAX_GUIDANCE, MAX_INTERESTS, MAX_PRIOR_KNOWLEDGE, normalizeCourseNotes, normalizeProfile, studentLevel, undoProfileUpdate, type ProfileRevision } from "../src/domain/profile.js";
import { reviseContext } from "../src/agents/profile-agent.js";
import type { Course, CourseKnowledge, CourseNotes, Learner, LearnerProfile, MasteryReport, ProfileUpdate, Session } from "../src/domain/types.js";

const profile: LearnerProfile = {
  demonstrationPreferences: ["explain-in-own-words"],
  challengeTolerance: "medium",
  pace: "moderate",
  verbalLevel: "Casual, short sentences.",
  interests: ["soccer"],
  parentSummary: "Sam learns from examples.",
  tutoringGuidance: ["Open with an example"],
};
/** Sam's record for the course the session is on: what the profile used to carry as prior knowledge and gaps. */
const notes: CourseNotes = { priorKnowledge: ["Knows Rome is in Italy"], observedGaps: ["Thinks Romulus founded Rome alone, from nothing"], guidance: [] };
const learner: Learner = { id: "l", name: "Sam", gradeLevel: "7", profile, createdAt: "" };
const meta = { sessionId: "s1", courseId: "c1", courseTitle: "Rome", at: "2026-09-27T10:00:00Z" };
const revision = (changes: Partial<LearnerProfile>, reasons: ProfileRevision["reasons"] = [], summary = "This session showed steady recall."): ProfileRevision => ({
  profile: { ...profile, ...changes },
  reasons,
  summary,
});

describe("revising the profile after a session", () => {
  it("lands changes to the course notes with their reasons, beside the profile, and keeps the parent summary out of the change list", () => {
    const r: ProfileRevision = {
      ...revision({ parentSummary: "Sam now recalls the founding legend." }, [
        { field: "priorKnowledge", why: 'Said unprompted: "they were raised by a wolf".' },
        { field: "observedGaps", why: "The one-founder gap was resolved at level 2 with independent evidence." },
        { field: "courseGuidance", why: "He retold the legend without help." },
      ]),
      course: { priorKnowledge: [...notes.priorKnowledge, "Knows Romulus and Remus were raised by a she-wolf"], observedGaps: [], guidance: ["He knows the legend; start from the two villages"] },
    };
    const { learner: after, course, update } = applyRevision(learner, r, meta, notes);
    expect(update?.changes).toEqual([
      { field: "priorKnowledge", from: "", to: "Knows Romulus and Remus were raised by a she-wolf", why: 'Said unprompted: "they were raised by a wolf".' },
      { field: "observedGaps", from: "Thinks Romulus founded Rome alone, from nothing", to: "", why: "The one-founder gap was resolved at level 2 with independent evidence." },
      { field: "courseGuidance", from: "", to: "He knows the legend; start from the two villages", why: "He retold the legend without help." },
    ]);
    expect(update?.held).toEqual([]);
    expect(update?.summary).toBe("This session showed steady recall.");
    expect(update?.previous).toEqual(profile);
    // The notes as they were ride on the update, so undo can put the course record back too.
    expect(update?.previousCourse).toEqual(notes);
    expect(course).toEqual(r.course);
    expect(after.profile?.parentSummary).toBe("Sam now recalls the founding legend.");
    expect(after.profileHistory).toHaveLength(1);
    expect(after.profileReviewedAt).toBe(meta.at);
    expect(describeChange(update!.changes[0])).toBe("prior knowledge: + Knows Romulus and Remus were raised by a she-wolf");
    expect(describeChange(update!.changes[1])).toBe("observed gaps: − Thinks Romulus founded Rome alone, from nothing");
    expect(describeChange(update!.changes[2])).toBe("course guidance: + He knows the legend; start from the two villages");
  });

  it("starts a course record from the first notes, and leaves it alone when the session changed nothing about the course", () => {
    // No record for this course yet: everything the pass returns is new.
    const first = applyRevision(learner, { ...revision({}), course: { priorKnowledge: ["Knows the Tiber runs through Rome"], observedGaps: [], guidance: [] } }, meta);
    expect(first.course).toEqual({ priorKnowledge: ["Knows the Tiber runs through Rome"], observedGaps: [], guidance: [] });
    expect(first.update?.previousCourse).toEqual(EMPTY_NOTES);
    // The same notes back: no course change, nothing to save, no snapshot.
    const same = applyRevision(learner, { ...revision({ interests: ["soccer", "Rome"] }), course: notes }, meta, notes);
    expect(same.course).toBeUndefined();
    expect(same.update?.previousCourse).toBeUndefined();
    expect(same.update?.changes.map((c) => c.field)).toEqual(["interests"]);
    // A pass that was given no course returns none, and only the profile is looked at.
    expect(applyRevision(learner, revision({}), meta, notes).update).toBeUndefined();
    expect(diffCourseNotes(notes, notes)).toEqual([]);
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
    expect(normalizeProfile({ ...profile, interests: many("likes", 30) }).interests).toHaveLength(MAX_INTERESTS);
    const capped = normalizeCourseNotes({ priorKnowledge: many("fact", 30), observedGaps: [...many("gap", 30), " gap 0 "], guidance: many("rule", 9) });
    expect(capped.priorKnowledge).toHaveLength(MAX_PRIOR_KNOWLEDGE);
    expect(capped.priorKnowledge[0]).toBe("fact 0");
    expect(capped.observedGaps).toHaveLength(MAX_GAPS);
    expect(capped.guidance).toHaveLength(MAX_COURSE_GUIDANCE);
    // A record from before the split may still carry the old keys at run time: normalising leaves them behind.
    const legacy = { ...profile, intakePreferences: ["analogies"], priorKnowledge: ["x"], observedGaps: ["y"] } as LearnerProfile;
    expect(Object.keys(normalizeProfile(legacy)).sort()).toEqual(["challengeTolerance", "demonstrationPreferences", "depth", "interests", "pace", "parentSummary", "tutoringGuidance", "verbalLevel"]);
    expect(n.depth).toBe("some-nuance");
    expect(normalizeProfile(profile).depth).toBe("simple");
    expect(diffProfile(profile, { ...profile, parentSummary: "different" })).toEqual([]);
  });

  it("undoes the latest revision and refuses when there is none", () => {
    const { learner: after } = applyRevision(learner, revision({ interests: ["soccer", "Rome"] }), meta);
    const undone = undoProfileUpdate(after);
    expect(undone.learner.profile).toEqual(profile);
    expect(undone.learner.profileHistory).toEqual([]);
    expect(undone.course).toBeUndefined(); // that revision did not touch a course record
    expect(() => undoProfileUpdate(undone.learner)).toThrow(/no revision to undo/);
    // A revision that changed the course notes hands them back as they were, for that course.
    const withCourse = applyRevision(learner, { ...revision({}), course: { ...notes, priorKnowledge: [] } }, meta, notes);
    expect(undoProfileUpdate(withCourse.learner).course).toEqual({ courseId: "c1", notes });
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
    expect(ctx).toContain("(no record yet for this course: the notes you return start it)");
    expect(ctx).not.toContain("<parent_notes>");
    // With a record and the parent's notes, the pass sees both, and the starting points as a baseline it does not rewrite.
    const knowledge: CourseKnowledge = {
      id: "l__c1", learnerId: "l", courseId: "c1", ...notes, guidance: ["Start from the two villages"], intakeAt: "2026-09-26T09:00:00Z", createdAt: "", updatedAt: "",
      starts: [{ conceptId: "founding", estimate: "some", said: "Romulus built it alone", confidence: 8, materialSays: "two villages merged", from: "probe" }],
    };
    const full = reviseContext({ learner: { ...learner, parentNotes: "He shuts down if rushed." }, course, session, report, knowledge, priorReports: [] });
    expect(full).toContain('<course_record course="Rome">\npriorKnowledge:\n  - Knows Rome is in Italy');
    expect(full).toContain("courseGuidance:\n  - Start from the two villages");
    expect(full).toContain('startingPoints (from the course intake on 2026-09-26; a baseline, not yours to change):\n  - The founding legend: some; said "Romulus built it alone" (sure 8/10); the material says: two villages merged');
    expect(full).toContain("<parent_notes>");
    expect(full).toContain("He shuts down if rushed.");
  });
});

describe("a revision that only re-punctuates an entry changes nothing", () => {
  it("keeps the old wording when the words are the same, and still sees a real change", () => {
    const before = ['"Julius Caesar founded Rome way back"', "Knows the Tiber runs through Rome"];
    expect(keepWording(before, ["Julius Caesar founded Rome way back", "knows the Tiber runs through Rome.", "Knows the seven hills"])).toEqual([...before, "Knows the seven hills"]);
    // The pass took the quotation marks off every course note (2026-10-05): nothing to show the parent.
    const quoted: CourseNotes = { priorKnowledge: ['"Mostly bread, olives, and wine"'], observedGaps: ['"They spoke Italian"'], guidance: [] };
    const bare: CourseNotes = { priorKnowledge: ["Mostly bread, olives, and wine"], observedGaps: ["They spoke Italian", "Rome was right on the coast"], guidance: [] };
    const { course, update } = applyRevision(learner, { ...revision({}), course: bare }, meta, quoted);
    expect(update?.changes).toEqual([{ field: "observedGaps", from: "", to: "Rome was right on the coast", why: "" }]);
    expect(course?.priorKnowledge).toEqual(quoted.priorKnowledge);
    expect(course?.observedGaps).toEqual(['"They spoke Italian"', "Rome was right on the coast"]);
    // The same for the profile's own lists.
    const same = applyRevision(learner, revision({ interests: ["Soccer."], tutoringGuidance: ["open with an example"] }), meta);
    expect(same.update).toBeUndefined();
  });
});

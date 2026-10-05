/**
 * The learner's two records over time: pure helpers for revising them after a session and undoing a revision.
 *
 * Two records, since 2026-10-05 (docs/INTAKE.md):
 *  - the learner profile, how to work with this student across every course, written once by the general intake;
 *  - the course-knowledge record, what this student knows about one course, written by the course intake.
 * After every report the profile pass (agents/profile-agent.ts) proposes a revised profile and revised course
 * notes; this module decides what lands:
 *  - the profile's fast fields (interests, demonstration preferences, tutoring guidance) and all of the course
 *    notes (prior knowledge, gaps, course guidance) change whenever the session's evidence says so;
 *  - the profile's slow fields (pace, challenge tolerance, verbal level, depth) describe the learner rather than
 *    what they know, and one session must not swing them: a change is held until the next session's pass
 *    proposes the same, and only then applied. A change made last time cannot be undone by the next pass
 *    either, for the same reason.
 * Every landed change and every held one is recorded with the session, so the parent sees them and can undo the
 * latest revision, which puts both records back. Nothing here talks to the model or the store.
 */
import type { Course, CourseNotes, Depth, Learner, LearnerProfile, ProfileChange, ProfileUpdate } from "./types.js";

export const PROFILE_FIELDS = ["demonstrationPreferences", "challengeTolerance", "pace", "verbalLevel", "interests", "parentSummary", "tutoringGuidance", "depth"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** The course record's notes as the pass and the parent name them. `courseGuidance` is the record's `guidance`. */
export const COURSE_FIELDS = ["priorKnowledge", "observedGaps", "courseGuidance"] as const;
export type CourseField = (typeof COURSE_FIELDS)[number];
/** Every field a revision can give a reason for. */
export const REVISION_FIELDS = [...PROFILE_FIELDS, ...COURSE_FIELDS] as const;

const COURSE_KEY: Record<CourseField, keyof CourseNotes> = { priorKnowledge: "priorKnowledge", observedGaps: "observedGaps", courseGuidance: "guidance" };

/** Fields that describe the learner rather than what they know. Two consecutive sessions must agree to move one. */
export const SLOW_FIELDS: ReadonlySet<ProfileField> = new Set<ProfileField>(["pace", "challengeTolerance", "verbalLevel", "depth"]);
const LIST_FIELDS: ReadonlySet<ProfileField> = new Set<ProfileField>(["demonstrationPreferences", "interests", "tutoringGuidance"]);
/** The tutor follows every item literally, so the list stays short enough to follow. */
export const MAX_GUIDANCE = 6;
/**
 * Ceilings on the other lists, keeping the first entries (the skill puts the most useful first). Replaying nine
 * Rome sessions on 2026-09-27 grew prior knowledge to 40 entries, gaps to 27 and interests to 16, one per session
 * and never merged; the records sit in the tutor's cached prompt, so they cannot grow without bound.
 */
export const MAX_PRIOR_KNOWLEDGE = 15;
export const MAX_GAPS = 12;
export const MAX_INTERESTS = 10;
export const MAX_COURSE_GUIDANCE = 4;
/** Revisions kept on the record; older ones are dropped. Undo only needs the latest. */
export const MAX_HISTORY = 40;

export const EMPTY_NOTES: CourseNotes = { priorKnowledge: [], observedGaps: [], guidance: [] };

export const DEPTH_LABEL: Record<Depth, string> = {
  simple: "the plain version",
  "some-nuance": "some nuance",
  full: "the full picture",
};

/** A profile from before depth existed reads as "simple". */
export function depthOf(profile: LearnerProfile | undefined): Depth {
  return profile?.depth ?? "simple";
}

/** The student's level as the reference checker and the tutor hear it: grade, and how much nuance they are ready for. */
export function studentLevel(learner: Learner, course: Course): string {
  const grade = learner.gradeLevel ? `Grade ${learner.gradeLevel}` : course.level;
  return `${grade}; ready for ${DEPTH_LABEL[depthOf(learner.profile)]}`;
}

/** What the profile pass returns: the whole revised profile, the course notes as revised, a reason per field it changed, a note for the parent. */
export interface ProfileRevision {
  profile: LearnerProfile;
  /** The notes of the course the session was on. Absent when the pass had no course to revise. */
  course?: CourseNotes;
  reasons: Array<{ field: string; why: string }>;
  summary: string;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const list = (xs: string[] | undefined): string[] => [...new Set((xs ?? []).map(norm).filter(Boolean))];

/**
 * Trim, drop empty and repeated items, keep the guidance list short, fill a missing depth from the old profile.
 * Built field by field, so anything a record from before the split still carries is left behind.
 */
export function normalizeProfile(p: LearnerProfile, before?: LearnerProfile): LearnerProfile {
  return {
    demonstrationPreferences: [...new Set(p.demonstrationPreferences)],
    challengeTolerance: p.challengeTolerance,
    pace: p.pace,
    verbalLevel: norm(p.verbalLevel),
    interests: list(p.interests).slice(0, MAX_INTERESTS),
    parentSummary: norm(p.parentSummary),
    tutoringGuidance: list(p.tutoringGuidance).slice(0, MAX_GUIDANCE),
    depth: p.depth ?? before?.depth ?? "simple",
  };
}

/** The same for a course record's notes. */
export function normalizeCourseNotes(n: CourseNotes): CourseNotes {
  return {
    priorKnowledge: list(n.priorKnowledge).slice(0, MAX_PRIOR_KNOWLEDGE),
    observedGaps: list(n.observedGaps).slice(0, MAX_GAPS),
    guidance: list(n.guidance).slice(0, MAX_COURSE_GUIDANCE),
  };
}

/** What an entry says, whatever it is wrapped in: case, punctuation, quotation marks and spacing set aside. */
const entryKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Keep the old wording of every entry the revision only re-punctuated. The pass is told not to reword for style
 * and still does: on 2026-10-05 it took the quotation marks off twenty-two course notes, which the parent would
 * have seen as twenty-two removals and twenty-two additions that changed nothing.
 */
export function keepWording(before: string[], after: string[]): string[] {
  const old = new Map(before.map((item) => [entryKey(item), item] as const));
  return after.map((item) => old.get(entryKey(item)) ?? item);
}

/** Every difference between two profiles, one entry per changed scalar and per list item added or removed. The parent summary is not a fact about the learner and is left out. */
export function diffProfile(before: LearnerProfile, after: LearnerProfile, reasons: ProfileRevision["reasons"] = []): ProfileChange[] {
  const why = (field: ProfileField): string => norm(reasons.find((r) => r.field === field)?.why ?? "");
  const out: ProfileChange[] = [];
  for (const field of PROFILE_FIELDS) {
    if (field === "parentSummary") continue;
    if (LIST_FIELDS.has(field)) {
      const a = (before[field] as string[] | undefined) ?? [];
      const b = (after[field] as string[] | undefined) ?? [];
      for (const item of a) if (!b.includes(item)) out.push({ field, from: item, to: "", why: why(field) });
      for (const item of b) if (!a.includes(item)) out.push({ field, from: "", to: item, why: why(field) });
    } else {
      // A profile from before depth existed reads as "simple", so filling that in is not a change.
      const a = field === "depth" ? depthOf(before) : String(before[field] ?? "");
      const b = field === "depth" ? depthOf(after) : String(after[field] ?? "");
      if (a !== b) out.push({ field, from: a, to: b, why: why(field) });
    }
  }
  return out;
}

/** Every difference between two versions of a course record's notes: one entry per item added or removed. */
export function diffCourseNotes(before: CourseNotes, after: CourseNotes, reasons: ProfileRevision["reasons"] = []): ProfileChange[] {
  const out: ProfileChange[] = [];
  for (const field of COURSE_FIELDS) {
    const why = norm(reasons.find((r) => r.field === field)?.why ?? "");
    const a = before[COURSE_KEY[field]] ?? [];
    const b = after[COURSE_KEY[field]] ?? [];
    for (const item of a) if (!b.includes(item)) out.push({ field, from: item, to: "", why });
    for (const item of b) if (!a.includes(item)) out.push({ field, from: "", to: item, why });
  }
  return out;
}

/**
 * Slow fields that are free text. The hold is on the field, not the words: two passes never write the same
 * paragraph twice, so an exact match held a verbal-level rewrite through two live sessions on 2026-09-27.
 */
const FREE_TEXT_SLOW: ReadonlySet<ProfileField> = new Set<ProfileField>(["verbalLevel"]);

/** The previous session held this change: same field and value, or for free text, a revision of the same field. */
const agrees = (held: ProfileChange, c: ProfileChange): boolean =>
  held.field === c.field && (FREE_TEXT_SLOW.has(c.field as ProfileField) || (held.from === c.from && held.to === c.to));

/** Put one change back the way it was. */
function revert(profile: LearnerProfile, c: ProfileChange): void {
  const field = c.field as ProfileField;
  if (LIST_FIELDS.has(field)) {
    const xs = [...((profile[field] as string[] | undefined) ?? [])];
    if (c.to) profile[field] = xs.filter((x) => x !== c.to) as never;
    else if (c.from && !xs.includes(c.from)) profile[field] = [...xs, c.from] as never;
  } else {
    profile[field] = c.from as never;
  }
}

export interface RevisionMeta {
  sessionId: string;
  courseId?: string;
  courseTitle?: string;
  at: string;
}

/**
 * Land a proposed revision. Returns the learner as it should be saved, the course notes as they should be saved
 * (only when the revision changed them), and the update recorded on the learner, or no update when the session
 * changed nothing (only `profileReviewedAt` moves). `courseBefore` is the course record's notes as they stand;
 * absent means the student has no record for the course yet, and the first notes create it.
 */
export function applyRevision(learner: Learner, revision: ProfileRevision, meta: RevisionMeta, courseBefore?: CourseNotes): { learner: Learner; course?: CourseNotes; update?: ProfileUpdate } {
  const before = learner.profile;
  if (!before) throw new Error(`${learner.name} has no profile to revise; the intake writes the first one.`);
  const candidate = normalizeProfile(revision.profile, before);
  candidate.interests = keepWording(before.interests, candidate.interests);
  candidate.tutoringGuidance = keepWording(before.tutoringGuidance, candidate.tutoringGuidance);
  const previousHeld = learner.profileHistory?.at(-1)?.held ?? [];
  const changes: ProfileChange[] = [];
  const held: ProfileChange[] = [];
  for (const c of diffProfile(before, candidate, revision.reasons)) {
    // A slow field moves only when the previous session's pass proposed this too and it was held then.
    if (SLOW_FIELDS.has(c.field as ProfileField) && !previousHeld.some((h) => agrees(h, c))) {
      revert(candidate, c);
      held.push(c);
    } else {
      changes.push(c);
    }
  }
  // The course notes are all fast: what a student knows about a course changes with every session on it.
  const notesBefore = courseBefore ? normalizeCourseNotes(courseBefore) : EMPTY_NOTES;
  const proposed = revision.course ? normalizeCourseNotes(revision.course) : undefined;
  const notesAfter = proposed && {
    priorKnowledge: keepWording(notesBefore.priorKnowledge, proposed.priorKnowledge),
    observedGaps: keepWording(notesBefore.observedGaps, proposed.observedGaps),
    guidance: keepWording(notesBefore.guidance, proposed.guidance),
  };
  const courseChanges = notesAfter ? diffCourseNotes(notesBefore, notesAfter, revision.reasons) : [];
  changes.push(...courseChanges);

  const reviewed = { ...learner, profileReviewedAt: meta.at };
  if (!changes.length && !held.length) return { learner: reviewed };
  const heldNote = held.length ? ` Held until another session agrees: ${held.map((h) => describeChange(h, 80)).join("; ")}.` : "";
  const update: ProfileUpdate = {
    at: meta.at,
    sessionId: meta.sessionId,
    courseId: meta.courseId,
    courseTitle: meta.courseTitle,
    summary: (norm(revision.summary) || "The profile was reviewed after this session.") + heldNote,
    changes,
    held,
    previous: before,
    ...(courseChanges.length ? { previousCourse: notesBefore } : {}),
  };
  return {
    learner: { ...reviewed, profile: candidate, profileHistory: [...(learner.profileHistory ?? []), update].slice(-MAX_HISTORY) },
    ...(courseChanges.length ? { course: notesAfter } : {}),
    update,
  };
}

/** "pace: moderate → fast", "prior knowledge: + Knows the founding legend", "observed gaps: − ...". A value longer than `max` characters is cut short. */
export function describeChange(c: ProfileChange, max = 120): string {
  const field = c.field.replace(/([A-Z])/g, " $1").toLowerCase();
  const clip = (s: string): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  if (c.from && c.to) return `${field}: ${clip(c.from)} → ${clip(c.to)}`;
  return c.to ? `${field}: + ${clip(c.to)}` : `${field}: − ${clip(c.from)}`;
}

/**
 * Undo the latest revision: the profile goes back to what it was, the revision leaves the history, and when the
 * revision changed a course record's notes, those are returned for the caller to put back as well.
 */
export function undoProfileUpdate(learner: Learner): { learner: Learner; course?: { courseId: string; notes: CourseNotes } } {
  const history = learner.profileHistory ?? [];
  const last = history.at(-1);
  if (!last) throw new Error(`${learner.name}'s profile has no revision to undo.`);
  return {
    learner: { ...learner, profile: last.previous, profileHistory: history.slice(0, -1) },
    ...(last.previousCourse && last.courseId ? { course: { courseId: last.courseId, notes: last.previousCourse } } : {}),
  };
}

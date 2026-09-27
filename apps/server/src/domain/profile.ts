/**
 * The learner profile over time: pure helpers for revising it after a session and undoing a revision.
 *
 * The intake writes the profile once. After every report, the profile pass (agents/profile-agent.ts) proposes a
 * revised profile; this module decides what of it lands:
 *  - the fast fields (prior knowledge, gaps, interests, demonstration preferences, tutoring guidance) change
 *    whenever the session's evidence says so;
 *  - the slow fields (pace, challenge tolerance, verbal level, depth, intake preferences) describe the learner
 *    rather than what they know, and one session must not swing them: a change is held until the next session's
 *    pass proposes the same, and only then applied. A change made last time cannot be undone by the next pass
 *    either, for the same reason.
 * Every landed change and every held one is recorded with the session, so the parent sees them and can undo the
 * latest revision. Nothing here talks to the model or the store.
 */
import type { Course, Depth, Learner, LearnerProfile, ProfileChange, ProfileUpdate } from "./types.js";

export const PROFILE_FIELDS = [
  "intakePreferences",
  "demonstrationPreferences",
  "challengeTolerance",
  "pace",
  "verbalLevel",
  "interests",
  "priorKnowledge",
  "observedGaps",
  "parentSummary",
  "tutoringGuidance",
  "depth",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Fields that describe the learner rather than what they know. Two consecutive sessions must agree to move one. */
export const SLOW_FIELDS: ReadonlySet<ProfileField> = new Set<ProfileField>(["pace", "challengeTolerance", "verbalLevel", "depth", "intakePreferences"]);
const LIST_FIELDS: ReadonlySet<ProfileField> = new Set<ProfileField>(["intakePreferences", "demonstrationPreferences", "interests", "priorKnowledge", "observedGaps", "tutoringGuidance"]);
/** The tutor follows every item literally, so the list stays short enough to follow. */
export const MAX_GUIDANCE = 6;
/**
 * Ceilings on the other lists, keeping the first entries (the skill puts the most useful first). Replaying nine
 * Rome sessions on 2026-09-27 grew prior knowledge to 40 entries, gaps to 27 and interests to 16, one per session
 * and never merged; the profile sits in the tutor's cached prompt, so it cannot grow without bound.
 */
export const MAX_PRIOR_KNOWLEDGE = 15;
export const MAX_GAPS = 12;
export const MAX_INTERESTS = 10;
/** Revisions kept on the record; older ones are dropped. Undo only needs the latest. */
export const MAX_HISTORY = 40;

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

/** What the profile pass returns: the whole revised profile, a reason per field it changed, a note for the parent. */
export interface ProfileRevision {
  profile: LearnerProfile;
  reasons: Array<{ field: string; why: string }>;
  summary: string;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Trim, drop empty and repeated items, keep the guidance list short, fill a missing depth from the old profile. */
export function normalizeProfile(p: LearnerProfile, before?: LearnerProfile): LearnerProfile {
  const list = (xs: string[]): string[] => [...new Set(xs.map(norm).filter(Boolean))];
  return {
    ...p,
    intakePreferences: [...new Set(p.intakePreferences)],
    demonstrationPreferences: [...new Set(p.demonstrationPreferences)],
    verbalLevel: norm(p.verbalLevel),
    interests: list(p.interests).slice(0, MAX_INTERESTS),
    priorKnowledge: list(p.priorKnowledge).slice(0, MAX_PRIOR_KNOWLEDGE),
    observedGaps: list(p.observedGaps).slice(0, MAX_GAPS),
    parentSummary: norm(p.parentSummary),
    tutoringGuidance: list(p.tutoringGuidance).slice(0, MAX_GUIDANCE),
    depth: p.depth ?? before?.depth ?? "simple",
  };
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
 * Land a proposed revision on the learner. Returns the learner as it should be saved, and the update recorded on it,
 * or no update when the session changed nothing (only `profileReviewedAt` moves).
 */
export function applyRevision(learner: Learner, revision: ProfileRevision, meta: RevisionMeta): { learner: Learner; update?: ProfileUpdate } {
  const before = learner.profile;
  if (!before) throw new Error(`${learner.name} has no profile to revise; the intake writes the first one.`);
  const candidate = normalizeProfile(revision.profile, before);
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
  };
  return {
    learner: { ...reviewed, profile: candidate, profileHistory: [...(learner.profileHistory ?? []), update].slice(-MAX_HISTORY) },
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

/** Undo the latest revision: the profile goes back to what it was, and the revision leaves the history. */
export function undoProfileUpdate(learner: Learner): Learner {
  const history = learner.profileHistory ?? [];
  const last = history.at(-1);
  if (!last) throw new Error(`${learner.name}'s profile has no revision to undo.`);
  return { ...learner, profile: last.previous, profileHistory: history.slice(0, -1) };
}

/**
 * Domain model for Homeschool-AI.
 *
 * Every persisted object and every structured LLM output is described here with Zod so
 * the same schema validates JSON on disk, request bodies, and model responses.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Curriculum (produced by the Curriculum Agent from uploaded material)
// ---------------------------------------------------------------------------

export const SourceChunkSchema = z.object({
  id: z.string(),
  /** Original file name the chunk came from. */
  source: z.string(),
  /** Heading path, e.g. ["Unit 2", "Photosynthesis"]. */
  headingPath: z.array(z.string()),
  /** Verbatim text of the chunk. */
  text: z.string(),
  /** Approximate position in the source, for ordering. */
  order: z.number().int(),
});
export type SourceChunk = z.infer<typeof SourceChunkSchema>;

export const ConceptSchema = z.object({
  id: z.string().describe("Stable slug, e.g. 'photosynthesis-light-reactions'."),
  name: z.string(),
  /** Faithful summary of what the source material says about this concept. */
  summary: z.string(),
  /** Facts the student must be able to state, in the source's own terms. */
  keyFacts: z.array(z.string()),
  /** Misconceptions the source warns about or that are common for this concept. */
  commonMisconceptions: z.array(z.string()),
  /** Ids of SourceChunks that ground this concept. */
  sourceChunkIds: z.array(z.string()),
  /** Concept ids that should be understood first. */
  prerequisites: z.array(z.string()),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const LessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Measurable objectives, phrased "The student can ...". */
  objectives: z.array(z.string()),
  conceptIds: z.array(z.string()),
  /** Open questions the source poses or that naturally arise, useful as Socratic entry points. */
  guidingQuestions: z.array(z.string()),
  /** Worked examples, exercises or problems present in the material. */
  practiceItems: z.array(z.string()),
  order: z.number().int(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * The parent's decision about how much of a course the tutor teaches. Homeschool parents skip and
 * substitute parts of any curriculum as a matter of course, so this is their call, never an agent's.
 * Kept separate from Lesson/Concept because those schemas are reused for structured outputs.
 */
export const CourseFocusSchema = z.object({
  /** Lessons the parent chose not to teach at all. */
  skippedLessonIds: z.array(z.string()),
  /** Concepts skipped inside lessons that are otherwise kept. */
  skippedConceptIds: z.array(z.string()),
  /** The parent's preferred lesson order, by id; lessons not listed follow in their ingested order. */
  lessonOrder: z.array(z.string()).optional(),
});
export type CourseFocus = z.infer<typeof CourseFocusSchema>;

export const CourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  /** Grade / age band as stated or inferred from the material, e.g. "Grade 7". */
  level: z.string(),
  description: z.string(),
  lessons: z.array(LessonSchema),
  concepts: z.array(ConceptSchema),
  chunks: z.array(SourceChunkSchema),
  sourceFiles: z.array(z.string()),
  /** Where each source came from: an uploaded file, or a URL (video, podcast, TED talk). */
  sources: z
    .array(z.object({ name: z.string(), kind: z.enum(["file", "video", "podcast", "audio", "slides", "url"]), url: z.string().optional() }))
    .optional(),
  /** Absent means everything is taught (courses built before focus existed, and fresh ingests). See domain/focus.ts. */
  focus: CourseFocusSchema.optional(),
  createdAt: z.string(),
});
export type Course = z.infer<typeof CourseSchema>;

/** What the Curriculum Agent returns for one batch of chunks (no ids for chunks; those exist already). */
export const CurriculumExtractionSchema = z.object({
  title: z.string(),
  subject: z.string(),
  level: z.string(),
  description: z.string(),
  lessons: z.array(LessonSchema.omit({ id: true, order: true })),
  concepts: z.array(ConceptSchema),
});
export type CurriculumExtraction = z.infer<typeof CurriculumExtractionSchema>;

// ---------------------------------------------------------------------------
// Learner (produced by the Profiler Agent during the initial assessment)
// ---------------------------------------------------------------------------

/**
 * How much of an answer the learner is ready for, shown by what they demonstrate rather than by their grade:
 * the plain version, the main exception or a second view when they ask, or the real complexity. It is about
 * how much nuance to give, never about the mastery bar.
 */
export const DepthSchema = z.enum(["simple", "some-nuance", "full"]);
export type Depth = z.infer<typeof DepthSchema>;

/**
 * How to work with this student, across every course: written once by the general intake and kept current by
 * the profile pass after each report. What the student knows about a particular course is not here: that is the
 * course-knowledge record (CourseKnowledgeSchema), one per student per course.
 *
 * Until 2026-10-05 this also held `intakePreferences` (dropped: matching teaching to a stated preference has no
 * evidence behind it, docs/INTAKE.md §1; the entry point follows prior knowledge instead) and `priorKnowledge` /
 * `observedGaps` (moved to the course record). Records from before are migrated when the store opens
 * (store/migrate.ts).
 */
export const LearnerProfileSchema = z.object({
  /** How the learner demonstrates understanding most reliably. */
  demonstrationPreferences: z.array(
    z.enum(["explain-in-own-words", "solve-a-problem", "teach-it-back", "compare-and-contrast", "predict-an-outcome", "apply-to-new-case"]),
  ),
  /** What they do when stuck, as observed (shown to parents as "when stuck"): low = goes quiet or guesses and needs support early; high = reasons aloud and stays with it. */
  challengeTolerance: z.enum(["low", "medium", "high"]),
  /** Observed pacing need. An intake cannot measure it: it starts at "moderate" and the profile pass revises it. */
  pace: z.enum(["slow", "moderate", "fast"]),
  /** The register they speak or write in, as observed ("short plain sentences; explains with 'because'"). Not a reading level: typed or spoken answers cannot give one. */
  verbalLevel: z.string(),
  /** Interests to hook analogies onto, specific enough to build on ("builds redstone machines in Minecraft", not "games"). */
  interests: z.array(z.string()),
  /** Short plain-language note for the parent. */
  parentSummary: z.string(),
  /** Concrete instructions the Tutor should follow for this learner. */
  tutoringGuidance: z.array(z.string()),
  /** Absent on profiles written before depth existed: read as "simple" (domain/profile.ts). */
  depth: DepthSchema.optional(),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

/** What the intake and the profile pass produce: every field filled, depth included. Persisted records may lack depth. */
export const LearnerProfileExtractionSchema = LearnerProfileSchema.extend({ depth: DepthSchema });

// ---------------------------------------------------------------------------
// Course knowledge (one record per student per course; written by the course intake, kept current by the profile pass)
// ---------------------------------------------------------------------------

/** Where a student starts on a concept, from one first-step question: nothing, something, or can already explain it. */
export const StartingEstimateSchema = z.enum(["none", "some", "can-explain"]);
export type StartingEstimate = z.infer<typeof StartingEstimateSchema>;

/** One concept's starting point, in the student's own words. It is a baseline and is never rewritten: reports say where the student stands now. */
export const ConceptStartSchema = z.object({
  conceptId: z.string(),
  estimate: StartingEstimateSchema,
  /** The student's first answer, quoted. Empty when they said they did not know. */
  said: z.string(),
  /** How sure they said they were, 0 to 10. Absent when they gave no number (it is not asked after "I don't know"). */
  confidence: z.number().int().optional(),
  /** Where the answer contradicts the family's material: what the material says instead. */
  materialSays: z.string().optional(),
  /** A probe question, or the opening "tell me everything you know" narration. */
  from: z.enum(["probe", "narration"]),
});
export type ConceptStart = z.infer<typeof ConceptStartSchema>;

/** The part of a course record the profile pass keeps current after each session on the course. */
export const CourseNotesSchema = z.object({
  /** What the student has shown they know about this course, one entry per fact, quoted. */
  priorKnowledge: z.array(z.string()),
  /** What they got wrong or could not do when asked, in their words. */
  observedGaps: z.array(z.string()),
  /** Instructions for the tutor that hold on this course only. */
  guidance: z.array(z.string()),
});
export type CourseNotes = z.infer<typeof CourseNotesSchema>;

export const CourseKnowledgeSchema = CourseNotesSchema.extend({
  /** `<learnerId>__<courseId>` (store/index.ts, knowledgeId). */
  id: z.string(),
  learnerId: z.string(),
  courseId: z.string(),
  /** Starting points from the course intake, one per concept it reached. Empty when no intake has run. */
  starts: z.array(ConceptStartSchema),
  /** For the parent: what the student could do before starting the course. Written once, by the course intake. */
  baselineSummary: z.string().optional(),
  /** A course intake has finished and its starting points are being written in the background (or that failed, with the reason). Cleared when they land. */
  pending: z.object({ sessionId: z.string(), since: z.string(), error: z.string().optional() }).optional(),
  /** The course-intake session that wrote the starting points. Absent on a record made by migration or by the profile pass alone. */
  intakeSessionId: z.string().optional(),
  intakeAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CourseKnowledge = z.infer<typeof CourseKnowledgeSchema>;

/** What the course-intake extraction returns. Every field is required (structured outputs): confidence is -1 when no number was given, materialSays is empty when nothing contradicts. */
export const CourseIntakeExtractionSchema = CourseNotesSchema.extend({
  starts: z.array(
    z.object({
      conceptId: z.string(),
      estimate: StartingEstimateSchema,
      said: z.string().describe("The student's own words, quoted. Empty if they said they did not know."),
      confidence: z.number().int().describe("0 to 10 as the student said it; -1 if they gave no number."),
      materialSays: z.string().describe("What the family's material says instead, when the answer contradicts it; empty otherwise."),
      from: z.enum(["probe", "narration"]),
    }),
  ),
  baselineSummary: z.string().describe("Three to five plain sentences for the parent: what the student could do before starting this course."),
});
export type CourseIntakeExtraction = z.infer<typeof CourseIntakeExtractionSchema>;

/** One difference between two versions of a profile. A list field gets one entry per item added (from "") or removed (to ""). */
export const ProfileChangeSchema = z.object({
  field: z.string(),
  from: z.string(),
  to: z.string(),
  /** One sentence quoting the evidence, from the profile pass. */
  why: z.string(),
});
export type ProfileChange = z.infer<typeof ProfileChangeSchema>;

/**
 * One revision of the profile after a session's report. The parent sees every one and can undo the latest, which
 * restores `previous`. The profile is the tutor's running notes on how to teach this student, never a verdict on
 * them, so the pass changes what the evidence changed and nothing else (skills/profile-update).
 */
export const ProfileUpdateSchema = z.object({
  at: z.string(),
  sessionId: z.string(),
  courseId: z.string().optional(),
  courseTitle: z.string().optional(),
  /** One or two plain sentences for the parent on what this session showed. */
  summary: z.string(),
  changes: z.array(ProfileChangeSchema),
  /**
   * Changes to the slow fields (pace, challenge tolerance, verbal level, depth) that this session proposed but
   * one session cannot make: held until the next session's pass proposes the same.
   */
  held: z.array(ProfileChangeSchema),
  /** The profile before this update, so it can be undone. */
  previous: LearnerProfileSchema,
  /**
   * The course record's notes before this update, when the update changed them (`changes` entries for
   * priorKnowledge, observedGaps and courseGuidance belong to the record of `courseId`). Undo restores them too.
   */
  previousCourse: CourseNotesSchema.optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const LearnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().optional(),
  gradeLevel: z.string().optional(),
  /** The parent's own words about their child, followed by the tutor as written and never rewritten by any pass. */
  parentNotes: z.string().optional(),
  profile: LearnerProfileSchema.optional(),
  /**
   * The general intake has finished and its profile is being written in the background (or failed, with the
   * reason). While this is set the intake conversation is not run again: the transcript is kept, and the
   * write is retried. Cleared when the profile lands.
   */
  profilePending: z.object({ sessionId: z.string(), since: z.string(), error: z.string().optional() }).optional(),
  /** Revisions of the profile after sessions, oldest first (domain/profile.ts keeps the tail). */
  profileHistory: z.array(ProfileUpdateSchema).optional(),
  /** When the profile pass last ran, whether or not it changed anything. */
  profileReviewedAt: z.string().optional(),
  createdAt: z.string(),
});
export type Learner = z.infer<typeof LearnerSchema>;

// ---------------------------------------------------------------------------
// Session (managed by the Orchestrator; the Tutor Agent runs inside it)
// ---------------------------------------------------------------------------

/**
 * What a session is for. A sitting can be a chain of them: a new student's first session on a course is the
 * general intake, then the course intake, then the lesson, each its own session with its own transcript.
 * Absent on sessions from before 2026-10-05: a lesson (or, with phase "intake", the old combined intake).
 */
export const SessionKindSchema = z.enum(["general-intake", "course-intake", "lesson"]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const SessionPhaseSchema = z.enum([
  "intake", // An intake agent is running: the general intake or the course intake (see Session.kind)
  "teach", // Tutor introduces / elicits the concept
  "inquire", // Tutor probes with Socratic questions
  "assess", // Tutor asks the learner to demonstrate mastery
  "wrap-up", // Session summary
  "complete",
]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

export const TranscriptTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  at: z.string(),
  /** Prosody labels a voice provider attached to the turn. None does today; kept so saved sessions still read. */
  expressions: z.array(z.string()).optional(),
  /** Latency measurements for assistant turns (see TurnLatency). */
  latency: z
    .object({
      ttftMs: z.number(),
      totalMs: z.number(),
      iterations: z.number().int(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      /** Text the model produced after its bookkeeping tools ran; dropped, never shown to the learner. */
      suppressedChars: z.number().optional(),
      /** Characters of private reasoning before the first spoken word. */
      thinkingChars: z.number().optional(),
      /** The model did its bookkeeping before speaking (an extra round trip before the first word). */
      toolsBeforeSpeech: z.boolean().optional(),
      /** Milliseconds the reflect pass took, after the reply was spoken. */
      reflectMs: z.number().optional(),
      /** Characters of private reasoning in the reflect pass. */
      reflectThinkingChars: z.number().optional(),
      /** Voice turns: ms from the student's end of speech to the first audio byte sent back. */
      firstAudioMs: z.number().optional(),
      /** Voice turns: ms from end of speech to the final transcript. */
      transcriptMs: z.number().optional(),
      /** The learner barged in and the reply was cut short. */
      interrupted: z.boolean().optional(),
    })
    .optional(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/**
 * What the tutor does with facts from outside the family's material, the parent's choice (Settings), frozen on
 * each session at creation:
 *  - check:         answer (confirm, correct, or say it is not sure) and check the fact against Wikipedia in the
 *                   background, following up next turn when the check says to;
 *  - answer:        answer from general knowledge, labelled as outside the material, with no check;
 *  - material-only: neither confirm nor correct; say it is outside the reading.
 */
export const OutsideKnowledgeModeSchema = z.enum(["check", "answer", "material-only"]);
export type OutsideKnowledgeMode = z.infer<typeof OutsideKnowledgeModeSchema>;

/**
 * A checkable fact from a session that the material does not settle, flagged by the reflect pass: something the
 * learner brought in from outside ("Aphrodite saved Aeneas"), or a version that differs from the material's. The
 * reference check fills in the verdict; the parent sees every one in the report, under "Outside the reading".
 */
export const OutsideClaimSchema = z.object({
  id: z.string(),
  /** When the reflect pass flagged it. */
  at: z.string(),
  /** The claim as one plain, checkable sentence. */
  claim: z.string(),
  raisedBy: z.enum(["learner", "tutor"]),
  /** What the tutor told the learner about it: agreed, corrected it, said it was not sure, or pointed back to the reading. */
  tutorStance: z.enum(["confirmed", "corrected", "unsure", "deferred"]),
  /** What the family's material says on the point, when it says something different. The material wins in the session. */
  materialSays: z.string().optional(),
  /** What to look up: the subject, e.g. "Aeneas". */
  query: z.string(),
  status: z.enum(["pending", "checked", "not-checked", "failed"]),
  /** Why it was not checked, or why the check failed, in words a parent can read. */
  statusNote: z.string().optional(),
  /** complicated: true in one version or sense and not another, e.g. ancient accounts differ. */
  verdict: z.enum(["supported", "contradicted", "complicated", "not-found"]).optional(),
  /** One or two plain sentences for the parent. */
  explanation: z.string().optional(),
  /** A short quotation from the source that settles it. */
  evidence: z.string().optional(),
  source: z
    .object({
      title: z.string(),
      /** Permanent link to the exact version that was read. */
      url: z.string(),
      revisionId: z.number().int().optional(),
      /** Wikipedia's own grade for the article (FA, GA, B, C, Start, Stub), stored but not shown yet (#26). */
      quality: z.string().optional(),
    })
    .optional(),
  /** What the tutor was asked to tell the learner once the check came back, if anything. */
  followUp: z.string().optional(),
  checkedAt: z.string().optional(),
});
export type OutsideClaim = z.infer<typeof OutsideClaimSchema>;

/** Evidence the Tutor records while talking to the learner. */
export const ObservationSchema = z.object({
  at: z.string(),
  conceptId: z.string(),
  /** `told` marks a fact the tutor stated outright: what the learner says about it afterwards is not independent recall, and it never counts as assessment evidence (domain/told.ts). */
  kind: z.enum(["understanding", "partial", "misconception", "gap", "engagement", "told"]),
  evidence: z.string().describe("What the learner said or did, briefly quoted. For kind told: what the tutor said."),
  note: z.string().describe("Why this matters for mastery."),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  learnerId: z.string(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  kind: SessionKindSchema.optional(),
  /** An intake only: what the sitting goes on to when it finishes (the course intake, then the lesson). Absent: it ends there. */
  then: z.object({ courseId: z.string().optional(), lessonId: z.string().optional(), narrationFirst: z.boolean().optional() }).optional(),
  /** The session that took over when this intake finished. A message sent to this one is answered there. */
  continuedIn: z.string().optional(),
  /** The intake this session carried on from, in the same sitting. */
  continuedFrom: z.string().optional(),
  /** Course intake: the concepts it asks about, in order, chosen once at creation (domain/intake.ts). */
  probeConceptIds: z.array(z.string()).optional(),
  /** General intake: the age band whose questions it starts with (domain/intake.ts), from the grade at creation. */
  intakeBand: z.enum(["A", "B", "C"]).optional(),
  /** An intake that has finished: its record is written in the background, and this says how that went. */
  extraction: z.object({ status: z.enum(["writing", "done", "failed"]), at: z.string(), error: z.string().optional() }).optional(),
  /** Index into the session's concept walk (conceptIds below) of the concept currently being worked. */
  conceptIndex: z.number().int(),
  /**
   * The concepts this session walks, in order: the lesson's concepts minus the parent's skips, frozen at
   * creation so a later focus edit changes neither the walk nor the tutor's cached prompt. Absent on
   * sessions created before focus existed; readers fall back to the lesson's list (domain/focus.ts).
   */
  conceptIds: z.array(z.string()).optional(),
  /** The student read the material beforehand, so the session opened by asking them to tell it back. */
  narrationFirst: z.boolean().optional(),
  /**
   * The earlier concept the session opened with a spaced-retrieval question on. The learner's first reply
   * answers it, and the reflect pass files that answer under this concept rather than the current one.
   */
  retrievalConceptId: z.string().optional(),
  /**
   * Passages the tutor looked up with lookup_source during the session, from anywhere in the course. The
   * assessor audits the tutor against the lesson's passages plus these, so a fact fetched from another
   * lesson is not called ungrounded.
   */
  retrievedChunkIds: z.array(z.string()).optional(),
  /** The parent's outside-the-material setting when the session was created. Absent on older sessions: "answer". */
  outsideKnowledge: OutsideKnowledgeModeSchema.optional(),
  /** Facts from outside the material that came up, with the reference check's verdicts. */
  outsideClaims: z.array(OutsideClaimSchema).optional(),
  phase: SessionPhaseSchema,
  transcript: z.array(TranscriptTurnSchema),
  observations: z.array(ObservationSchema),
  /** Free-form notes the orchestrator injects into the next tutor turn (e.g. phase changes). */
  pendingDirectives: z.array(z.string()),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// Assessment (produced by the Assessor Agent)
// ---------------------------------------------------------------------------

export const ConceptMasterySchema = z.object({
  conceptId: z.string(),
  /** 0 = no evidence, 1 = recalls facts, 2 = explains, 3 = applies to new cases, 4 = teaches/extends. */
  level: z.number().int().describe("0 no evidence, 1 recalls, 2 explains, 3 applies, 4 extends"),
  evidence: z.array(z.string()),
  misconceptions: z.array(z.string()),
  nextStep: z.string(),
});
export type ConceptMastery = z.infer<typeof ConceptMasterySchema>;

export const MasteryReportSchema = z.object({
  sessionId: z.string(),
  learnerId: z.string(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  concepts: z.array(ConceptMasterySchema),
  /** Which practice / demonstration formats produced the clearest evidence for this learner. */
  effectiveFormats: z.array(z.string()),
  /** Plain-language summary for the parent. */
  parentSummary: z.string(),
  /** Encouraging, specific summary for the student. */
  studentSummary: z.string(),
  /** Recommended focus for the next session. */
  recommendedNext: z.array(z.string()),
  /** Any statement the tutor made that the assessor could not ground in the source material. */
  ungroundedClaims: z.array(z.string()),
  /** Learner turns that asked for the answer outright. A rising number across sessions is the crutch pattern. */
  answerSeekingTurns: z.number().int(),
  /** Tutor turns that handed over a final answer before the learner attempted it. Should be zero. */
  tutorAnswerGiveaways: z.number().int(),
  /** Copied from the session when the report is written, so the parent sees each outside fact and its check. */
  outsideClaims: z.array(OutsideClaimSchema).optional(),
  createdAt: z.string(),
});
export type MasteryReport = z.infer<typeof MasteryReportSchema>;

/** Assessor output (before ids/timestamps and the session's outside claims are attached). */
export const MasteryExtractionSchema = MasteryReportSchema.omit({
  sessionId: true,
  learnerId: true,
  courseId: true,
  lessonId: true,
  outsideClaims: true,
  createdAt: true,
});
export type MasteryExtraction = z.infer<typeof MasteryExtractionSchema>;

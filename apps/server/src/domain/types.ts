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

export const LearnerProfileSchema = z.object({
  /** How the learner best takes in new ideas. Not "learning styles" pseudoscience: concrete, observed preferences. */
  intakePreferences: z.array(
    z.enum([
      "worked-examples",
      "analogies",
      "definitions-first",
      "exploration-first",
      "visual-descriptions",
      "step-by-step",
      "big-picture-first",
    ]),
  ),
  /** How the learner demonstrates understanding most reliably. */
  demonstrationPreferences: z.array(
    z.enum(["explain-in-own-words", "solve-a-problem", "teach-it-back", "compare-and-contrast", "predict-an-outcome", "apply-to-new-case"]),
  ),
  /** Observed tolerance for being questioned without being given the answer. */
  challengeTolerance: z.enum(["low", "medium", "high"]),
  /** Observed pacing need. */
  pace: z.enum(["slow", "moderate", "fast"]),
  /** Reading / verbal level, as observed, e.g. "reads at grade level, strong verbal reasoning". */
  verbalLevel: z.string(),
  /** Interests to hook analogies onto. */
  interests: z.array(z.string()),
  /** What the learner already knows about the subject, as evidenced in the intake conversation. */
  priorKnowledge: z.array(z.string()),
  /** Gaps or misconceptions observed during intake. */
  observedGaps: z.array(z.string()),
  /** Short plain-language note for the parent. */
  parentSummary: z.string(),
  /** Concrete instructions the Tutor should follow for this learner. */
  tutoringGuidance: z.array(z.string()),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const LearnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().optional(),
  gradeLevel: z.string().optional(),
  profile: LearnerProfileSchema.optional(),
  createdAt: z.string(),
});
export type Learner = z.infer<typeof LearnerSchema>;

// ---------------------------------------------------------------------------
// Session (managed by the Orchestrator; the Tutor Agent runs inside it)
// ---------------------------------------------------------------------------

export const SessionPhaseSchema = z.enum([
  "intake", // Profiler Agent is running the initial assessment
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
  /** Top prosody / expression labels from Hume, if the turn came through voice. */
  expressions: z.array(z.string()).optional(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/** Evidence the Tutor records while talking to the learner. */
export const ObservationSchema = z.object({
  at: z.string(),
  conceptId: z.string(),
  kind: z.enum(["understanding", "partial", "misconception", "gap", "engagement"]),
  evidence: z.string().describe("What the learner said or did, briefly quoted."),
  note: z.string().describe("Why this matters for mastery."),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  learnerId: z.string(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  /** Index into lesson.conceptIds of the concept currently being worked. */
  conceptIndex: z.number().int(),
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
  createdAt: z.string(),
});
export type MasteryReport = z.infer<typeof MasteryReportSchema>;

/** Assessor output (before ids/timestamps are attached). */
export const MasteryExtractionSchema = MasteryReportSchema.omit({
  sessionId: true,
  learnerId: true,
  courseId: true,
  lessonId: true,
  createdAt: true,
});
export type MasteryExtraction = z.infer<typeof MasteryExtractionSchema>;

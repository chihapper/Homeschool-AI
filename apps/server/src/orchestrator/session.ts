/**
 * Orchestrator: deterministic session state machine that routes each learner turn to the right agent.
 *
 *   intake ──(profile finalized)──> teach ──> inquire ──> assess ──(next concept)──> teach ...
 *                                                                 └─(last concept)──> wrap-up ──> complete
 *
 * The LLM agents *request* transitions via the `advance` tool; the orchestrator validates them
 * (e.g. no next-concept without recorded evidence) and owns all persistence.
 */
import { ObservationSchema, type Concept, type Course, type Learner, type Lesson, type MasteryReport, type Observation, type ProfileUpdate, type Session, type SessionKind, type TranscriptTurn } from "../domain/types.js";
import { gradeBand, planSitting, selectProbeConcepts, toCourseKnowledge } from "../domain/intake.js";
import { applyRevision, normalizeProfile, studentLevel } from "../domain/profile.js";
import { proposeRevision } from "../agents/profile-agent.js";
import type { TurnLatency } from "../llm/client.js";
import type { TurnResult } from "../agents/base.js";
import { ChunkIndex } from "../ingest/retrieval.js";
import { effectiveConceptIds, effectiveLessons, isConceptKept, walkedConceptIds } from "../domain/focus.js";
import { courseKnowledge, courses, knowledgeFor, knowledgeId, learners, putCourseNotes, reports, sessions } from "../store/index.js";
import { buildProgress } from "../domain/progress.js";
import { openThread, setOpenThread } from "./notes.js";
import { finalizeProfile, passageReading, profilerTurn, type NextStep } from "../agents/profiler-agent.js";
import { courseIntakeTurn, extractCourseKnowledge } from "../agents/course-intake-agent.js";
import { prewarmTutor, reflectTurn, tutorTurn, type AdvanceTarget, type TutorContext } from "../agents/tutor-agent.js";
import { config } from "../config.js";
import { assessSession } from "../agents/assessor-agent.js";
import { checkOutsideClaim } from "../agents/reference-agent.js";
import { aboutFaith, mergeFinishedChecks, recordOutsideClaim, SAY_FIRST, settleChecks, spokenFollowUps, startCheck } from "./outside.js";
import { isEvidence } from "../domain/told.js";

const indexCache = new Map<string, ChunkIndex>();
function indexFor(course: Course): ChunkIndex {
  let idx = indexCache.get(course.id);
  if (!idx) {
    idx = new ChunkIndex(course.chunks);
    indexCache.set(course.id, idx);
  }
  return idx;
}

export interface CreateSessionArgs {
  learnerId: string;
  courseId?: string;
  lessonId?: string;
  /** Go straight to the lesson: neither intake runs, even for a student with no profile or no record for the course. */
  skipIntake?: boolean;
  /** Begin the lesson without the general intake (the parent runs it from the Students tab); the course intake still runs when the course is new to the student. */
  skipGeneralIntake?: boolean;
  /** The student has already read the material: open by asking them to tell it back, then question from that. */
  narrationFirst?: boolean;
  /** Run one intake on its own, with nothing after it (the Courses tab's button for the course intake). */
  only?: "general-intake" | "course-intake";
}

/**
 * Charlotte Mason families run this loop by hand: the child reads, tells it back uninterrupted, and only
 * then is questioned. The directive rides in pendingDirectives, so it survives an intake conversation and
 * is consumed by the first teaching turn. The socratic-method skill says how to conduct the narration.
 */
export const NARRATION_DIRECTIVE =
  "The student has already read this material. Open by asking them to tell back what they read, in their own words, and then say nothing while they do: " +
  "no corrections and no questions mid-narration; if they pause, at most \"take your time, what else?\". Once they stop, work from what they said and what they " +
  "left out, as the socratic-method skill describes under \"Narration first\". Do this before anything else queued here.";

/** A concept the course intake does not ask about: a child is not quizzed on faith before the family's material has spoken. */
const notAskedAbout = (c: Concept): boolean => aboutFaith(`${c.name}. ${c.summary}`);

/** The concepts a course intake would ask this student about; empty when there is nothing it may ask. */
function probeConcepts(course: Course): string[] {
  return selectProbeConcepts(course, notAskedAbout);
}

/** What a sitting for this student consists of, as things stand: see planSitting. A course with nothing to ask about has no course intake. */
function sittingPlan(learner: Learner, course: Course | undefined, skipIntake?: boolean, skipGeneralIntake?: boolean): SessionKind[] {
  return planSitting({
    // A profile being written counts: the conversation happened, and is not held again.
    hasProfile: Boolean(learner.profile || learner.profilePending),
    hasCourse: Boolean(course),
    hasCourseRecord: course ? Boolean(knowledgeFor(learner.id, course.id)) : false,
    skipIntake,
    skipGeneralIntake,
  }).filter((kind) => kind !== "course-intake" || (course !== undefined && probeConcepts(course).length > 0));
}

/**
 * Start a sitting: the first session of whatever it consists of. A new student's first session on a course is
 * the general intake; when that finishes the sitting carries on by itself into the course intake and then the
 * lesson (continueSitting), each its own session with its own transcript.
 */
export function createSession(args: CreateSessionArgs): Session {
  const learner = learners.require(args.learnerId);
  let course: Course | undefined;
  let lesson: Lesson | undefined;
  if (args.courseId) {
    course = courses.require(args.courseId);
    lesson = args.lessonId ? course.lessons.find((l) => l.id === args.lessonId) : effectiveLessons(course)[0];
    if (!lesson && args.only !== "course-intake") {
      throw new Error(args.lessonId ? `Lesson ${args.lessonId} not found in course ${course.id}` : `Course ${course.id} has no lesson left to teach: every lesson is skipped in its focus.`);
    }
  }
  // An intake whose record was never written (the server stopped, or the write failed) is picked up again here.
  resumePendingRecords(learner);
  if (args.only === "course-intake") {
    if (!course) throw new Error("Choose the course to ask about.");
    if (!probeConcepts(course).length) throw new Error(`"${course.title}" has nothing the course intake may ask about: every concept is skipped in its focus, or is about faith.`);
    return startSession("course-intake", learner, { course });
  }
  if (args.only === "general-intake") return startSession("general-intake", learner, {});
  const plan = sittingPlan(learner, course, args.skipIntake, args.skipGeneralIntake);
  if (!plan.length) {
    const why = learner.profile || learner.profilePending ? `${learner.name} already has a profile` : "the general intake was left out";
    throw new Error(`Choose a course: without one there is only the general intake to run, and ${why}.`);
  }
  const destination = course ? { courseId: course.id, lessonId: args.lessonId, narrationFirst: args.narrationFirst || undefined } : undefined;
  return startSession(plan[0], learner, { course, lesson, narrationFirst: args.narrationFirst, then: plan.length > 1 ? destination : undefined });
}

interface StartOptions {
  course?: Course;
  lesson?: Lesson;
  narrationFirst?: boolean;
  /** An intake: where the sitting goes when it finishes. */
  then?: Session["then"];
  /** The intake this session carries on from, in the same sitting. */
  continuedFrom?: string;
}

function startSession(kind: SessionKind, learner: Learner, o: StartOptions): Session {
  const base = { id: sessions.newId(), learnerId: learner.id, kind, conceptIndex: 0, transcript: [], observations: [], startedAt: new Date().toISOString(), continuedFrom: o.continuedFrom };
  if (kind === "general-intake") {
    return sessions.put({ ...base, phase: "intake", intakeBand: gradeBand(learner.gradeLevel, learner.age), then: o.then, pendingDirectives: [] });
  }
  const course = o.course;
  if (!course) throw new Error("A course is required for this session.");
  if (kind === "course-intake") {
    return sessions.put({ ...base, phase: "intake", courseId: course.id, probeConceptIds: probeConcepts(course), then: o.then, pendingDirectives: [] });
  }
  const lesson = o.lesson;
  if (!lesson) throw new Error(`Course ${course.id} has no lesson left to teach: every lesson is skipped in its focus.`);
  // The parent's focus is read here, once. The walk is frozen on the session so a later edit cannot change
  // what a running session teaches or the tutor's cached prompt prefix.
  const conceptIds = effectiveConceptIds(course, lesson);
  if (!conceptIds.length) throw new Error(`Lesson "${lesson.title}" has no concepts left to teach: change the course's focus or pick another lesson.`);
  const opening: string[] = [];
  // A narration is itself retrieval, so a narration-first session does not also open with a spaced-retrieval question.
  const retrieval = !o.narrationFirst ? spacedRetrieval(learner, course) : undefined;
  if (retrieval) opening.push(retrieval.directive);
  if (o.narrationFirst) opening.push(NARRATION_DIRECTIVE);
  const saved = sessions.put({
    ...base,
    courseId: course.id,
    lessonId: lesson.id,
    conceptIds,
    narrationFirst: o.narrationFirst ? true : undefined,
    retrievalConceptId: retrieval?.conceptId,
    // Read once, like the focus: the tutor's cached prompt states it, so a Settings change applies from the next session.
    outsideKnowledge: config.outsideKnowledge,
    phase: "teach",
    pendingDirectives: opening,
  });
  if (config.prewarmCache) {
    const ctx = tutorContextFor(saved, learner, course, lesson);
    if (ctx) void prewarmTutor(ctx);
  }
  return saved;
}

/** Where an intake's sitting goes next: its own `then`, or, for an intake session saved before 2026-10-05, the lesson it was created for. */
function destinationOf(session: Session): Session["then"] {
  return session.then ?? (session.kind ? undefined : { courseId: session.courseId, lessonId: session.lessonId, narrationFirst: session.narrationFirst });
}

/** After this intake, is the course intake next? Yes unless this was it, the student already has a record for the course, or there is nothing to ask. */
function courseIntakeFollows(finished: Session, learner: Learner, course: Course): boolean {
  return finished.kind !== "course-intake" && !knowledgeFor(learner.id, course.id) && probeConcepts(course).length > 0;
}

/** What the sitting goes on to after this intake, in words the intake can say: the course intake, the lesson, or nothing. */
function nextStepAfter(session: Session, learner: Learner): NextStep | undefined {
  const then = destinationOf(session);
  const course = then?.courseId ? courses.get(then.courseId) : undefined;
  if (!then || !course) return undefined;
  if (courseIntakeFollows(session, learner, course)) return { kind: "course-intake", courseTitle: course.title };
  const lesson = then.lessonId ? course.lessons.find((l) => l.id === then.lessonId) : effectiveLessons(course)[0];
  return lesson ? { kind: "lesson", courseTitle: course.title, lessonTitle: lesson.title } : undefined;
}

/** An intake has finished: start whatever its sitting goes on to, and return it (nothing, when the sitting ends there). */
function continueSitting(finished: Session, learner: Learner): Session | undefined {
  const then = destinationOf(finished);
  const course = then?.courseId ? courses.get(then.courseId) : undefined;
  if (!then || !course) return undefined;
  if (courseIntakeFollows(finished, learner, course)) return startSession("course-intake", learner, { course, then, continuedFrom: finished.id });
  const lesson = then.lessonId ? course.lessons.find((l) => l.id === then.lessonId) : effectiveLessons(course)[0];
  if (!lesson) return undefined;
  return startSession("lesson", learner, { course, lesson, narrationFirst: then.narrationFirst, continuedFrom: finished.id });
}

/** The last thing the previous session of the sitting said, for a session that has not spoken yet: it carries on from those words. */
function carriedOnWords(session: Session): string | undefined {
  if (!session.continuedFrom || session.transcript.length) return undefined;
  const last = [...(sessions.get(session.continuedFrom)?.transcript ?? [])].reverse().find((t) => t.role === "assistant");
  // The closing turn is the hand-over; if a passage was read in it, only the words after it matter.
  return last?.content.split(/\n\n/).at(-1)?.trim() || undefined;
}

/**
 * Spaced retrieval: if this learner has mastered concepts in earlier sessions, the tutor opens with one
 * retrieval question on the least-recently-reported one before starting today's concept. The session keeps
 * the concept's id, because the answer is filed by the reflect pass one turn later (tutor-agent.ts).
 */
export function spacedRetrieval(learner: Learner, course: Course): { conceptId: string; directive: string } | undefined {
  const prior = reports
    .list()
    .filter((r) => r.learnerId === learner.id && r.courseId === course.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Only material the parent still teaches: a skipped concept is not quizzed, even if it was mastered before the skip.
  const mastered = prior.flatMap((r) => r.concepts.filter((c) => c.level >= 2 && isConceptKept(course, c.conceptId)).map((c) => ({ conceptId: c.conceptId, at: r.createdAt })));
  if (!mastered.length) return undefined;
  const oldest = mastered[0];
  const concept = course.concepts.find((c) => c.id === oldest.conceptId);
  if (!concept) return undefined;
  return { conceptId: concept.id, directive: retrievalDirective(concept.name, oldest.at.slice(0, 10)) };
}

/**
 * What the speaking call is told. It asks and nothing more: it has no tool for notes, and telling it to take
 * one made it narrate instead (2026-09-24: "Waiting on their answer to that retrieval question, let me just
 * ask it plainly and wait." was spoken aloud).
 */
export function retrievalDirective(conceptName: string, learnedOn: string): string {
  return `Spaced retrieval: before today's concept, open with ONE quick retrieval question about "${conceptName}" (learned on ${learnedOn}). No hints, and keep the answer out of the question: that name may contain it. Once they have answered, move on to today's concept.`;
}

function tutorContextFor(session: Session, learner: Learner, course: Course, lesson: Lesson): TutorContext | undefined {
  const concept = course.concepts.find((c) => c.id === walkedConceptIds(session, course, lesson)[session.conceptIndex]);
  if (!concept) return undefined;
  return { session, learner, course, lesson, concept, index: indexFor(course), onObservation: () => "", onAdvance: () => "", ...whatIsKnown(session, learner, course) };
}

/** Where earlier reports put the student on each concept. Reports are written when a session ends, so one reading per session is enough. */
const assessedCache = new Map<string, NonNullable<TutorContext["assessed"]>>();

/** What the tutor is told about the student on this course: their record for it, and the levels earlier reports gave. */
function whatIsKnown(session: Session, learner: Learner, course: Course): Pick<TutorContext, "knowledge" | "assessed" | "intakeJustNow"> {
  let assessed = assessedCache.get(session.id);
  if (!assessed) {
    const progress = buildProgress(reports.list(), course, learner.id, course.id);
    assessed = Object.fromEntries((progress?.concepts ?? []).map((c) => [c.conceptId, { level: c.level, asOf: c.asOf }]));
    assessedCache.set(session.id, assessed);
  }
  // The record is read on every turn: a course intake's notes can land while the lesson that followed it is running,
  // and until they do the tutor reads the intake's exchange itself.
  const knowledge = knowledgeFor(learner.id, course.id);
  return { knowledge, assessed, intakeJustNow: intakeJustNow(knowledge, learner.name) };
}

export function getSession(id: string): Session {
  return sessions.require(id);
}

function resolve(session: Session): { learner: Learner; course?: Course; lesson?: Lesson } {
  const learner = learners.require(session.learnerId);
  const course = session.courseId ? courses.require(session.courseId) : undefined;
  const lesson = course && session.lessonId ? course.lessons.find((l) => l.id === session.lessonId) : undefined;
  return { learner, course, lesson };
}

/** Apply a validated transition. Returns the message the tutor sees as the tool result. */
export function applyAdvance(session: Session, course: Course, lesson: Lesson, to: AdvanceTarget, rationale: string): string {
  const walk = walkedConceptIds(session, course, lesson);
  const conceptId = walk[session.conceptIndex];
  const obsForConcept = session.observations.filter((o) => o.conceptId === conceptId);
  switch (to) {
    case "inquire":
      if (session.phase !== "teach") return `Refused: cannot move to inquire from ${session.phase}.`;
      session.phase = "inquire";
      session.pendingDirectives.push("Now in INQUIRE: the learner's questions about this concept come first. If you already invited them, just answer what they ask.");
      return `OK: phase is now inquire (${rationale}).`;
    case "assess":
      if (session.phase !== "inquire" && session.phase !== "teach") return `Refused: cannot move to assess from ${session.phase}.`;
      // Nothing recorded means nothing was taught: a session was seen moving to assess on a concept it had
      // not started (2026-09-24), and then noting its own mistake.
      if (!obsForConcept.some((o) => isEvidence(o.kind))) return `Refused: nothing is recorded for ${conceptId} yet. Teach it and record what the learner shows before assessing.`;
      session.phase = "assess";
      session.pendingDirectives.push("Now in ASSESS: ask for demonstrations, one per turn, and record at least two observations before advancing. No hints in this phase.");
      return `OK: phase is now assess (${rationale}).`;
    case "next-concept": {
      if (session.phase !== "assess") return "Refused: assess the current concept first (advance to 'assess').";
      const assessObs = obsForConcept.filter((o) => isEvidence(o.kind)); // not engagement, and not what the tutor itself told them
      if (assessObs.length < 2) return `Refused: only ${assessObs.length} observation(s) recorded for ${conceptId}. Record evidence of the learner's demonstration first.`;
      if (session.conceptIndex + 1 >= walk.length) {
        session.phase = "wrap-up";
        session.pendingDirectives.push("All concepts in this lesson are done. Wrap up the session.");
        return "OK: that was the last concept. Phase is now wrap-up.";
      }
      session.conceptIndex += 1;
      session.phase = "teach";
      const next = course.concepts.find((c) => c.id === walk[session.conceptIndex]);
      session.pendingDirectives.push(`Moving on to the next concept: ${next?.name ?? walk[session.conceptIndex]}. Start by eliciting what the learner already thinks.`);
      return `OK: moved to concept ${session.conceptIndex + 1} of ${walk.length}: ${next?.name}.`;
    }
  }
}

export interface RespondResult {
  text: string;
  session: Session;
  /**
   * The tutor's reflect pass: records observations and requests the phase change, started after the reply
   * was spoken and running while the learner listens. Await it before the next turn so the tutor's notes
   * and the phase are current; the session on disk is updated when it settles.
   */
  reflection?: Promise<Session>;
  /**
   * An intake finished in this reply and the sitting went straight on: `session` is the one that took over (the
   * course intake, or the lesson), and its opening words are part of `text`. Later messages belong to it.
   */
  handover?: { from: string; to: string; kind: SessionKind };
}

/** In-flight reflect passes, so a caller that did not keep the promise can still wait before the next turn. */
const reflections = new Map<string, Promise<Session>>();

/** Wait for any reflect pass still running for this session (no-op if there is none). */
export async function settleReflection(sessionId: string): Promise<void> {
  await reflections.get(sessionId)?.catch(() => {});
}

/** Sessions with a turn being composed right now. A second message for the same session must wait. */
const inFlight = new Set<string>();

/**
 * Handle one learner utterance and stream the agent's reply. Persists transcript, observations,
 * and phase changes. `userText` may be empty for the opening turn (agent speaks first).
 *
 * One turn at a time per session: two overlapping requests each read the session, and the second to
 * finish overwrites the first, which is how a transcript came to hold the same student line twice with no
 * reply between (2026-09-24).
 */
export async function* respond(
  sessionId: string,
  userText: string,
  expressions?: string[],
  signal?: AbortSignal,
): AsyncGenerator<string, RespondResult, void> {
  if (inFlight.has(sessionId)) throw new Error("The tutor is still answering the previous message. Wait for that reply, then send again.");
  inFlight.add(sessionId);
  try {
    return yield* respondTurn(sessionId, userText, expressions, signal);
  } finally {
    inFlight.delete(sessionId);
  }
}

async function* respondTurn(
  sessionId: string,
  userText: string,
  expressions?: string[],
  signal?: AbortSignal,
): AsyncGenerator<string, RespondResult, void> {
  // The previous turn's notes and phase change must land before this turn is composed.
  await settleReflection(sessionId);
  let session = sessions.require(sessionId);
  // An intake that has finished handed its sitting on: a message addressed to it belongs to the session that took over.
  while (session.continuedIn) {
    await settleReflection(session.continuedIn);
    session = sessions.require(session.continuedIn);
  }
  if (session.phase === "complete") {
    const bye = "This session is finished. Start a new one when you're ready.";
    yield bye;
    return { text: bye, session };
  }
  // Reference checks that finished since the last turn: their verdicts land now, and any follow-up they ask
  // for joins this turn's directives, so the tutor comes back to it in this reply.
  mergeFinishedChecks(session);
  const { learner, course, lesson } = resolve(session);
  const now = new Date().toISOString();
  if (userText.trim()) session.transcript.push({ role: "user", content: userText.trim(), at: now, expressions });

  let intakeFinished: string | undefined;
  let result: { text: string; latency: TurnLatency };
  /** Set for tutor turns: runs the bookkeeping once the reply has been spoken. */
  let startReflection: ((spoken: string) => Promise<Session>) | undefined;

  /**
   * Stream an agent turn through to the caller. On a barge-in (the caller aborted the signal) keep what
   * the learner already heard as the turn's text instead of losing the exchange.
   */
  async function* drain(gen: AsyncGenerator<string, TurnResult, void>): AsyncGenerator<string, { text: string; latency: TurnLatency }, void> {
    let spoken = "";
    try {
      let r = await gen.next();
      while (!r.done) {
        spoken += r.value;
        yield r.value;
        r = await gen.next();
      }
      return r.value;
    } catch (err) {
      if (!signal?.aborted) throw err;
      return {
        text: spoken.trim(),
        latency: { ttftMs: 0, totalMs: 0, iterations: 1, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0, suppressedChars: 0, interrupted: true },
      };
    }
  }

  if (session.phase === "intake" && session.kind === "course-intake") {
    if (!course) throw new Error("The course intake has no course.");
    const concepts = (session.probeConceptIds ?? []).map((id) => course.concepts.find((c) => c.id === id)).filter((c): c is Concept => Boolean(c));
    result = yield* drain(courseIntakeTurn({ session, learner, course, concepts, next: nextStepAfter(session, learner), carriedOn: carriedOnWords(session), onFinish: (reason) => (intakeFinished = reason) }, signal));
  } else if (session.phase === "intake") {
    // The general intake. The agent asks for the passage and the orchestrator reads it, so every student hears the same words.
    let passageAsked = false;
    result = yield* drain(profilerTurn({ session, learner, next: nextStepAfter(session, learner), onFinish: (reason) => (intakeFinished = reason), onReadPassage: () => (passageAsked = true) }, signal));
    if (passageAsked && !result.latency.interrupted) {
      const reading = passageReading();
      yield `${result.text ? "\n\n" : ""}${reading}`;
      result = { ...result, text: `${result.text}${result.text ? "\n\n" : ""}${reading}` };
    }
  } else {
    if (!course || !lesson) throw new Error("Session has no course/lesson.");
    const concept = course.concepts.find((c) => c.id === walkedConceptIds(session, course, lesson)[session.conceptIndex]);
    if (!concept) throw new Error("Current concept not found.");
    const directives = session.pendingDirectives;
    // A sentence a reference check wrote for the tutor ("I looked that up: you were right...") is spoken first, by
    // the orchestrator: asked to open with it, the speaking model mostly did not (orchestrator/outside.ts, SAY_FIRST).
    const saidFirst = spokenFollowUps(directives).join(" ");
    // The thread is not a one-shot directive: it lives until the dialogue resolves it. Remember how many
    // turns it has been open so the reflect pass can keep counting, and drop it if that pass does not
    // renew it (which is how a resolved thread disappears).
    const priorThreadTurns = openThread(session)?.turns ?? 0;
    session.pendingDirectives = [];
    const ctx: TutorContext = {
      session: { ...session, pendingDirectives: directives.filter((d) => !d.startsWith(SAY_FIRST)) },
      saidFirst: saidFirst || undefined,
      carriedOn: carriedOnWords(session),
      ...whatIsKnown(session, learner, course),
      learner,
      course,
      lesson,
      concept,
      index: indexFor(course),
      onObservation: (raw: Observation) => {
        // A tool call can arrive with an empty or partial payload (seen 2026-09-23: `{}`). Pushing it would
        // make the session unsaveable, so refuse it here and let the model retry.
        const checked = ObservationSchema.safeParse(raw);
        if (!checked.success) return `Refused: incomplete observation (${checked.error.issues.map((i) => i.path.join(".")).join(", ") || "empty"}). Give conceptId, kind, evidence and note.`;
        const o = checked.data;
        // The reflect pass sees the whole exchange each turn, so it sometimes re-files evidence it already
        // recorded, usually re-quoted a little differently. Duplicates would also inflate the two-observation
        // gate on advancing, so drop them here.
        const already = session.observations.some((x) => x.conceptId === o.conceptId && sameEvidence(x.evidence, o.evidence));
        if (already) return `Already recorded that evidence for ${o.conceptId}; nothing added.`;
        session.observations.push(o);
        return `Recorded (${session.observations.filter((x) => x.conceptId === o.conceptId).length} observations for ${o.conceptId}).`;
      },
      onAdvance: (to, rationale) => applyAdvance(session, course, lesson, to, rationale),
      onThread: (thread) => setOpenThread(session, thread, priorThreadTurns),
      // Remember what the tutor read, from anywhere in the course, so the assessor can see it too.
      onLookup: (ids) => {
        session.retrievedChunkIds = [...new Set([...(session.retrievedChunkIds ?? []), ...ids])];
      },
      // A fact from outside the material: recorded for the parent, and checked in the background when the
      // parent's setting says so. The check never holds up a turn (orchestrator/outside.ts).
      onOutsideClaim: (input) => {
        const r = recordOutsideClaim(session, input, { mode: session.outsideKnowledge ?? "answer", checksAvailable: Boolean(config.wikipedia.contact) });
        const claim = r.claim;
        if (r.check && claim) void startCheck(session.id, claim.id, () => checkOutsideClaim(claim, studentLevel(learner, course)));
        return r.message;
      },
    };
    if (saidFirst) yield `${saidFirst} `;
    result = yield* drain(tutorTurn(ctx, signal));
    if (saidFirst) result = { ...result, text: `${saidFirst} ${result.text}`.trim() };

    // The reflect pass reads the exchange INCLUDING the reply just spoken, and writes into this same
    // session object, which is persisted again when it settles.
    startReflection = async (spoken: string): Promise<Session> => {
      try {
        const r = await reflectTurn({ ...ctx, session }, spoken);
        if (session.phase === "wrap-up" && spoken) {
          session.pendingDirectives.push("The learner may say goodbye. Respond in one sentence.");
        }
        const last = [...session.transcript].reverse().find((t) => t.role === "assistant");
        if (last?.latency) {
          last.latency.reflectMs = r.latency.totalMs;
          last.latency.reflectThinkingChars = r.latency.thinkingChars;
        }
      } catch (err) {
        console.warn("[reflect] pass failed:", err instanceof Error ? err.message : err);
      }
      return sessions.put(session);
    };
  }

  if (result.text) {
    // A cut-off reply keeps an ellipsis so the model (and the assessor) can see it was interrupted.
    const content = result.latency.interrupted ? `${result.text} …` : result.text;
    const turn: TranscriptTurn = { role: "assistant", content, at: new Date().toISOString(), latency: result.latency };
    session.transcript.push(turn);
  }

  if (intakeFinished) {
    // The conversation is over. Its record (the profile, or the course's starting points) is written from the
    // transcript in the background: the old intake wrote it before answering, which was half a minute of
    // silence followed by a goodbye, and then the lesson started ("wait are we done already?", 2026-09-15).
    const at = new Date().toISOString();
    session.phase = "complete";
    session.endedAt = at;
    session.extraction = { status: "writing", at };
    markRecordPending(session, at);
    // Read again: the pending mark has just been written on the learner.
    const next = signal?.aborted ? undefined : continueSitting(session, learners.require(learner.id));
    if (next) session.continuedIn = next.id;
    sessions.put(session);
    void writeIntakeRecord(session.id);
    if (next) {
      // The sitting goes straight on: the next session's opening is part of this same reply, so there is no dead
      // air and nothing for the browser to trigger. The words land in the next session's own transcript.
      yield " ";
      const follow = yield* respondTurn(next.id, "", undefined, signal);
      return { ...follow, text: `${result.text} ${follow.text}`.trim(), handover: { from: session.id, to: follow.session.id, kind: follow.session.kind ?? "lesson" } };
    }
    return { text: result.text, session };
  }

  sessions.put(session);

  // Start the bookkeeping now that the words are out. An interrupted reply is not reflected on: the
  // exchange the learner heard is incomplete, and the next turn will cover it.
  let reflection: Promise<Session> | undefined;
  if (startReflection && result.text && !result.latency.interrupted) {
    reflection = startReflection(result.text).finally(() => {
      if (reflections.get(sessionId) === reflection) reflections.delete(sessionId);
    });
    reflections.set(sessionId, reflection);
  }
  return { text: result.text, session, reflection };
}

/** Latency summary across a session's assistant turns (for the API and the chat CLI). Interrupted turns are skipped. */
export function latencySummary(session: Session): { turns: number; ttftP50Ms: number; ttftMaxMs: number; totalP50Ms: number; cacheHitRate: number; firstAudioP50Ms?: number } {
  const ls = session.transcript.map((t) => t.latency).filter((l): l is NonNullable<typeof l> => Boolean(l) && !l?.interrupted);
  const p50 = (xs: number[]): number => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const cacheRead = ls.reduce((a, l) => a + l.cacheReadTokens, 0);
  const allInput = ls.reduce((a, l) => a + l.cacheReadTokens + l.cacheWriteTokens + l.inputTokens, 0);
  const audio = ls.map((l) => l.firstAudioMs).filter((x): x is number => typeof x === "number");
  return {
    turns: ls.length,
    ttftP50Ms: p50(ls.map((l) => l.ttftMs)),
    ttftMaxMs: Math.max(0, ...ls.map((l) => l.ttftMs)),
    totalP50Ms: p50(ls.map((l) => l.totalMs)),
    cacheHitRate: allInput ? Math.round((100 * cacheRead) / allInput) / 100 : 0,
    ...(audio.length ? { firstAudioP50Ms: p50(audio) } : {}),
  };
}

/** Attach voice timings (end of speech to first audio, etc.) to the most recent assistant turn. */
export function annotateLastTurn(sessionId: string, patch: Partial<TurnLatency>): void {
  const session = sessions.require(sessionId);
  const last = [...session.transcript].reverse().find((t) => t.role === "assistant" && t.latency);
  if (!last?.latency) return;
  Object.assign(last.latency, patch);
  sessions.put(session);
}

/**
 * Two observations are the same evidence if one quotes the other, allowing for re-quoting: case, punctuation,
 * an ellipsis, a trimmed or extended quotation.
 */
export function sameEvidence(a: string, b: string): boolean {
  const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return ka === kb;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 24 && long.includes(short.slice(0, 40));
}

/**
 * End the session and, when a lesson was taught, produce the mastery report.
 *
 * Waits for a reflect pass still running for this session: it saves the session when it finishes, and
 * without the wait it saved an older copy over the closed one (2026-09-24: a session with a report was
 * left in phase "assess" and offered for resumption).
 */
export async function endSession(sessionId: string): Promise<{ session: Session; report?: MasteryReport; profileUpdate?: Promise<ProfileUpdate | undefined> }> {
  // A sitting that began with an intake is ended where it is now: the session that took over.
  for (let next = sessions.require(sessionId).continuedIn; next; next = sessions.require(next).continuedIn) sessionId = next;
  await settleReflection(sessionId);
  // Give reference checks still running a moment, so the report can show their verdicts.
  await settleChecks(sessionId);
  const session = sessions.require(sessionId);
  const { learner, course, lesson } = resolve(session);
  if (session.phase === "complete") {
    const existing = reports.get(sessionId);
    if (existing) return { session, report: existing };
  }
  session.phase = "complete";
  session.endedAt = new Date().toISOString();
  // After the phase is complete, so a late verdict is recorded without queueing a follow-up nobody will hear.
  mergeFinishedChecks(session);
  sessions.put(session);
  if (!course || !lesson || session.transcript.length < 2) return { session };
  const report = await assessSession({ session, learner, course, lesson, knowledge: knowledgeFor(learner.id, course.id) });
  reports.put({ ...report, id: session.id });
  // The profile pass runs after the report is saved, in the background: the parent is waiting on the report,
  // and the revision lands on the record when it is done. Never rejects; a failure is logged.
  const profileUpdate = learner.profile ? reviseProfile(learner.id, course, session, report) : undefined;
  return { session, report, profileUpdate };
}



// ---------------------------------------------------------------------------
// An intake's record, written in the background
// ---------------------------------------------------------------------------

/** One write at a time per learner (a profile pass, an intake's record), each reading what the previous one wrote. */
const learnerWrites = new Map<string, Promise<unknown>>();
function queued<T>(learnerId: string, job: () => Promise<T>): Promise<T> {
  const run = (learnerWrites.get(learnerId) ?? Promise.resolve()).then(job);
  learnerWrites.set(learnerId, run.catch(() => undefined));
  return run;
}

/** Intake sessions whose record is being written in this process, so a second request does not start a second write. */
const writing = new Set<string>();

/**
 * Say on the student's records that an intake has happened and its record is on the way: the general intake is
 * not held again while the profile is being written, the course intake is not due again, and the Students tab
 * can say what is going on.
 */
function markRecordPending(session: Session, since: string): void {
  const pending = { sessionId: session.id, since };
  if (session.kind === "course-intake") {
    if (!session.courseId) return;
    const existing = knowledgeFor(session.learnerId, session.courseId);
    courseKnowledge.put({
      ...(existing ?? { id: knowledgeId(session.learnerId, session.courseId), learnerId: session.learnerId, courseId: session.courseId, starts: [], priorKnowledge: [], observedGaps: [], guidance: [], createdAt: since }),
      pending,
      updatedAt: since,
    });
  } else {
    learners.put({ ...learners.require(session.learnerId), profilePending: pending });
  }
}

/**
 * Write the record an intake session leaves behind: the learner profile (general intake) or the course's
 * starting points and first notes (course intake). Never rejects: a failure is recorded on the session and on
 * the pending mark, where the Students tab shows it with a way to try again.
 */
export function writeIntakeRecord(sessionId: string): Promise<void> {
  if (writing.has(sessionId)) return Promise.resolve();
  writing.add(sessionId);
  const learnerId = sessions.require(sessionId).learnerId;
  return queued(learnerId, async () => {
    const session = sessions.require(sessionId);
    const learner = learners.require(learnerId);
    const settle = (extraction: NonNullable<Session["extraction"]>): void => void sessions.put({ ...sessions.require(sessionId), extraction });
    try {
      if (session.kind === "course-intake") {
        const course = courses.require(session.courseId ?? "");
        const asked = session.probeConceptIds ?? [];
        const concepts = asked.map((id) => course.concepts.find((c) => c.id === id)).filter((c): c is Concept => Boolean(c));
        const extraction = await extractCourseKnowledge({ session, learner, course, concepts });
        const at = new Date().toISOString();
        // Read again: a profile pass may have added notes while this was being written.
        courseKnowledge.put(toCourseKnowledge(extraction, { id: knowledgeId(learnerId, course.id), learnerId, courseId: course.id, probeConceptIds: asked, sessionId, at }, knowledgeFor(learnerId, course.id)));
      } else {
        // Normalised like every later revision: no repeats, and at most six guidance items (an intake once wrote eleven).
        const profile = normalizeProfile(await finalizeProfile({ session, learner }));
        const { profilePending: _written, ...fresh } = learners.require(learnerId);
        learners.put({ ...fresh, profile });
      }
      settle({ status: "done", at: new Date().toISOString() });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[intake] writing the record of session ${sessionId} failed:`, error);
      settle({ status: "failed", at: new Date().toISOString(), error });
      if (session.kind === "course-intake" && session.courseId) {
        const k = knowledgeFor(learnerId, session.courseId);
        if (k?.pending?.sessionId === sessionId) courseKnowledge.put({ ...k, pending: { ...k.pending, error } });
      } else {
        const l = learners.require(learnerId);
        if (l.profilePending?.sessionId === sessionId) learners.put({ ...l, profilePending: { ...l.profilePending, error } });
      }
    } finally {
      writing.delete(sessionId);
    }
  });
}

/** Wait for whatever is being written for this learner (an intake's record, a profile pass). For a CLI about to exit, and for tests. */
export async function settleLearnerWrites(learnerId: string): Promise<void> {
  await learnerWrites.get(learnerId);
}

/** Try again to write a record that failed, or that a restart interrupted. Returns once the attempt has been queued. */
export function retryIntakeRecord(sessionId: string): void {
  const session = sessions.require(sessionId);
  if (session.phase !== "complete" || (session.kind !== "general-intake" && session.kind !== "course-intake")) throw new Error("That session is not a finished intake.");
  const at = new Date().toISOString();
  sessions.put({ ...session, extraction: { status: "writing", at } });
  markRecordPending(session, at);
  void writeIntakeRecord(sessionId);
}

/** Records still marked as on the way for this learner that nothing in this process is writing: pick them up. */
function resumePendingRecords(learner: Learner): void {
  const stalled = [learner.profilePending?.sessionId, ...courseKnowledge.list().filter((k) => k.learnerId === learner.id).map((k) => k.pending?.sessionId)];
  for (const id of stalled) {
    if (!id || writing.has(id) || !sessions.get(id)) continue;
    void writeIntakeRecord(id);
  }
}

/** A finished intake's exchange, as the lesson that follows it reads it while the record is still being written. */
function intakeJustNow(knowledge: ReturnType<typeof knowledgeFor>, learnerName: string): string | undefined {
  if (!knowledge?.pending || knowledge.starts.length) return undefined;
  const intake = sessions.get(knowledge.pending.sessionId);
  if (!intake) return undefined;
  const text = intake.transcript.map((t) => `${t.role === "user" ? learnerName : "Tutor"}: ${t.content}`).join("\n");
  return text.length > 8000 ? `${text.slice(0, 8000)}\n(...)` : text;
}

/**
 * Keep the learner's profile current from this session (domain/profile.ts decides what lands; here it is
 * persisted). The learner is read inside the queue, so the pass sees the latest profile, and again right before
 * saving, so a change made meanwhile (an undo) is not overwritten.
 */
function reviseProfile(learnerId: string, course: Course, session: Session, report: MasteryReport): Promise<ProfileUpdate | undefined> {
  // One write at a time per learner, each reading what the previous one wrote: two sessions ending together cannot overwrite each other.
  return queued(learnerId, () => revise(learnerId, course, session, report));
}

async function revise(learnerId: string, course: Course, session: Session, report: MasteryReport): Promise<ProfileUpdate | undefined> {
  try {
    const learner = learners.require(learnerId);
    if (!learner.profile) return undefined;
    const priorReports = reports
      .list()
      .filter((r) => r.learnerId === learnerId && r.sessionId !== session.id && r.createdAt < report.createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-3)
      .map((r) => ({ report: r, course: r.courseId ? courses.get(r.courseId) : undefined }));
    const revision = await proposeRevision({ learner, course, session, report, knowledge: knowledgeFor(learnerId, course.id), priorReports });
    // Read both records again: the pass took a minute or two, and an undo or a course intake may have landed meanwhile.
    const fresh = learners.require(learnerId);
    if (!fresh.profile) return undefined;
    const { learner: revised, course: notes, update } = applyRevision(fresh, revision, { sessionId: session.id, courseId: course.id, courseTitle: course.title, at: new Date().toISOString() }, knowledgeFor(learnerId, course.id));
    learners.put(revised);
    if (notes) putCourseNotes(learnerId, course.id, notes);
    return update;
  } catch (err) {
    console.warn("[profile] revision failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

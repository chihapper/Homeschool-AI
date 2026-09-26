/**
 * Orchestrator: deterministic session state machine that routes each learner turn to the right agent.
 *
 *   intake ──(profile finalized)──> teach ──> inquire ──> assess ──(next concept)──> teach ...
 *                                                                 └─(last concept)──> wrap-up ──> complete
 *
 * The LLM agents *request* transitions via the `advance` tool; the orchestrator validates them
 * (e.g. no next-concept without recorded evidence) and owns all persistence.
 */
import { ObservationSchema, type Course, type Learner, type Lesson, type MasteryReport, type Observation, type Session, type TranscriptTurn } from "../domain/types.js";
import type { TurnLatency } from "../llm/client.js";
import type { TurnResult } from "../agents/base.js";
import { ChunkIndex } from "../ingest/retrieval.js";
import { effectiveConceptIds, effectiveLessons, isConceptKept, walkedConceptIds } from "../domain/focus.js";
import { courses, learners, reports, sessions } from "../store/index.js";
import { openThread, setOpenThread } from "./notes.js";
import { finalizeProfile, profilerTurn } from "../agents/profiler-agent.js";
import { prewarmTutor, reflectTurn, tutorTurn, type AdvanceTarget, type TutorContext } from "../agents/tutor-agent.js";
import { config } from "../config.js";
import { assessSession } from "../agents/assessor-agent.js";
import { checkOutsideClaim } from "../agents/reference-agent.js";
import { mergeFinishedChecks, recordOutsideClaim, SAY_FIRST, settleChecks, spokenFollowUps, startCheck } from "./outside.js";

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
  /** Skip the intake even if the learner has no profile yet. */
  skipIntake?: boolean;
  /** The student has already read the material: open by asking them to tell it back, then question from that. */
  narrationFirst?: boolean;
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

export function createSession(args: CreateSessionArgs): Session {
  const learner = learners.require(args.learnerId);
  let course: Course | undefined;
  let lesson: Lesson | undefined;
  if (args.courseId) {
    course = courses.require(args.courseId);
    lesson = args.lessonId ? course.lessons.find((l) => l.id === args.lessonId) : effectiveLessons(course)[0];
    if (!lesson) {
      throw new Error(args.lessonId ? `Lesson ${args.lessonId} not found in course ${course.id}` : `Course ${course.id} has no lesson left to teach: every lesson is skipped in its focus.`);
    }
  }
  const needsIntake = !learner.profile && !args.skipIntake;
  if (!needsIntake && !course) throw new Error("A course is required unless the session is an intake.");
  // The parent's focus is read here, once. The walk is frozen on the session so a later edit cannot change
  // what a running session teaches or the tutor's cached prompt prefix.
  const conceptIds = course && lesson ? effectiveConceptIds(course, lesson) : undefined;
  if (course && lesson && !conceptIds?.length) throw new Error(`Lesson "${lesson.title}" has no concepts left to teach: change the course's focus or pick another lesson.`);
  const opening: string[] = [];
  // A narration is itself retrieval, so a narration-first session does not also open with a spaced-retrieval question.
  const retrieval = course && !needsIntake && !args.narrationFirst ? spacedRetrieval(learner, course) : undefined;
  if (retrieval) opening.push(retrieval.directive);
  if (course && args.narrationFirst) opening.push(NARRATION_DIRECTIVE);
  const session: Session = {
    id: sessions.newId(),
    learnerId: learner.id,
    courseId: course?.id,
    lessonId: lesson?.id,
    conceptIndex: 0,
    conceptIds,
    narrationFirst: course && args.narrationFirst ? true : undefined,
    retrievalConceptId: retrieval?.conceptId,
    // Read once, like the focus: the tutor's cached prompt states it, so a Settings change applies from the next session.
    outsideKnowledge: course ? config.outsideKnowledge : undefined,
    phase: needsIntake ? "intake" : "teach",
    transcript: [],
    observations: [],
    pendingDirectives: opening,
    startedAt: new Date().toISOString(),
  };
  const saved = sessions.put(session);
  if (config.prewarmCache && course && lesson && !needsIntake) {
    const ctx = tutorContextFor(saved, learner, course, lesson);
    if (ctx) void prewarmTutor(ctx);
  }
  return saved;
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
  return { session, learner, course, lesson, concept, index: indexFor(course), onObservation: () => "", onAdvance: () => "" };
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
      if (!obsForConcept.some((o) => o.kind !== "engagement")) return `Refused: nothing is recorded for ${conceptId} yet. Teach it and record what the learner shows before assessing.`;
      session.phase = "assess";
      session.pendingDirectives.push("Now in ASSESS: ask for demonstrations, one per turn, and record at least two observations before advancing. No hints in this phase.");
      return `OK: phase is now assess (${rationale}).`;
    case "next-concept": {
      if (session.phase !== "assess") return "Refused: assess the current concept first (advance to 'assess').";
      const assessObs = obsForConcept.filter((o) => o.kind !== "engagement");
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
  const session = sessions.require(sessionId);
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

  if (session.phase === "intake") {
    result = yield* drain(profilerTurn({ session, learner, course, onFinish: (reason) => (intakeFinished = reason) }, signal));
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
        if (r.check && claim) void startCheck(session.id, claim.id, () => checkOutsideClaim(claim, learner.gradeLevel ?? course.level));
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
    const profile = await finalizeProfile({ session, learner, course });
    learners.put({ ...learner, profile });
    if (course && lesson) {
      session.phase = "teach";
      session.pendingDirectives.push(`Intake is complete. Begin the lesson "${lesson.title}" with the first concept.`);
      // The tutor prompt (with the new profile) is about to be used for the first time: warm its cache now.
      if (config.prewarmCache) {
        const ctx = tutorContextFor(session, { ...learner, profile }, course, lesson);
        if (ctx) void prewarmTutor(ctx);
      }
    } else {
      session.phase = "complete";
      session.endedAt = new Date().toISOString();
    }
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
export async function endSession(sessionId: string): Promise<{ session: Session; report?: MasteryReport }> {
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
  const report = await assessSession({ session, learner, course, lesson });
  reports.put({ ...report, id: session.id });
  return { session, report };
}

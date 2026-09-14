/**
 * Orchestrator: deterministic session state machine that routes each learner turn to the right agent.
 *
 *   intake ──(profile finalized)──> teach ──> inquire ──> assess ──(next concept)──> teach ...
 *                                                                 └─(last concept)──> wrap-up ──> complete
 *
 * The LLM agents *request* transitions via the `advance` tool; the orchestrator validates them
 * (e.g. no next-concept without recorded evidence) and owns all persistence.
 */
import type { Course, Learner, Lesson, MasteryReport, Observation, Session, TranscriptTurn } from "../domain/types.js";
import type { TurnLatency } from "../llm/client.js";
import { ChunkIndex } from "../ingest/retrieval.js";
import { courses, learners, reports, sessions } from "../store/index.js";
import { finalizeProfile, profilerTurn } from "../agents/profiler-agent.js";
import { prewarmTutor, tutorTurn, type AdvanceTarget, type TutorContext } from "../agents/tutor-agent.js";
import { config } from "../config.js";
import { assessSession } from "../agents/assessor-agent.js";

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
}

export function createSession(args: CreateSessionArgs): Session {
  const learner = learners.require(args.learnerId);
  let course: Course | undefined;
  let lesson: Lesson | undefined;
  if (args.courseId) {
    course = courses.require(args.courseId);
    lesson = args.lessonId ? course.lessons.find((l) => l.id === args.lessonId) : course.lessons[0];
    if (!lesson) throw new Error(`Lesson ${args.lessonId ?? "(first)"} not found in course ${course.id}`);
  }
  const needsIntake = !learner.profile && !args.skipIntake;
  if (!needsIntake && !course) throw new Error("A course is required unless the session is an intake.");
  const session: Session = {
    id: sessions.newId(),
    learnerId: learner.id,
    courseId: course?.id,
    lessonId: lesson?.id,
    conceptIndex: 0,
    phase: needsIntake ? "intake" : "teach",
    transcript: [],
    observations: [],
    pendingDirectives: course && !needsIntake ? retrievalDirectives(learner, course) : [],
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
 * Spaced retrieval: if this learner has mastered concepts in earlier sessions, ask the tutor to open with
 * one retrieval question on the least-recently-reported one before starting today's concept.
 */
export function retrievalDirectives(learner: Learner, course: Course): string[] {
  const prior = reports
    .list()
    .filter((r) => r.learnerId === learner.id && r.courseId === course.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mastered = prior.flatMap((r) => r.concepts.filter((c) => c.level >= 2).map((c) => ({ conceptId: c.conceptId, at: r.createdAt })));
  if (!mastered.length) return [];
  const oldest = mastered[0];
  const concept = course.concepts.find((c) => c.id === oldest.conceptId);
  if (!concept) return [];
  return [
    `Spaced retrieval: before today's concept, ask ONE quick retrieval question about "${concept.name}" (learned on ${oldest.at.slice(0, 10)}). No hints. Record the result with record_observation for concept ${concept.id}, then move on to today's concept.`,
  ];
}

function tutorContextFor(session: Session, learner: Learner, course: Course, lesson: Lesson): TutorContext | undefined {
  const concept = course.concepts.find((c) => c.id === lesson.conceptIds[session.conceptIndex]);
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
  const conceptId = lesson.conceptIds[session.conceptIndex];
  const obsForConcept = session.observations.filter((o) => o.conceptId === conceptId);
  switch (to) {
    case "inquire":
      if (session.phase !== "teach") return `Refused: cannot move to inquire from ${session.phase}.`;
      session.phase = "inquire";
      session.pendingDirectives.push("Now in INQUIRE: invite the learner's questions about this concept.");
      return `OK: phase is now inquire (${rationale}).`;
    case "assess":
      if (session.phase !== "inquire" && session.phase !== "teach") return `Refused: cannot move to assess from ${session.phase}.`;
      session.phase = "assess";
      session.pendingDirectives.push("Now in ASSESS: ask for demonstrations and record at least two observations before advancing.");
      return `OK: phase is now assess (${rationale}).`;
    case "next-concept": {
      if (session.phase !== "assess") return "Refused: assess the current concept first (advance to 'assess').";
      const assessObs = obsForConcept.filter((o) => o.kind !== "engagement");
      if (assessObs.length < 2) return `Refused: only ${assessObs.length} observation(s) recorded for ${conceptId}. Record evidence of the learner's demonstration first.`;
      if (session.conceptIndex + 1 >= lesson.conceptIds.length) {
        session.phase = "wrap-up";
        session.pendingDirectives.push("All concepts in this lesson are done. Wrap up the session.");
        return "OK: that was the last concept. Phase is now wrap-up.";
      }
      session.conceptIndex += 1;
      session.phase = "teach";
      const next = course.concepts.find((c) => c.id === lesson.conceptIds[session.conceptIndex]);
      session.pendingDirectives.push(`Moving on to the next concept: ${next?.name ?? lesson.conceptIds[session.conceptIndex]}. Start by eliciting what the learner already thinks.`);
      return `OK: moved to concept ${session.conceptIndex + 1} of ${lesson.conceptIds.length}: ${next?.name}.`;
    }
  }
}

export interface RespondResult {
  text: string;
  session: Session;
}

/**
 * Handle one learner utterance and stream the agent's reply. Persists transcript, observations,
 * and phase changes. `userText` may be empty for the opening turn (agent speaks first).
 */
export async function* respond(
  sessionId: string,
  userText: string,
  expressions?: string[],
  signal?: AbortSignal,
): AsyncGenerator<string, RespondResult, void> {
  const session = sessions.require(sessionId);
  if (session.phase === "complete") {
    const bye = "This session is finished. Start a new one when you're ready.";
    yield bye;
    return { text: bye, session };
  }
  const { learner, course, lesson } = resolve(session);
  const now = new Date().toISOString();
  if (userText.trim()) session.transcript.push({ role: "user", content: userText.trim(), at: now, expressions });

  let intakeFinished: string | undefined;
  let result: { text: string; latency: TurnLatency };

  if (session.phase === "intake") {
    const gen = profilerTurn({ session, learner, course, onFinish: (reason) => (intakeFinished = reason) }, signal);
    let r = await gen.next();
    while (!r.done) {
      yield r.value;
      r = await gen.next();
    }
    result = r.value;
  } else {
    if (!course || !lesson) throw new Error("Session has no course/lesson.");
    const concept = course.concepts.find((c) => c.id === lesson.conceptIds[session.conceptIndex]);
    if (!concept) throw new Error("Current concept not found.");
    const directives = session.pendingDirectives;
    session.pendingDirectives = [];
    const gen = tutorTurn(
      {
        session: { ...session, pendingDirectives: directives },
        learner,
        course,
        lesson,
        concept,
        index: indexFor(course),
        onObservation: (o: Observation) => {
          session.observations.push(o);
          return `Recorded (${session.observations.filter((x) => x.conceptId === o.conceptId).length} observations for ${o.conceptId}).`;
        },
        onAdvance: (to, rationale) => applyAdvance(session, course, lesson, to, rationale),
      },
      signal,
    );
    let r = await gen.next();
    while (!r.done) {
      yield r.value;
      r = await gen.next();
    }
    result = r.value;
    if (session.phase === "wrap-up" && result.text) {
      // The wrap-up words were just spoken; next turn closes the session.
      session.pendingDirectives.push("The learner may say goodbye. Respond in one sentence.");
    }
  }

  if (result.text) {
    const turn: TranscriptTurn = { role: "assistant", content: result.text, at: new Date().toISOString(), latency: result.latency };
    session.transcript.push(turn);
  }

  if (intakeFinished) {
    const profile = await finalizeProfile({ session, learner, course });
    learners.put({ ...learner, profile });
    if (course && lesson) {
      session.phase = "teach";
      session.pendingDirectives.push(`Intake is complete. Begin the lesson "${lesson.title}" with the first concept.`);
    } else {
      session.phase = "complete";
      session.endedAt = new Date().toISOString();
    }
  }

  sessions.put(session);
  return { text: result.text, session };
}

/** Latency summary across a session's assistant turns (for the API and the chat CLI). */
export function latencySummary(session: Session): { turns: number; ttftP50Ms: number; ttftMaxMs: number; totalP50Ms: number; cacheHitRate: number } {
  const ls = session.transcript.map((t) => t.latency).filter((l): l is NonNullable<typeof l> => Boolean(l));
  const p50 = (xs: number[]): number => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const cacheRead = ls.reduce((a, l) => a + l.cacheReadTokens, 0);
  const allInput = ls.reduce((a, l) => a + l.cacheReadTokens + l.cacheWriteTokens + l.inputTokens, 0);
  return {
    turns: ls.length,
    ttftP50Ms: p50(ls.map((l) => l.ttftMs)),
    ttftMaxMs: Math.max(0, ...ls.map((l) => l.ttftMs)),
    totalP50Ms: p50(ls.map((l) => l.totalMs)),
    cacheHitRate: allInput ? Math.round((100 * cacheRead) / allInput) / 100 : 0,
  };
}

/** End the session and, when a lesson was taught, produce the mastery report. */
export async function endSession(sessionId: string): Promise<{ session: Session; report?: MasteryReport }> {
  const session = sessions.require(sessionId);
  const { learner, course, lesson } = resolve(session);
  session.phase = "complete";
  session.endedAt = new Date().toISOString();
  sessions.put(session);
  if (!course || !lesson || session.transcript.length < 2) return { session };
  const report = await assessSession({ session, learner, course, lesson });
  reports.put({ ...report, id: session.id });
  return { session, report };
}

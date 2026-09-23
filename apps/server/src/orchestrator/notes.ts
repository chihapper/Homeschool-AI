/**
 * The open thread: what this dialogue is currently about, carried from one turn to the next.
 *
 * Socratic teaching is one continuous dialogue, not a series of independent questions: "a shared dialogue
 * between teacher and students in which both are responsible for pushing the dialogue forward through
 * questioning" (Stanford, *Speaking of Teaching* 13:1). The unfinished business of that dialogue — a
 * question the learner answered around, a claim of theirs that contradicts an earlier one, an answer that
 * sounded like a lucky guess — IS the thread, and following it is the method rather than an interruption
 * to it.
 *
 * The speaking call answers in the rhythm of talk and cannot deliberate, so the reflect pass that follows
 * it names the thread in one sentence, and the next speaking turn sees it beside the phase. They are not
 * competing instructions: the phase says what kind of work is being done (build the idea, take questions,
 * ask for a demonstration), the thread says what that work is currently ON.
 *
 * A thread also carries how many turns it has been open, because a teacher varies the angle once or twice
 * and then says plainly "I want to come back to this." Without the count the tutor can circle a dodged
 * question indefinitely, each turn a reasonable new angle, and never close it (observed 2026-09-22).
 *
 * Its own module so the tutor agent can read the marker without importing the orchestrator, which imports
 * the agent.
 */
import type { Session } from "../domain/types.js";

/** Marks a queued directive as the dialogue's open thread rather than an instruction from the state machine. */
export const THREAD_PREFIX = "Open thread in this dialogue: ";

/** One sentence, so a thread cannot grow into a second lesson plan. */
const MAX_THREAD_CHARS = 200;

/** After this many turns on the same thread, the tutor should stop varying the angle and ask it plainly. */
export const THREAD_PATIENCE = 3;

export interface OpenThread {
  text: string;
  /** How many spoken turns this thread has been open, including the one about to happen. */
  turns: number;
}

/** Serialize so the thread survives in the plain-string directive list the session already persists. */
function encode(t: OpenThread): string {
  return `${THREAD_PREFIX}[turn ${t.turns}] ${t.text}`;
}

/** The open thread, if the dialogue has one. */
export function openThread(session: Session): OpenThread | undefined {
  const d = session.pendingDirectives.find((x) => x.startsWith(THREAD_PREFIX));
  if (!d) return undefined;
  const rest = d.slice(THREAD_PREFIX.length);
  const m = rest.match(/^\[turn (\d+)\] ([\s\S]*)$/);
  return m ? { turns: Number(m[1]), text: m[2] } : { turns: 1, text: rest };
}

/**
 * Name the open thread for the next spoken turn. Naming it again while one is already open keeps the
 * count running: the dialogue is still stuck in the same place, however the tutor rephrases it.
 * `priorTurns` carries the count across the orchestrator's per-turn clearing of the directive list, so a
 * thread the reflect pass renews keeps counting and one it does not renew simply disappears.
 * Returns the tool result the model sees.
 */
export function setOpenThread(session: Session, thread: string, priorTurns = 0): string {
  const text = thread.trim().replace(/\s+/g, " ").slice(0, MAX_THREAD_CHARS);
  if (!text) return "Refused: an empty thread.";
  const turns = Math.max(openThread(session)?.turns ?? 0, priorTurns) + 1;
  // One thread at a time: a dialogue has one place it is stuck, and the latest reading of it replaces the last.
  session.pendingDirectives = session.pendingDirectives.filter((d) => !d.startsWith(THREAD_PREFIX));
  session.pendingDirectives.push(encode({ text, turns }));
  return turns >= THREAD_PATIENCE
    ? `The open thread is now: "${text}" — and it has been open for ${turns} turns. Next turn, ask it plainly rather than from another angle.`
    : `The open thread is now: "${text}". Your next turn will see it.`;
}

/** Clear the thread once it is genuinely resolved. */
export function clearOpenThread(session: Session): void {
  session.pendingDirectives = session.pendingDirectives.filter((d) => !d.startsWith(THREAD_PREFIX));
}

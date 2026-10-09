/**
 * The session clock: the parent's limit on how long a lesson runs (Settings, 3 to 60 minutes, frozen on the
 * session when it starts). Pure, so the rule is testable. With two minutes left the tutor wraps up the idea it
 * is on; at the limit its next reply closes the session; after that no turn is taken and the app ends the
 * session, which brings up the report. Intakes are not clocked: they are short by construction and end
 * themselves. The user asked for the parent to set this (2026-10-09), between 3 and 60 minutes.
 *
 * The orchestrator keeps the time (`clockCall`, which marks `timeWarnedAt` and `timeUpAt` on the session); the
 * tutor agent reads the stage back from those marks (`clockStage`) and lets it shape the speaking call's final
 * instruction. It has to be the final instruction: given the same words in the `<orchestrator>` block, the
 * speaking model kept to "end in your single question" and asked one in the reply meant to close the session
 * (2026-10-09, Haiku 5.5).
 */
import type { Session } from "./types.js";

/** Minutes before the limit at which the tutor is told to wrap up. */
export const WARN_MINUTES = 2;

export type ClockCall = { kind: "warn"; minutesLeft: number } | { kind: "close" } | null;

type Clocked = Pick<Session, "kind" | "startedAt" | "limitMinutes" | "timeWarnedAt" | "timeUpAt">;

export function elapsedMinutes(session: Pick<Session, "startedAt">, now: Date): number {
  return (now.getTime() - new Date(session.startedAt).getTime()) / 60_000;
}

/** Seconds left on the clock, or undefined when the session has none. Never negative. */
export function secondsLeft(session: Pick<Session, "startedAt" | "limitMinutes">, now: Date): number | undefined {
  if (!session.limitMinutes) return undefined;
  return Math.max(0, Math.round(session.limitMinutes * 60 - elapsedMinutes(session, now) * 60));
}

/** What the clock asks of this turn, if anything. The orchestrator marks the session accordingly. */
export function clockCall(session: Clocked, now: Date): ClockCall {
  if (session.kind && session.kind !== "lesson") return null;
  if (!session.limitMinutes || session.timeUpAt) return null;
  const elapsed = elapsedMinutes(session, now);
  if (elapsed >= session.limitMinutes) return { kind: "close" };
  const left = session.limitMinutes - elapsed;
  if (left <= WARN_MINUTES && !session.timeWarnedAt) return { kind: "warn", minutesLeft: Math.max(1, Math.round(left)) };
  return null;
}

/**
 * What the clock asks of the reply being composed, read from the session's marks: `close` while the closing
 * reply is composed (after it no reply is composed at all), `wrap-up` from the warning to the close, with
 * `announce` on the one turn that tells the learner. Pure: the orchestrator sets the marks before the turn.
 */
export type ClockStage = { kind: "close" } | { kind: "wrap-up"; announce: boolean } | null;

export function clockStage(session: Pick<Session, "kind" | "timeWarnedAt" | "timeUpAt" | "transcript">): ClockStage {
  if (session.kind && session.kind !== "lesson") return null;
  if (session.timeUpAt) return { kind: "close" };
  const warnedAt = session.timeWarnedAt;
  if (!warnedAt) return null;
  const saidAlready = session.transcript.some((t) => t.role === "assistant" && t.at > warnedAt);
  return { kind: "wrap-up", announce: !saidAlready };
}

/** True from the two-minute warning on: no concept-to-concept move is applied, so the last minutes stay on the idea in hand. */
export function wrappingUp(session: Pick<Session, "kind" | "timeWarnedAt">): boolean {
  if (session.kind && session.kind !== "lesson") return false;
  return Boolean(session.timeWarnedAt);
}

/** Leads the speaking call's final instruction from the warning to the close. */
export function wrapUpInstruction(announce: boolean): string {
  return (
    (announce
      ? "This session has about two minutes left: tell the learner so in passing, in a few words, and then "
      : "This session is in its last two minutes, so ") +
    "stay on the idea you are on: no new concept and no new line of questioning. If their latest answer was sound, say so and ask one small question that finishes the idea. "
  );
}

/** The speaking call's whole final instruction for the reply that closes the session. */
export const CLOSE_INSTRUCTION =
  "The session's time is up and this reply closes it. You are speaking to the learner now and they are waiting, so answer straight away: " +
  "in two or three sentences, thank them, name one thing they did well today in their own words, and say what to pick up next time. " +
  "Ask no question, start nothing new, and call no tool. Never mention tools, phases, or the profile out loud.";

/** What the reflect pass is told at each stage: notes as usual, nothing that would carry the lesson on. */
export const CLOSE_REFLECT_NOTE =
  " The session's time is up and the reply they just heard closed it: record what their latest reply showed, as usual, but do not call advance or open_thread; nothing more is spoken.";
export const WRAP_UP_REFLECT_NOTE = " The session is in its last two minutes: open no thread that would take several turns, and do not advance to another concept.";

/** Spoken when a message arrives after the closing reply. */
export const AFTER_CLOSE = "This session's time is up. Ending it now brings up the report.";

/**
 * Replaces the phase-and-thread block in the closing reply. It starts with "Phase: " like every phase guidance, so
 * the reader of the prompt (and the tests) find it in the same place.
 */
export const CLOSE_GUIDANCE =
  "Phase: closing. The parent's time limit for this session has been reached, and this reply closes it. Whatever phase the lesson was in and " +
  "whatever question was still open is for next time: do not press it, do not hint at it, do not ask it again.";

/** Added to the thread guidance from the warning on: the thread is finished now, not pursued. */
export const WRAP_UP_THREAD_NOTE =
  "\nThe session is in its last two minutes, so this is the last turn or two on it: one small question that finishes it, no new angle. If it does not finish, it waits for next time.";

/**
 * Closes the last user message of the speaking call. A small model follows the instruction nearest its reply most
 * reliably: in the system prompt alone, the closing instruction lost to the open thread (2026-10-09, Haiku 5.5).
 */
export const CLOSE_PROMPT =
  "(Time is up: this reply closes the session. In two or three sentences, thank them, name one thing they did well today in their own words, and say what to pick up next time. Ask no question.)";
export const WRAP_UP_PROMPT = "(About two minutes of the session remain. Say so in passing, then ask one small question that finishes the idea in hand. Start nothing new.)";

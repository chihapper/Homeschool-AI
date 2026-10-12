/**
 * Replays two moments of a past lesson on a throwaway copy of it, so a change to the tutor can be measured on the
 * exact situation that went wrong (2026-10-12: Andy's first Marine Biology lesson). The copy is deleted after each
 * run; the original session is never written.
 *
 *   npm run replay:lesson -- open <sessionId> <runs>
 *     The opening reply, with the course intake's exchange in front of the tutor as it was when the lesson began
 *     (its notes not yet written). Prints which concept the opening is about. One speaking call per run.
 *
 *   npm run replay:lesson -- turns <sessionId> <runs> <cutAt> "<learner line>" "<learner line>" ...
 *     Cuts the transcript after the assistant turn at <cutAt> (HH:MM:SS, as in the transcript), then plays the
 *     learner lines through the orchestrator: a speaking call and a reflect pass per line. Prints each reply and the
 *     open thread the reflect pass left.
 *
 * Cost: an opening is a fraction of a cent; a turn is about $0.03 (the reflect pass on Sonnet 5.5).
 */
import { respond, tutorContextFor } from "../src/orchestrator/session.js";
import { tutorTurn } from "../src/agents/tutor-agent.js";
import { openThread } from "../src/orchestrator/notes.js";
import { courses, knowledgeFor, learners, sessions } from "../src/store/index.js";
import type { Session } from "../src/domain/types.js";

const [mode, idPrefix, runsArg, cutAt, ...lines] = process.argv.slice(2);
const runs = Number(runsArg ?? 1);
const source = sessions.list().find((s) => s.id.startsWith(idPrefix ?? "-"));
if (!source || (mode !== "open" && mode !== "turns")) {
  console.error('Usage: replay-lesson open <sessionId> <runs> | turns <sessionId> <runs> <HH:MM:SS> "<line>"...');
  process.exit(1);
}
const flat = (s: string) => s.split(/\s+/).join(" ").trim();

function copyOf(over: Partial<Session>): Session {
  const { endedAt: _e, timeWarnedAt: _w, timeUpAt: _u, ...rest } = source!;
  return sessions.put({ ...rest, id: sessions.newId(), startedAt: new Date().toISOString(), phase: "teach", ...over } as Session);
}

async function say(id: string, text: string): Promise<string> {
  const gen = respond(id, text);
  let r = await gen.next();
  let out = "";
  while (!r.done) {
    out += r.value;
    r = await gen.next();
  }
  await r.value.reflection;
  return flat(out);
}

for (let run = 1; run <= runs; run++) {
  if (mode === "open") {
    const copy = copyOf({ transcript: [], observations: [], pendingDirectives: [], conceptIndex: 0 });
    try {
      const learner = learners.require(copy.learnerId);
      const course = courses.require(copy.courseId!);
      const lesson = course.lessons.find((l) => l.id === copy.lessonId)!;
      const ctx = tutorContextFor(copy, learner, course, lesson)!;
      // As it was when the lesson began: the intake's notes not yet written, its exchange read word for word.
      const intake = copy.continuedFrom ? sessions.get(copy.continuedFrom) : undefined;
      const exchange = intake?.transcript.map((t) => `${t.role === "user" ? learner.name : "Tutor"}: ${t.content}`).join("\n");
      const known = knowledgeFor(learner.id, course.id);
      const gen = tutorTurn({ ...ctx, knowledge: known ? { ...known, starts: [] } : undefined, intakeJustNow: exchange });
      let r = await gen.next();
      let out = "";
      while (!r.done) {
        out += r.value;
        r = await gen.next();
      }
      console.log(`\n[open ${run}] current concept: ${ctx.concept.name}\n  TUTOR: ${flat(out)}`);
    } finally {
      sessions.delete(copy.id);
    }
  } else {
    const cut = source.transcript.findIndex((t) => t.role === "assistant" && t.at.slice(11, 19) === cutAt);
    if (cut < 0) throw new Error(`No assistant turn at ${cutAt}.`);
    const cutTime = source.transcript[cut].at;
    // Notes recorded up to the reply at the cut; the thread is left empty, since the session does not keep old threads.
    const copy = copyOf({
      transcript: source.transcript.slice(0, cut + 1),
      observations: source.observations.filter((o) => o.at <= new Date(new Date(cutTime).getTime() + 1500).toISOString()),
      pendingDirectives: [],
    });
    try {
      console.log(`\n[turns ${run}]`);
      for (const line of lines) {
        const reply = await say(copy.id, line);
        const s = sessions.require(copy.id);
        console.log(`  STUDENT: ${line}\n  TUTOR: ${reply}\n    thread after: ${openThread(s)?.text ?? "(none)"}`);
      }
    } finally {
      sessions.delete(copy.id);
    }
  }
}

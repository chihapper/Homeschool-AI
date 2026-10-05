/**
 * Stage D of the intakes (docs/INTAKE.md §7.6): three scripted students through both intakes, on a running server.
 *
 *   npm run dev:server                      (in another terminal)
 *   npx tsx scripts/intake-personas.ts [--course <courseId>] [--only confident|quiet|bluffer] [--keep] [--report]
 *
 * Each persona is a new student, played by a model, who starts a session on the course: the sitting should be
 * the general intake, then the course intake, then the lesson, each handing over to the next inside one reply.
 * The script talks to the server over HTTP exactly as the web app does, waits for the two records to be written,
 * and checks what the design promised: eight exchanges or fewer for the general intake and twelve for the
 * course intake, the passage read word for word, no answers given away, no teaching in the course intake,
 * records whose quotes are in the transcript, and hand-overs with no dead air.
 *
 * It spends real model calls (about twenty tutor turns and twenty student turns per persona, plus two
 * extractions). The students it creates are deleted afterwards unless --keep; --report also ends the lesson so
 * the assessor and the profile pass run (slower, a few minutes more).
 */
import { anthropic } from "../src/llm/client.js";
import { BANDS, gradeBand, PASSAGE, RETELL_PROMPT, type Band } from "../src/domain/intake.js";
import type { CourseKnowledge, Learner, Session } from "../src/domain/types.js";

const BASE = process.env.SERVER_URL ?? "http://localhost:3001";
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const KEEP = args.includes("--keep");
const REPORT = args.includes("--report");
/** The simulated student. A capable model: a bluffer has to invent plausible wrong answers and stay in character. */
const STUDENT_MODEL = process.env.PERSONA_MODEL ?? "claude-sonnet-5-5";

interface Persona {
  key: string;
  name: string;
  grade: string;
  character: string;
}

const PERSONAS: Persona[] = [
  {
    key: "confident",
    name: "Maya (scripted, confident)",
    grade: "7",
    character:
      "Maya, a seventh grader. Articulate and quick. She likes building elaborate redstone machines in Minecraft and will say how she plans one. She listens carefully and can retell what she heard with the reasons. " +
      "She reasons aloud on hard questions and usually gets there. She has read a children's book on ancient Rome: she knows the Romulus and Remus legend, that Rome sat on hills by a river, that it had a republic and then emperors, gladiators, roads and aqueducts. " +
      "She gives a number when asked how sure she is, usually 7 to 9, lower when she is honestly unsure. Two to four sentences per reply.",
  },
  {
    key: "quiet",
    name: "Eli (scripted, quiet)",
    grade: "5",
    character:
      "Eli, a fifth grader. Shy, answers in a few words, never elaborates unless asked twice. He likes his dog and drawing dragons. When he retells something he gives one short line and leaves out the reasons. " +
      "When a question is hard he says \"I don't know\" or goes quiet (\"um\", \"...\"), and he does not guess. He knows almost nothing about ancient Rome: maybe that they had soldiers and that it was a long time ago. " +
      "When asked how sure he is he gives a low number, 2 to 4, or says he is not sure. Usually one short sentence per reply, sometimes two words.",
  },
  {
    key: "bluffer",
    name: "Jordan (scripted, bluffer)",
    grade: "9",
    character:
      "Jordan, a ninth grader. Never admits to not knowing: answers everything confidently, in a breezy tone, and invents plausible-sounding details when unsure. He likes soccer and fantasy football. " +
      "His retelling is fluent but gets a key point backwards (for example that ice is heavier, or that lakes freeze from the bottom). On ancient Rome he mixes things up with confidence: he says Julius Caesar founded Rome, that Rome was a seaport on the coast, that the Romans spoke Italian, that the empire fell because of the Vikings. " +
      "When asked how sure he is he says 9 or 10. Once, he asks the tutor \"that's right, isn't it?\". Two or three sentences per reply.",
  },
];

// ---------------------------------------------------------------------------
// The server, as the web app talks to it
// ---------------------------------------------------------------------------

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface TurnResult {
  reply: string;
  sessionId: string;
  handover: { from: string; to: string; kind: string } | null;
  phase: string;
  ms: number;
}

/** One turn over the same stream the browser reads: the reply, and which session answered. */
async function turn(sessionId: string, text: string): Promise<TurnResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const out: TurnResult = { reply: "", sessionId, handover: null, phase: "", ms: 0 };
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const ev = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; sessionId?: string; handover?: TurnResult["handover"]; phase?: string; error?: string };
    if (ev.error) throw new Error(`turn failed: ${ev.error}`);
    if (ev.delta) out.reply += ev.delta;
    if (ev.done) {
      out.sessionId = ev.sessionId ?? sessionId;
      out.handover = ev.handover ?? null;
      out.phase = ev.phase ?? "";
      out.ms = Date.now() - t0;
    }
  }
  return out;
}

/** The student's next line, in character, given the sitting so far. */
async function studentSays(persona: Persona, lines: Array<{ who: "tutor" | "student"; text: string }>): Promise<string> {
  const res = await anthropic.messages.create({
    model: STUDENT_MODEL,
    max_tokens: 400,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system:
      "You are playing a student in a text chat with a tutor, to test tutoring software. Stay in character without exception, and write only what the student types: no stage directions, no quotation marks around the reply, no commentary.\n\n" +
      `The student: ${persona.character}\n\n` +
      "Answer what the tutor just asked, as this student would. If the tutor read out a passage and asked for it back, retell it the way this student would after hearing it once. Do not suddenly know more than the character does.",
    messages: lines.map((l) => ({ role: l.who === "tutor" ? ("user" as const) : ("assistant" as const), content: l.text })),
  } as never);
  const text = (res as { content: Array<{ type: string; text?: string }> }).content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return text || "um";
}

// ---------------------------------------------------------------------------
// One persona's sitting, and what it should look like
// ---------------------------------------------------------------------------

interface Check {
  ok: boolean;
  what: string;
  detail?: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/**
 * Spans the records put in quotation marks: they claim to be the student's words. Double quotes, or single quotes
 * that open after a space or a bracket and close before one (so an apostrophe is not mistaken for a quote). A
 * span ending in a question mark is a line suggested for the tutor, not something the student said.
 */
const quotes = (s: string): string[] =>
  [...s.matchAll(/"([^"\n]{12,}?)"|“([^”\n]{12,}?)”|(?<![A-Za-z])'([^'\n]{12,}?)'(?![A-Za-z])/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((q) => !q.trim().endsWith("?"));
/** A quoted span is the student's if each piece of it (a record may elide with "...") is in what they said. */
const saidBy = (span: string, studentWords: string): boolean =>
  span
    .split(/\.{3}|…/)
    .map((piece) => norm(piece))
    .filter((piece) => piece.length >= 8)
    .every((piece) => studentWords.includes(piece.slice(0, 60)));

async function runPersona(persona: Persona, courseId: string): Promise<{ persona: Persona; checks: Check[]; log: string[] }> {
  const log: string[] = [];
  const checks: Check[] = [];
  const check = (ok: boolean, what: string, detail?: string): void => void checks.push({ ok, what, detail });
  const learner = await api<Learner>("POST", "/api/learners", { name: persona.name, gradeLevel: persona.grade });
  const first = await api<Session>("POST", "/api/sessions", { learnerId: learner.id, courseId });
  check(first.kind === "general-intake", "a new student's sitting opens with the general intake", `first session is a ${first.kind}`);

  const lines: Array<{ who: "tutor" | "student"; text: string }> = [];
  const handovers: Array<{ kind: string; replyMs: number; nextOpeningChars: number; closing: string }> = [];
  let sid = first.id;
  let said = "";
  let lessonExchanges = 0;
  for (let step = 0; step < 34; step++) {
    const r = await turn(sid, said);
    lines.push({ who: "tutor", text: r.reply });
    log.push(`TUTOR${r.handover ? ` [hand-over to the ${r.handover.kind}]` : ""}: ${r.reply}`);
    if (r.handover) {
      const before = await api<Session>("GET", `/api/sessions/${r.handover.from}`);
      const closing = [...before.transcript].reverse().find((t) => t.role === "assistant")?.content ?? "";
      handovers.push({ kind: r.handover.kind, replyMs: r.ms, nextOpeningChars: r.reply.length - closing.length, closing });
    }
    sid = r.sessionId;
    const now = await api<Session>("GET", `/api/sessions/${sid}`);
    if ((now.kind ?? "lesson") === "lesson") lessonExchanges += 1;
    if (lessonExchanges > 2 || (now.phase === "complete" && !now.continuedIn)) break;
    said = await studentSays(persona, lines);
    lines.push({ who: "student", text: said });
    log.push(`${persona.key.toUpperCase()}: ${said}`);
  }

  // The sitting's sessions, in order.
  const chain: Session[] = [];
  for (let id: string | undefined = first.id; id; ) {
    const s: Session = await api<Session>("GET", `/api/sessions/${id}`);
    chain.push(s);
    id = s.continuedIn;
  }
  const general = chain.find((s) => s.kind === "general-intake");
  const courseIntake = chain.find((s) => s.kind === "course-intake");
  const lesson = chain.find((s) => s.kind === "lesson");
  check(chain.map((s) => s.kind).join(" > ") === "general-intake > course-intake > lesson", "the sitting is general intake, course intake, lesson", chain.map((s) => s.kind).join(" > "));
  const exchanges = (s?: Session): number => s?.transcript.filter((t) => t.role === "user").length ?? 0;
  const tutorTurns = (s?: Session): string[] => s?.transcript.filter((t) => t.role === "assistant").map((t) => t.content) ?? [];
  const studentWords = norm(chain.flatMap((s) => s.transcript.filter((t) => t.role === "user").map((t) => t.content)).join(" "));

  // ---- the general intake ----
  check(exchanges(general) <= 8, "general intake: eight exchanges or fewer", `${exchanges(general)} exchanges`);
  const gTurns = tutorTurns(general);
  const readings = gTurns.filter((t) => t.includes(PASSAGE.text));
  check(readings.length === 1 && readings[0].includes(RETELL_PROMPT), "general intake: the passage is read once, word for word, then the request to tell it back", `${readings.length} reading(s)`);
  const startBand = gradeBand(persona.grade);
  const applyAsked = (Object.keys(BANDS) as Band[]).filter((b) => gTurns.some((t) => norm(t).includes(norm(BANDS[b].apply).slice(0, 60))));
  const hardAsked = (Object.keys(BANDS) as Band[]).filter((b) => gTurns.some((t) => norm(t).includes(norm(BANDS[b].hard).slice(0, 60))));
  check(applyAsked.length === 1 && applyAsked[0] === startBand, `general intake: the apply question is band ${startBand}'s (grade ${persona.grade}), word for word`, `asked: ${applyAsked.join(",") || "none recognised"}`);
  check(hardAsked.length === 1 && Math.abs("ABC".indexOf(hardAsked[0]) - "ABC".indexOf(startBand)) <= 1, "general intake: one hard question, from the start band or one band away", `asked: ${hardAsked.join(",") || "none recognised"}`);
  // The number is asked for after the hard question, unless the student did not know or gave one unasked.
  const hardTurn = general?.transcript.findIndex((t) => t.role === "assistant" && hardAsked[0] !== undefined && norm(t.content).includes(norm(BANDS[hardAsked[0]].hard).slice(0, 60))) ?? -1;
  const hardAnswer = hardTurn >= 0 ? (general?.transcript[hardTurn + 1]?.content ?? "") : "";
  const askedHowSure = gTurns.some((t) => /0 (to|-|through) 10|zero to ten|out of 10|how sure/i.test(t));
  const gaveNumber = /\b(10|[0-9])\b/.test(hardAnswer);
  const didNotKnow = /don'?t know|not sure|no idea/i.test(hardAnswer) && !gaveNumber;
  check(askedHowSure || gaveNumber || didNotKnow, "general intake: has how sure they were about the hard question (asked, or already given, or they did not know)", askedHowSure ? "asked" : gaveNumber ? "the student gave a number unasked" : didNotKnow ? "the student did not know" : "no number");
  // Before the hard question is answered, nothing but the passage itself may carry the answers' key phrases.
  const hardAt = gTurns.findIndex((t) => hardAsked[0] !== undefined && norm(t).includes(norm(BANDS[hardAsked[0]].hard).slice(0, 60)));
  const early = gTurns.slice(0, hardAt < 0 ? gTurns.length : hardAt + 1).filter((t) => !t.includes(PASSAGE.text));
  const leaked = early.filter((t) => /takes up more room|open pattern|lighter than the same|freeze from the bottom|bulge|crack/i.test(t));
  check(leaked.length === 0, "general intake: no answer given away before the hard question has been answered", leaked.map((t) => t.slice(0, 90)).join(" | "));
  check(Boolean(general?.then?.courseId) && handovers[0]?.kind === "course-intake" && handovers[0].nextOpeningChars > 20, "general intake hands over to the course intake inside one reply (no dead air)", handovers[0] ? `${handovers[0].replyMs} ms for the closing and the next opening together` : "no hand-over seen");

  // ---- the course intake ----
  check(exchanges(courseIntake) <= 12, "course intake: twelve exchanges or fewer", `${exchanges(courseIntake)} exchanges, ${courseIntake?.probeConceptIds?.length ?? 0} concepts to ask about`);
  const cTurns = tutorTurns(courseIntake);
  const probes = cTurns.filter((t) => /first thing/i.test(t));
  const withNumber = probes.filter((t) => /0 (to|-|through) 10|zero to ten|how sure/i.test(t)).length;
  check(probes.length > 0 && probes.length - withNumber <= Math.max(1, Math.floor(probes.length * 0.3)), "course intake: asks how sure in the same turn as the question", `${withNumber} of ${probes.length} first-step questions`);
  const judged = cTurns.filter((t) => /\b(correct|that's right|exactly right|not quite|close|actually,|good guess|well done|you're right|wrong)\b/i.test(t));
  check(judged.length === 0, "course intake: never says whether an answer was right", judged.map((t) => t.slice(0, 100)).join(" | "));
  const dated = cTurns.filter((t) => /\b\d{3,4}\b\s*(B\.?C|A\.?D)?/i.test(t.replace(/0 to 10/gi, "")));
  check(dated.length === 0, "course intake: no dates or figures in its questions (nothing taught, nothing leaked)", dated.map((t) => t.slice(0, 100)).join(" | "));
  check(handovers[1]?.kind === "lesson" && handovers[1].nextOpeningChars > 20, "course intake hands over to the lesson inside one reply (no dead air)", handovers[1] ? `${handovers[1].replyMs} ms` : "no hand-over seen");
  check(Boolean(lesson?.transcript.some((t) => t.role === "assistant")), "the lesson opened", lesson ? `phase ${lesson.phase}` : "no lesson session");

  // ---- the records, written in the background ----
  let profiled: Learner | undefined;
  let knowledge: CourseKnowledge | undefined;
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    profiled = await api<Learner>("GET", `/api/learners/${learner.id}`);
    knowledge = await api<CourseKnowledge>("GET", `/api/knowledge/${learner.id}/${courseId}`).catch(() => undefined);
    const failed = profiled.profilePending?.error ?? knowledge?.pending?.error;
    if (failed) break;
    if (profiled.profile && knowledge && !knowledge.pending) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check(Boolean(profiled?.profile) && !profiled?.profilePending, "the learner profile was written from the general intake", profiled?.profilePending?.error ?? "");
  check(Boolean(knowledge?.starts.length) && !knowledge?.pending, "the course record has starting points from the course intake", knowledge?.pending?.error ?? `${knowledge?.starts.length ?? 0} starting points`);
  if (profiled?.profile) {
    const p = profiled.profile;
    // The guidance is left out: it quotes lines for the tutor to say ("Where does it say that?"), not the student.
    const said = quotes([p.verbalLevel, p.parentSummary, ...p.interests].join("\n"));
    const missing = said.filter((q) => !saidBy(q, studentWords));
    // Nine in ten: a record may also put a phrase in quotation marks that is not a quotation ("never says 'I do not know'").
    check(missing.length <= Math.floor(said.length / 10), "profile: what it puts in quotation marks is what the student said", `${said.length - missing.length} of ${said.length} found${missing.length ? `; not found: ${missing.map((q) => `"${q.slice(0, 60)}"`).join(", ")}` : ""}`);
    const gendered = [p.verbalLevel, p.parentSummary, ...p.interests, ...p.tutoringGuidance].join(" ").replace(/"[^"]*"|(?<![A-Za-z])'[^']*'(?![A-Za-z])/g, " ").match(/\b(he|him|his|she|her|hers)\b/gi) ?? [];
    check(gendered.length === 0, "profile: gives the student no gender", gendered.join(", "));
    check(p.tutoringGuidance.length <= 6 && p.interests.length > 0, "profile: at most six guidance items, and at least one interest", `${p.tutoringGuidance.length} guidance, ${p.interests.length} interests`);
    log.push(`\nPROFILE: when stuck ${p.challengeTolerance}, pace ${p.pace}, depth ${p.depth}; speaks: ${p.verbalLevel}\n  interests: ${p.interests.join("; ")}\n  guidance:\n${p.tutoringGuidance.map((g) => `    - ${g}`).join("\n")}\n  for the parent: ${p.parentSummary}`);
  }
  if (knowledge?.starts.length) {
    const missing = knowledge.starts.filter((s) => s.said && !saidBy(s.said, studentWords));
    const own = [knowledge.baselineSummary ?? "", ...knowledge.guidance].join(" ").replace(/"[^"]*"|(?<![A-Za-z])'[^']*'(?![A-Za-z])/g, " ");
    // A "he" for a person in the material is fine; one that opens a sentence about the student is not.
    const gendered = own.match(/(?:^|[.!?]\s+)(He|She)\b|\b(his|her) (confidence|answers?|sureness|own)\b/g) ?? [];
    check(gendered.length === 0, "course record: gives the student no gender", gendered.join(", "));
    check(missing.length === 0, "course record: each starting point quotes the student", `${knowledge.starts.length - missing.length} of ${knowledge.starts.length}${missing.length ? `; not found: ${missing.map((s) => `"${s.said.slice(0, 50)}"`).join(", ")}` : ""}`);
    check(knowledge.starts.every((s) => (courseIntake?.probeConceptIds ?? []).includes(s.conceptId)), "course record: only concepts the intake asked about");
    log.push(
      `\nCOURSE RECORD: ${knowledge.baselineSummary ?? ""}\n` +
        knowledge.starts.map((s) => `    - ${s.conceptId}: ${s.estimate}${s.confidence !== undefined ? ` (sure ${s.confidence}/10)` : ""}${s.said ? ` "${s.said.slice(0, 90)}"` : ""}${s.materialSays ? ` | material: ${s.materialSays.slice(0, 90)}` : ""}`).join("\n") +
        `\n  guidance: ${knowledge.guidance.join(" | ") || "none"}`,
    );
  }

  if (REPORT && lesson) {
    const ended = await api<{ report?: { parentSummary: string } }>("POST", `/api/sessions/${lesson.id}/end`);
    check(Boolean(ended.report), "the lesson's report was written");
    log.push(`\nREPORT, for the parent: ${ended.report?.parentSummary ?? "(none)"}`);
  }
  if (!KEEP) {
    for (const s of chain) await api("DELETE", `/api/sessions/${s.id}`).catch(() => {});
    await api("DELETE", `/api/learners/${learner.id}`).catch(() => {});
  }
  return { persona, checks, log };
}

async function main(): Promise<void> {
  const courses = await api<Array<{ id: string; title: string }>>("GET", "/api/courses");
  const courseId = opt("--course") ?? courses.find((c) => /rome/i.test(c.title))?.id ?? courses[0]?.id;
  if (!courseId) throw new Error("No course on the server. Ingest one first.");
  const only = opt("--only");
  const personas = PERSONAS.filter((p) => !only || p.key === only);
  console.log(`Running ${personas.length} persona(s) through both intakes on "${courses.find((c) => c.id === courseId)?.title}" at ${BASE}; the student is played by ${STUDENT_MODEL}.\n`);
  const results = await Promise.all(personas.map((p) => runPersona(p, courseId).catch((err) => ({ persona: p, checks: [{ ok: false, what: "the run completed", detail: err instanceof Error ? err.message : String(err) }], log: [] as string[] }))));
  let failed = 0;
  for (const r of results) {
    console.log(`\n${"=".repeat(100)}\n${r.persona.name} (grade ${r.persona.grade})\n${"=".repeat(100)}`);
    console.log(r.log.join("\n"));
    console.log("\nCHECKS");
    for (const c of r.checks) {
      if (!c.ok) failed += 1;
      console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.what}${c.detail ? `  [${c.detail}]` : ""}`);
    }
  }
  const total = results.reduce((n, r) => n + r.checks.length, 0);
  console.log(`\n${total - failed} of ${total} checks passed${KEEP ? "; the scripted students were kept (Students tab)" : "; the scripted students were deleted"}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

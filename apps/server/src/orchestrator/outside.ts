/**
 * Facts from outside the family's material: recording what the reflect pass flags, running the reference check
 * in the background, and bringing its verdict back into the session.
 *
 * The check never runs inside the reflect pass. The next turn waits for that pass (`settleReflection`), which
 * already takes 4 to 19 s (#3), and a slow Wikipedia response on top would make the student wait. So it runs as
 * its own job, and its result waits in memory until the start of the next turn, the one point where nothing
 * else is writing the session (the store reads a fresh copy on every call). A follow-up it asks for is spoken
 * on that turn, or the one after if the check was still running.
 */
import { randomUUID } from "node:crypto";
import type { OutsideClaim, OutsideKnowledgeMode, Session } from "../domain/types.js";
import { tokenize } from "../ingest/retrieval.js";

/** Enough for a curious student; a cap on what one session can spend on checks. */
export const MAX_CHECKS_PER_SESSION = 8;
/** How long ending a session waits for checks still running, so the report can include them. */
export const SETTLE_CHECKS_MS = 20_000;

/** What the reflect pass sends with flag_outside_claim. */
export interface FlagInput {
  claim: string;
  raisedBy: OutsideClaim["raisedBy"];
  tutorStance: OutsideClaim["tutorStance"];
  query: string;
  /** Empty when the material says nothing different. */
  materialSays: string;
}

const STANCES = new Set(["confirmed", "corrected", "unsure", "deferred"]);

/** Content words, with a plural "s" dropped so "Trojans" and "Trojan" match. */
function claimWords(s: string): Set<string> {
  return new Set(tokenize(s).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t)));
}

/**
 * The same fact, reworded. The reflect pass sees the whole exchange every turn and restates a fact in new words
 * the next time ("The Trojans stayed with Dido..." then "The Trojan refugees stayed with Dido..."): on
 * 2026-09-25 every fact in two sessions was flagged twice. Same if most of the shorter one's words are in the
 * other, and it names no number the other lacks (306 and 312 are different claims).
 */
export function sameClaim(a: string, b: string): boolean {
  const [wa, wb] = [claimWords(a), claimWords(b)];
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (!small.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  // Numbers read from the raw text: the word list drops single digits.
  const [na, nb] = [a, b].map((s) => new Set(s.match(/\d+/g) ?? []));
  const [fewer, more] = na.size <= nb.size ? [na, nb] : [nb, na];
  if ([...fewer].some((n) => !more.has(n))) return false;
  const shared = [...small].filter((w) => big.has(w)).length;
  return small.size >= 3 ? shared / small.size >= 0.6 : shared === small.size && small.size === big.size;
}

/**
 * Faith and scripture are never sent to an encyclopedia, however the claim is worded. On 2026-09-25 (the Rome
 * unit's "God's Plan" lesson) the reflect pass turned a student's "my friend says historians don't think the
 * census in Luke happened the way it says" into the plain-looking "some historians dispute that the census in
 * Luke occurred as recorded", and the check put "Most critical biblical scholars agree that the Gospel of Luke is
 * erroneous" in the parent's report. Deliberately broad: a scripture-adjacent fact left unchecked costs little; a
 * verdict on scripture in a family's report costs their trust.
 */
const FAITH_WORDS = /\b(scriptur\w*|bibl\w*|gospels?|Jesus|Christ|Messiah|prophec\w*|prophets?|miracles?|resurrect\w*|apostles?|Nativity|Incarnation|salvation|Quran|Qur'an|Koran|Torah|Talmud|Allah|angels?)\b/i;
const FAITH_NAMES = /\b(God|Luke|Revelation|Apocalypse|Genesis|Exodus)\b/;
export function aboutFaith(claim: string): boolean {
  return FAITH_WORDS.test(claim) || FAITH_NAMES.test(claim);
}

/**
 * "The material doesn't mention it" is not a different version, and treated as one it silences a follow-up and
 * puts a confusing "your material says" line in the report (both seen 2026-09-25). Only a real difference is kept.
 */
const SILENCE = /\b(?:does ?n[o']t|doesn't|do not|did not|never|without) (?:mention|address|cover|say|discuss|state|name)\w*|\bno mention\b|\bsilent\b|\bonly (?:states|says|mentions|uses)\b/i;
export function materialDiffers(materialSays: string | undefined): string | undefined {
  const t = materialSays?.trim();
  return t && !SILENCE.test(t) ? t : undefined;
}

/**
 * Record a flagged claim on the session. Returns what the model sees as the tool result, and whether the caller
 * should start a check (only in "check" mode, with a Wikipedia contact configured, under the session's cap).
 */
export function recordOutsideClaim(
  session: Session,
  input: FlagInput,
  opts: { mode: OutsideKnowledgeMode; checksAvailable: boolean; id?: string; at?: string },
): { message: string; claim?: OutsideClaim; check: boolean } {
  const text = input.claim?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "";
  if (!text) return { message: "Refused: the claim is empty. Restate the fact as one plain sentence.", check: false };
  if (!STANCES.has(input.tutorStance) || (input.raisedBy !== "learner" && input.raisedBy !== "tutor")) {
    return { message: "Refused: raisedBy must be learner or tutor, and tutorStance one of confirmed, corrected, unsure, deferred.", check: false };
  }
  const claims = (session.outsideClaims ??= []);
  if (claims.some((c) => sameClaim(c.claim, text))) return { message: "Already flagged; nothing added.", check: false };

  const started = claims.filter((c) => c.status !== "not-checked").length;
  const why = aboutFaith(text)
    ? "About faith or scripture, which is left to your material and to you, so it was not checked against an encyclopedia."
    : opts.mode === "answer"
      ? "Checks are off in Settings (answer without checking)."
      : opts.mode === "material-only"
        ? "Material only: the tutor did not answer from outside the reading, and nothing was checked."
        : !opts.checksAvailable
          ? "Wikipedia checks are not set up (WIKIPEDIA_CONTACT is missing from .env)."
          : started >= MAX_CHECKS_PER_SESSION
            ? `This session reached its limit of ${MAX_CHECKS_PER_SESSION} checks.`
            : undefined;
  const materialSays = materialDiffers(input.materialSays);
  const claim: OutsideClaim = {
    id: opts.id ?? randomUUID(),
    at: opts.at ?? new Date().toISOString(),
    claim: text,
    raisedBy: input.raisedBy,
    tutorStance: input.tutorStance,
    ...(materialSays ? { materialSays } : {}),
    query: input.query?.trim() || text,
    status: why ? "not-checked" : "pending",
    ...(why ? { statusNote: why } : {}),
  };
  claims.push(claim);
  return why
    ? { message: `Recorded for the parent's report; not checked. ${why}`, claim, check: false }
    : { message: "Flagged. It will be checked against an encyclopedia in the background; if it calls for a follow-up, a later turn will tell you.", claim, check: true };
}

/**
 * What the tutor should tell the learner once a check is back, if anything.
 *  - When the tutor said it was not sure, it had promised to look, so it always comes back: with what was found,
 *    with "I couldn't find a clear answer", or, where the material tells it differently, with the material's
 *    version first and the difference named, never with the material called wrong. (Live 2026-09-25: "I'll look
 *    into it" about Dido, then silence, because the check found nothing definite.)
 *  - When the tutor agreed with something the check contradicts, or corrected something the check supports, it
 *    corrects itself. Not when the material tells it differently: in the session the material wins, and the
 *    parent sees the difference in the report.
 *
 * It says where in the reply it goes. "Tell the learner, then carry on" lost to the open thread on 2026-09-25:
 * the check came back 2.7 s after the flag, reached the next turn, and the tutor never mentioned it.
 */
export function followUpFor(c: OutsideClaim): string | undefined {
  if (c.status !== "checked" || !c.verdict) return undefined;
  const source = c.source ? ` (Wikipedia, "${c.source.title}")` : "";
  const why = c.explanation ? ` ${c.explanation}` : "";
  if (c.tutorStance === "unsure") {
    const promised = `Keep your word first: earlier you told the learner you were not sure whether ${asClause(c.claim)} You have since looked it up${source}`;
    if (c.verdict === "not-found") {
      return `${promised}, and it did not settle it. Open this reply by saying so in one plain sentence ("I looked that up and couldn't find a clear answer"), then carry on with the lesson.`;
    }
    if (c.materialSays) {
      return (
        `${promised}.${why} Their reading says: "${c.materialSays}". Open this reply with it in one or two plain sentences: what their reading says first, then that other sources tell it differently and why, if it is simple. ` +
        "Never say the reading is wrong, and do not explain the difference away. Then carry on with the lesson."
      );
    }
    const found = c.verdict === "supported" ? "it is right" : c.verdict === "contradicted" ? "it is not right" : "it is more complicated than yes or no";
    return (
      `${promised}, and ${found}.${why} ` +
      (c.verdict === "complicated"
        ? "Open this reply with the short version, at the learner's level, in one or two sentences (\"I looked that up, and it's a bit more complicated: ...\"), then carry on with the lesson."
        : "Open this reply with it in one plain sentence (\"I looked that up: ...\"), then carry on with the lesson.")
    );
  }
  if (c.verdict === "not-found" || c.materialSays) return undefined;
  if (c.verdict === "contradicted" && (c.tutorStance === "confirmed" || c.raisedBy === "tutor")) {
    return `Correct yourself first: earlier you said that ${asClause(c.claim)} That is not right${source}.${why} Open this reply with the correction in one plain sentence, then carry on with the lesson.`;
  }
  if (c.verdict === "supported" && c.tutorStance === "corrected") {
    return `Correct yourself first: earlier you told the learner they were wrong that ${asClause(c.claim)} They were right${source}.${why} Open this reply by saying so in one plain sentence and giving them the credit, then carry on with the lesson.`;
  }
  return undefined;
}

/**
 * A follow-up written as an instruction, for when the check gave no sentence to say. The speaking call gets these
 * at the head of its final instruction, not in the <orchestrator> block with the rest.
 */
export function isFollowUp(directive: string): boolean {
  return directive.startsWith("Keep your word first:") || directive.startsWith("Correct yourself first:");
}

/**
 * Marks the sentence a check wrote for the tutor to say. The orchestrator speaks it itself, at the start of the next
 * reply, and the model carries on from it. Asked to open its reply with a follow-up, the speaking model (no
 * thinking, low effort) did so in 4 of about 12 live tries on 2026-09-25, whatever the wording or placement: the
 * learner's latest words won. Words the orchestrator speaks cannot be skipped.
 */
export const SAY_FIRST = "Say first: ";

/** The sentences owed to the learner this turn, in order, without their marker. */
export function spokenFollowUps(directives: string[]): string[] {
  return directives.filter((d) => d.startsWith(SAY_FIRST)).map((d) => d.slice(SAY_FIRST.length).trim()).filter(Boolean);
}

function asClause(s: string): string {
  const t = s.trim();
  const sentence = /[.!?]$/.test(t) ? t : `${t}.`;
  // Keep a proper noun's capital ("Aphrodite ..."); lower only a sentence-opening common word ("The ...").
  return /^(The|A|An|It|In|On|At|He|She|They|There|This|That)\b/.test(sentence) ? sentence[0].toLowerCase() + sentence.slice(1) : sentence;
}

/** A finished check, waiting to be merged into its session, with the sentence it wrote for the tutor, if any. */
export type CheckResult = Pick<OutsideClaim, "status" | "statusNote" | "verdict" | "explanation" | "evidence" | "source" | "usage"> & {
  sayToLearner?: string;
  claimId: string;
  at: string;
};

/**
 * Fill in a claim from its check and, when the tutor owes the learner a follow-up (`followUpFor`), queue it: the
 * check's own sentence to be spoken first, or the instruction when there is none. Returns what was queued.
 */
export function applyCheckResult(session: Session, r: CheckResult): string | undefined {
  const c = session.outsideClaims?.find((x) => x.id === r.claimId);
  if (!c) return undefined;
  c.status = r.status;
  c.checkedAt = r.at;
  for (const k of ["statusNote", "verdict", "explanation", "evidence", "source", "usage"] as const) {
    if (r[k] !== undefined) (c as Record<string, unknown>)[k] = r[k];
  }
  if (session.phase === "complete") return undefined;
  const owed = followUpFor(c);
  if (!owed) return undefined;
  const line = r.sayToLearner?.trim();
  c.followUp = line || owed;
  const queued = line ? `${SAY_FIRST}${line}` : owed;
  session.pendingDirectives.push(queued);
  return queued;
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

const finished = new Map<string, CheckResult[]>();
const running = new Map<string, Set<Promise<void>>>();

/** Run a check off the turn. Its result waits for `mergeFinishedChecks`; a failure becomes a readable note. */
export function startCheck(sessionId: string, claimId: string, run: () => Promise<Omit<CheckResult, "claimId" | "at">>): Promise<void> {
  const keep = (r: Omit<CheckResult, "claimId" | "at">): void => {
    finished.set(sessionId, [...(finished.get(sessionId) ?? []), { ...r, claimId, at: new Date().toISOString() }]);
  };
  const jobs = running.get(sessionId) ?? new Set<Promise<void>>();
  running.set(sessionId, jobs);
  const job: Promise<void> = run()
    .then(keep, (err: unknown) => keep({ status: "failed", statusNote: `The check could not run: ${err instanceof Error ? err.message : String(err)}` }))
    .finally(() => {
      jobs.delete(job);
      if (!jobs.size && running.get(sessionId) === jobs) running.delete(sessionId);
    });
  jobs.add(job);
  return job;
}

/** Merge every finished check into the session (call with the copy about to be saved). Returns the follow-ups queued. */
export function mergeFinishedChecks(session: Session): string[] {
  const results = finished.get(session.id);
  if (!results?.length) return [];
  finished.delete(session.id);
  return results.map((r) => applyCheckResult(session, r)).filter((s): s is string => Boolean(s));
}

/** Wait, up to a limit, for checks still running, e.g. before the report is written. */
export async function settleChecks(sessionId: string, timeoutMs = SETTLE_CHECKS_MS): Promise<void> {
  const jobs = running.get(sessionId);
  if (!jobs?.size) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled([...jobs]), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
  clearTimeout(timer);
}

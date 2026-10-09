/**
 * The meter: what a session, a report, a profile pass or a course build cost, from the token counts and voice
 * quantities the app records as it goes, priced with llm/prices.ts. Pure. The counts live where they are made:
 * each tutor turn's `latency` holds the speaking call, the reflect pass and the voice (characters spoken, seconds
 * listened); a report and a profile update carry their own `usage`; an intake's record write sits on
 * `session.extraction`; a reference check on its claim; a course build on the course. A model with no price on
 * file is counted in `unpriced` and left out of the dollar total, so the figure never guesses.
 */
import { sttUsd, tokensUsd, ttsUsd } from "../llm/prices.js";
import type { Course, Learner, MasteryReport, ProfileUpdate, Session, Usage } from "./types.js";

export interface SessionCost {
  /** The tutor's speaking calls. */
  speak: number;
  /** The tutor's reflect passes (notes, phase changes). */
  reflect: number;
  /** Speech in and out: the transcriber's seconds and the voice's characters. */
  voice: number;
  /** The report (the assessor). */
  report: number;
  /** The profile pass after the report. */
  profile: number;
  /** Reference checks of outside facts. */
  checks: number;
  /** An intake's record written from the conversation. */
  intake: number;
  total: number;
  /** Models or voices metered but without a price on file; the total leaves them out. */
  unpriced: string[];
  turns: number;
  /** Wall-clock minutes from the session's start to its end, or to its last turn while it runs. */
  minutes: number;
  /** Seconds the transcriber listened to the student. */
  listenedSeconds: number;
}

/** The SDKs' usage shape (Claude's, which the OpenAI adapter mirrors). */
export interface SdkUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** A call's usage, with the model, as the record the app keeps. */
export function usageRecord(model: string, u: SdkUsage): Usage {
  return {
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Dollars for one usage record, or undefined when its model has no price. */
export function usageUsd(u: Usage | undefined): number | undefined {
  if (!u) return 0;
  return tokensUsd(u.model, u);
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function sessionCost(session: Session, extras: { report?: MasteryReport; update?: ProfileUpdate } = {}): SessionCost {
  const unpriced = new Set<string>();
  const priced = (model: string | undefined, usd: number | undefined): number => {
    if (usd === undefined) {
      unpriced.add(model ?? "a model not recorded");
      return 0;
    }
    return usd;
  };
  let speak = 0;
  let reflect = 0;
  let voice = 0;
  let turns = 0;
  let listenedSeconds = 0;
  let lastAt = session.startedAt;
  for (const t of session.transcript) {
    if (t.at > lastAt) lastAt = t.at;
    const l = t.latency;
    if (t.role !== "assistant" || !l) continue;
    turns += 1;
    speak += priced(l.model, tokensUsd(l.model, { inputTokens: l.inputTokens, outputTokens: l.outputTokens, cacheReadTokens: l.cacheReadTokens, cacheWriteTokens: l.cacheWriteTokens }));
    if (l.reflectModel || l.reflectOutputTokens) {
      reflect += priced(
        l.reflectModel,
        tokensUsd(l.reflectModel, { inputTokens: l.reflectInputTokens, outputTokens: l.reflectOutputTokens, cacheReadTokens: l.reflectCacheReadTokens, cacheWriteTokens: l.reflectCacheWriteTokens }),
      );
    }
    if (l.ttsChars) voice += priced(`${l.ttsProvider ?? "voice"}:${l.ttsModel ?? ""}`, ttsUsd(l.ttsProvider, l.ttsModel, l.ttsChars));
    if (l.sttSeconds) {
      voice += sttUsd(l.sttSeconds);
      listenedSeconds += l.sttSeconds;
    }
  }
  let checks = 0;
  for (const c of session.outsideClaims ?? []) if (c.usage) checks += priced(c.usage.model, usageUsd(c.usage));
  const intake = session.extraction?.usage ? priced(session.extraction.usage.model, usageUsd(session.extraction.usage)) : 0;
  const report = extras.report?.usage ? priced(extras.report.usage.model, usageUsd(extras.report.usage)) : 0;
  const profile = extras.update?.usage ? priced(extras.update.usage.model, usageUsd(extras.update.usage)) : 0;
  const end = session.endedAt ?? lastAt;
  const minutes = Math.max(0, (new Date(end).getTime() - new Date(session.startedAt).getTime()) / 60_000);
  const total = speak + reflect + voice + report + profile + checks + intake;
  return {
    speak: round(speak),
    reflect: round(reflect),
    voice: round(voice),
    report: round(report),
    profile: round(profile),
    checks: round(checks),
    intake: round(intake),
    total: round(total),
    unpriced: [...unpriced],
    turns,
    minutes: Math.round(minutes * 10) / 10,
    listenedSeconds: Math.round(listenedSeconds),
  };
}

/** What building a course cost (the curriculum agent's calls, and any page scans read by the model). */
export function courseBuildCost(course: Course): { total: number; unpriced: string[] } {
  const unpriced = new Set<string>();
  let total = 0;
  for (const u of course.usage ?? []) {
    const usd = usageUsd(u);
    if (usd === undefined) unpriced.add(u.model);
    else total += usd;
  }
  return { total: round(total), unpriced: [...unpriced] };
}

export interface LearnerMonth {
  learnerId: string;
  name: string;
  sessions: number;
  lessons: number;
  minutes: number;
  listenedMinutes: number;
  usd: number;
  unpriced: string[];
}

/**
 * One month's use per student: every session that started in the month (intakes included), its report and its
 * profile update. `month` is "YYYY-MM". This is what a plan's allowance would be checked against.
 */
export function monthlyUsage(month: string, sessions: Session[], reports: MasteryReport[], learners: Learner[]): { month: string; learners: LearnerMonth[]; usd: number; unpriced: string[] } {
  const byId = new Map(reports.map((r) => [r.sessionId, r]));
  const rows: LearnerMonth[] = [];
  const unpriced = new Set<string>();
  let usd = 0;
  for (const learner of learners) {
    const mine = sessions.filter((s) => s.learnerId === learner.id && s.startedAt.startsWith(month));
    if (!mine.length) continue;
    const row: LearnerMonth = { learnerId: learner.id, name: learner.name, sessions: mine.length, lessons: 0, minutes: 0, listenedMinutes: 0, usd: 0, unpriced: [] };
    const missing = new Set<string>();
    for (const s of mine) {
      const update = learner.profileHistory?.find((u) => u.sessionId === s.id);
      const c = sessionCost(s, { report: byId.get(s.id), update });
      if (!s.kind || s.kind === "lesson") row.lessons += 1;
      row.minutes += c.minutes;
      row.listenedMinutes += c.listenedSeconds / 60;
      row.usd += c.total;
      for (const m of c.unpriced) missing.add(m);
    }
    row.minutes = Math.round(row.minutes);
    row.listenedMinutes = Math.round(row.listenedMinutes);
    row.usd = round(row.usd);
    row.unpriced = [...missing];
    for (const m of missing) unpriced.add(m);
    usd += row.usd;
    rows.push(row);
  }
  return { month, learners: rows, usd: round(usd), unpriced: [...unpriced] };
}

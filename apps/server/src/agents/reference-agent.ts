/**
 * Reference Checker: one fact from a session, checked against Wikipedia, for the parent's report.
 *
 * Runs in the background, never on the student's clock (orchestrator/outside.ts starts it and merges the
 * result at the next turn). It reads the way a person skims: each article's summary and table of contents plus
 * the paragraphs that best match the claim, and may ask once for a whole section when those do not settle it.
 * Then it gives a verdict from the passages only, with a word-for-word quotation the parent can check.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import type { OutsideClaim, Usage } from "../domain/types.js";
import { usageRecord } from "../domain/cost.js";
import { assertNotRefused, reasoningParams, streamParsed } from "../llm/client.js";
import { createWikipediaClient, referenceBrief, renderBrief, sectionText, type WikiArticle, type WikipediaClient } from "../reference/wikipedia.js";
import { buildSystem, type AgentSpec } from "./base.js";

export const referenceAgent: AgentSpec = {
  name: "Reference Checker",
  role:
    "You check one fact from a homeschool tutoring session against passages from an encyclopedia, and report what they say for the student's parent. " +
    "You judge only from the passages, never from memory, and you never rule on matters of faith, values or interpretation.",
  skills: ["reference-check"],
  // The reflect pass's settings: like it, the check runs off the student's clock.
  get model() {
    return config.tutorModel;
  },
  get effort() {
    return config.reflectEffort;
  },
};

export const CheckVerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "complicated", "not-found", "not-checkable", "read-more"]),
  explanation: z.string().describe("One or two plain sentences for the parent, naming the article. Empty with read-more."),
  evidence: z.string().describe("At most 30 words copied exactly from one passage, or empty."),
  articleTitle: z.string().describe("The article the evidence comes from, or empty."),
  sectionToRead: z.string().describe("With read-more only: a section heading copied exactly from an article's contents. Otherwise empty."),
  sayToLearner: z.string().describe("The one sentence the tutor says to the learner about this on its next turn, as the skill describes. Empty with read-more or not-checkable."),
});
export type CheckVerdict = z.infer<typeof CheckVerdictSchema>;

export interface CheckInput {
  claim: string;
  query: string;
  materialSays?: string;
  /** The course's level or the learner's grade, so "complicated" is judged at the student's level. */
  level?: string;
  /** What the tutor told the learner about it, so the sentence it owes them is phrased to fit. */
  tutorStance?: OutsideClaim["tutorStance"];
  raisedBy?: OutsideClaim["raisedBy"];
}

/**
 * What a check found, in the fields it fills on the OutsideClaim, plus the sentence the tutor would say about it
 * next turn. The orchestrator decides whether that sentence is owed (orchestrator/outside.ts, followUpFor).
 */
export type CheckOutcome = Pick<OutsideClaim, "status" | "statusNote" | "verdict" | "explanation" | "evidence" | "source" | "usage"> & { sayToLearner?: string };

const STANCE_FOR_CHECKER: Record<OutsideClaim["tutorStance"], string> = {
  confirmed: "that it is right",
  corrected: "that it is wrong",
  unsure: "that it was not sure, and that it would look into it",
  deferred: "nothing either way; it pointed back to the reading",
};

export interface CheckDeps {
  wiki: WikipediaClient;
  /** One look at the reference. `final` means read-more is no longer allowed. */
  judge: (input: CheckInput, reference: string, final: boolean) => Promise<CheckVerdict & { usage?: Usage }>;
}

/** Collapse spacing and quote marks, so a quotation copied across a line break still matches. */
function normalized(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The articles to read: the subject as an exact title first, then search results, two in all. Search alone
 * went astray on 2026-09-25: "Constantine the Great reign start date" found Constantine XI, the last Byzantine
 * emperor, and the check could not confirm a date the article on Constantine the Great states in its first line.
 */
async function articlesFor(input: CheckInput, wiki: WikipediaClient): Promise<WikiArticle[]> {
  const articles: WikiArticle[] = [];
  const exact = input.query.trim() ? await wiki.article(input.query.trim()) : undefined;
  if (exact) articles.push(exact);
  let titles = await wiki.search(input.query);
  if (!titles.length && input.claim !== input.query) titles = await wiki.search(input.claim);
  for (const t of titles) {
    if (articles.length >= 2) break;
    if (articles.some((a) => a.title === t)) continue;
    const a = await wiki.article(t);
    if (a && !articles.some((b) => b.title === a.title)) articles.push(a);
  }
  return articles;
}

export async function checkClaim(input: CheckInput, deps: CheckDeps): Promise<CheckOutcome> {
  const articles = await articlesFor(input, deps.wiki);
  if (!articles.length) {
    return { status: "checked", verdict: "not-found", explanation: `Wikipedia has no article that matches "${input.query}".` };
  }

  const brief = referenceBrief(articles, input.claim);
  let reference = renderBrief(brief);
  const spent: Usage[] = []; // one or two judge calls, for the meter
  let v = await deps.judge(input, reference, false);
  if (v.usage) spent.push(v.usage);
  if (v.verdict === "read-more") {
    const extra = articles.map((a) => sectionText(a, v.sectionToRead)).find(Boolean);
    if (extra) reference = renderBrief(brief, extra);
    v = await deps.judge(input, reference, true);
    if (v.usage) spent.push(v.usage);
  }
  const usage = spent.length
    ? spent.reduce((a, b) => ({ model: a.model, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0), cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) }))
    : undefined;
  // Still asking to read more after the second look: the articles did not settle it.
  const verdict = v.verdict === "read-more" ? "not-found" : v.verdict;
  const explanation = v.explanation.trim() || (v.verdict === "read-more" ? "The articles did not settle it." : undefined);

  if (verdict === "not-checkable") {
    return {
      status: "not-checked",
      statusNote: "A matter of faith, values or interpretation, which is left to the family's material and the parent.",
      explanation,
      ...(usage ? { usage } : {}),
    };
  }
  const article = articles.find((a) => a.title === v.articleTitle) ?? articles[0];
  // A quotation is shown to the parent as the source's own words, so one that is not in what was read is dropped.
  const quoted = v.evidence.trim() && normalized(reference).includes(normalized(v.evidence)) ? v.evidence.trim() : undefined;
  return {
    status: "checked",
    verdict,
    explanation,
    evidence: quoted,
    source: { title: article.title, url: article.url, revisionId: article.revisionId, quality: article.quality },
    ...(v.sayToLearner.trim() ? { sayToLearner: v.sayToLearner.trim() } : {}),
    ...(usage ? { usage } : {}),
  };
}

/** The real judge: one structured-output call to Claude. */
export async function claudeJudge(input: CheckInput, reference: string, final: boolean): Promise<CheckVerdict & { usage?: Usage }> {
  const model = referenceAgent.model;
  const { output_config: effortConfig, ...thinking } = reasoningParams(model, referenceAgent.effort) as { output_config?: Record<string, unknown> };
  const system = buildSystem(referenceAgent, []);
  const { message, parsed } = await streamParsed<CheckVerdict>(
    {
      model,
      max_tokens: 8000,
      ...thinking,
      system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
      output_config: { ...(effortConfig ?? {}), format: zodOutputFormat(CheckVerdictSchema) },
      messages: [
        {
          role: "user",
          content:
            `The claim to check: "${input.claim}"\n` +
            (input.level ? `The student's level: ${input.level}.\n` : "") +
            (input.materialSays ? `The family's material says, on this point: "${input.materialSays}"\n` : "") +
            (input.tutorStance
              ? `What the tutor told the learner about it: ${STANCE_FOR_CHECKER[input.tutorStance]}.${input.raisedBy === "tutor" ? " The tutor brought it up itself." : ""}\n`
              : "") +
            `\n${reference}\n\n` +
            (final
              ? "This is your second look, so decide now: read-more is not available."
              : "If the summaries and passages do not settle it but a section named in an article's contents would, answer read-more with that heading."),
        },
      ],
    },
    { timeout: 90_000 },
  );
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("The check was cut off at its output limit.");
  if (!parsed) throw new Error("The check returned no verdict.");
  return { ...parsed, usage: usageRecord(model, message.usage) };
}

let client: WikipediaClient | undefined;

/** Check a flagged claim with the live Wikipedia client and Claude. Fails with a readable message without a contact. */
export function checkOutsideClaim(claim: Pick<OutsideClaim, "claim" | "query" | "materialSays" | "tutorStance" | "raisedBy">, level?: string): Promise<CheckOutcome> {
  client ??= createWikipediaClient({ contact: config.wikipedia.contact });
  const { claim: text, query, materialSays, tutorStance, raisedBy } = claim;
  return checkClaim({ claim: text, query, materialSays, level, tutorStance, raisedBy }, { wiki: client, judge: claudeJudge });
}

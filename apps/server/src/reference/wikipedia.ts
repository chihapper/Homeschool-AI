/**
 * Wikipedia as the reference for facts from outside the family's material, read through the free public
 * MediaWiki Action API (no account).
 *
 * The check is a fact-checker, never a teacher: what it reads decides a verdict for the parent's report and,
 * sometimes, a one-sentence follow-up. The student never hears Wikipedia's wording.
 *
 * Wikimedia's rules, as of 2026-09-25 (details in #26):
 *  - Every request names the program and a contact in its User-Agent. Anonymous programs are limited to 10
 *    requests a minute (a probe without a contact was cut off after about ten); identified ones get 200.
 *  - Requests go one at a time, and a 429 is honoured with its retry-after.
 * Articles and searches are cached for a day, so a unit that keeps returning to the same subject (Aeneas,
 * Augustus) downloads each article once.
 *
 * Measured on 2026-09-25 (six claims across history, science and math): the search found the right article
 * every time, and search plus two articles took 0.3 to 0.5 s. Ranking paragraphs by the claim's words missed
 * once ("McDonald's rescued Aeneas": the article says "saved", not "rescued"), so the checker also gets each
 * article's summary and table of contents and may ask for one whole section (see reference-agent.ts).
 */
import type { SourceChunk } from "../domain/types.js";
import { ChunkIndex } from "../ingest/retrieval.js";

const API = "https://en.wikipedia.org/w/api.php";
const CLIENT = "ReferenceCheck/0.1";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest retry-after worth waiting for; beyond it the check fails with a readable note instead. */
const MAX_RETRY_WAIT_S = 30;
const MAX_CACHE_ENTRIES = 500;
/** Sections that hold no prose worth checking against. */
const SKIP_SECTIONS = /^(references|external links|see also|notes|further reading|sources|bibliography|citations|footnotes|notes and references|works cited|primary sources|secondary sources|gallery)$/i;
/** About a paragraph or two: small enough that a ranked passage is on one point. */
const PASSAGE_WORDS = 180;

export interface WikiArticle {
  title: string;
  /** Permanent link to the exact version read. */
  url: string;
  revisionId?: number;
  lastEdited?: string;
  /** Wikipedia's own grade for the article (FA, GA, B, C, Start, Stub), when a WikiProject has graded it. */
  quality?: string;
  /** Plain text, with "== Heading ==" lines between sections. */
  text: string;
}

export interface WikiPassage {
  article: string;
  section: string;
  text: string;
}

export interface WikipediaClient {
  /** Article titles for a subject, best first, without disambiguation pages. */
  search(query: string): Promise<string[]>;
  /** The article's current text, or undefined if there is none (or it is a disambiguation page). */
  article(title: string): Promise<WikiArticle | undefined>;
}

/** Wikimedia's required form: `<client>/<version> (<contact>) <library>/<version>`. */
export function wikipediaUserAgent(contact: string | undefined): string {
  const c = contact?.trim();
  if (!c) {
    throw new Error(
      "Wikipedia checks need WIKIPEDIA_CONTACT in .env: an email address or website Wikimedia can reach. Its policy asks every program for one, and an anonymous one is limited to 10 requests a minute.",
    );
  }
  return `${CLIENT} (${c}) Node.js/${process.versions.node}`;
}

/** A link to the exact version that was read, so a parent sees what the check saw even after later edits. */
export function permalink(title: string, revisionId?: number): string {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  return revisionId ? `https://en.wikipedia.org/w/index.php?title=${t}&oldid=${revisionId}` : `https://en.wikipedia.org/wiki/${t}`;
}

export interface WikipediaClientOptions {
  contact: string | undefined;
  /** Tests only: replace the network. */
  fetch?: (url: string, init: { headers: Record<string, string> }) => Promise<Pick<Response, "ok" | "status" | "statusText" | "headers" | "json">>;
  /** Tests only: replace waiting out a retry-after. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  cacheMs?: number;
}

export function createWikipediaClient(opts: WikipediaClientOptions): WikipediaClient {
  const userAgent = wikipediaUserAgent(opts.contact);
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const cacheMs = opts.cacheMs ?? DAY_MS;
  const cache = new Map<string, { at: number; value: unknown }>();
  let queue: Promise<unknown> = Promise.resolve();

  /** One request at a time, as Wikimedia's etiquette asks. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  // The API's JSON has no published TypeScript types; only the fields read below are relied on.
  async function get(params: Record<string, string>): Promise<any> {
    const url = `${API}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`;
    return serial(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(url, { headers: { "User-Agent": userAgent } });
        if (res.status === 429) {
          const wait = Number(res.headers.get("retry-after"));
          if (attempt === 0 && Number.isFinite(wait) && wait <= MAX_RETRY_WAIT_S) {
            await sleep(wait * 1000);
            continue;
          }
          throw new Error(`Wikipedia asked us to slow down (429 Too Many Requests${Number.isFinite(wait) ? `, retry after ${wait} s` : ""}).`);
        }
        if (!res.ok) throw new Error(`Wikipedia returned ${res.status} ${res.statusText}.`);
        const body: any = await res.json();
        if (body?.error) throw new Error(`Wikipedia API error: ${body.error.info ?? body.error.code}.`);
        return body;
      }
    });
  }

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.value as T;
    const value = await load();
    cache.set(key, { at: now(), value });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    return value;
  }

  return {
    search: (query) =>
      cached(`search:${query.trim().toLowerCase()}`, async () => {
        const body = await get({ action: "query", list: "search", srsearch: query, srlimit: "4", srprop: "" });
        return ((body.query?.search ?? []) as Array<{ title: string }>).map((s) => s.title).filter((t) => !/\(disambiguation\)$/i.test(t));
      }),
    article: (title) =>
      cached(`article:${title}`, async () => {
        const body = await get({
          action: "query",
          prop: "extracts|revisions|pageassessments",
          explaintext: "1",
          exsectionformat: "wiki",
          rvprop: "ids|timestamp",
          titles: title,
          redirects: "1",
        });
        const page = body.query?.pages?.[0];
        if (!page || page.missing || !page.extract) return undefined;
        const grades = [...new Set(Object.values((page.pageassessments ?? {}) as Record<string, { class?: string }>).map((a) => a.class).filter((c): c is string => Boolean(c)))];
        if (grades.includes("Disambig")) return undefined;
        const revisionId: number | undefined = page.revisions?.[0]?.revid;
        return {
          title: page.title as string,
          url: permalink(page.title, revisionId),
          revisionId,
          lastEdited: page.revisions?.[0]?.timestamp,
          quality: grades.join("/") || undefined,
          text: page.extract as string,
        } satisfies WikiArticle;
      }),
  };
}

// ---------------------------------------------------------------------------
// Reading an article the way a person skims it: the summary, the contents, the paragraphs that bear on the claim.
// ---------------------------------------------------------------------------

interface Section {
  heading: string;
  level: number;
  paragraphs: string[];
}

function sections(article: WikiArticle): Section[] {
  const out: Section[] = [{ heading: "Introduction", level: 1, paragraphs: [] }];
  for (const line of article.text.split("\n")) {
    const h = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
    if (h) {
      out.push({ heading: h[2], level: h[1].length, paragraphs: [] });
      continue;
    }
    if (line.trim()) out[out.length - 1].paragraphs.push(line.trim());
  }
  // A subsection of a skipped section ("References" > "Primary sources") is skipped with it.
  let skipping = 0;
  return out.filter((s) => {
    if (skipping && s.level > skipping) return false;
    skipping = SKIP_SECTIONS.test(s.heading) ? s.level : 0;
    return !skipping;
  });
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** The article cut into passages of about 180 words, paragraph-aligned, each labelled with its section. */
export function articlePassages(article: WikiArticle): WikiPassage[] {
  const out: WikiPassage[] = [];
  for (const s of sections(article)) {
    let buf: string[] = [];
    const flush = (): void => {
      if (buf.length) out.push({ article: article.title, section: s.heading, text: buf.join("\n") });
      buf = [];
    };
    for (const p of s.paragraphs) {
      buf.push(p);
      if (words(buf.join(" ")) >= PASSAGE_WORDS) flush();
    }
    flush();
  }
  return out;
}

/** The section headings, in order: the article's table of contents. */
export function articleContents(article: WikiArticle): string[] {
  return sections(article)
    .filter((s) => s.heading !== "Introduction")
    .map((s) => `${"  ".repeat(Math.max(0, s.level - 2))}${s.heading}`);
}

/** One section's whole text, including its subsections, for a second look. Matched ignoring case and spacing. */
export function sectionText(article: WikiArticle, heading: string): WikiPassage | undefined {
  const key = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, " ");
  const all = sections(article);
  const i = all.findIndex((s) => key(s.heading) === key(heading));
  if (i < 0) return undefined;
  const parts = [all[i]];
  for (let j = i + 1; j < all.length && all[j].level > all[i].level; j++) parts.push(all[j]);
  const text = parts.map((s, n) => (n ? `${s.heading}:\n` : "") + s.paragraphs.join("\n")).join("\n\n").trim();
  return text ? { article: article.title, section: all[i].heading, text } : undefined;
}

export interface ReferenceBrief {
  articles: Array<{ title: string; summary: string; contents: string[] }>;
  /** The passages that best match the claim's words, best first. */
  passages: WikiPassage[];
}

/**
 * What the checker reads: each article's summary (its opening, which usually states the essentials) and table of
 * contents, plus the passages from anywhere in the articles that best match the claim, ranked with the same BM25
 * the tutor uses on the family's material.
 */
export function referenceBrief(articles: WikiArticle[], claim: string, maxPassages = 6): ReferenceBrief {
  const all = articles.flatMap(articlePassages);
  const summaries = articles.map((a) => {
    const intro = all.filter((p) => p.article === a.title && p.section === "Introduction");
    return { title: a.title, summary: intro[0]?.text ?? "", contents: articleContents(a) };
  });
  const shown = new Set(summaries.map((s) => s.summary));
  const chunks: SourceChunk[] = all
    .filter((p) => !shown.has(p.text))
    .map((p, i) => ({ id: String(i), source: p.article, headingPath: [p.article, p.section], text: p.text, order: i }));
  const passages = new ChunkIndex(chunks)
    .search(claim, maxPassages)
    .map((h) => ({ article: h.chunk.source, section: h.chunk.headingPath[1], text: h.chunk.text }));
  return { articles: summaries, passages };
}

/** The brief as the checker reads it. */
export function renderBrief(brief: ReferenceBrief, extra?: WikiPassage): string {
  const articles = brief.articles
    .map((a) => `<article title="${a.title}">\n<summary>\n${a.summary}\n</summary>\n<contents>\n${a.contents.join("\n")}\n</contents>\n</article>`)
    .join("\n");
  const passages = brief.passages.map((p) => `<passage article="${p.article}" section="${p.section}">\n${p.text}\n</passage>`).join("\n");
  const section = extra ? `\n<section article="${extra.article}" heading="${extra.section}">\n${extra.text}\n</section>` : "";
  return `<wikipedia>\n${articles}\n<passages_matching_the_claim>\n${passages || "(none matched the claim's words)"}\n</passages_matching_the_claim>${section}\n</wikipedia>`;
}

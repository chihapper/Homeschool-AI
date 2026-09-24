/**
 * Lexical retrieval over source chunks (BM25). No embeddings, no external service.
 *
 * Good enough for "find the passage that talks about X" inside one course. Upgrade to embeddings
 * if courses grow to hundreds of pages.
 */
import type { SourceChunk } from "../domain/types.js";

const STOP = new Set(
  "a an the and or of to in on for with is are was were be been by as at it its this that these those from into over under about which who whom what when where why how not no do does did can could should would will may might".split(" "),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface Hit {
  chunk: SourceChunk;
  score: number;
}

/**
 * The tutor's query plus the learner's own words. The tutor tends to search for the idea ("what the
 * Etruscans gave Rome") while the learner named the thing ("I heard coinage"); the one chunk with the rare
 * word ranks first for the learner's words and nowhere for the tutor's (seen 2026-09-24, and the tutor then
 * told the learner the material does not mention coinage). Up to `extra` passages found only through the
 * learner's words are appended after the tutor's hits.
 */
export function searchWithLearner(index: ChunkIndex, query: string, learnerText: string | undefined, k = 4, extra = 2): Hit[] {
  const hits = index.search(query, k);
  if (!learnerText?.trim()) return hits;
  const seen = new Set(hits.map((h) => h.chunk.id));
  const more = index
    .search(learnerText, k + extra)
    .filter((h) => !seen.has(h.chunk.id))
    .slice(0, extra);
  return [...hits, ...more];
}

export class ChunkIndex {
  private readonly docs: Array<{ chunk: SourceChunk; tf: Map<string, number>; len: number }>;
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(chunks: SourceChunk[]) {
    this.docs = chunks.map((chunk) => {
      const tokens = tokenize(`${chunk.headingPath.join(" ")} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k = 4): Hit[] {
    const q = tokenize(query);
    if (!q.length || !this.docs.length) return [];
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.75;
    const scored = this.docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
      }
      return { chunk: d.chunk, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k);
  }
}

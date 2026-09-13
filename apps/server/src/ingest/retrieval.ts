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

  search(query: string, k = 4): Array<{ chunk: SourceChunk; score: number }> {
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

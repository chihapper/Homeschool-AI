/**
 * Incremental sentence chunker: as the tutor's text streams in token by token, hand back complete
 * sentences the moment each one is ready, so text-to-speech can start on sentence one while the model
 * is still writing sentence two. Ported from the character engine's `orchestrator/sentence_chunker.py`.
 *
 *   const chunker = new SentenceChunker();
 *   for await (const delta of stream) for (const s of chunker.push(delta)) speak(s.text);
 *   const tail = chunker.flush(); if (tail) speak(tail.text);
 */

export interface Segment {
  text: string;
  /** A blank line followed the sentence in the source text: leave a longer beat after it. */
  paraBreak: boolean;
}

/** Sentence-ending punctuation followed by whitespace: (1) the punctuation run, (2) the whitespace. */
const BOUNDARY = /([.!?]+)(\s+)/g;
const PARA_BREAK = /\n\s*\n/;
/** Tokens that end in a period but usually do not end a sentence ("Mr. Smith", "e.g. this"). */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "no", "fig", "inc", "ltd", "co"]);
const MIN_CHARS = 2;

export class SentenceChunker {
  private buf = "";

  /** Add a text delta; return any newly completed sentences, in order. */
  push(delta: string): Segment[] {
    if (!delta) return [];
    this.buf += delta;
    const out: Segment[] = [];
    let searchStart = 0;
    for (;;) {
      BOUNDARY.lastIndex = searchStart;
      const m = BOUNDARY.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const punct = m[1];
      const sep = m[2];
      const before = this.buf.slice(0, m.index);
      const candidate = this.buf.slice(0, end).trim();
      const paraBreak = PARA_BREAK.test(sep);
      // A mid-paragraph ellipsis is a trailing-off pause, not a sentence end: let it ride so the
      // voice performs the pause instead of restarting its prosody on the continuation.
      const isEllipsis = punct.length >= 2 && /^\.+$/.test(punct);
      if (isFalseBoundary(before) || candidate.length < MIN_CHARS || (isEllipsis && !paraBreak)) {
        searchStart = end;
        continue;
      }
      out.push({ text: candidate, paraBreak });
      this.buf = this.buf.slice(end);
      searchStart = 0;
    }
    return out;
  }

  /** Whatever remains (the final, unterminated sentence), or null. */
  flush(): Segment | null {
    const tail = this.buf.trim();
    this.buf = "";
    return tail ? { text: tail, paraBreak: false } : null;
  }
}

function isFalseBoundary(before: string): boolean {
  const words = before.trim().split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase().replace(/\.+$/, "");
  return Boolean(last) && ABBREVIATIONS.has(last);
}

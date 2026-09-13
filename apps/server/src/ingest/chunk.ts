/**
 * Split extracted text into source chunks that keep heading context.
 *
 * Heuristics only: markdown headings, ALL-CAPS lines, "Chapter N" / "Lesson N" / "Unit N" lines,
 * and numbered section titles are treated as headings. Everything else is paragraph text, packed
 * into chunks of roughly `maxChars` characters.
 */
import type { SourceChunk } from "../domain/types.js";

export interface ChunkOptions {
  maxChars?: number;
  minChars?: number;
}

const HEADING_PATTERNS: Array<{ re: RegExp; level: (m: RegExpMatchArray) => number }> = [
  { re: /^(#{1,6})\s+(.+)$/, level: (m) => m[1].length },
  { re: /^(?:unit|chapter|module|part)\s+\d+[a-z]?\b.*$/i, level: () => 1 },
  { re: /^(?:lesson|section|week|day)\s+\d+[a-z]?\b.*$/i, level: () => 2 },
  { re: /^\d+(?:\.\d+)*\.?\s+[A-Z][^.]{2,80}$/, level: (m) => Math.min(3, (m[0].match(/\./g)?.length ?? 0) + 1) },
  { re: /^[A-Z][A-Z0-9 ,:'&()-]{4,80}$/, level: () => 2 },
];

export function detectHeading(line: string): { level: number; title: string } | undefined {
  const t = line.trim();
  if (!t || t.length > 120) return undefined;
  for (const { re, level } of HEADING_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const title = (m[2] ?? m[0]).replace(/^#+\s*/, "").trim();
      return { level: level(m), title };
    }
  }
  return undefined;
}

export function chunkDocument(text: string, source: string, opts: ChunkOptions = {}): SourceChunk[] {
  const maxChars = opts.maxChars ?? 1800;
  const minChars = opts.minChars ?? 300;
  const chunks: SourceChunk[] = [];
  const headingPath: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let order = 0;

  const flush = (): void => {
    const body = buffer.join("\n").trim();
    if (!body) {
      buffer = [];
      bufferLen = 0;
      return;
    }
    chunks.push({
      id: `${slug(source)}-${String(order).padStart(4, "0")}`,
      source,
      headingPath: [...headingPath],
      text: body,
      order: order++,
    });
    buffer = [];
    bufferLen = 0;
  };

  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const lines = para.split("\n");
    const heading = lines.length === 1 ? detectHeading(lines[0]) : undefined;
    if (heading) {
      flush();
      headingPath.splice(heading.level - 1);
      headingPath[heading.level - 1] = heading.title;
      // Fill any gap levels so the path is dense.
      for (let i = 0; i < headingPath.length; i++) if (!headingPath[i]) headingPath[i] = "";
      continue;
    }
    const p = para.trim();
    if (!p) continue;
    if (bufferLen + p.length > maxChars && bufferLen >= minChars) flush();
    if (p.length > maxChars) {
      // Very long paragraph: hard-split on sentence boundaries.
      for (const piece of splitLong(p, maxChars)) {
        buffer.push(piece);
        bufferLen += piece.length;
        flush();
      }
      continue;
    }
    buffer.push(p);
    bufferLen += p.length + 1;
  }
  flush();
  return chunks.map((c) => ({ ...c, headingPath: c.headingPath.filter(Boolean) }));
}

function splitLong(p: string, maxChars: number): string[] {
  const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > maxChars && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "doc";
}

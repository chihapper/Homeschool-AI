/**
 * Caption / transcript formats -> plain text with periodic timestamps.
 *
 * WebVTT and SRT from yt-dlp; JSON word lists from speech-to-text. Output keeps a `[mm:ss]` marker
 * roughly every `markerEverySec` seconds so chunks retain provenance inside a long recording.
 */

export interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^(WEBVTT|NOTE|Kind:|Language:|STYLE|REGION)/.test(l));
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->").map((s) => s.trim().split(/\s+/)[0]);
    const text = lines
      .slice(ti + 1)
      .map((l) => l.replace(/<[^>]+>/g, "").trim()) // strip <c> / <00:00:01.000> inline tags
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    cues.push({ start: ts(a), end: ts(b), text });
  }
  // yt-dlp auto captions repeat lines as they roll; drop exact consecutive duplicates.
  return cues.filter((c, i) => i === 0 || c.text !== cues[i - 1].text);
}

export function parseSrt(srt: string): Cue[] {
  return parseVtt(srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"));
}

export function ts(s: string): number {
  const parts = s.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Join cues into paragraphs with a timestamp marker at the start of each paragraph. */
export function cuesToText(cues: Cue[], opts: { markerEverySec?: number; title?: string } = {}): string {
  const every = opts.markerEverySec ?? 60;
  const paras: string[] = [];
  let cur: string[] = [];
  let curStart = cues[0]?.start ?? 0;
  for (const c of cues) {
    if (c.start - curStart >= every && cur.length) {
      paras.push(`[${fmt(curStart)}] ${cur.join(" ")}`);
      cur = [];
      curStart = c.start;
    }
    cur.push(c.text);
  }
  if (cur.length) paras.push(`[${fmt(curStart)}] ${cur.join(" ")}`);
  return (opts.title ? `# ${opts.title}\n\n` : "") + paras.join("\n\n");
}

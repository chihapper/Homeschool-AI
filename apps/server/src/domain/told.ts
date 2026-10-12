/**
 * What the tutor has already told the learner, worked out from the transcript alone.
 *
 * On 2026-09-30 a tutor read out "merged around 753 B.C." from the material, later asked the learner for
 * "the date", filed "I don't remember" as a gap and "753 BC" as recall, and, when the learner said "you
 * told me that", denied it twice. The whole transcript was in front of the model each time; what it lacked
 * was anything pointing at its own earlier words, and its notes said the learner had recalled the date.
 * Replayed with the notes as they stood, the speaking call owned its earlier statement two times in three.
 *
 * A fact the tutor stated is told, not recalled: asking for it back tests listening, and the answer is
 * evidence of nothing either way. This is the deterministic part of the fix: figures (dates and other
 * numbers) from the key facts of the concepts this session walks that the TUTOR was the first to say. Every
 * walked concept counts, not only the current one: in that session the tutor had moved on to the next
 * concept by the time the learner objected. Prose facts are left to the reflect pass, which records what
 * the tutor stated as an observation of kind `told`.
 */

export interface ToldFigure {
  /** The number as digits, without separators ("753"). */
  figure: string;
  /** The key fact it belongs to. */
  fact: string;
  /** Index in the transcript of the tutor turn that said it first (the transcript's length for a reply not yet in it). */
  turn: number;
  /** How many tutor replies back that was: 1 is the tutor's most recent reply. */
  repliesAgo: number;
  /** The tutor's own words around it, so the model recognises them. */
  quote: string;
}

type Turn = { role: "user" | "assistant"; content: string };

/** "1,200" reads as one number: thousands separators out, so a figure compares as its digits. */
const plain = (text: string): string => text.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

/** Numbers of two or more digits in a text ("754 or 753 B.C." -> 754, 753). Single digits are everywhere and mean nothing. */
export function figuresIn(text: string): string[] {
  return [...new Set(plain(text).match(/(?<!\d)(?<!\d\.)\d{2,}(?!\d)(?!\.\d)/g) ?? [])];
}

/** Where a figure stands as a whole number in a text: 753 is not found inside 1753, 7530 or 2.753. */
function indexOfFigure(text: string, figure: string): number {
  const m = new RegExp(`(?<!\\d)(?<!\\d\\.)${figure}(?!\\d)(?!\\.\\d)`).exec(text);
  return m ? m.index : -1;
}

/** The words around a position, cut at word boundaries. */
function around(text: string, at: number, length: number, before = 90, after = 60): string {
  let start = Math.max(0, at - before);
  let end = Math.min(text.length, at + length + after);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at + length) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/**
 * The figures in these key facts that the tutor said before the learner did. Whoever says a figure first
 * owns it: a learner who brings "753 BC" and hears it echoed has not been told anything. `justSpoken` is a
 * reply the learner has heard that is not in the transcript yet (the reflect pass runs at that moment).
 */
export function toldFigures(keyFacts: string[], transcript: Turn[], justSpoken?: string): ToldFigure[] {
  // The reply just heard is usually the transcript's last turn already (the orchestrator saves it first): count it once.
  const last = transcript.at(-1);
  const already = justSpoken !== undefined && last?.role === "assistant" && last.content.trim() === justSpoken.trim();
  const turns: Turn[] = (justSpoken && !already ? [...transcript, { role: "assistant" as const, content: justSpoken }] : transcript).map((t) => ({ role: t.role, content: plain(t.content) }));
  const told: ToldFigure[] = [];
  const seen = new Set<string>();
  for (const fact of keyFacts) {
    for (const figure of figuresIn(fact)) {
      if (seen.has(figure)) continue;
      seen.add(figure);
      const first = turns.findIndex((t) => indexOfFigure(t.content, figure) >= 0);
      if (first < 0 || turns[first].role !== "assistant") continue; // nobody has said it yet, or the learner brought it
      const text = turns[first].content;
      const repliesAgo = turns.slice(first).filter((t) => t.role === "assistant").length;
      told.push({ figure, fact, turn: first, repliesAgo, quote: around(text, indexOfFigure(text, figure), figure.length) });
    }
  }
  return told;
}

/** Observation kinds that are evidence of what the learner can do. Engagement is a pattern, and `told` is the tutor's own words. */
export function isEvidence(kind: string): boolean {
  return kind !== "engagement" && kind !== "told";
}

/**
 * Small helpers for 16-bit signed mono PCM (the wire format between the browser, the transcriber,
 * text-to-speech, and us). Pure functions: no I/O.
 */

/** Linear-interpolation resample of s16le mono PCM. Plenty for speech. */
export function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate || input.length < 2) return input;
  const inSamples = Math.floor(input.length / 2);
  const outSamples = Math.floor((inSamples * toRate) / fromRate);
  const out = Buffer.alloc(outSamples * 2);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, inSamples - 1);
    const frac = pos - i0;
    const a = input.readInt16LE(i0 * 2);
    const b = input.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(a * (1 - frac) + b * frac), i * 2);
  }
  return out;
}

/** `ms` of digital silence at `rate`. */
export function silencePcm16(ms: number, rate: number): Buffer {
  return Buffer.alloc(Math.max(0, Math.round((rate * ms) / 1000)) * 2);
}

/**
 * Fade the first and last `ms` of a clip to zero so stitching it next to silence never clicks
 * (a per-sentence synthesizer cuts each clip off abruptly).
 */
export function fadeEdgesPcm16(pcm: Buffer, rate: number, ms = 5): Buffer {
  const n = Math.floor(pcm.length / 2);
  const edge = Math.min(Math.round((rate * ms) / 1000), Math.floor(n / 2));
  if (edge <= 0) return pcm;
  const out = Buffer.from(pcm);
  for (let i = 0; i < edge; i++) {
    const g = i / edge;
    out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * g), i * 2);
    const j = n - 1 - i;
    out.writeInt16LE(Math.round(out.readInt16LE(j * 2) * g), j * 2);
  }
  return out;
}

/** Sentence gaps, in ms, by how the previous sentence ended. A breath between spoken sentences. */
export const SENTENCE_GAP_MS = { default: 220, emphatic: 280, trailing: 450, clause: 140, paragraph: 450 } as const;

export function gapAfter(sentence: string, paraBreak = false): number {
  const t = sentence.trimEnd().replace(/["'”’)]+$/, "");
  let base: number;
  if (t.endsWith("…") || t.endsWith("—") || t.endsWith("...")) base = SENTENCE_GAP_MS.trailing;
  else if (t.endsWith("?") || t.endsWith("!")) base = SENTENCE_GAP_MS.emphatic;
  else if (/[,;:]$/.test(t)) base = SENTENCE_GAP_MS.clause;
  else base = SENTENCE_GAP_MS.default;
  return paraBreak ? Math.max(base, SENTENCE_GAP_MS.paragraph) : base;
}

/** Peak level of a PCM chunk as a fraction of full scale (0..1). Cheap voice-activity signal. */
export function peakPcm16(pcm: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const v = Math.abs(pcm.readInt16LE(i));
    if (v > peak) peak = v;
  }
  return peak / 32768;
}

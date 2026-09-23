/**
 * Hume Octave text-to-speech, streamed per request.
 *
 * Ported from the character engine's `orchestrator/adapters/tts_hume.py` (its bake-off winner), trimmed
 * to what a tutor needs. One request can carry several sentences as separate utterances: Octave keeps
 * its pace and pitch across the utterances of one request far better than across separate requests,
 * and each utterance gets a `trailing_silence` the voice performs itself instead of digital silence
 * spliced in afterwards. Prosody is also carried across requests and turns through
 * `context.generation_id`. Re-checked against dev.hume.ai on 2026-09-21: POST /v0/tts/stream/json,
 * `X-Hume-Api-Key`, newline-delimited JSON chunks with base64 PCM, 48 kHz signed 16-bit mono
 * (measured). Octave 2 gave first audio in ~0.6 s versus ~0.9 s for Octave 1 in that probe.
 */
import { config } from "../config.js";
import { fadeEdgesPcm16, resamplePcm16 } from "./pcm.js";

const BASE_URL = "https://api.hume.ai";
const UUID = /^[0-9a-f-]{36}$/i;

export interface SpeakOptions {
  /** Voice Library name ("Ava Song"), "HUME_AI:<name|id>", "CUSTOM_VOICE:<id>", or a bare custom-voice UUID. */
  voice: string;
  /** Standing delivery note (Octave 1 only honours it; kept short). */
  description?: string;
  version?: "1" | "2";
  instant?: boolean;
  /** Seconds of silence after a plain-string input. Utterance inputs carry their own. */
  trailingSilence?: number;
  /** Carry prosody from a previous generation (same voice). */
  continuation?: string;
  signal?: AbortSignal;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** One sentence to speak, with how long the voice should hang after it (seconds). */
export interface Utterance {
  text: string;
  trailingSilence: number;
}

/** Map a voice setting to Hume's voice reference. */
export function voiceRef(voice: string): { id?: string; name?: string; provider: "HUME_AI" | "CUSTOM_VOICE" } {
  for (const provider of ["HUME_AI", "CUSTOM_VOICE"] as const) {
    if (voice.startsWith(`${provider}:`)) {
      const ref = voice.slice(provider.length + 1).trim();
      return UUID.test(ref) ? { id: ref, provider } : { name: ref, provider };
    }
  }
  return UUID.test(voice) ? { id: voice, provider: "CUSTOM_VOICE" } : { name: voice, provider: "HUME_AI" };
}

/**
 * How long a line hangs after it lands, from how it ends: a trailing-off line waits, an exclamation
 * moves on, a question leaves room for the answer. The last utterance of a request always gets at least
 * half a second so the reply's final beat lands before whatever comes next.
 */
export function trailingSilenceFor(sentence: string, isLast: boolean, paraBreak = false): number {
  const s = sentence.trimEnd().replace(/["'”’)]+$/, "");
  let gap: number;
  if (s.endsWith("...") || s.endsWith("…") || s.endsWith("—") || s.endsWith("--")) gap = 0.9;
  else if (s.endsWith("!")) gap = 0.2;
  else if (s.endsWith("?")) gap = 0.45;
  else gap = 0.35;
  if (paraBreak) gap = Math.max(gap, 0.6);
  if (isLast && gap < 0.5) gap = 0.5;
  return Math.round(Math.min(gap, 1.5) * 100) / 100;
}

/** The request body for one synthesis call. Pure, so it can be unit-tested. */
export function humeRequestBody(utterances: Utterance[], opts: Omit<SpeakOptions, "signal" | "apiKey" | "fetchImpl">): Record<string, unknown> {
  const version = opts.version ?? "2";
  const voice = voiceRef(opts.voice);
  const list = utterances.map((u, i) => {
    // Instant mode wants the voice on every utterance; prosody still flows utterance to utterance.
    const utt: Record<string, unknown> = { text: u.text, voice, trailing_silence: u.trailingSilence };
    // Acting descriptions are an Octave 1 feature; on 2 they are ignored, so only send them where they work.
    if (i === 0 && opts.description && version === "1") utt.description = opts.description.slice(0, 100);
    return utt;
  });
  const body: Record<string, unknown> = {
    utterances: list,
    format: { type: "pcm" },
    version,
    instant_mode: opts.instant ?? true,
    strip_headers: true,
  };
  if (opts.continuation) body.context = { generation_id: opts.continuation };
  return body;
}

export interface SpeechChunk {
  /** 16-bit mono PCM at `config.voice.playbackSampleRate`. */
  pcm: Buffer;
  generationId?: string;
}

/**
 * Synthesize one sentence (a string) or a run of sentences (utterances) in a single request; yields PCM
 * chunks as they arrive. Throws on a provider error (including "no audio", which is how an exhausted
 * balance shows up on the file endpoint).
 */
export async function* speakHume(input: string | Utterance[], opts: SpeakOptions): AsyncGenerator<SpeechChunk, void, void> {
  const apiKey = opts.apiKey ?? config.hume.apiKey;
  if (!apiKey) throw new Error("HUME_API_KEY is not set: text-to-speech is unavailable.");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const utterances = typeof input === "string" ? [{ text: input, trailingSilence: opts.trailingSilence ?? 0 }] : input;
  if (!utterances.length) return;
  const body = humeRequestBody(utterances, opts);

  const res = await fetchImpl(`${BASE_URL}/v0/tts/stream/json`, {
    method: "POST",
    headers: { "X-Hume-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`Hume TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const from = config.voice.humeSampleRate;
  const to = config.voice.playbackSampleRate;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let gotAudio = false;
  let generationId: string | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const chunk = parseHumeLine(line);
        if (chunk.error) throw new Error(`Hume TTS error: ${chunk.error}`);
        if (chunk.generationId) generationId = chunk.generationId;
        if (!chunk.audio) continue;
        gotAudio = true;
        yield { pcm: fadeEdgesPcm16(resamplePcm16(chunk.audio, from, to), to), generationId };
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!gotAudio) throw new Error("Hume TTS returned no audio (check the voice name and the balance at platform.hume.ai).");
}

/** Interpret one line of the stream. Pure, so it can be unit-tested. */
export function parseHumeLine(line: string): { audio?: Buffer; generationId?: string; error?: string } {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (msg.error || (msg.message && !msg.audio && msg.type !== "timestamp")) return { error: String(msg.error ?? msg.message).slice(0, 300) };
  const generationId = typeof msg.generation_id === "string" ? msg.generation_id : undefined;
  const audio = typeof msg.audio === "string" && msg.audio ? Buffer.from(msg.audio, "base64") : undefined;
  return { audio, generationId };
}

/** Hume Voice Library, for the Settings tab. */
export async function listHumeVoices(apiKey = config.hume.apiKey): Promise<Array<{ id: string; name: string }>> {
  if (!apiKey) return [];
  const res = await fetch(`${BASE_URL}/v0/tts/voices?provider=HUME_AI&page_size=100`, { headers: { "X-Hume-Api-Key": apiKey } });
  if (!res.ok) throw new Error(`Hume voices error ${res.status}`);
  const body = (await res.json()) as { voices_page?: Array<{ id: string; name: string }> };
  return (body.voices_page ?? []).map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

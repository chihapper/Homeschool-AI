/**
 * ElevenLabs text-to-speech, streamed per request: one of the two voices for browser voice mode, chosen in
 * Settings (`ttsProvider`). Same role as `tts-inworld.ts`: text in, 24 kHz PCM out; the turn loop in
 * `live.ts` decides what to send when. Modelled on the character engine's
 * `orchestrator/adapters/tts_elevenlabs.py`.
 *
 * Checked against elevenlabs.io/docs on 2026-09-24:
 *  - POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000 with header `xi-api-key`.
 *    `pcm_24000` is headerless signed 16-bit little-endian mono at 24 kHz and available on every tier
 *    (`pcm_48000` needs Pro). The browser plays 24 kHz, so nothing is resampled.
 *  - voice_settings: stability (default 0.5), similarity_boost (0.75), style (0; anything else adds
 *    latency), use_speaker_boost (true), speed (1.0).
 *  - Request stitching: a finished request's `request-id` response header, passed back in
 *    `previous_request_ids` (at most three, no older than two hours), keeps the voice's delivery continuous
 *    from one request to the next. An id only counts once its audio was read to the end. Not available
 *    on eleven_v3.
 *  - `optimize_streaming_latency` is deprecated: pick a Flash model for speed (about 75 ms). Flash models
 *    do not normalize numbers by default, so "753" can come out digit by digit.
 *  - Errors are JSON `{"detail": {"message", "status", "code", ...}}`. Pasting the key ID instead of the
 *    key gives HTTP 400 with status `api_key_id_used_as_api_key` (seen 2026-09-24): keys start with "sk_".
 */
import { config } from "../config.js";
import { Pcm16Stream } from "./pcm.js";

export const ELEVEN_BASE_URL = "https://api.elevenlabs.io";
export const ELEVEN_SAMPLE_RATE = 24_000;
const OUTPUT_FORMAT = "pcm_24000";

/** At most this many earlier requests condition the next one (the API's limit). */
const MAX_PREVIOUS = 3;
/** The API accepts ids up to two hours old; stop a little short. */
const MAX_PREVIOUS_AGE_MS = 100 * 60 * 1000;

export interface ElevenSpeakOptions {
  voiceId: string;
  model: string;
  stability: number;
  speed: number;
  /** Request ids of earlier requests with the same voice and model whose audio played to the end. */
  previousRequestIds?: string[];
  signal?: AbortSignal;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** A finished request the next one can be stitched to. */
export interface StitchedRequest {
  id: string;
  at: number;
}

/** Whether a model accepts request stitching. The docs rule out eleven_v3; its conversational variant is treated the same until shown otherwise. */
export function supportsStitching(model: string): boolean {
  return !model.startsWith("eleven_v3");
}

/** Keep the newest ids, at most three, none too old to be accepted. */
export function rememberRequest(list: StitchedRequest[], id: string, now = Date.now()): StitchedRequest[] {
  return [...list, { id, at: now }].filter((r) => now - r.at < MAX_PREVIOUS_AGE_MS).slice(-MAX_PREVIOUS);
}

/** The ids still young enough to send. */
export function freshRequestIds(list: StitchedRequest[], now = Date.now()): string[] {
  return list.filter((r) => now - r.at < MAX_PREVIOUS_AGE_MS).map((r) => r.id).slice(-MAX_PREVIOUS);
}

/** URL and body for one synthesis request. Pure, so it can be unit-tested. */
export function elevenRequest(text: string, opts: Omit<ElevenSpeakOptions, "signal" | "apiKey" | "fetchImpl">): { url: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    text,
    model_id: opts.model,
    // Sent in full: a partial voice_settings would reset the fields left out to the API's defaults anyway.
    voice_settings: { stability: opts.stability, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: opts.speed },
  };
  const previous = (opts.previousRequestIds ?? []).slice(-MAX_PREVIOUS);
  if (previous.length && supportsStitching(opts.model)) body.previous_request_ids = previous;
  return { url: `${ELEVEN_BASE_URL}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/stream?output_format=${OUTPUT_FORMAT}`, body };
}

/** The readable part of an ElevenLabs error body, whichever of its shapes it takes. */
export function elevenErrorMessage(status: number, body: string): string {
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d))).join("; ");
    if (detail && typeof detail === "object") {
      const d = detail as { message?: unknown; status?: unknown };
      const text = [d.message, d.status ? `(${String(d.status)})` : ""].filter(Boolean).join(" ");
      if (text) return text;
    }
  } catch {
    /* not JSON */
  }
  return body.trim().slice(0, 300) || `HTTP ${status}`;
}

/** Why the configured key cannot work, if that can be told without calling the API. */
export function elevenKeyProblem(key: string | undefined): string | undefined {
  if (!key) return "ELEVENLABS_API_KEY is not set in .env.";
  if (!key.startsWith("sk_")) return "ELEVENLABS_API_KEY does not start with sk_, so it is probably the key ID; paste the key itself (shown once when it is created or rotated).";
  return undefined;
}

export interface ElevenChunk {
  /** 16-bit mono PCM at 24 kHz, whole samples only. */
  pcm: Buffer;
  /** The request's id, for stitching the next request to it once this one has played to the end. */
  requestId?: string;
}

/**
 * Synthesize one piece of text; yields PCM as it arrives. If a stitched request is refused (for instance
 * an id that expired), it is retried once without stitching rather than losing the sentence. Throws on
 * any other provider error, and when the stream carries no audio.
 */
export async function* speakElevenLabs(text: string, opts: ElevenSpeakOptions): AsyncGenerator<ElevenChunk, void, void> {
  const apiKey = opts.apiKey ?? config.elevenlabs.apiKey;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set: ElevenLabs text-to-speech is unavailable.");
  if (!text.trim()) return;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const send = (withStitching: boolean): Promise<Response> => {
    const { url, body } = elevenRequest(text, withStitching ? opts : { ...opts, previousRequestIds: [] });
    return fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/pcm" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  };

  const stitched = Boolean(opts.previousRequestIds?.length) && supportsStitching(opts.model);
  let res = await send(true);
  if (!res.ok && stitched && (res.status === 400 || res.status === 422)) {
    await res.text().catch(() => "");
    res = await send(false);
  }
  if (!res.ok || !res.body) throw new Error(`ElevenLabs TTS error ${res.status}: ${elevenErrorMessage(res.status, await res.text().catch(() => ""))}`);

  const requestId = res.headers.get("request-id") ?? undefined;
  const pcm = new Pcm16Stream(ELEVEN_SAMPLE_RATE);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const out = pcm.push(value);
      if (out.length) yield { pcm: out, requestId };
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!pcm.samples) throw new Error("ElevenLabs TTS returned no audio (check the voice and the model in Settings, and the account's credits).");
}

// ---------------------------------------------------------------------------
// Account lookups for the Settings tab and the readiness check
// ---------------------------------------------------------------------------

export interface VoiceOption {
  id: string;
  name: string;
  /** Short description from the voice's labels, e.g. "female · young · american · calm". */
  description?: string;
  /** A public sample clip the browser can play without a key. */
  previewUrl?: string;
  category?: string;
}

/** Map one page of GET /v2/voices. Pure, so it can be unit-tested. */
export function mapElevenVoices(raw: unknown): VoiceOption[] {
  const voices = (raw as { voices?: unknown[] } | null)?.voices ?? [];
  return voices
    .map((v) => v as { voice_id?: string; name?: string; description?: string | null; preview_url?: string | null; category?: string; labels?: Record<string, string> | null })
    .filter((v) => v.voice_id && v.name)
    .map((v) => {
      const l = v.labels ?? {};
      const fromLabels = [l.gender, l.age, l.accent, l.descriptive ?? l.description, l.use_case].filter(Boolean).join(" · ");
      const description = (fromLabels || v.description || "").slice(0, 90) || undefined;
      return { id: v.voice_id!, name: v.name!, description, previewUrl: v.preview_url ?? undefined, category: v.category };
    });
}

/** The account's voices (premade, cloned, designed, saved from the library), up to three pages of a hundred. */
export async function listElevenVoices(apiKey = config.elevenlabs.apiKey, fetchImpl: typeof fetch = fetch): Promise<VoiceOption[]> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set in .env.");
  const out: VoiceOption[] = [];
  let token: string | undefined;
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ page_size: "100", sort: "name", sort_direction: "asc", include_total_count: "false" });
    if (token) q.set("next_page_token", token);
    const res = await fetchImpl(`${ELEVEN_BASE_URL}/v2/voices?${q}`, { headers: { "xi-api-key": apiKey } });
    const text = await res.text();
    if (!res.ok) throw new Error(`ElevenLabs voices error ${res.status}: ${elevenErrorMessage(res.status, text)}`);
    const body = JSON.parse(text) as { has_more?: boolean; next_page_token?: string | null };
    out.push(...mapElevenVoices(body));
    if (!body.has_more || !body.next_page_token) break;
    token = body.next_page_token;
  }
  return out;
}

export interface ModelOption {
  id: string;
  name: string;
  /** What to expect from it here, in a few words. */
  note?: string;
}

/** What each known model is like for a live tutor, from the ElevenLabs model docs (2026-09-24). */
const MODEL_NOTES: Record<string, string> = {
  eleven_flash_v2_5: "fastest, about 75 ms; reads numbers digit by digit",
  eleven_flash_v2: "fastest, about 75 ms; English only",
  eleven_v3_conversational: "expressive and real-time, about 280 ms; same credits as Flash",
  eleven_multilingual_v2: "richest of the v2 voices; slower, double the credits",
  eleven_turbo_v2_5: "older fast model",
  eleven_turbo_v2: "older fast model, English only",
  eleven_v3: "most expressive, but not built for real-time; no stitching; double the credits",
};
const PREFERRED_ORDER = ["eleven_flash_v2_5", "eleven_v3_conversational", "eleven_multilingual_v2", "eleven_flash_v2", "eleven_turbo_v2_5", "eleven_v3"];

/** Used when the account cannot be asked (no key yet): the models the docs recommend for real-time speech. */
export const ELEVEN_FALLBACK_MODELS: ModelOption[] = [
  { id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", note: MODEL_NOTES.eleven_flash_v2_5 },
  { id: "eleven_v3_conversational", name: "Eleven v3 Conversational", note: MODEL_NOTES.eleven_v3_conversational },
  { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", note: MODEL_NOTES.eleven_multilingual_v2 },
  { id: "eleven_flash_v2", name: "Eleven Flash v2", note: MODEL_NOTES.eleven_flash_v2 },
];

/** Map GET /v1/models to the text-to-speech models, known real-time ones first. Pure, so it can be unit-tested. */
export function mapElevenModels(raw: unknown): ModelOption[] {
  const models = Array.isArray(raw) ? raw : [];
  const rank = (id: string): number => {
    const i = PREFERRED_ORDER.indexOf(id);
    return i < 0 ? PREFERRED_ORDER.length : i;
  };
  return models
    .map((m) => m as { model_id?: string; name?: string; can_do_text_to_speech?: boolean; requires_alpha_access?: boolean })
    .filter((m) => m.model_id && m.can_do_text_to_speech)
    .map((m) => ({
      id: m.model_id!,
      name: m.name || m.model_id!,
      note: [MODEL_NOTES[m.model_id!], m.requires_alpha_access ? "needs alpha access" : ""].filter(Boolean).join("; ") || undefined,
    }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

export async function listElevenModels(apiKey = config.elevenlabs.apiKey, fetchImpl: typeof fetch = fetch): Promise<ModelOption[]> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set in .env.");
  const res = await fetchImpl(`${ELEVEN_BASE_URL}/v1/models`, { headers: { "xi-api-key": apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs models error ${res.status}: ${elevenErrorMessage(res.status, text)}`);
  return mapElevenModels(JSON.parse(text));
}

export interface ElevenCredits {
  tier?: string;
  status?: string;
  /** Characters used in the current period. */
  used: number;
  /** Characters allowed in the current period. */
  limit: number;
  /** When the count resets, ISO date. */
  resetsAt?: string;
}

/** Map GET /v1/user/subscription. Pure, so it can be unit-tested. */
export function mapElevenSubscription(raw: unknown): ElevenCredits {
  const s = (raw ?? {}) as { tier?: string; status?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number };
  return {
    tier: s.tier,
    status: s.status,
    used: Number(s.character_count ?? 0),
    limit: Number(s.character_limit ?? 0),
    resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : undefined,
  };
}

/** The account's character credits: how many are used, how many remain, and when they reset. */
export async function elevenCredits(apiKey = config.elevenlabs.apiKey, fetchImpl: typeof fetch = fetch): Promise<ElevenCredits> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set in .env.");
  const res = await fetchImpl(`${ELEVEN_BASE_URL}/v1/user/subscription`, { headers: { "xi-api-key": apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs subscription error ${res.status}: ${elevenErrorMessage(res.status, text)}`);
  return mapElevenSubscription(JSON.parse(text));
}

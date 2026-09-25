/**
 * Inworld text-to-speech: the third voice for browser voice mode, beside Hume Octave and ElevenLabs
 * (`ttsProvider`). Unlike those two, a tutor reply is voiced as ONE stream: `live.ts` opens a context for
 * the reply, feeds it each sentence batch the moment it is written, and the context keeps the voice's
 * delivery continuous across batches, which separate requests cannot do (docs/LATENCY.md, clips A to D).
 * The connection is opened while the student is still talking, so its handshake costs the reply nothing.
 *
 * Checked against docs.inworld.ai and github.com/inworld-ai/inworld-api-examples on 2026-09-24:
 *  - wss://api.inworld.ai/tts/v1/voice:streamBidirectional with `Authorization: Basic <key>`. The key is
 *    the Base64 credential copied from the Portal as-is (base64 of key_id:secret); encoding it again, or
 *    sending the key ID alone, is refused with 401/403.
 *  - Per context: {context_id, create: {voice_id, model_id, audio_config}}, then one
 *    {context_id, send_text: {text, flush_context: {}}} per piece, then {context_id, close_context: {}}.
 *    Messages are processed in order, so nothing waits for the `contextCreated` acknowledgment.
 *  - Replies: {result: {contextId, audioChunk: {audioContent}}} (base64), result.contextClosed once a
 *    closed context's audio is all out, or {error: {code, message}} with gRPC status codes.
 *  - audio_encoding "PCM" is raw signed 16-bit little-endian with no WAV header ("LINEAR16" repeats a WAV
 *    header in every chunk). 24 kHz, what the browser plays. speaking_rate is 0.5 to 1.5.
 *  - At most 5 contexts per connection; plan concurrency counts only active contexts; 2,000 characters per
 *    send_text.
 *  - HTTP streaming (POST /tts/v1/voice:stream, NDJSON lines of {result: {audioContent}}) for one-off text:
 *    Test this voice, and the fallback when the socket fails mid-reply.
 *  - Voices: GET /voices/v1/voices. Preview: GET /tts/v1/voice:preview?voice_id&model_id returns an MP3
 *    as base64 JSON and is not billed.
 */
import { config } from "../config.js";
import { Pcm16Stream, SENTENCE_GAP_MS } from "./pcm.js";
import type { ModelOption, VoiceOption } from "./tts-elevenlabs.js";

export const INWORLD_BASE_URL = "https://api.inworld.ai";
export const INWORLD_WS_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional";
export const INWORLD_SAMPLE_RATE = 24_000;
/** The API's limit on one send_text. */
const MAX_TEXT = 2000;
/** Text owed audio (or a close owed its confirmation) with nothing back for this long: the reply has failed and falls back. */
const SILENCE_TIMEOUT_MS = 10_000;

export interface InworldVoice {
  voiceId: string;
  model: string;
  /** 1 is the voice's natural pace. */
  speed: number;
}

/** What `inworld-tts-2` and `inworld-tts-2-flash` are for, for the model picker. */
export const INWORLD_MODELS: ModelOption[] = [
  { id: "inworld-tts-2", name: "Realtime TTS-2", note: "best quality and most natural; about 100 ms" },
  { id: "inworld-tts-2-flash", name: "Realtime TTS-2 Flash", note: "fastest and cheapest, about 20 ms; a little less expressive" },
];

/** Why the key cannot work, or undefined if it looks right. Pure, so the settings view can show it. */
export function inworldKeyProblem(key: string | undefined): string | undefined {
  if (!key) return "INWORLD_API_KEY is not set in .env.";
  if (/^basic\s/i.test(key)) return 'INWORLD_API_KEY starts with "Basic "; keep only the Base64 credential after it.';
  if (key.includes(":")) return "INWORLD_API_KEY looks like key_id:secret; paste the Portal's Base64 copy of it instead.";
  if (!/^[A-Za-z0-9+/]+=*$/.test(key)) return "INWORLD_API_KEY is not a Base64 credential; copy it again with the Portal's Base64 button.";
  if (!Buffer.from(key, "base64").toString("utf8").includes(":")) return "INWORLD_API_KEY does not decode to key_id:secret, so it is probably the key ID alone; paste the Base64 credential.";
  return undefined;
}

/** A readable message for an Inworld error code (gRPC status codes, not HTTP). */
export function inworldErrorMessage(code: number | undefined, message: string | undefined): string {
  const said = (message ?? "").trim() || "no detail";
  if (code === 16 || code === 7) return `Inworld refused the key (${said}). Paste the Portal's Base64 credential as INWORLD_API_KEY, unchanged.`;
  if (code === 5) return `Inworld could not find that voice or model (${said}). Pick one from the list in Settings.`;
  if (code === 8) return `Inworld's limit on simultaneous voices for this plan was reached (${said}).`;
  if (code === 3) return `Inworld rejected the request (${said}).`;
  return `Inworld error${code !== undefined ? ` ${code}` : ""}: ${said}`;
}

// ---------------------------------------------------------------------------
// Messages: pure builders and a parser, so the protocol is unit-tested without a network
// ---------------------------------------------------------------------------

export function createContextMessage(contextId: string, voice: InworldVoice): Record<string, unknown> {
  const audio_config: Record<string, unknown> = { audio_encoding: "PCM", sample_rate_hertz: INWORLD_SAMPLE_RATE };
  if (voice.speed !== 1) audio_config.speaking_rate = voice.speed;
  return { context_id: contextId, create: { voice_id: voice.voiceId, model_id: voice.model, audio_config } };
}

/** One piece of text, flushed so it is voiced now rather than when a buffer fills. */
export function sendTextMessage(contextId: string, text: string): Record<string, unknown> {
  return { context_id: contextId, send_text: { text, flush_context: {} } };
}

export function closeContextMessage(contextId: string): Record<string, unknown> {
  return { context_id: contextId, close_context: {} };
}

/** Text that is safe inside Inworld's SSML: a stray "<" or "&" would be taken for markup. */
export function speakableForInworld(text: string): string {
  return text.replace(/</g, " less than ").replace(/&/g, " and ").replace(/\s{2,}/g, " ").trim();
}

/** Inworld's pause tag (SSML `<break>`, honoured over the socket and HTTP alike); nothing for no pause. */
export function inworldBreak(ms: number): string {
  return ms > 0 ? `<break time="${Math.round(ms)}ms" />` : "";
}

/**
 * Pauses inside a sentence, on the same scale as the ones between sentences (`basePauseMs` is the pause
 * after a full stop): about 0.6 of it after a comma, colon or semicolon, all of it after a dash or an
 * ellipsis mid-sentence. Punctuation must be followed by a space, so 1,000 and 3:30 are left alone.
 */
export function withInnerPauses(text: string, basePauseMs: number): string {
  if (basePauseMs <= 0) return text;
  const clause = inworldBreak((SENTENCE_GAP_MS.clause * basePauseMs) / SENTENCE_GAP_MS.default);
  const full = inworldBreak(basePauseMs);
  return text
    .replace(/([,;:])\s+(?=\S)/g, `$1 ${clause} `)
    .replace(/\s*(—|--|…|\.\.\.)\s+(?=\S)/g, (_m, mark: string) => ` ${mark} ${full} `);
}

/** Split text over the per-message limit at word boundaries (a batch is far below it; a runaway sentence is not). */
export function splitForInworld(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export type InworldEvent =
  | { kind: "audio"; contextId?: string; pcm: Buffer }
  | { kind: "created"; contextId?: string }
  | { kind: "closed"; contextId?: string }
  | { kind: "error"; contextId?: string; message: string };

/** One server message as events, in order (a message can carry audio and the context's close together). */
export function parseInworldMessage(raw: string): InworldEvent[] {
  let m: { result?: Record<string, unknown>; error?: { code?: number; message?: string; contextId?: string } };
  try {
    m = JSON.parse(raw);
  } catch {
    return [];
  }
  if (m.error) {
    const contextId = m.error.contextId ?? (m.result?.contextId as string | undefined);
    return [{ kind: "error", contextId, message: inworldErrorMessage(m.error.code, m.error.message) }];
  }
  const r = m.result;
  if (!r) return [];
  const contextId = (r.contextId ?? r.context_id) as string | undefined;
  const events: InworldEvent[] = [];
  if (r.contextCreated) events.push({ kind: "created", contextId });
  const b64 = ((r.audioChunk as { audioContent?: string } | undefined)?.audioContent ?? r.audioContent) as string | undefined;
  if (b64) events.push({ kind: "audio", contextId, pcm: Buffer.from(b64, "base64") });
  if (r.contextClosed) events.push({ kind: "closed", contextId });
  return events;
}

// ---------------------------------------------------------------------------
// The connection: one socket per live session, one context per tutor reply
// ---------------------------------------------------------------------------

/** The part of the WebSocket API this module uses, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
}
export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

const OPEN = 1;

const defaultFactory: SocketFactory = (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike;

/** One tutor reply being voiced. */
export interface InworldReply {
  /** Voice one piece of the reply (whole sentences); it is sent straight away, without waiting for earlier audio. */
  say(text: string): void;
  /** No more text: the context closes once its audio is out, which ends `audio()`. */
  end(): void;
  /** Barge-in: close the context now and stop yielding its audio. */
  cancel(): void;
  /** The reply's audio in order, as whole 16-bit samples at 24 kHz. Throws if Inworld reports a failure. */
  audio(): AsyncGenerator<Buffer, void, void>;
  /** Whether any audio arrived, so a failure before the first sound can be re-voiced in full. */
  readonly heard: boolean;
  /** Everything passed to `say`, in order. */
  readonly said: readonly string[];
}

export class InworldConnection {
  private socket: SocketLike | null = null;
  private opening: Promise<void> | null = null;
  /** Messages sent before the socket was open, in order. */
  private outbox: string[] = [];
  private readonly replies = new Map<string, ReplyStream>();
  private seq = 0;
  private closedByUs = false;

  constructor(private readonly opts: { apiKey?: string; url?: string; socketFactory?: SocketFactory } = {}) {}

  get isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  /** Connect if not connected. Idempotent, so it can be called whenever the student starts talking. */
  open(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    if (this.opening) return this.opening;
    const apiKey = this.opts.apiKey ?? config.inworld.apiKey;
    const problem = inworldKeyProblem(apiKey);
    if (problem) return Promise.reject(new Error(problem));
    this.closedByUs = false;
    const socket = (this.opts.socketFactory ?? defaultFactory)(this.opts.url ?? INWORLD_WS_URL, { Authorization: `Basic ${apiKey}` });
    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      socket.addEventListener("open", () => {
        settled = true;
        this.socket = socket;
        this.opening = null;
        for (const m of this.outbox.splice(0)) socket.send(m);
        resolve();
      });
      socket.addEventListener("message", (ev: { data: unknown }) => {
        for (const e of parseInworldMessage(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString("utf8"))) this.dispatch(e);
      });
      const lost = (why: string): void => {
        if (this.socket === socket) this.socket = null;
        if (!settled) {
          settled = true;
          this.opening = null;
          this.outbox = [];
          reject(new Error(why));
        }
        this.failAll(why);
      };
      socket.addEventListener("error", () => lost("The Inworld voice connection failed (check INWORLD_API_KEY and the network)."));
      socket.addEventListener("close", () => {
        if (!this.closedByUs) lost("The Inworld voice connection closed.");
        else if (this.socket === socket) this.socket = null;
      });
    });
    return this.opening;
  }

  /** Start voicing one tutor reply with this voice. Its create message goes out as soon as the socket is up. */
  reply(voice: InworldVoice): InworldReply {
    const id = `reply-${++this.seq}`;
    const stream = new ReplyStream(id, (m) => this.send(m), () => this.replies.delete(id));
    this.replies.set(id, stream);
    this.send(createContextMessage(id, voice));
    this.open().catch((err: Error) => stream.fail(err.message));
    return stream;
  }

  close(): void {
    this.closedByUs = true;
    this.failAll("closed");
    this.socket?.close();
    this.socket = null;
    this.opening = null;
    this.outbox = [];
  }

  private send(message: Record<string, unknown>): void {
    const text = JSON.stringify(message);
    if (this.isOpen) this.socket!.send(text);
    else this.outbox.push(text);
  }

  private dispatch(e: InworldEvent): void {
    // A context id identifies the reply; an error without one concerns every reply on this connection.
    if (e.contextId) this.replies.get(e.contextId)?.receive(e);
    else if (e.kind === "error") this.failAll(e.message);
    else if (this.replies.size === 1) [...this.replies.values()][0].receive(e);
  }

  private failAll(why: string): void {
    for (const r of [...this.replies.values()]) r.fail(why);
  }
}

class ReplyStream implements InworldReply {
  private readonly events: InworldEvent[] = [];
  private wake: (() => void) | null = null;
  private finished = false;
  private cancelled = false;
  private ended = false;
  private failure: string | undefined;
  private readonly pcm = new Pcm16Stream(INWORLD_SAMPLE_RATE);
  private lastSayAt = 0;
  private lastEventAt = 0;
  private endedAt = 0;
  heard = false;
  readonly said: string[] = [];

  constructor(
    private readonly id: string,
    private readonly send: (m: Record<string, unknown>) => void,
    private readonly forget: () => void,
  ) {}

  say(text: string): void {
    if (this.ended || this.cancelled || this.finished) return;
    for (const piece of splitForInworld(text)) {
      this.said.push(piece);
      this.send(sendTextMessage(this.id, piece));
    }
    this.lastSayAt = Date.now();
  }

  end(): void {
    if (this.ended || this.cancelled || this.finished) return;
    this.ended = true;
    this.send(closeContextMessage(this.id));
    this.endedAt = Date.now();
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    if (!this.ended) {
      this.ended = true;
      this.send(closeContextMessage(this.id));
    }
    this.finish();
  }

  receive(e: InworldEvent): void {
    if (this.finished) return;
    this.lastEventAt = Date.now();
    this.events.push(e);
    this.wake?.();
  }

  fail(why: string): void {
    if (this.finished || this.cancelled) return;
    this.failure = why;
    this.finish();
  }

  /** Text sent since the last reply from the server, or a close not yet confirmed, for too long. */
  private overdue(now: number): boolean {
    const textOwed = this.lastSayAt > this.lastEventAt && now - this.lastSayAt >= SILENCE_TIMEOUT_MS;
    const closeOwed = this.ended && now - Math.max(this.lastEventAt, this.endedAt) >= SILENCE_TIMEOUT_MS;
    return textOwed || closeOwed;
  }

  private finish(): void {
    this.finished = true;
    this.forget();
    this.wake?.();
  }

  async *audio(): AsyncGenerator<Buffer, void, void> {
    for (;;) {
      const e = this.events.shift();
      if (e) {
        if (e.kind === "audio") {
          const out = this.pcm.push(e.pcm);
          if (out.length && !this.cancelled) {
            this.heard = true;
            yield out;
          }
        } else if (e.kind === "error") {
          this.failure = e.message;
          this.finish();
        } else if (e.kind === "closed") {
          this.finish();
          return;
        }
        continue;
      }
      if (this.finished) {
        if (this.failure && !this.cancelled) throw new Error(this.failure);
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        // Do not hang the turn on a server that went quiet while it owed us something. A tutor that is slow
        // to write its next sentence owes nothing, so that wait is not timed.
        const timer = setTimeout(() => {
          if (this.overdue(Date.now())) this.fail("Inworld stopped sending audio.");
          resolve();
        }, SILENCE_TIMEOUT_MS);
        const done = this.wake;
        this.wake = () => {
          clearTimeout(timer);
          done();
        };
      });
      this.wake = null;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP streaming: one-off text (Test this voice) and the fallback when a socket fails mid-reply
// ---------------------------------------------------------------------------

/** Split an NDJSON stream into complete lines; `rest` is the unfinished tail. Pure. */
export function ndjsonLines(pending: string): { lines: string[]; rest: string } {
  const parts = pending.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim()), rest };
}

export interface InworldHttpOptions extends InworldVoice {
  signal?: AbortSignal;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** Voice one piece of text over HTTP streaming; yields whole-sample PCM as it arrives. */
export async function* speakInworldHttp(text: string, opts: InworldHttpOptions): AsyncGenerator<Buffer, void, void> {
  const apiKey = opts.apiKey ?? config.inworld.apiKey;
  const problem = inworldKeyProblem(apiKey);
  if (problem) throw new Error(problem);
  if (!text.trim()) return;
  const audioConfig: Record<string, unknown> = { audioEncoding: "PCM", sampleRateHertz: INWORLD_SAMPLE_RATE };
  if (opts.speed !== 1) audioConfig.speakingRate = opts.speed;
  const res = await (opts.fetchImpl ?? fetch)(`${INWORLD_BASE_URL}/tts/v1/voice:stream`, {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text: text.slice(0, 4000), voiceId: opts.voiceId, modelId: opts.model, audioConfig }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let code: number | undefined;
    let message = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { error?: { code?: number; message?: string }; code?: number; message?: string };
      code = (j.error ?? j).code;
      message = (j.error ?? j).message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(res.status === 401 || res.status === 403 ? inworldErrorMessage(16, message) : inworldErrorMessage(code, `HTTP ${res.status}: ${message}`));
  }
  const pcm = new Pcm16Stream(INWORLD_SAMPLE_RATE);
  const decoder = new TextDecoder();
  let pending = "";
  const reader = res.body.getReader();
  const handle = function* (line: string): Generator<Buffer> {
    for (const e of parseInworldMessage(line)) {
      if (e.kind === "error") throw new Error(e.message);
      if (e.kind === "audio") {
        const out = pcm.push(e.pcm);
        if (out.length) yield out;
      }
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const split = ndjsonLines(pending + decoder.decode(value, { stream: true }));
      pending = split.rest;
      for (const line of split.lines) yield* handle(line);
    }
    pending += decoder.decode();
    if (pending.trim()) yield* handle(pending);
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!pcm.samples) throw new Error("Inworld returned no audio (check the voice and the model in Settings).");
}

// ---------------------------------------------------------------------------
// Workspace lookups for the Settings tab and the readiness check
// ---------------------------------------------------------------------------

/** Map GET /voices/v1/voices. Pure, so it can be unit-tested. */
export function mapInworldVoices(raw: unknown): VoiceOption[] {
  const voices = (raw as { voices?: unknown[] } | null)?.voices ?? [];
  return voices
    .map((v) => v as { voiceId?: string; displayName?: string; description?: string; source?: string; languageCode?: string; gender?: string; tags?: string[] })
    .filter((v) => v.voiceId)
    .map((v) => ({
      id: v.voiceId!,
      name: v.displayName || v.voiceId!,
      description: [v.description, v.gender, v.languageCode, v.source && v.source !== "SYSTEM" ? v.source.toLowerCase() : undefined].filter(Boolean).join(" · ") || undefined,
      // Served by this app (`/api/voice/voice-preview`), which fetches Inworld's free preview and caches it.
      previewUrl: `/api/voice/voice-preview?provider=inworld&voiceId=${encodeURIComponent(v.voiceId!)}`,
      category: v.source,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** English voices the workspace can use (system voices and its own clones), for the voice picker. */
export async function listInworldVoices(apiKey = config.inworld.apiKey, fetchImpl: typeof fetch = fetch): Promise<VoiceOption[]> {
  const problem = inworldKeyProblem(apiKey);
  if (problem) throw new Error(problem);
  const q = new URLSearchParams({ pageSize: "500", filter: 'lang_code="en"' });
  const res = await fetchImpl(`${INWORLD_BASE_URL}/voices/v1/voices?${q}`, { headers: { Authorization: `Basic ${apiKey}` } });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? inworldErrorMessage(16, `HTTP ${res.status}`) : `Inworld voices error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return mapInworldVoices(await res.json());
}

/** Inworld's own sample of a voice (an MP3, not billed), for the voice picker's play button. */
export async function inworldVoicePreview(voiceId: string, model: string, apiKey = config.inworld.apiKey, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const problem = inworldKeyProblem(apiKey);
  if (problem) throw new Error(problem);
  const q = new URLSearchParams({ voice_id: voiceId, model_id: model });
  const res = await fetchImpl(`${INWORLD_BASE_URL}/tts/v1/voice:preview?${q}`, { headers: { Authorization: `Basic ${apiKey}` } });
  if (!res.ok) throw new Error(`Inworld preview error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body = (await res.json()) as { audioContent?: string };
  if (!body.audioContent) throw new Error("Inworld's preview had no audio.");
  return Buffer.from(body.audioContent, "base64");
}

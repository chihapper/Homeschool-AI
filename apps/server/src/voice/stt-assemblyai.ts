/**
 * AssemblyAI realtime speech-to-text (Universal Streaming v3).
 *
 * The browser streams 16 kHz 16-bit mono PCM to our server, which proxies it here; the API key never
 * leaves the server. Transcription happens as the audio arrives and the service signals end-of-turn
 * the moment the speaker stops, so the transcript is ready with no post-speech delay.
 * Ported from the character engine's `orchestrator/adapters/stt_assemblyai_stream.py`, re-checked
 * against the docs on 2026-09-21: the model id is now `universal-3-5-pro`.
 *
 *   const stt = await AssemblyAIStream.connect({...});
 *   stt.sendAudio(pcm) ...
 *   for await (const ev of stt.events()) { ev.kind === "partial" | "final" }
 *   stt.close();
 */

export interface SttEvent {
  kind: "partial" | "final";
  text: string;
}

export interface AssemblyAIStreamOptions {
  apiKey: string;
  sampleRate: number;
  /** e.g. "universal-3-5-pro" */
  model: string;
  /** End-of-turn detection: silence (ms) that ends a turn when the transcriber is confident the thought is complete. */
  minTurnSilenceMs: number;
  /** Silence (ms) that ends a turn regardless of confidence. */
  maxTurnSilenceMs: number;
  /** Words the speaker is likely to say (lesson vocabulary). Improves recognition of rare terms. */
  keyterms?: string[];
  fetchImpl?: typeof fetch;
}

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token?expires_in_seconds=120";
const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";

/** Interpret one JSON message from the service. Pure, so it can be unit-tested. */
export function parseAssemblyMessage(raw: string): { type: "partial" | "final" | "end" | "error" | "ignore"; text?: string; message?: string } {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { type: "ignore" };
  }
  const type = msg.type;
  if (type === "Turn") {
    const text = String(msg.transcript ?? msg.utterance ?? "");
    return msg.end_of_turn ? { type: "final", text } : { type: "partial", text };
  }
  if (type === "Termination" || type === "SessionTerminated") return { type: "end" };
  if (type === "Error" || type === "error" || msg.error) {
    const code = msg.error_code ? ` (${String(msg.error_code)})` : "";
    return { type: "error", message: `${String(msg.error ?? msg.message ?? raw)}${code}`.slice(0, 300) };
  }
  return { type: "ignore" };
}

/** Short-lived token so the socket URL never carries the account key. */
async function mintToken(apiKey: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`AssemblyAI token error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("AssemblyAI token response had no token.");
  return body.token;
}

export class AssemblyAIStream {
  private queue: SttEvent[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  private failure: Error | undefined;
  /** The last error the service reported; fatal ones are followed by a close. */
  private lastError: string | undefined;

  private constructor(private readonly ws: WebSocket) {}

  static async connect(opts: AssemblyAIStreamOptions): Promise<AssemblyAIStream> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const token = await mintToken(opts.apiKey, fetchImpl);
    const url = `${WS_BASE}?sample_rate=${opts.sampleRate}&speech_model=${encodeURIComponent(opts.model)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const stream = new AssemblyAIStream(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("AssemblyAI streaming socket failed to open (check ASSEMBLYAI_API_KEY and network).")), { once: true });
      ws.addEventListener("close", (ev) => reject(new Error(`AssemblyAI streaming socket closed before opening (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`)), { once: true });
    });
    ws.addEventListener("message", (ev) => stream.onMessage(typeof ev.data === "string" ? ev.data : ""));
    // A fatal error (a bad chunk size, an expired token) arrives as a message and is immediately followed
    // by a close. Carry it into the failure so the learner is told why the microphone stopped, instead of
    // just hearing "I didn't catch that".
    ws.addEventListener("close", () => stream.finish(stream.lastError ? new Error(stream.lastError) : undefined));
    ws.addEventListener("error", () => stream.finish(new Error("AssemblyAI streaming socket error.")));
    // Make end-of-turn detection patient enough for a child thinking out loud.
    ws.send(JSON.stringify({ type: "UpdateConfiguration", min_turn_silence: opts.minTurnSilenceMs, max_turn_silence: opts.maxTurnSilenceMs }));
    if (opts.keyterms?.length) ws.send(JSON.stringify({ type: "UpdateConfiguration", keyterms_prompt: opts.keyterms.slice(0, 100) }));
    return stream;
  }

  /** Forward a chunk of 16-bit mono PCM at the configured sample rate. */
  sendAudio(pcm: Buffer | ArrayBuffer): void {
    if (this.ended || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(pcm instanceof Buffer ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : pcm);
    } catch {
      /* socket closing */
    }
  }

  /** Ask the service to end the current turn now (a "Done" button), instead of waiting for silence. */
  forceEndpoint(): void {
    if (this.ended || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "ForceEndpoint" }));
  }

  /** Yields partial transcripts, then one final per turn. Ends when the session terminates. */
  async *events(): AsyncGenerator<SttEvent, void, void> {
    for (;;) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) {
        if (this.failure) throw this.failure;
        return;
      }
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        /* ignore */
      }
    }
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.finish();
  }

  private onMessage(raw: string): void {
    const m = parseAssemblyMessage(raw);
    if (m.type === "partial" || m.type === "final") {
      this.queue.push({ kind: m.type, text: m.text ?? "" });
      this.wake();
    } else if (m.type === "end") {
      this.finish();
    } else if (m.type === "error") {
      // Configuration errors are informational and the session keeps transcribing; fatal ones close the
      // socket next, and the close handler turns this into the failure the caller sees.
      this.lastError = m.message;
      console.warn("[stt] AssemblyAI:", m.message);
    }
  }

  private finish(err?: Error): void {
    if (this.ended) return;
    this.ended = true;
    if (err) this.failure = err;
    this.wake();
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }
}

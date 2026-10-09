/**
 * Browser voice client: one WebSocket to /ws/voice per session, microphone capture streamed as 16 kHz
 * PCM, and gapless playback of the tutor's 24 kHz PCM through an AudioWorklet. The protocol mirrors
 * the character engine's web/app.js; see apps/server/src/voice/live.ts for the message list.
 *
 * States: idle (nobody talking) -> listening (mic open, transcribing) -> thinking (tutor writing) ->
 * speaking (audio playing) -> idle. Clicking Talk while speaking is a barge-in: playback stops at once
 * and the server cancels the rest of the reply.
 */
import type { Phase } from "./api";

export type VoiceState = "connecting" | "idle" | "listening" | "thinking" | "speaking";

export interface ReadyMessage {
  sessionId: string;
  phase: Phase;
  conceptIndex: number;
  stt: "assemblyai" | "none";
  tts: "elevenlabs" | "inworld" | "none";
  voice: string;
  /** The provider's model id. */
  ttsModel?: string;
  micSampleRate: number;
  playbackSampleRate: number;
}

export interface VoiceEvents {
  state: (state: VoiceState) => void;
  ready: (msg: ReadyMessage) => void;
  partial: (text: string) => void;
  transcript: (text: string) => void;
  delta: (text: string) => void;
  /** `sessionId` is the session that answered: after an intake's hand-over, the one that took over. */
  done: (msg: { text: string; phase: Phase; conceptIndex: number; interrupted: boolean; sessionId?: string; timeUp?: boolean }) => void;
  /** An intake finished inside a reply and the sitting went on in another session; this connection now speaks for it. */
  session: (msg: { sessionId: string; kind: string }) => void;
  latency: (marks: Record<string, number>) => void;
  /** Mic input level, 0..1, a few times a second while listening. */
  level: (peak: number) => void;
  info: (message: string) => void;
  error: (message: string) => void;
  closed: () => void;
}

const MIC_RATE = 16_000;
const FRAME_SAMPLES = 1600; // 100 ms at 16 kHz

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const out = new Float32Array(Math.round(input.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private handlers: { [K in keyof VoiceEvents]?: Array<VoiceEvents[K]> } = {};
  private _state: VoiceState = "connecting";
  private playbackRate = 24_000;

  // playback
  private audioCtx: AudioContext | null = null;
  private player: AudioWorkletNode | null = null;
  private carry = new Uint8Array(0);
  private audioEnded = true;

  // capture
  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private capActive = false;
  private capBuf = new Float32Array(0);
  private levelAt = 0;

  /** The last `ready` message, for a listener that attaches after it arrived. */
  private _ready: ReadyMessage | null = null;
  private connecting: Promise<void> | null = null;

  constructor(readonly sessionId: string) {}

  get state(): VoiceState {
    return this._state;
  }

  get ready(): ReadyMessage | null {
    return this._ready;
  }

  on<K extends keyof VoiceEvents>(event: K, handler: VoiceEvents[K]): () => void {
    const list = (this.handlers[event] ??= []) as Array<VoiceEvents[K]>;
    list.push(handler);
    return () => {
      this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== handler) as never;
    };
  }

  private emit<K extends keyof VoiceEvents>(event: K, ...args: Parameters<VoiceEvents[K]>): void {
    for (const h of this.handlers[event] ?? []) (h as (...a: unknown[]) => void)(...args);
  }

  private setState(s: VoiceState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit("state", s);
  }

  /**
   * Create the speaker's audio context. Browsers only let a page start audio after the person has clicked, so
   * the page calls this from its button handler; connect() can then run from wherever the conversation is shown.
   */
  prepare(): void {
    if (this.audioCtx) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      this.audioCtx = new Ctor({ sampleRate: this.playbackRate });
    } catch {
      this.audioCtx = new Ctor(); // browser refused the rate; we resample
    }
  }

  /** Open the socket and the speaker. A second call joins the first: React mounts a component twice in development. */
  connect(): Promise<void> {
    return (this.connecting ??= this.open());
  }

  private async open(): Promise<void> {
    await this.ensurePlayback();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/voice?sessionId=${encodeURIComponent(this.sessionId)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.playFrame(ev.data);
        return;
      }
      this.handle(JSON.parse(ev.data as string));
    };
    ws.onclose = () => {
      this.stopCapture();
      this.ws = null;
      this.emit("closed");
    };
    ws.onerror = () => this.emit("error", "Voice connection error.");
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.addEventListener("error", () => reject(new Error("Could not open the voice connection.")), { once: true });
    });
  }

  private handle(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ready":
        this.playbackRate = Number(msg.playbackSampleRate) || 24_000;
        this._ready = msg as unknown as ReadyMessage;
        this.setState("idle");
        this.emit("ready", this._ready);
        break;
      case "listening":
        this.setState("listening");
        break;
      case "partial_transcript":
        this.emit("partial", String(msg.text ?? ""));
        break;
      case "transcript":
        this.emit("transcript", String(msg.text ?? ""));
        break;
      case "mic_ended":
        this.stopCapture();
        if (this._state === "listening") this.setState("idle");
        break;
      case "assistant_start":
        this.setState("thinking");
        break;
      case "assistant_delta":
        this.emit("delta", String(msg.text ?? ""));
        break;
      case "audio_start":
        this.resetPlayback();
        this.audioEnded = false;
        this.setState("speaking");
        break;
      case "audio_end":
        this.audioEnded = true; // playback drains on its own; the worklet tells us when
        this.player?.port.postMessage({ type: "status" }); // unless it already has
        break;
      case "assistant_done":
        this.emit("done", { text: String(msg.text ?? ""), phase: msg.phase as Phase, conceptIndex: Number(msg.conceptIndex ?? 0), timeUp: Boolean(msg.timeUp), interrupted: Boolean(msg.interrupted), sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined });
        if (this._state === "thinking") this.setState("idle"); // no audio came (text-only)
        break;
      case "session":
        this.emit("session", { sessionId: String(msg.sessionId ?? ""), kind: String(msg.kind ?? "lesson") });
        break;
      case "latency":
        this.emit("latency", (msg.marks as Record<string, number>) ?? {});
        break;
      case "info":
        this.emit("info", String(msg.message ?? ""));
        break;
      case "error":
        this.emit("error", String(msg.message ?? "Unknown error"));
        if (this._state === "listening") this.setState("idle");
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- playback
  private async ensurePlayback(): Promise<void> {
    this.prepare();
    const ctx = this.audioCtx as AudioContext;
    if (!this.player) {
      await ctx.audioWorklet.addModule("/pcm-player.js");
      this.player = new AudioWorkletNode(ctx, "pcm-player");
      this.player.port.onmessage = (e) => {
        if (e.data?.type === "drained" && this.audioEnded && this._state === "speaking") this.setState("idle");
      };
      this.player.connect(ctx.destination);
    }
    if (ctx.state === "suspended") await ctx.resume();
  }

  private resetPlayback(): void {
    this.carry = new Uint8Array(0);
    if (!this.player) return;
    this.player.port.postMessage({ type: "reset" });
    // Prime with a short silence so the first real samples are never at the very edge of startup.
    const pad = new Float32Array(Math.round((this.audioCtx?.sampleRate ?? this.playbackRate) * 0.08));
    this.player.port.postMessage(pad, [pad.buffer]);
  }

  private playFrame(buffer: ArrayBuffer): void {
    if (!this.player || !this.audioCtx) return;
    let bytes = new Uint8Array(buffer);
    if (this.carry.length) {
      const merged = new Uint8Array(this.carry.length + bytes.length);
      merged.set(this.carry, 0);
      merged.set(bytes, this.carry.length);
      bytes = merged;
      this.carry = new Uint8Array(0);
    }
    if (bytes.length % 2 !== 0) {
      this.carry = bytes.slice(bytes.length - 1);
      bytes = bytes.slice(0, bytes.length - 1);
    }
    if (!bytes.length) return;
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    let f32: Float32Array = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f32[i] = samples[i] / 32768;
    if (this.audioCtx.sampleRate !== this.playbackRate) f32 = resampleLinear(f32, this.playbackRate, this.audioCtx.sampleRate);
    this.player.port.postMessage(f32, [f32.buffer as ArrayBuffer]);
  }

  // ----------------------------------------------------------------- capture
  /** Open the microphone and start streaming. While the tutor is speaking this is a barge-in. */
  async startMic(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.capActive) return;
    if (this._state === "speaking" || this._state === "thinking") {
      this.resetPlayback();
      this.audioEnded = true;
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.emit("error", "Microphone access was denied.");
      return;
    }
    this.captureCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    await this.captureCtx.audioWorklet.addModule("/mic-capture.js");
    const src = this.captureCtx.createMediaStreamSource(this.micStream);
    this.captureNode = new AudioWorkletNode(this.captureCtx, "mic-capture");
    src.connect(this.captureNode);
    // Keep the graph running without audibly playing the mic back.
    const sink = this.captureCtx.createGain();
    sink.gain.value = 0;
    this.captureNode.connect(sink);
    sink.connect(this.captureCtx.destination);
    this.capBuf = new Float32Array(0);
    this.capActive = true;
    this.captureNode.port.onmessage = (e) => this.onMicChunk(e.data as Float32Array);
    this.ws.send(JSON.stringify({ type: "mic_start" }));
    this.setState("listening");
  }

  private onMicChunk(frame: Float32Array): void {
    if (!this.capActive || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.captureCtx) return;
    const down = resampleLinear(frame, this.captureCtx.sampleRate, MIC_RATE);
    const merged = new Float32Array(this.capBuf.length + down.length);
    merged.set(this.capBuf);
    merged.set(down, this.capBuf.length);
    this.capBuf = merged;
    let peak = 0;
    while (this.capBuf.length >= FRAME_SAMPLES) {
      const chunk = this.capBuf.subarray(0, FRAME_SAMPLES);
      const i16 = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const v = Math.max(-1, Math.min(1, chunk[i]));
        const a = Math.abs(v);
        if (a > peak) peak = a;
        i16[i] = v < 0 ? v * 32768 : v * 32767;
      }
      this.ws.send(i16.buffer);
      this.capBuf = this.capBuf.slice(FRAME_SAMPLES);
    }
    const now = performance.now();
    if (now - this.levelAt > 120) {
      this.levelAt = now;
      this.emit("level", peak);
    }
  }

  private stopCapture(): void {
    this.capActive = false;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.captureCtx?.close().catch(() => {});
    this.captureCtx = null;
    this.captureNode = null;
    this.micStream = null;
    this.capBuf = new Float32Array(0);
    this.emit("level", 0);
  }

  /** Cancel listening without sending what was said. */
  stopMic(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "mic_stop" }));
    this.stopCapture();
    if (this._state === "listening") this.setState("idle");
  }

  /** End the turn now instead of waiting for the silence detector. */
  forceEnd(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "force_end" }));
  }

  /** Typed fallback while in voice mode; the tutor still answers out loud. */
  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "text", text }));
  }

  interrupt(): void {
    this.resetPlayback();
    this.audioEnded = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "interrupt" }));
    this.setState("idle");
  }

  close(): void {
    this.stopCapture();
    this.ws?.close();
    this.ws = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.player = null;
  }
}

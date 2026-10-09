/**
 * Browser voice: one WebSocket per session. The student talks into the web app; we transcribe as they
 * speak, run the tutor turn the instant they stop, and stream the spoken reply back sentence by
 * sentence while the model is still writing the next one. No public tunnel needed.
 *
 * Protocol (mirrors the character engine's /ws):
 *   browser -> server  JSON  {type:"mic_start"} {type:"mic_stop"} {type:"force_end"} {type:"text", text} {type:"interrupt"}
 *                      binary: 16 kHz 16-bit mono PCM frames while the mic is open
 *   server -> browser  JSON  ready | listening | partial_transcript | transcript | mic_ended | assistant_start |
 *                            assistant_delta | assistant_done | audio_start | audio_end | latency | info | error
 *                      binary: 24 kHz 16-bit mono PCM frames between audio_start and audio_end
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { activeTtsProvider, config, ttsModelLabel, ttsVoiceLabel } from "../config.js";
import type { Course } from "../domain/types.js";
import { annotateLastTurn, respond } from "../orchestrator/session.js";
import { courses, sessions } from "../store/index.js";
import { gapAfter, scaledGapAfter, silencePcm16 } from "./pcm.js";
import { SentenceChunker, type Segment } from "./sentence-chunker.js";
import { AssemblyAIStream } from "./stt-assemblyai.js";
import { ELEVEN_SAMPLE_RATE, freshRequestIds, rememberRequest, speakElevenLabs, type StitchedRequest } from "./tts-elevenlabs.js";
import { InworldConnection, inworldBreak, speakableForInworld, speakInworldHttp, withInnerPauses, type InworldReply } from "./tts-inworld.js";

/** A tiny async queue: the text producer pushes sentences, the speech consumer awaits them. */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: T) => void> = [];
  push(v: T): void {
    const w = this.waiters.shift();
    if (w) w(v);
    else this.items.push(v);
  }
  next(): Promise<T> {
    const v = this.items.shift();
    if (v !== undefined) return Promise.resolve(v);
    return new Promise<T>((r) => this.waiters.push(r));
  }
  /** Whatever is already waiting, without waiting for more. */
  tryNext(): T | undefined {
    return this.items.shift();
  }
}

/** Caps on one speech request: enough to keep cadence across a run of sentences, small enough to start soon. */
export const BATCH_LIMITS = { maxSentences: 4, maxChars: 420 } as const;

/**
 * Gather the sentences already waiting behind `first` into one batch (never waiting for more), so the
 * synthesizer keeps its cadence across them. The first sentence of a reply typically goes alone, because
 * nothing else has been written yet; later batches carry whatever the model produced meanwhile.
 * `tryNext` returns undefined when the queue is momentarily empty and null when the reply is finished.
 */
export function takeBatch(first: Segment, tryNext: () => Segment | null | undefined, limits = BATCH_LIMITS): { batch: Segment[]; endSeen: boolean } {
  const batch = [first];
  let chars = first.text.length;
  while (batch.length < limits.maxSentences && chars < limits.maxChars) {
    const next = tryNext();
    if (next === undefined) break;
    if (next === null) return { batch, endSeen: true };
    batch.push(next);
    chars += next.text.length;
  }
  return { batch, endSeen: false };
}

/** Markdown and stray symbols the voice skill forbids anyway; belt and braces before the synthesizer. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[*_`#>]+/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Lesson vocabulary the transcriber should expect: concept names plus long words from the key facts. */
export function keytermsFor(course: Course | undefined): string[] {
  if (!course) return [];
  const terms = new Set<string>();
  for (const c of course.concepts) {
    terms.add(c.name);
    for (const w of c.keyFacts.join(" ").match(/\b[A-Za-z]{7,}\b/g) ?? []) terms.add(w.toLowerCase());
  }
  return [...terms].slice(0, 60);
}

interface Conn {
  sessionId: string;
  socket: WebSocket;
  course: Course | undefined;
  stt: AssemblyAIStream | null;
  sttConnecting: boolean;
  sttCancelled: boolean;
  /** Mic frames that arrived while the transcriber was still connecting (the first word must not be lost). */
  pendingAudio: Buffer[];
  /**
   * The turn in flight. `speaking` settles when the learner has heard everything (the reply is composed
   * and its audio sent); `done` runs on past it through the tutor's reflect pass. A barge-in waits only on
   * `speaking` — the note-taking takes seconds and must never hold the microphone shut.
   */
  turn: { abort: AbortController; speaking: Promise<void>; done: Promise<void> } | null;
  /** The learner has asked to talk: buffer their audio even before the transcriber is connected. */
  micWanted: boolean;
  /** ElevenLabs requests that played to the end, for stitching; only valid for the voice and model they were made with. */
  eleven: { key: string; requests: StitchedRequest[] };
  /** Inworld's socket for this session, opened when the student starts talking; each reply is one context on it. */
  inworld: InworldConnection | null;
  /** When the transcriber started listening for the current student turn (performance.now()), for the meter. */
  listenStartedAt: number;
  closed: boolean;
}

/** A batch's sentences as one text, cleaned for speech, so the voice reads them as a run. */
export function batchText(batch: Segment[]): string {
  return batch.map((s) => cleanForSpeech(s.text)).filter(Boolean).join(" ");
}

/**
 * A batch for Inworld: each sentence cleaned for speech, with a pause in front of it sized by how the sentence
 * before it ended (a question more than a full stop, a paragraph most) and pauses at its own commas, dashes
 * and colons, all scaled by the pause set in Settings. `before` is the last sentence already sent in this
 * reply, so a reply never opens on a pause.
 */
export function inworldText(batch: Segment[], before: Segment | undefined, basePauseMs: number): string {
  const parts: string[] = [];
  let prev = before;
  for (const seg of batch) {
    const text = withInnerPauses(speakableForInworld(cleanForSpeech(seg.text)), basePauseMs);
    if (!text) continue;
    const pause = prev ? inworldBreak(scaledGapAfter(prev.text, prev.paraBreak, basePauseMs)) : "";
    parts.push(pause ? `${pause} ${text}` : text);
    prev = seg;
  }
  return parts.join(" ");
}

export function registerLiveVoiceRoutes(app: FastifyInstance): void {
  app.get("/ws/voice", { websocket: true }, (socket: WebSocket, req: FastifyRequest<{ Querystring: { sessionId?: string } }>) => {
    const sessionId = req.query.sessionId ?? "";
    const send = (payload: Record<string, unknown>): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    const sendAudio = (pcm: Buffer): void => {
      if (socket.readyState === socket.OPEN && pcm.length) socket.send(pcm, { binary: true });
    };

    const session = sessions.get(sessionId);
    if (!session) {
      send({ type: "error", message: `Unknown session ${sessionId}` });
      socket.close();
      return;
    }
    const conn: Conn = {
      sessionId,
      socket,
      course: session.courseId ? courses.get(session.courseId) : undefined,
      stt: null,
      sttConnecting: false,
      sttCancelled: false,
      pendingAudio: [],
      turn: null,
      micWanted: false,
      eleven: { key: "", requests: [] },
      inworld: null,
      listenStartedAt: 0,
      closed: false,
    };
    const log = req.log;
    const inworldConn = (): InworldConnection => (conn.inworld ??= new InworldConnection());

    send({
      type: "ready",
      sessionId,
      phase: session.phase,
      conceptIndex: session.conceptIndex,
      stt: config.voice.sttProvider === "assemblyai" && config.voice.assemblyAiKey ? "assemblyai" : "none",
      // Every provider delivers 24 kHz, so a provider switch in Settings applies from the next reply without reconnecting.
      tts: activeTtsProvider(),
      voice: ttsVoiceLabel(),
      ttsModel: ttsModelLabel(),
      micSampleRate: config.voice.micSampleRate,
      playbackSampleRate: config.voice.playbackSampleRate,
    });

    // ---- the tutor turn: text streams to the browser and, sentence by sentence, to the synthesizer ----
    const runTurn = async (text: string, t0: number, transcriptMs: number, sttSeconds = 0): Promise<void> => {
      if (conn.turn) await interrupt();
      const abort = new AbortController();
      const ms = (): number => Math.round(performance.now() - t0);
      const marks: Record<string, number> = { transcript_ready: transcriptMs };
      // Read once per turn: a reply is never voiced half by one provider and half by the other.
      const provider = activeTtsProvider();
      const speak = provider !== "none";

      // Resolved once the learner has heard everything; see Conn.turn.
      let spoken = (): void => {};
      const speaking = new Promise<void>((resolve) => {
        spoken = resolve;
      });

      const done = (async () => {
        send({ type: "assistant_start" });
        const chunker = new SentenceChunker();
        const q = new AsyncQueue<Segment | null>();
        let fullText = "";
        let audioStarted = false;
        let ttsErrorShown = false;
        /** Characters sent to the voice this turn, for the meter. */
        let ttsChars = 0;
        /** The tutor's bookkeeping pass, started once the reply was composed. */
        let reflection: Promise<unknown> | undefined;
        /** The reply closed the session on the parent's clock; the browser ends the session once the audio is out. */
        let timeUp = false;

        const producer = (async () => {
          try {
            const gen = respond(conn.sessionId, text, undefined, abort.signal);
            let r = await gen.next();
            while (!r.done) {
              if (marks.llm_first_token === undefined) marks.llm_first_token = ms();
              fullText += r.value;
              send({ type: "assistant_delta", text: r.value });
              for (const seg of chunker.push(r.value)) q.push(seg);
              r = await gen.next();
            }
            const tail = chunker.flush();
            if (tail) q.push(tail);
            // Hand the reflect pass to the turn so it can report when the notes landed; the learner is
            // listening to the reply while it runs.
            reflection = r.value.reflection;
            timeUp = Boolean(r.value.timeUp);
            return r.value.session;
          } finally {
            q.push(null);
          }
        })();

        const consumer = (async () => {
          const batching = config.ttsBatchSentences;
          let endSeen = false;
          const startAudio = (): void => {
            if (audioStarted) return;
            audioStarted = true;
            marks.first_audio = ms();
            send({ type: "audio_start" });
          };
          // Inworld voices the whole reply as one context: each batch goes in the moment it is written while
          // the audio streams back, so the voice never starts cold between batches.
          const inworldVoice = { voiceId: config.inworldVoiceId, model: config.inworldModel, speed: config.inworldSpeed };
          const inworldPause = config.inworldPauseMs;
          /** The last sentence sent in this reply, which sizes the pause before the next one. */
          let lastSent: Segment | undefined;
          let stream: { reply: InworldReply; forwarding: Promise<void> } | undefined;
          let streamFailure: Error | undefined;
          let recovered = false;
          const speakOverHttp = async (text: string): Promise<void> => {
            for await (const pcm of speakInworldHttp(text, { ...inworldVoice, signal: abort.signal })) {
              startAudio();
              sendAudio(pcm);
            }
          };
          // The context failed: the rest of the reply goes over HTTP, so the tutor never goes silent. If nothing
          // was heard yet, the text already sent is voiced again; after that we cannot tell what was heard.
          const recover = async (): Promise<void> => {
            if (recovered || !stream) return;
            recovered = true;
            log.warn({ err: streamFailure }, "Inworld socket failed mid-reply; voicing the rest over HTTP");
            if (!stream.reply.heard && stream.reply.said.length) await speakOverHttp(stream.reply.said.join(" "));
          };
          while (!endSeen) {
            const first = await q.next();
            if (first === null) break;
            let batch: Segment[] = [first];
            if (batching) ({ batch, endSeen } = takeBatch(first, () => q.tryNext()));
            if (!speak || abort.signal.aborted) continue; // drain
            try {
              if (provider === "inworld") {
                const text = inworldText(batch, lastSent, inworldPause);
                if (!text) continue;
                ttsChars += batchText(batch).length;
                lastSent = batch[batch.length - 1];
                marks.tts_requests = (marks.tts_requests ?? 0) + 1;
                if (streamFailure) {
                  await recover();
                  await speakOverHttp(text);
                  continue;
                }
                if (!stream) {
                  const reply = inworldConn().reply(inworldVoice);
                  abort.signal.addEventListener("abort", () => reply.cancel(), { once: true });
                  const forwarding = (async () => {
                    for await (const pcm of reply.audio()) {
                      startAudio();
                      sendAudio(pcm);
                    }
                  })().catch((err: unknown) => {
                    streamFailure = err instanceof Error ? err : new Error(String(err));
                  });
                  stream = { reply, forwarding };
                }
                stream.reply.say(text);
                continue;
              }
              if (provider === "elevenlabs") {
                const text = batchText(batch);
                if (!text) continue;
                ttsChars += text.length;
                // Stitching ids only mean something for the voice and model that produced them.
                const key = `${config.elevenVoiceId}|${config.elevenModel}`;
                if (conn.eleven.key !== key) conn.eleven = { key, requests: [] };
                marks.tts_requests = (marks.tts_requests ?? 0) + 1;
                log.debug({ sentences: batch.length, chars: text.length }, "tts request (elevenlabs)");
                let requestId: string | undefined;
                const opts = { voiceId: config.elevenVoiceId, model: config.elevenModel, stability: config.elevenStability, speed: config.elevenSpeed, previousRequestIds: freshRequestIds(conn.eleven.requests), signal: abort.signal };
                for await (const chunk of speakElevenLabs(text, opts)) {
                  requestId = chunk.requestId ?? requestId;
                  startAudio();
                  sendAudio(chunk.pcm);
                }
                if (!abort.signal.aborted) {
                  // Played to the end, so the next request may be stitched to it.
                  if (requestId) conn.eleven.requests = rememberRequest(conn.eleven.requests, requestId);
                  // A breath before the next request; within one request the voice paces itself.
                  const last = batch[batch.length - 1];
                  sendAudio(silencePcm16(gapAfter(last.text, last.paraBreak), ELEVEN_SAMPLE_RATE));
                }
                continue;
              }
            } catch (err) {
              if (abort.signal.aborted) break;
              log.warn({ err }, "TTS failed on a sentence; skipping it");
              if (!ttsErrorShown) {
                ttsErrorShown = true;
                send({ type: "error", message: `Text-to-speech failed: ${err instanceof Error ? err.message : String(err)}` });
              }
            }
          }
          if (stream) {
            // No more text: close the context and let its last audio play out.
            if (!abort.signal.aborted) stream.reply.end();
            await stream.forwarding;
            if (streamFailure && !abort.signal.aborted) {
              try {
                await recover();
              } catch (err) {
                log.warn({ err }, "Inworld fallback failed");
                if (!ttsErrorShown) {
                  ttsErrorShown = true;
                  send({ type: "error", message: `Text-to-speech failed: ${err instanceof Error ? err.message : String(err)}` });
                }
              }
            }
          }
        })();

        let phase: typeof session.phase = session.phase;
        let conceptIndex = session.conceptIndex;
        try {
          const s = await producer;
          phase = s.phase;
          conceptIndex = s.conceptIndex;
          // An intake finished in this reply and the sitting went on in another session: this connection follows it.
          if (s.id !== conn.sessionId) {
            conn.sessionId = s.id;
            conn.course = s.courseId ? courses.get(s.courseId) : undefined;
            send({ type: "session", sessionId: s.id, kind: s.kind ?? "lesson", phase: s.phase });
          }
        } catch (err) {
          if (!abort.signal.aborted) {
            log.error({ err }, "voice turn failed");
            send({ type: "error", message: `The tutor could not answer: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        await consumer;
        if (audioStarted) send({ type: "audio_end" });
        marks.turn_complete = ms();
        // Everything the learner hears has now been sent: a barge-in from here on must not wait for us.
        spoken();
        // The notes and any phase change land after the audio: report the settled state to the panel.
        if (reflection) {
          await reflection.catch(() => {});
          marks.reflect_done = ms();
          try {
            const s = sessions.require(conn.sessionId);
            phase = s.phase;
            conceptIndex = s.conceptIndex;
          } catch {
            /* session deleted mid-turn */
          }
        }
        const interrupted = abort.signal.aborted;
        send({ type: "assistant_done", text: fullText, phase, conceptIndex, interrupted, sessionId: conn.sessionId, timeUp });
        send({ type: "latency", marks });
        if (!interrupted && fullText) {
          try {
            annotateLastTurn(conn.sessionId, {
              transcriptMs,
              ...(audioStarted ? { firstAudioMs: marks.first_audio } : {}),
              // The meter: what the voice spoke and the transcriber heard this turn.
              ...(ttsChars ? { ttsChars, ttsProvider: provider, ttsModel: provider === "elevenlabs" ? config.elevenModel : config.inworldModel } : {}),
              ...(sttSeconds ? { sttSeconds: Math.round(sttSeconds * 10) / 10 } : {}),
            });
          } catch (err) {
            log.warn({ err }, "could not annotate turn latency");
          }
        }
      })();

      conn.turn = { abort, speaking, done };
      await done.finally(() => {
        spoken(); // in case the turn threw before the audio finished
        if (conn.turn?.abort === abort) conn.turn = null;
      });
    };

    /** Barge-in: stop the model and the synthesizer; what was already spoken stays in the transcript. */
    const interrupt = async (): Promise<void> => {
      const t = conn.turn;
      if (!t) return;
      t.abort.abort();
      // Only as far as the speaking: the reflect pass finishes on its own time, and the learner is already
      // talking. Waiting for `done` here kept the microphone shut for the several seconds the tutor spent
      // taking its notes, and the learner's first words were dropped (reported 2026-09-23).
      await t.speaking.catch(() => {});
    };

    // ---- listening: proxy mic audio to the transcriber; on end-of-turn, run the tutor ----
    const stopListening = (): void => {
      conn.sttCancelled = true;
      conn.micWanted = false;
      conn.pendingAudio = [];
      conn.stt?.close();
      conn.stt = null;
    };

    const readTranscript = async (stt: AssemblyAIStream): Promise<void> => {
      let finalText: string | null = null;
      let endOfSpeechAt = 0;
      try {
        for await (const ev of stt.events()) {
          if (ev.kind === "partial") {
            if (ev.text) send({ type: "partial_transcript", text: ev.text });
          } else {
            finalText = ev.text;
            endOfSpeechAt = performance.now();
            break;
          }
        }
      } catch (err) {
        send({ type: "error", message: `Transcription stream error: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        stt.close();
        if (conn.stt === stt) conn.stt = null;
      }
      send({ type: "mic_ended" });
      if (conn.sttCancelled || conn.closed) return;
      if (finalText && finalText.trim()) {
        send({ type: "transcript", text: finalText });
        // Streaming transcription: the transcript is ready at end of speech, so transcriptMs is ~0.
        await runTurn(finalText, endOfSpeechAt, 0, conn.listenStartedAt ? (endOfSpeechAt - conn.listenStartedAt) / 1000 : 0);
      } else {
        send({ type: "info", message: "I didn't catch that. Try again?" });
      }
    };

    const startListening = async (): Promise<void> => {
      if (conn.stt || conn.sttConnecting) return;
      if (config.voice.sttProvider !== "assemblyai" || !config.voice.assemblyAiKey) {
        send({ type: "error", message: "Speech-to-text is not configured (ASSEMBLYAI_API_KEY). Type instead." });
        send({ type: "mic_ended" });
        return;
      }
      conn.sttConnecting = true;
      conn.sttCancelled = false;
      conn.listenStartedAt = performance.now();
      try {
        const stt = await AssemblyAIStream.connect({
          apiKey: config.voice.assemblyAiKey,
          sampleRate: config.voice.micSampleRate,
          model: config.voice.assemblyAiModel,
          minTurnSilenceMs: config.sttMinSilenceMs,
          maxTurnSilenceMs: config.sttMaxSilenceMs,
          keyterms: keytermsFor(conn.course),
        });
        if (conn.closed || conn.sttCancelled) {
          stt.close();
          return;
        }
        conn.stt = stt;
        for (const b of conn.pendingAudio) stt.sendAudio(b);
        conn.pendingAudio = [];
        send({ type: "listening" });
        void readTranscript(stt);
      } catch (err) {
        log.error({ err }, "could not start transcription");
        send({ type: "error", message: `Couldn't start the microphone stream: ${err instanceof Error ? err.message : String(err)}` });
        send({ type: "mic_ended" });
      } finally {
        conn.sttConnecting = false;
      }
    };

    // ---- socket events ----
    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
        // Buffer from the moment the learner asks to talk, not just while the transcriber is connecting:
        // on a barge-in their first words arrive before the previous turn has finished letting go.
        if (conn.stt) conn.stt.sendAudio(buf);
        else if ((conn.micWanted || conn.sttConnecting) && conn.pendingAudio.length < 300) conn.pendingAudio.push(buf); // up to ~30 s
        return;
      }
      let msg: { type?: string; text?: string };
      try {
        msg = JSON.parse(data.toString()) as { type?: string; text?: string };
      } catch {
        return;
      }
      switch (msg.type) {
        case "mic_start":
          // Set before awaiting anything, so audio arriving during the barge-in is kept rather than dropped.
          conn.micWanted = true;
          // The student is about to speak: connect the voice now, so the reply never waits on its handshake.
          if (activeTtsProvider() === "inworld") inworldConn().open().catch((err: unknown) => log.warn({ err }, "Inworld pre-connect failed"));
          void (async () => {
            await interrupt(); // barge-in: the student started talking over the tutor
            if (conn.micWanted) await startListening();
          })();
          break;
        case "mic_stop":
          stopListening();
          break;
        case "force_end":
          conn.stt?.forceEndpoint();
          break;
        case "interrupt":
          void interrupt();
          break;
        case "text": {
          const text = (msg.text ?? "").trim();
          if (!text) return;
          void (async () => {
            await interrupt();
            stopListening();
            send({ type: "transcript", text });
            await runTurn(text, performance.now(), 0);
          })();
          break;
        }
        default:
          break;
      }
    });
    socket.on("close", () => {
      conn.closed = true;
      stopListening();
      void interrupt();
      conn.inworld?.close();
      log.info({ sessionId }, "voice socket closed");
    });
    socket.on("error", (err: Error) => log.warn({ err }, "voice socket error"));

    // The tutor speaks first on a fresh session, or answers a student line that never got a reply.
    const last = session.transcript.at(-1);
    if (!session.transcript.length || last?.role === "user") void runTurn("", performance.now(), 0);
  });
}

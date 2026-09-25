import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeContextMessage,
  createContextMessage,
  InworldConnection,
  inworldBreak,
  inworldErrorMessage,
  inworldKeyProblem,
  mapInworldVoices,
  ndjsonLines,
  parseInworldMessage,
  sendTextMessage,
  speakableForInworld,
  speakInworldHttp,
  splitForInworld,
  withInnerPauses,
  type SocketLike,
} from "../src/voice/tts-inworld.js";
import { inworldText } from "../src/voice/live.js";
import type { Segment } from "../src/voice/sentence-chunker.js";

const KEY = Buffer.from("key-id:secret-part").toString("base64");
const voice = { voiceId: "Ashley", model: "inworld-tts-2", speed: 1 };

/** A WebSocket stand-in: records what the client sent and lets the test play the server. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, Array<(ev?: unknown) => void>> = {};
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  addEventListener(type: string, listener: (ev?: never) => void): void {
    (this.listeners[type] ??= []).push(listener as (ev?: unknown) => void);
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error("sent before open");
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  emit(type: string, ev?: unknown): void {
    for (const l of this.listeners[type] ?? []) l(ev);
  }
  accept(): void {
    this.readyState = 1;
    this.emit("open");
  }
  serverSays(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }
}

function connection(): { conn: InworldConnection; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const conn = new InworldConnection({ apiKey: KEY, socketFactory: (url, headers) => (sockets.push(new FakeSocket(url, headers)), sockets.at(-1)!) });
  return { conn, sockets };
}

const audio = (contextId: string, bytes: number[]) => ({ result: { contextId, audioChunk: { audioContent: Buffer.from(bytes).toString("base64") } } });

async function collect(gen: AsyncGenerator<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const b of gen) parts.push(b);
  return Buffer.concat(parts);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Inworld key and errors", () => {
  it("accepts the Portal's Base64 credential and explains the usual mistakes", () => {
    expect(inworldKeyProblem(KEY)).toBeUndefined();
    expect(inworldKeyProblem(undefined)).toMatch(/not set/);
    expect(inworldKeyProblem(`Basic ${KEY}`)).toMatch(/Basic/);
    expect(inworldKeyProblem("key-id:secret-part")).toMatch(/Base64 copy/);
    expect(inworldKeyProblem("not base64!")).toMatch(/not a Base64 credential/);
    expect(inworldKeyProblem(Buffer.from("just-the-key-id").toString("base64"))).toMatch(/key ID alone/);
  });

  it("turns gRPC codes into advice", () => {
    expect(inworldErrorMessage(16, "bad credentials")).toMatch(/refused the key/);
    expect(inworldErrorMessage(5, "Voice not found")).toMatch(/Pick one from the list/);
    expect(inworldErrorMessage(8, "maximum allowed number of active WebSocket TTS contexts")).toMatch(/limit/);
    expect(inworldErrorMessage(undefined, "")).toBe("Inworld error: no detail");
  });
});

describe("Inworld messages", () => {
  it("builds a context for raw 24 kHz PCM, sending the speaking rate only when it is not the default", () => {
    expect(createContextMessage("reply-1", voice)).toEqual({
      context_id: "reply-1",
      create: { voice_id: "Ashley", model_id: "inworld-tts-2", audio_config: { audio_encoding: "PCM", sample_rate_hertz: 24000 } },
    });
    expect((createContextMessage("r", { ...voice, speed: 1.1 }).create as { audio_config: Record<string, unknown> }).audio_config.speaking_rate).toBe(1.1);
    expect(sendTextMessage("r", "Hi there.")).toEqual({ context_id: "r", send_text: { text: "Hi there.", flush_context: {} } });
    expect(closeContextMessage("r")).toEqual({ context_id: "r", close_context: {} });
  });

  it("splits text over the per-message limit at word boundaries", () => {
    const long = Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ");
    const pieces = splitForInworld(long, 2000);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 2000)).toBe(true);
    expect(pieces.join(" ")).toBe(long);
    expect(splitForInworld("  Short one.  ")).toEqual(["Short one."]);
  });

  it("reads audio, the close that can share its message, and errors", () => {
    expect(parseInworldMessage(JSON.stringify(audio("r", [1, 0, 2, 0])))).toEqual([{ kind: "audio", contextId: "r", pcm: Buffer.from([1, 0, 2, 0]) }]);
    const both = parseInworldMessage(JSON.stringify({ result: { contextId: "r", audioChunk: { audioContent: Buffer.from([9, 9]).toString("base64") }, contextClosed: {} } }));
    expect(both.map((e) => e.kind)).toEqual(["audio", "closed"]);
    expect(parseInworldMessage(JSON.stringify({ error: { code: 5, message: "Voice not found" } }))).toEqual([{ kind: "error", contextId: undefined, message: inworldErrorMessage(5, "Voice not found") }]);
    expect(parseInworldMessage("not json")).toEqual([]);
  });
});

describe("Inworld connection: one context per reply", () => {
  it("queues a reply started before the socket opens, then sends create, text and close in order", async () => {
    const { conn, sockets } = connection();
    const reply = conn.reply(voice);
    reply.say("Good, you remembered the she-wolf.");
    reply.say("Now here is the part the legend leaves out.");
    expect(sockets).toHaveLength(1);
    expect(sockets[0].headers.Authorization).toBe(`Basic ${KEY}`);
    sockets[0].accept();
    reply.end();
    const kinds = sockets[0].sent.map((m) => Object.keys(m).find((k) => k !== "context_id"));
    expect(kinds).toEqual(["create", "send_text", "send_text", "close_context"]);
    expect(new Set(sockets[0].sent.map((m) => m.context_id)).size).toBe(1);
  });

  it("streams the reply's audio in whole samples until its context closes", async () => {
    const { conn, sockets } = connection();
    const reply = conn.reply(voice);
    const heard = collect(reply.audio());
    sockets[0].accept();
    reply.say("Hello.");
    reply.end();
    const id = sockets[0].sent[0].context_id as string;
    sockets[0].serverSays({ result: { contextId: id, contextCreated: {} } });
    sockets[0].serverSays(audio(id, [1, 2, 3])); // an odd byte count is carried to the next chunk
    sockets[0].serverSays(audio(id, [4, 5, 6, 7, 8]));
    sockets[0].serverSays({ result: { contextId: id, contextClosed: {} } });
    const pcm = await heard;
    expect(pcm.length).toBe(8);
    expect(reply.heard).toBe(true);
    expect(reply.said).toEqual(["Hello."]);
  });

  it("keeps two replies apart and reuses the open socket", async () => {
    const { conn, sockets } = connection();
    const first = conn.reply(voice);
    sockets[0].accept();
    const second = conn.reply(voice);
    expect(sockets).toHaveLength(1);
    const [a, b] = sockets[0].sent.filter((m) => "create" in m).map((m) => m.context_id as string);
    expect(a).not.toBe(b);
    const heardSecond = collect(second.audio());
    sockets[0].serverSays(audio(a, [7, 7]));
    sockets[0].serverSays(audio(b, [1, 1, 2, 2]));
    sockets[0].serverSays({ result: { contextId: b, contextClosed: {} } });
    expect((await heardSecond).length).toBe(4);
    first.cancel();
  });

  it("stops at once on a barge-in, closes the context once, and ignores late audio", async () => {
    const { conn, sockets } = connection();
    const reply = conn.reply(voice);
    sockets[0].accept();
    reply.say("A long answer that the student talks over.");
    const id = sockets[0].sent[0].context_id as string;
    const heard = collect(reply.audio());
    sockets[0].serverSays(audio(id, [1, 1]));
    await new Promise((r) => setTimeout(r, 0));
    reply.cancel();
    reply.cancel();
    sockets[0].serverSays(audio(id, [2, 2, 2, 2]));
    expect((await heard).length).toBe(2);
    expect(sockets[0].sent.filter((m) => "close_context" in m)).toHaveLength(1);
  });

  it("fails the reply with Inworld's reason, so the turn can fall back", async () => {
    const { conn, sockets } = connection();
    const reply = conn.reply(voice);
    sockets[0].accept();
    reply.say("Hello.");
    const id = sockets[0].sent[0].context_id as string;
    sockets[0].serverSays({ error: { code: 5, message: "Voice not found", contextId: id } });
    await expect(collect(reply.audio())).rejects.toThrow(/Pick one from the list/);
    expect(reply.heard).toBe(false);
  });

  it("fails every reply when the socket drops, and opens a new one for the next reply", async () => {
    const { conn, sockets } = connection();
    const reply = conn.reply(voice);
    sockets[0].accept();
    reply.say("Hello.");
    const heard = collect(reply.audio());
    sockets[0].emit("close");
    await expect(heard).rejects.toThrow(/closed/);
    conn.reply(voice);
    expect(sockets).toHaveLength(2);
  });

  it("refuses a malformed key without opening a socket", async () => {
    const sockets: FakeSocket[] = [];
    const conn = new InworldConnection({ apiKey: "key-id:secret-part", socketFactory: (u, h) => (sockets.push(new FakeSocket(u, h)), sockets[0]) });
    const reply = conn.reply(voice);
    await expect(collect(reply.audio())).rejects.toThrow(/Base64 copy/);
    expect(sockets).toHaveLength(0);
  });

  it("gives up on a server that goes quiet while it owes audio, but not on a tutor still writing", async () => {
    vi.useFakeTimers();
    const { conn, sockets } = connection();
    // Still writing: nothing has been sent, so nothing is owed and nothing times out.
    const waiting = conn.reply(voice);
    sockets[0].accept();
    const waitingAudio = collect(waiting.audio());
    await vi.advanceTimersByTimeAsync(25_000);
    waiting.say("Finally, a sentence.");
    const id = sockets[0].sent.find((m) => "create" in m)!.context_id as string;
    sockets[0].serverSays({ result: { contextId: id, contextClosed: {} } });
    await expect(waitingAudio).resolves.toBeInstanceOf(Buffer);
    // Owed: text went out and the server said nothing for ten seconds.
    const owed = conn.reply(voice);
    owed.say("Hello?");
    const owedAudio = collect(owed.audio());
    const assertion = expect(owedAudio).rejects.toThrow(/stopped sending audio/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

describe("Inworld over HTTP (Test this voice, and the fallback)", () => {
  it("splits an NDJSON stream into complete lines", () => {
    expect(ndjsonLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  });

  function ndjsonResponse(text: string, cut: number[]): Response {
    const bytes = new TextEncoder().encode(text);
    const pieces: Uint8Array[] = [];
    let at = 0;
    for (const c of [...cut, bytes.length]) {
      pieces.push(bytes.slice(at, c));
      at = c;
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const p of pieces) controller.enqueue(p);
          controller.close();
        },
      }),
      { status: 200 },
    );
  }

  it("reads audio from lines that arrive split across network reads", async () => {
    const lines = [audio("", [1, 0, 2, 0]), audio("", [3, 0])].map((m) => JSON.stringify({ result: { audioContent: m.result.audioChunk.audioContent } })).join("\n") + "\n";
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ndjsonResponse(lines, [5, 17, 40]);
    }) as unknown as typeof fetch;
    const pcm = await collect(speakInworldHttp("Hello there.", { ...voice, apiKey: KEY, fetchImpl }));
    expect(pcm.length).toBe(6);
    expect(body).toEqual({ text: "Hello there.", voiceId: "Ashley", modelId: "inworld-tts-2", audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 } });
  });

  it("throws on an error line, and explains a refused key", async () => {
    const errorLine = (async () => ndjsonResponse(JSON.stringify({ error: { code: 3, message: "Invalid request" } }) + "\n", [])) as unknown as typeof fetch;
    await expect(collect(speakInworldHttp("Hi.", { ...voice, apiKey: KEY, fetchImpl: errorLine }))).rejects.toThrow(/rejected the request/);
    const refused = (async () => new Response('{"error":{"code":16,"message":"bad key"}}', { status: 401 })) as unknown as typeof fetch;
    await expect(collect(speakInworldHttp("Hi.", { ...voice, apiKey: KEY, fetchImpl: refused }))).rejects.toThrow(/refused the key/);
  });
});

describe("Inworld voices", () => {
  it("maps the workspace's voices for the picker, with a play button served by this app", () => {
    const voices = mapInworldVoices({
      voices: [
        { voiceId: "Dennis", displayName: "Dennis", source: "SYSTEM", languageCode: "en-US", gender: "male" },
        { voiceId: "my clone", displayName: "Grandma", source: "IVC", languageCode: "en-US" },
        { displayName: "no id" },
      ],
    });
    expect(voices.map((v) => v.name)).toEqual(["Dennis", "Grandma"]);
    expect(voices[0].description).toBe("male · en-US");
    expect(voices[1].description).toBe("en-US · ivc");
    expect(voices[1].previewUrl).toBe("/api/voice/voice-preview?provider=inworld&voiceId=my%20clone");
    expect(mapInworldVoices(null)).toEqual([]);
  });
});

describe("Inworld pauses between sentences", () => {
  const seg = (text: string, paraBreak = false): Segment => ({ text, paraBreak });

  it("puts a pause before each sentence after the first, sized by how the one before it ended", () => {
    const text = inworldText([seg("Good, you remembered."), seg("Why one year?"), seg("Think,"), seg("Then answer.")], undefined, 220);
    expect(text).toBe('Good, <break time="140ms" /> you remembered. <break time="220ms" /> Why one year? <break time="280ms" /> Think, <break time="140ms" /> Then answer.');
  });

  it("carries the pause across batches, and scales with the setting", () => {
    expect(inworldText([seg("Next part.")], seg("Wait…"), 220)).toBe('<break time="450ms" /> Next part.');
    expect(inworldText([seg("Next part.")], seg("A new idea.", true), 440)).toBe('<break time="900ms" /> Next part.');
    expect(inworldText([seg("Next part.")], seg("Done."), 0)).toBe("Next part.");
  });

  it("pauses at a sentence's own punctuation too, but not inside numbers or times", () => {
    expect(withInnerPauses("In 509 B.C., at 3:30, 1,000 Romans rose: kings out — for good... then what?", 220)).toBe(
      'In 509 B.C., <break time="140ms" /> at 3:30, <break time="140ms" /> 1,000 Romans rose: <break time="140ms" /> kings out — <break time="220ms" /> for good ... <break time="220ms" /> then what?',
    );
    expect(withInnerPauses("Well, that is it.", 0)).toBe("Well, that is it.");
  });

  it("keeps markup characters out of Inworld's SSML", () => {
    expect(speakableForInworld("Is 3 < 5 & 7?")).toBe("Is 3 less than 5 and 7?");
    expect(inworldBreak(0)).toBe("");
    expect(inworldBreak(279.6)).toBe('<break time="280ms" />');
  });
});

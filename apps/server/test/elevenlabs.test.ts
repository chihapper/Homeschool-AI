import { describe, expect, it } from "vitest";
import {
  ELEVEN_FALLBACK_MODELS,
  elevenErrorMessage,
  elevenKeyProblem,
  elevenRequest,
  freshRequestIds,
  mapElevenModels,
  mapElevenSubscription,
  mapElevenVoices,
  rememberRequest,
  speakElevenLabs,
  supportsStitching,
} from "../src/voice/tts-elevenlabs.js";
import { Pcm16Stream, pcm16ToWav } from "../src/voice/pcm.js";
import { elevenText } from "../src/voice/live.js";
import type { Segment } from "../src/voice/sentence-chunker.js";

const opts = { voiceId: "JBFqnCBsd6RMkjVDRZzb", model: "eleven_flash_v2_5", stability: 0.4, speed: 1.1 };

/** A fake ElevenLabs: records each request and answers with the given responses in order. */
function fakeFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** A streamed audio response whose chunks split samples at odd byte boundaries, as a network can. */
function audioResponse(pcm: Buffer, chunkSizes: number[], requestId = "req-1"): Response {
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const n of chunkSizes) {
    parts.push(pcm.subarray(at, at + n));
    at += n;
  }
  if (at < pcm.length) parts.push(pcm.subarray(at));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(new Uint8Array(p));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "request-id": requestId, "content-type": "audio/pcm" } });
}

/** 0.1 s of a steady tone well above the fade-in region. */
function tone(samples = 2400, value = 1000): Buffer {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(i % 2 ? value : -value, i * 2);
  return b;
}

describe("ElevenLabs requests", () => {
  it("asks for 24 kHz raw PCM with the full voice settings", () => {
    const { url, body } = elevenRequest("Hello there.", opts);
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=pcm_24000");
    expect(body).toEqual({
      text: "Hello there.",
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.1 },
    });
  });

  it("stitches to at most the three latest requests, and never on v3 models", () => {
    const withIds = elevenRequest("Next.", { ...opts, previousRequestIds: ["a", "b", "c", "d"] }).body;
    expect(withIds.previous_request_ids).toEqual(["b", "c", "d"]);
    expect(supportsStitching("eleven_multilingual_v2")).toBe(true);
    for (const model of ["eleven_v3", "eleven_v3_conversational"]) {
      expect(supportsStitching(model)).toBe(false);
      expect(elevenRequest("Next.", { ...opts, model, previousRequestIds: ["a"] }).body).not.toHaveProperty("previous_request_ids");
    }
    expect(elevenRequest("x", { ...opts, voiceId: "a/b" }).url).toContain("/text-to-speech/a%2Fb/stream");
  });

  it("remembers only fresh, recent request ids", () => {
    const t0 = 1_000_000;
    let list = rememberRequest([], "one", t0);
    list = rememberRequest(list, "two", t0 + 1000);
    list = rememberRequest(list, "three", t0 + 2000);
    list = rememberRequest(list, "four", t0 + 3000);
    expect(freshRequestIds(list, t0 + 4000)).toEqual(["two", "three", "four"]);
    // The API accepts ids up to two hours old; anything past 100 minutes is dropped.
    expect(freshRequestIds(list, t0 + 101 * 60 * 1000)).toEqual([]);
  });

  it("reads every error shape ElevenLabs returns", () => {
    const keyId = JSON.stringify({ detail: { type: "authentication_error", code: "invalid_api_key", message: "API key ID used as API key - only valid API keys can be used.", status: "api_key_id_used_as_api_key" } });
    expect(elevenErrorMessage(400, keyId)).toBe("API key ID used as API key - only valid API keys can be used. (api_key_id_used_as_api_key)");
    expect(elevenErrorMessage(401, JSON.stringify({ detail: "Invalid API key" }))).toBe("Invalid API key");
    expect(elevenErrorMessage(422, JSON.stringify({ detail: [{ msg: "field required" }, { msg: "bad speed" }] }))).toBe("field required; bad speed");
    expect(elevenErrorMessage(502, "<html>Bad gateway</html>")).toBe("<html>Bad gateway</html>");
    expect(elevenErrorMessage(500, "")).toBe("HTTP 500");
  });

  it("spots a missing key or a pasted key ID before any call is made", () => {
    expect(elevenKeyProblem(undefined)).toMatch(/not set/);
    expect(elevenKeyProblem("a1b2c3d4e5f6")).toMatch(/key ID/);
    expect(elevenKeyProblem("sk_0123456789abcdef")).toBeUndefined();
  });
});

describe("PCM from a byte stream", () => {
  it("never splits a sample, whatever the chunk boundaries", () => {
    const pcm = tone(1000);
    const s = new Pcm16Stream(24_000, 0);
    const out = [s.push(pcm.subarray(0, 3)), s.push(pcm.subarray(3, 3)), s.push(pcm.subarray(3, 1001)), s.push(pcm.subarray(1001))];
    for (const o of out) expect(o.length % 2).toBe(0);
    expect(Buffer.concat(out).equals(pcm)).toBe(true);
    expect(s.samples).toBe(1000);
  });

  it("fades the first 5 ms in and leaves the rest untouched", () => {
    const pcm = tone(2400);
    const s = new Pcm16Stream(24_000, 5); // 120 samples of fade
    const out = Buffer.concat([s.push(pcm.subarray(0, 101)), s.push(pcm.subarray(101))]);
    expect(out.readInt16LE(0)).toBe(0);
    expect(Math.abs(out.readInt16LE(60 * 2))).toBeLessThan(1000);
    expect(out.subarray(120 * 2).equals(pcm.subarray(120 * 2))).toBe(true);
  });

  it("wraps PCM in a playable WAV header", () => {
    const wav = pcm16ToWav(Buffer.alloc(4800), 24_000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(4800);
    expect(wav.length).toBe(44 + 4800);
  });
});

describe("speaking through ElevenLabs", () => {
  it("streams whole samples and reports the request id for stitching", async () => {
    const pcm = tone();
    const { impl, calls } = fakeFetch([() => audioResponse(pcm, [1, 999, 7, 2000])]);
    const out: Buffer[] = [];
    let requestId: string | undefined;
    for await (const c of speakElevenLabs("Where does the plant get its food?", { ...opts, previousRequestIds: ["earlier"], apiKey: "sk_test", fetchImpl: impl })) {
      expect(c.pcm.length % 2).toBe(0);
      out.push(c.pcm);
      requestId = c.requestId;
    }
    expect(Buffer.concat(out).length).toBe(pcm.length);
    expect(requestId).toBe("req-1");
    expect(calls[0].headers["xi-api-key"]).toBe("sk_test");
    expect(calls[0].body.previous_request_ids).toEqual(["earlier"]);
  });

  it("retries once without stitching when a stitched request is refused", async () => {
    const refused = () => new Response(JSON.stringify({ detail: { message: "previous_request_ids too old", status: "invalid_request" } }), { status: 400 });
    const { impl, calls } = fakeFetch([refused, () => audioResponse(tone(), [4800])]);
    let bytes = 0;
    for await (const c of speakElevenLabs("Next sentence.", { ...opts, previousRequestIds: ["stale"], apiKey: "sk_test", fetchImpl: impl })) bytes += c.pcm.length;
    expect(bytes).toBe(4800);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).not.toHaveProperty("previous_request_ids");
  });

  it("names the problem when the account refuses, and when no audio comes back", async () => {
    const keyId = () => new Response(JSON.stringify({ detail: { message: "API key ID used as API key", status: "api_key_id_used_as_api_key" } }), { status: 400 });
    const drain = async (gen: AsyncGenerator<unknown>) => {
      for await (const _ of gen) void _;
    };
    await expect(drain(speakElevenLabs("Hi.", { ...opts, apiKey: "abc", fetchImpl: fakeFetch([keyId]).impl }))).rejects.toThrow(/ElevenLabs TTS error 400: API key ID used as API key \(api_key_id_used_as_api_key\)/);
    await expect(drain(speakElevenLabs("Hi.", { ...opts, apiKey: "sk_test", fetchImpl: fakeFetch([() => audioResponse(Buffer.alloc(0), [])]).impl }))).rejects.toThrow(/no audio/);
    await expect(drain(speakElevenLabs("Hi.", { ...opts, apiKey: "", fetchImpl: fakeFetch([]).impl }))).rejects.toThrow(/ELEVENLABS_API_KEY is not set/);
  });
});

describe("ElevenLabs account lookups", () => {
  it("describes voices from their labels", () => {
    const voices = mapElevenVoices({
      voices: [
        { voice_id: "v1", name: "George", category: "premade", labels: { gender: "male", age: "middle_aged", accent: "british", descriptive: "warm" }, preview_url: "https://example.com/g.mp3" },
        { voice_id: "v2", name: "My clone", category: "cloned", labels: {}, description: "Recorded in the kitchen" },
        { name: "no id" },
      ],
    });
    expect(voices).toEqual([
      { id: "v1", name: "George", description: "male · middle_aged · british · warm", previewUrl: "https://example.com/g.mp3", category: "premade" },
      { id: "v2", name: "My clone", description: "Recorded in the kitchen", previewUrl: undefined, category: "cloned" },
    ]);
    expect(mapElevenVoices(null)).toEqual([]);
  });

  it("keeps only text-to-speech models, real-time ones first, with a note on each", () => {
    const models = mapElevenModels([
      { model_id: "eleven_multilingual_sts_v2", name: "STS", can_do_text_to_speech: false },
      { model_id: "eleven_v3", name: "Eleven v3", can_do_text_to_speech: true },
      { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
      { model_id: "eleven_flash_v2_5", name: "Flash v2.5", can_do_text_to_speech: true },
      { model_id: "eleven_new_thing", name: "New thing", can_do_text_to_speech: true, requires_alpha_access: true },
    ]);
    expect(models.map((m) => m.id)).toEqual(["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v3", "eleven_new_thing"]);
    expect(models[0].note).toMatch(/75 ms/);
    expect(models[3].note).toBe("needs alpha access");
    expect(ELEVEN_FALLBACK_MODELS[0].id).toBe("eleven_flash_v2_5");
  });

  it("turns the subscription into characters used, left and the reset date", () => {
    const c = mapElevenSubscription({ tier: "creator", status: "active", character_count: 1200, character_limit: 100000, next_character_count_reset_unix: 1_790_000_000 });
    expect(c).toEqual({ tier: "creator", status: "active", used: 1200, limit: 100000, resetsAt: new Date(1_790_000_000 * 1000).toISOString() });
    expect(mapElevenSubscription(undefined)).toEqual({ tier: undefined, status: undefined, used: 0, limit: 0, resetsAt: undefined });
  });
});

describe("live voice with ElevenLabs", () => {
  it("sends a batch as one clean text so the voice reads the sentences as a run", () => {
    const seg = (text: string): Segment => ({ text, paraBreak: false });
    expect(elevenText([seg("**Nice** thinking."), seg("So where does the food come from?")])).toBe("Nice thinking. So where does the food come from?");
    expect(elevenText([seg("   "), seg("`ok`")])).toBe("ok");
  });
});

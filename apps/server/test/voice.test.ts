import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/voice/sentence-chunker.js";
import { fadeEdgesPcm16, gapAfter, peakPcm16, resamplePcm16, silencePcm16 } from "../src/voice/pcm.js";
import { parseAssemblyMessage } from "../src/voice/stt-assemblyai.js";
import { cleanForSpeech, keytermsFor, takeBatch } from "../src/voice/live.js";
import type { Segment } from "../src/voice/sentence-chunker.js";
import type { Course } from "../src/domain/types.js";

describe("SentenceChunker", () => {
  it("emits sentences as soon as they complete, across token boundaries", () => {
    const c = new SentenceChunker();
    const out = [
      ...c.push("Nice thinking. So wh"),
      ...c.push("ere does the plant get its food? It is not the so"),
      ...c.push("il... right? Tell me"),
    ];
    expect(out.map((s) => s.text)).toEqual(["Nice thinking.", "So where does the plant get its food?", "It is not the soil... right?"]);
    expect(c.flush()).toEqual({ text: "Tell me", paraBreak: false });
    expect(c.flush()).toBeNull();
  });

  it("does not split on abbreviations or mid-thought ellipses, and flags paragraph breaks", () => {
    const c = new SentenceChunker();
    expect(c.push("Ask Mr. Lee about it. Then wait... and think.\n\nNow go.")).toEqual([
      { text: "Ask Mr. Lee about it.", paraBreak: false },
      { text: "Then wait... and think.", paraBreak: true },
    ]);
    expect(c.flush()?.text).toBe("Now go.");
  });
});

describe("pcm helpers", () => {
  it("resamples by the rate ratio and keeps 16-bit alignment", () => {
    const src = Buffer.alloc(48 * 2);
    for (let i = 0; i < 48; i++) src.writeInt16LE(i * 100, i * 2);
    const out = resamplePcm16(src, 48000, 24000);
    expect(out.length).toBe(24 * 2);
    expect(out.readInt16LE(0)).toBe(0);
    expect(out.readInt16LE(2)).toBe(200);
    expect(resamplePcm16(src, 24000, 24000)).toBe(src);
  });

  it("makes silence, fades edges, and measures peaks", () => {
    expect(silencePcm16(100, 24000).length).toBe(2400 * 2);
    const loud = Buffer.alloc(200 * 2);
    for (let i = 0; i < 200; i++) loud.writeInt16LE(16384, i * 2);
    const faded = fadeEdgesPcm16(loud, 24000, 1); // 24 samples per edge
    expect(faded.readInt16LE(0)).toBe(0);
    expect(faded.readInt16LE(100 * 2)).toBe(16384);
    expect(faded.readInt16LE(199 * 2)).toBe(0);
    expect(peakPcm16(loud)).toBeCloseTo(0.5, 2);
  });

  it("sizes the breath after a sentence by how it ended", () => {
    expect(gapAfter("Why is that?")).toBeGreaterThan(gapAfter("It is a leaf."));
    expect(gapAfter("Hmm...")).toBeGreaterThan(gapAfter("Why is that?"));
    expect(gapAfter("It is a leaf.", true)).toBeGreaterThanOrEqual(450);
  });
});

describe("AssemblyAI message parsing", () => {
  it("maps Turn messages to partial / final and recognises termination", () => {
    expect(parseAssemblyMessage(JSON.stringify({ type: "Turn", transcript: "plants get food", end_of_turn: false }))).toEqual({ type: "partial", text: "plants get food" });
    expect(parseAssemblyMessage(JSON.stringify({ type: "Turn", transcript: "Plants get food from soil.", end_of_turn: true }))).toEqual({ type: "final", text: "Plants get food from soil." });
    expect(parseAssemblyMessage(JSON.stringify({ type: "Begin", id: "x" }))).toEqual({ type: "ignore" });
    expect(parseAssemblyMessage(JSON.stringify({ type: "Termination" }))).toEqual({ type: "end" });
    expect(parseAssemblyMessage(JSON.stringify({ error: "bad config" })).type).toBe("error");
    // A fatal error carries a code, and the socket closes right after it.
    expect(parseAssemblyMessage(JSON.stringify({ type: "Error", error_code: 3007, error: "Input Duration Violation: 20.0 ms" })))
      .toEqual({ type: "error", message: "Input Duration Violation: 20.0 ms (3007)" });
    expect(parseAssemblyMessage("not json")).toEqual({ type: "ignore" });
  });
});

describe("sentence batching", () => {
  const seg = (text: string, paraBreak = false): Segment => ({ text, paraBreak });
  const feeder = (items: Array<Segment | null | undefined>) => () => (items.length ? items.shift() : undefined);

  it("takes what is already waiting and never waits for more", () => {
    const waiting = feeder([seg("Two."), seg("Three."), undefined, seg("Never.")]);
    const { batch, endSeen } = takeBatch(seg("One."), waiting);
    expect(batch.map((s) => s.text)).toEqual(["One.", "Two.", "Three."]);
    expect(endSeen).toBe(false);
  });

  it("stops at the end-of-reply marker and reports it", () => {
    const { batch, endSeen } = takeBatch(seg("One."), feeder([seg("Two."), null, seg("Never.")]));
    expect(batch.map((s) => s.text)).toEqual(["One.", "Two."]);
    expect(endSeen).toBe(true);
  });

  it("respects the sentence and character caps", () => {
    const many = feeder([seg("b"), seg("c"), seg("d"), seg("e"), seg("f")]);
    expect(takeBatch(seg("a"), many, { maxSentences: 3, maxChars: 1000 }).batch).toHaveLength(3);
    const long = feeder([seg("x".repeat(300)), seg("y".repeat(300))]);
    expect(takeBatch(seg("z".repeat(200)), long, { maxSentences: 10, maxChars: 420 }).batch).toHaveLength(2);
  });
});

describe("live voice helpers", () => {
  it("strips markdown before speech and builds lesson keyterms", () => {
    expect(cleanForSpeech("**Glucose** is the plant's `food`.")).toBe("Glucose is the plant's food .");
    const course = {
      concepts: [{ name: "Chloroplasts and chlorophyll", keyFacts: ["Chloroplasts contain a green pigment called chlorophyll."] }],
    } as unknown as Course;
    const terms = keytermsFor(course);
    expect(terms).toContain("Chloroplasts and chlorophyll");
    expect(terms).toContain("chlorophyll");
    expect(terms).not.toContain("green");
    expect(keytermsFor(undefined)).toEqual([]);
  });
});

/**
 * Transcribe a 16-bit mono WAV through the live speech-to-text adapter, streamed in real time the way
 * the browser would send it. Handy for checking a saved tutor clip is intelligible, or for tuning the
 * end-of-turn silence settings against a recording.
 *
 *   npx tsx scripts/transcribe-wav.ts path/to/clip.wav
 */
import fs from "node:fs";
import { config } from "../src/config.js";
import { resamplePcm16 } from "../src/voice/pcm.js";
import { AssemblyAIStream } from "../src/voice/stt-assemblyai.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("usage: tsx scripts/transcribe-wav.ts <clip.wav>");
  if (!config.voice.assemblyAiKey) throw new Error("ASSEMBLYAI_API_KEY is not set.");
  const wav = fs.readFileSync(file);
  const rate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  if (channels !== 1 || wav.readUInt16LE(34) !== 16) throw new Error("Expected 16-bit mono WAV.");
  const pcm = resamplePcm16(wav.subarray(44), rate, config.voice.micSampleRate);
  console.log(`${file}: ${(pcm.length / 2 / config.voice.micSampleRate).toFixed(1)} s at ${rate} Hz -> ${config.voice.micSampleRate} Hz`);

  const stt = await AssemblyAIStream.connect({
    apiKey: config.voice.assemblyAiKey,
    sampleRate: config.voice.micSampleRate,
    model: config.voice.assemblyAiModel,
    minTurnSilenceMs: config.sttMinSilenceMs,
    maxTurnSilenceMs: config.sttMaxSilenceMs,
  });
  const frame = (config.voice.micSampleRate / 10) * 2; // 100 ms
  const finals: string[] = [];
  const reader = (async () => {
    for await (const ev of stt.events()) {
      if (ev.kind === "final") {
        finals.push(ev.text);
        console.log(`final: ${ev.text}`);
      } else process.stdout.write(`\r  ... ${ev.text.slice(-80)}`);
    }
  })();
  const t0 = Date.now();
  for (let off = 0; off < pcm.length; off += frame) {
    stt.sendAudio(pcm.subarray(off, off + frame));
    await new Promise((r) => setTimeout(r, 100));
  }
  // Trailing silence so the last turn ends, then close.
  const silence = Buffer.alloc(frame);
  for (let i = 0; i < 25; i++) {
    stt.sendAudio(silence);
    await new Promise((r) => setTimeout(r, 100));
  }
  stt.close();
  await reader;
  console.log(`\ndone in ${Date.now() - t0} ms; ${finals.length} turn(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

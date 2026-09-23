/**
 * Headless Hume EVI smoke test: open a real EVI session against HUME_CONFIG_ID, tell it which of our
 * sessions it belongs to, feed it a spoken student line (synthesized with Hume TTS in another voice),
 * and print what comes back. Verifies the three assumptions in docs/TESTING.md Stage 3b:
 *   1. Hume calls our CLM with custom_session_id;
 *   2. Hume forwards language_model_api_key as `Authorization: Bearer ...` (a wrong secret would 401);
 *   3. the prosody scores arrive as models.prosody.scores.
 *
 *   npx tsx scripts/evi-smoke.ts [learnerId] [courseId] [--line "what the student says"]
 *
 * Needs PUBLIC_URL to be a live tunnel to this server and the server to be running.
 */
import fs from "node:fs";
import path from "node:path";
import { HumeClient } from "hume";
import { config } from "../src/config.js";
import { resamplePcm16 } from "../src/voice/pcm.js";
import { speakHume } from "../src/voice/tts-hume.js";

const BASE = `http://localhost:${config.port}`;
const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const learnerId = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const courseId = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")))[1];
const line = opt("--line") ?? "Um, I think plants get their food from the soil. Like, the roots suck up the nutrients from the dirt.";

async function json<T>(method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function main(): Promise<void> {
  if (!config.hume.configId) throw new Error("HUME_CONFIG_ID is not set; run npm run setup:hume first.");
  if (!learnerId || !courseId) throw new Error("usage: tsx scripts/evi-smoke.ts <learnerId> <courseId> [--line ...]");
  const session = await json<{ id: string; phase: string }>("POST", "/api/sessions", { learnerId, courseId });
  console.log(`our session ${session.id} (phase ${session.phase}); EVI config ${config.hume.configId}`);

  // The "student": another Hume voice, resampled to the 16 kHz linear16 we tell EVI to expect.
  const chunks: Buffer[] = [];
  for await (const c of speakHume(line, { voice: "Sitcom Girl", version: "2", instant: true })) chunks.push(c.pcm);
  const pcm16k = resamplePcm16(Buffer.concat(chunks), config.voice.playbackSampleRate, 16_000);
  console.log(`student line: ${(pcm16k.length / 2 / 16_000).toFixed(1)} s of audio`);

  const client = new HumeClient({ apiKey: config.hume.apiKey!, secretKey: config.hume.secretKey! });
  const socket = client.empathicVoice.chat.connect({ configId: config.hume.configId });
  const audioOut: Buffer[] = [];
  let tSent = 0;
  let firstAudioAt = 0;
  let assistantText = "";
  const done = new Promise<void>((resolve, reject) => {
    socket.on("open", () => console.log("EVI socket open"));
    socket.on("error", (err) => reject(err));
    socket.on("close", () => resolve());
    socket.on("message", (m) => {
      const msg = m as { type: string } & Record<string, unknown>;
      switch (msg.type) {
        case "chat_metadata":
          console.log("chat_metadata:", JSON.stringify({ chat_id: msg.chatId ?? msg.chat_id, chat_group_id: msg.chatGroupId ?? msg.chat_group_id }));
          break;
        case "user_message": {
          const message = msg.message as { content?: string };
          const models = msg.models as { prosody?: { scores?: Record<string, number> } } | undefined;
          const top = Object.entries(models?.prosody?.scores ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
          console.log(`user_message (${Date.now() - tSent} ms after audio sent): "${message?.content}"  prosody top: ${top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`);
          break;
        }
        case "assistant_message": {
          const message = msg.message as { content?: string };
          assistantText += (message?.content ?? "") + " ";
          console.log(`assistant_message (${Date.now() - tSent} ms): "${message?.content}"`);
          break;
        }
        case "audio_output": {
          const data = String(msg.data ?? "");
          if (!firstAudioAt) {
            firstAudioAt = Date.now();
            console.log(`first audio_output ${firstAudioAt - tSent} ms after audio sent`);
          }
          if (audioOut.length < 4) console.log(`  audio_output id=${String(msg.id).slice(0, 8)} index=${msg.index} bytes=${Buffer.from(data, "base64").length} head=${Buffer.from(data, "base64").subarray(0, 4).toString("latin1")}`);
          audioOut.push(Buffer.from(data, "base64"));
          break;
        }
        case "assistant_end":
          console.log(`assistant_end (${Date.now() - tSent} ms); ${audioOut.length} audio chunks`);
          setTimeout(() => socket.close(), 500);
          break;
        case "error":
          console.log("EVI error:", JSON.stringify(msg));
          break;
        default:
          if (msg.type !== "user_interruption") console.log("  event:", msg.type);
      }
    });
  });

  await socket.tillSocketOpen();
  socket.sendSessionSettings({
    customSessionId: session.id,
    languageModelApiKey: config.hume.clmSecret,
    audio: { encoding: "linear16", sampleRate: 16_000, channels: 1 },
  });
  // Stream the line in 100 ms frames, then a second of silence so end-of-turn fires.
  const frame = 1600 * 2;
  for (let off = 0; off < pcm16k.length; off += frame) {
    socket.sendAudioInput({ data: pcm16k.subarray(off, off + frame).toString("base64") });
    await new Promise((r) => setTimeout(r, 100));
  }
  tSent = Date.now();
  const silence = Buffer.alloc(frame).toString("base64");
  for (let i = 0; i < 15; i++) {
    socket.sendAudioInput({ data: silence });
    await new Promise((r) => setTimeout(r, 100));
  }
  await Promise.race([done, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timed out after 60 s")), 60_000))]);

  if (audioOut.length) {
    // audio_output chunks are WAV files; keep the first as a sample.
    const out = path.resolve("evi-reply-sample.wav");
    fs.writeFileSync(out, audioOut[0]);
    console.log(`saved first reply chunk to ${out}`);
  }
  const s = await json<{ transcript: Array<{ role: string; content: string; expressions?: string[] }> }>("GET", `/api/sessions/${session.id}`);
  console.log("\nour transcript:");
  for (const t of s.transcript) console.log(`  ${t.role}: ${t.content.slice(0, 120)}${t.expressions?.length ? `  [expressions: ${t.expressions.join(", ")}]` : ""}`);
  console.log(`\nassistant text heard via EVI: ${assistantText.trim().slice(0, 200)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

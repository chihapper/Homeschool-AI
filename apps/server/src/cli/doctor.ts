/**
 * Local readiness check: what is installed, what is configured, and what each stage of testing needs.
 *
 *   npm run doctor            # checks only
 *   npm run doctor -- --ping  # also makes one tiny Claude API call to confirm the key works
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config, REPO_ROOT } from "../config.js";

const run = promisify(execFile);
type Status = "ok" | "warn" | "fail";
const rows: Array<{ status: Status; item: string; note: string }> = [];
const add = (status: Status, item: string, note: string): void => {
  rows.push({ status, item, note });
};

async function bin(name: string, args: string[] = ["--version"]): Promise<string | undefined> {
  try {
    const { stdout } = await run(name, args);
    return stdout.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const ping = process.argv.includes("--ping");

  // --- Runtime ---------------------------------------------------------------
  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20 ? "ok" : "fail", `Node ${process.versions.node}`, major >= 20 ? "" : "Node 20 or newer is required.");
  const deps = fs.existsSync(path.join(REPO_ROOT, "node_modules"));
  add(deps ? "ok" : "fail", "Dependencies installed", deps ? "" : "Run `npm install` at the repo root.");
  add(fs.existsSync(path.join(REPO_ROOT, ".env")) ? "ok" : "warn", ".env file", "Copy .env.example to .env and fill in keys. (Values are also read from the shell environment.)");
  add(fs.existsSync(config.skillsDir) ? "ok" : "fail", `Skills dir ${path.relative(REPO_ROOT, config.skillsDir)}`, "");
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    add("ok", `Data dir ${path.relative(REPO_ROOT, config.dataDir) || "."}`, "");
  } catch {
    add("fail", "Data dir", `Cannot create ${config.dataDir}`);
  }

  // --- Stage 1: text mode (Anthropic only) -------------------------------------
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  add(hasKey ? "ok" : "fail", "ANTHROPIC_API_KEY", hasKey ? `models: ${config.model} (tutor ${config.tutorModel} @ ${config.tutorEffort})` : "Needed for ingestion, tutoring, and assessment.");
  if (ping && hasKey) {
    try {
      const { anthropic } = await import("../llm/client.js");
      const t0 = Date.now();
      const r = await anthropic.messages.create({ model: config.tutorModel, max_tokens: 5, messages: [{ role: "user", content: "Say hi." }] });
      add("ok", "Claude API ping", `${config.tutorModel} answered in ${Date.now() - t0} ms (stop_reason ${r.stop_reason})`);
    } catch (err) {
      add("fail", "Claude API ping", err instanceof Error ? err.message : String(err));
    }
  }

  // --- Stage 2: media ingestion ----------------------------------------------
  const ytdlp = await bin(config.ytDlpBin);
  add(ytdlp ? "ok" : "warn", `yt-dlp (${config.ytDlpBin})`, ytdlp ?? "Optional: needed for YouTube/TED/video URLs. Install: pip install yt-dlp  (or brew install yt-dlp)");
  const ffmpeg = await bin("ffmpeg", ["-version"]);
  add(ffmpeg ? "ok" : "warn", "ffmpeg", ffmpeg ? ffmpeg.slice(0, 40) : "Optional: yt-dlp downloads audio-only formats without it, but some sites need it.");
  switch (config.stt.provider) {
    case "deepgram":
      add(config.stt.deepgramApiKey ? "ok" : "warn", "Speech-to-text: Deepgram", config.stt.deepgramApiKey ? `model ${config.stt.deepgramModel}` : "Optional: DEEPGRAM_API_KEY needed for recordings without captions.");
      break;
    case "whisper-cli": {
      const w = await bin(config.stt.whisperBin, ["--help"]);
      add(w ? "ok" : "warn", `Speech-to-text: ${config.stt.whisperBin}`, w ? "" : "WHISPER_BIN not found on PATH.");
      break;
    }
    default:
      add("warn", "Speech-to-text", "STT_PROVIDER=none: podcasts and caption-less videos will be refused.");
  }

  // --- Stage 3: voice (Hume) ---------------------------------------------------
  const hume = Boolean(config.hume.apiKey && config.hume.secretKey);
  add(hume ? "ok" : "warn", "HUME_API_KEY + HUME_SECRET_KEY", hume ? "" : "Optional: voice mode. Text mode works without them.");
  if (hume) {
    add(config.hume.publicUrl ? "ok" : "warn", "PUBLIC_URL", config.hume.publicUrl ?? "Set to the public HTTPS URL of this server (e.g. ngrok) before `npm run setup:hume`.");
    add(config.hume.configId ? "ok" : "warn", "HUME_CONFIG_ID", config.hume.configId ?? "Run `npm run setup:hume` once PUBLIC_URL is set, then paste the id here.");
    add(config.hume.clmSecret ? "ok" : "warn", "CLM_SECRET", config.hume.clmSecret ? "set" : "Recommended: any long random string; protects the CLM endpoint.");
    const ngrok = await bin("ngrok", ["version"]);
    add(ngrok ? "ok" : "warn", "ngrok", ngrok ?? "Optional: `ngrok http 3001` is the quickest way to get a PUBLIC_URL during development.");
  }

  // --- Print --------------------------------------------------------------------
  const icon: Record<Status, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  console.log("\nHomeschool AI · doctor\n");
  for (const r of rows) console.log(`  ${icon[r.status]}  ${r.item}${r.note ? `\n        ${r.note}` : ""}`);
  const fails = rows.filter((r) => r.status === "fail").length;
  const warns = rows.filter((r) => r.status === "warn").length;
  console.log(`\n  ${fails} blocking, ${warns} optional.\n`);
  console.log("  Stage 1 (text tutor):  npm run ingest -- data/samples/photosynthesis-lesson.md && npm run chat -- --learner \"Test\" --grade 7");
  console.log("  Stage 2 (media):       npm run ingest -- --title \"Deck\" ./lecture.pptx  |  npm run ingest -- https://www.ted.com/talks/...");
  console.log("  Stage 3 (voice):       ngrok http 3001 -> PUBLIC_URL -> npm run setup:hume -> HUME_CONFIG_ID -> web app, Voice mode");
  console.log("  See docs/TESTING.md for the full plan.\n");
  process.exit(0); // A report, not a gate: never surface as an npm lifecycle error.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

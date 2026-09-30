/**
 * Readiness check: what is installed, what is configured, and what each stage of testing needs.
 * Shared by `npm run doctor` and the web app's Settings tab (GET /api/doctor).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config, REPO_ROOT, ttsVoiceLabel } from "./config.js";
import { elevenCredits, elevenKeyProblem } from "./voice/tts-elevenlabs.js";
import { inworldKeyProblem, listInworldVoices } from "./voice/tts-inworld.js";

const run = promisify(execFile);

export type ReadinessStatus = "ok" | "warn" | "fail";
export interface ReadinessRow {
  status: ReadinessStatus;
  item: string;
  note: string;
  /** Which testing stage the row gates: 0 build, 1 text tutor, 2 media, 3 voice. */
  stage: 0 | 1 | 2 | 3;
}
export interface Readiness {
  rows: ReadinessRow[];
  blocking: number;
  optional: number;
  checkedAt: string;
}

async function bin(name: string, args: string[] = ["--version"]): Promise<string | undefined> {
  try {
    const { stdout } = await run(name, args);
    return stdout.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

/** Run every check. `ping` makes one tiny Claude API call to confirm the key works and time the tutor model. */
export async function checkReadiness(opts: { ping?: boolean } = {}): Promise<Readiness> {
  const rows: ReadinessRow[] = [];
  const add = (stage: ReadinessRow["stage"], status: ReadinessStatus, item: string, note: string): void => {
    rows.push({ stage, status, item, note });
  };

  // --- Stage 0: runtime -------------------------------------------------------
  const major = Number(process.versions.node.split(".")[0]);
  add(0, major >= 20 ? "ok" : "fail", `Node ${process.versions.node}`, major >= 20 ? "" : "Node 20 or newer is required.");
  const deps = fs.existsSync(path.join(REPO_ROOT, "node_modules"));
  add(0, deps ? "ok" : "fail", "Dependencies installed", deps ? "" : "Run `npm install` at the repo root.");
  const hasEnv = fs.existsSync(path.join(REPO_ROOT, ".env"));
  add(0, hasEnv ? "ok" : "warn", ".env file", hasEnv ? "" : "Copy .env.example to .env and fill in keys. (Values are also read from the shell environment.)");
  add(0, fs.existsSync(config.skillsDir) ? "ok" : "fail", `Skills dir ${path.relative(REPO_ROOT, config.skillsDir)}`, "");
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    add(0, "ok", `Data dir ${path.relative(REPO_ROOT, config.dataDir) || "."}`, "");
  } catch {
    add(0, "fail", "Data dir", `Cannot create ${config.dataDir}`);
  }

  // --- Stage 1: text mode (Anthropic only) -------------------------------------
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  add(1, hasKey ? "ok" : "fail", "ANTHROPIC_API_KEY", hasKey ? `models: ${config.model} (tutor ${config.tutorModel} @ ${config.tutorEffort})` : "Needed for ingestion, tutoring, and assessment.");
  if (opts.ping && hasKey) {
    try {
      const { anthropic, reasoningParams } = await import("./llm/client.js");
      const t0 = Date.now();
      // Room for a model that thinks before it speaks (Opus 5.5 always does a little): max_tokens covers thinking too.
      const r = await anthropic.messages.create({ model: config.tutorModel, max_tokens: 64, ...reasoningParams(config.tutorModel, "low", "disabled"), messages: [{ role: "user", content: "Say hi." }] });
      add(1, "ok", "Claude API ping", `${config.tutorModel} answered in ${Date.now() - t0} ms (stop_reason ${r.stop_reason})`);
    } catch (err) {
      add(1, "fail", "Claude API ping", err instanceof Error ? err.message : String(err));
    }
  }

  // Facts from outside the material: the parent's setting, and the Wikipedia check behind "answer and check".
  const contact = config.wikipedia.contact;
  if (config.outsideKnowledge !== "check") {
    add(1, "ok", "Outside the reading", `Setting: ${config.outsideKnowledge === "answer" ? "answer without checking" : "material only"}. Nothing is checked against Wikipedia.`);
  } else {
    add(
      1,
      contact ? "ok" : "warn",
      "Outside the reading: Wikipedia checks (WIKIPEDIA_CONTACT)",
      contact
        ? "Setting: answer and check. Each request names this program and your contact, as Wikimedia requires."
        : "Setting: answer and check, but nothing is checked until WIKIPEDIA_CONTACT is set: an email address or website Wikimedia can reach. Add it to .env and restart.",
    );
    if (opts.ping && contact) {
      try {
        const { createWikipediaClient } = await import("./reference/wikipedia.js");
        const t0 = Date.now();
        const titles = await createWikipediaClient({ contact }).search("Aeneas");
        add(1, titles.length ? "ok" : "warn", "Wikipedia ping", `search answered in ${Date.now() - t0} ms${titles[0] ? ` (first result: ${titles[0]})` : ", with no results"}`);
      } catch (err) {
        add(1, "warn", "Wikipedia ping", err instanceof Error ? err.message : String(err));
      }
    }
  }

  // --- Stage 2: media ingestion ----------------------------------------------
  const ytdlp = await bin(config.ytDlpBin);
  add(2, ytdlp ? "ok" : "warn", `yt-dlp (${config.ytDlpBin})`, ytdlp ?? "Optional: needed for YouTube/TED/video URLs. Install: pip install yt-dlp  (or brew install yt-dlp)");
  const ffmpeg = await bin("ffmpeg", ["-version"]);
  add(2, ffmpeg ? "ok" : "warn", "ffmpeg", ffmpeg ? ffmpeg.slice(0, 40) : "Optional: yt-dlp downloads audio-only formats without it, but some sites need it.");
  switch (config.stt.provider) {
    case "deepgram":
      add(2, config.stt.deepgramApiKey ? "ok" : "warn", "Speech-to-text: Deepgram", config.stt.deepgramApiKey ? `model ${config.stt.deepgramModel}` : "Optional: DEEPGRAM_API_KEY needed for recordings without captions.");
      break;
    case "whisper-cli": {
      const w = await bin(config.stt.whisperBin, ["--help"]);
      add(2, w ? "ok" : "warn", `Speech-to-text: ${config.stt.whisperBin}`, w ? "" : "WHISPER_BIN not found on PATH.");
      break;
    }
    default:
      add(2, "warn", "Speech-to-text", "STT_PROVIDER=none: podcasts and caption-less videos will be refused.");
  }

  // --- Stage 3: voice in the browser (AssemblyAI in; Hume Octave, ElevenLabs or Inworld out, chosen in Settings) ---
  const stt = config.voice.sttProvider === "assemblyai" && Boolean(config.voice.assemblyAiKey);
  add(3, stt ? "ok" : "warn", "Speech-to-text: AssemblyAI (ASSEMBLYAI_API_KEY)", stt ? `model ${config.voice.assemblyAiModel}, end of turn after ${config.sttMinSilenceMs}-${config.sttMaxSilenceMs} ms of silence` : "Needed for the student to talk instead of type. Free key at assemblyai.com.");
  const elevenProblem = elevenKeyProblem(config.elevenlabs.apiKey);
  const inworldProblem = inworldKeyProblem(config.inworld.apiKey);
  const voices = [
    { id: "hume", item: "Text-to-speech: Hume Octave (HUME_API_KEY)", ready: Boolean(config.hume.apiKey), problem: "HUME_API_KEY is not set.", detail: `Octave ${config.ttsVersion}, voice "${config.ttsVoice}"${config.ttsInstant ? ", instant mode" : ""}. The key's presence is checked, not the balance.` },
    { id: "elevenlabs", item: "Text-to-speech: ElevenLabs (ELEVENLABS_API_KEY)", ready: !elevenProblem, problem: elevenProblem, detail: `${config.elevenModel}, voice "${config.ttsProvider === "elevenlabs" ? ttsVoiceLabel() : config.elevenVoiceName || config.elevenVoiceId}"` },
    { id: "inworld", item: "Text-to-speech: Inworld (INWORLD_API_KEY)", ready: !inworldProblem, problem: inworldProblem, detail: `${config.inworldModel}, voice "${config.inworldVoiceName || config.inworldVoiceId}", one stream per reply` },
  ] as const;
  for (const v of voices) {
    const selected = v.id === config.ttsProvider;
    const note = v.ready
      ? selected
        ? `Selected. ${v.detail}`
        : "Available: switch to it in Settings, Voice."
      : selected
        ? `Selected in Settings, but ${v.problem} Voice mode will show the tutor's text only.`
        : `Optional. ${v.problem}`;
    add(3, v.ready ? "ok" : "warn", v.item, note);
  }
  if (opts.ping && config.elevenlabs.apiKey) {
    try {
      const c = await elevenCredits();
      const left = Math.max(0, c.limit - c.used);
      add(3, "ok", "ElevenLabs credits", `${c.tier ?? "plan"}: ${left.toLocaleString()} of ${c.limit.toLocaleString()} characters left${c.resetsAt ? `, resets ${c.resetsAt.slice(0, 10)}` : ""}`);
    } catch (err) {
      add(3, config.ttsProvider === "elevenlabs" ? "fail" : "warn", "ElevenLabs credits", err instanceof Error ? err.message : String(err));
    }
  }
  if (opts.ping && !inworldProblem) {
    // Listing voices is free and proves the key works; a synthesis would spend characters.
    try {
      const n = (await listInworldVoices()).length;
      add(3, "ok", "Inworld key", `accepted; ${n} English voices available`);
    } catch (err) {
      add(3, config.ttsProvider === "inworld" ? "fail" : "warn", "Inworld key", err instanceof Error ? err.message : String(err));
    }
  }

  // --- Stage 3 (alternative): Hume EVI speech-to-speech, which calls us through a public URL ----
  const hume = Boolean(config.hume.apiKey && config.hume.secretKey);
  add(3, hume ? "ok" : "warn", "Hume EVI: HUME_API_KEY + HUME_SECRET_KEY", hume ? "Alternative voice path (needs a public URL)." : "Optional alternative voice path. Browser voice above does not need it.");
  if (hume) {
    add(3, config.hume.publicUrl ? "ok" : "warn", "PUBLIC_URL", config.hume.publicUrl ?? "Set to the public HTTPS URL of this server (e.g. ngrok) before `npm run setup:hume`.");
    add(3, config.hume.configId ? "ok" : "warn", "HUME_CONFIG_ID", config.hume.configId ?? "Run `npm run setup:hume` once PUBLIC_URL is set, then paste the id here.");
    add(3, config.hume.clmSecret ? "ok" : "warn", "CLM_SECRET", config.hume.clmSecret ? "set" : "Recommended: any long random string; protects the CLM endpoint.");
    const ngrok = await bin("ngrok", ["version"]);
    add(3, ngrok ? "ok" : "warn", "ngrok", ngrok ?? "Optional: `ngrok http 3001` is the quickest way to get a PUBLIC_URL during development.");
  }

  return {
    rows,
    blocking: rows.filter((r) => r.status === "fail").length,
    optional: rows.filter((r) => r.status === "warn").length,
    checkedAt: new Date().toISOString(),
  };
}

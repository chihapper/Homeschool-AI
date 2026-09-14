/**
 * Speech-to-text for audio files (podcast episodes, videos without captions, uploaded recordings).
 *
 * Providers:
 *  - deepgram     REST call to Deepgram (default; set DEEPGRAM_API_KEY). Returns utterances with timestamps.
 *  - whisper-cli  Local `whisper` (openai-whisper) or `whisper-cli` (whisper.cpp) binary writing a .vtt.
 *  - none         Refuse; used when no STT is configured so ingestion fails with a clear message.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { parseVtt, type Cue } from "./captions.js";

const run = promisify(execFile);

const MIME: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac" };

export function isAudioOrVideo(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() in MIME;
}

export async function transcribeFile(file: string): Promise<Cue[]> {
  switch (config.stt.provider) {
    case "deepgram":
      return transcribeDeepgram(file);
    case "whisper-cli":
      return transcribeWhisperCli(file);
    default:
      throw new Error("No speech-to-text configured. Set STT_PROVIDER=deepgram with DEEPGRAM_API_KEY, or STT_PROVIDER=whisper-cli.");
  }
}

interface DeepgramResponse {
  results?: { utterances?: Array<{ start: number; end: number; transcript: string }>; channels?: Array<{ alternatives?: Array<{ transcript?: string; paragraphs?: { paragraphs?: Array<{ start: number; end: number; sentences: Array<{ text: string }> }> } }> }> };
}

export async function transcribeDeepgram(file: string): Promise<Cue[]> {
  const key = config.stt.deepgramApiKey;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set.");
  const params = new URLSearchParams({ model: config.stt.deepgramModel, smart_format: "true", punctuate: "true", utterances: "true", paragraphs: "true" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  return deepgramToCues((await res.json()) as DeepgramResponse);
}

export function deepgramToCues(j: DeepgramResponse): Cue[] {
  const utt = j.results?.utterances;
  if (utt?.length) return utt.map((u) => ({ start: u.start, end: u.end, text: u.transcript.trim() })).filter((c) => c.text);
  const paras = j.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs;
  if (paras?.length) return paras.map((p) => ({ start: p.start, end: p.end, text: p.sentences.map((s) => s.text).join(" ").trim() }));
  const text = j.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  return text ? [{ start: 0, end: 0, text }] : [];
}

export async function transcribeWhisperCli(file: string): Promise<Cue[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-whisper-"));
  try {
    // openai-whisper CLI: `whisper file --output_format vtt --output_dir dir`
    await run(config.stt.whisperBin, [file, "--output_format", "vtt", "--output_dir", dir], { maxBuffer: 50 * 1024 * 1024 });
    const vtt = fs.readdirSync(dir).find((f) => f.endsWith(".vtt"));
    if (!vtt) throw new Error("whisper produced no .vtt output");
    return parseVtt(fs.readFileSync(path.join(dir, vtt), "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

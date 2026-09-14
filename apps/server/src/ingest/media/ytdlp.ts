/**
 * yt-dlp wrapper: metadata, subtitles, and audio download for YouTube, TED, Vimeo, and ~1,000 other sites.
 * Requires the `yt-dlp` binary (pip install yt-dlp, or brew install yt-dlp). Audio download does not
 * need ffmpeg when we ask for an already-encoded audio-only format.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { parseSrt, parseVtt, type Cue } from "./captions.js";

const run = promisify(execFile);

export interface MediaInfo {
  id: string;
  title: string;
  uploader?: string;
  durationSec?: number;
  description?: string;
  extractor: string;
  webpageUrl: string;
}

export async function ytDlpAvailable(): Promise<boolean> {
  try {
    await run(config.ytDlpBin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function mediaInfo(url: string): Promise<MediaInfo> {
  const { stdout } = await run(config.ytDlpBin, ["--dump-single-json", "--no-playlist", "--skip-download", url], { maxBuffer: 50 * 1024 * 1024 });
  const j = JSON.parse(stdout) as Record<string, unknown>;
  return {
    id: String(j.id ?? ""),
    title: String(j.title ?? url),
    uploader: (j.uploader as string | undefined) ?? (j.channel as string | undefined),
    durationSec: typeof j.duration === "number" ? j.duration : undefined,
    description: j.description as string | undefined,
    extractor: String(j.extractor_key ?? j.extractor ?? "unknown"),
    webpageUrl: String(j.webpage_url ?? url),
  };
}

/**
 * Download subtitles (manual first, then auto-generated) in the requested language.
 * Returns cues or undefined when the video has no captions.
 */
export async function fetchCaptions(url: string, lang = "en"): Promise<Cue[] | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-subs-"));
  try {
    await run(
      config.ytDlpBin,
      ["--skip-download", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", `${lang}.*,${lang}`, "--sub-format", "vtt/srt/best", "-o", path.join(dir, "media.%(ext)s"), url],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    const files = fs.readdirSync(dir).filter((f) => /\.(vtt|srt)$/.test(f));
    // Prefer manual captions (no "orig"/auto marker isn't exposed in the filename; yt-dlp writes manual first).
    const pick = files.find((f) => !/\.\w+-orig\./.test(f)) ?? files[0];
    if (!pick) return undefined;
    const raw = fs.readFileSync(path.join(dir, pick), "utf8");
    const cues = pick.endsWith(".srt") ? parseSrt(raw) : parseVtt(raw);
    return cues.length ? cues : undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Download the best audio-only stream to a temp file. Caller deletes it. */
export async function downloadAudio(url: string): Promise<{ file: string; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-audio-"));
  await run(
    config.ytDlpBin,
    ["--no-playlist", "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best", "-o", path.join(dir, "audio.%(ext)s"), url],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
  if (!file) throw new Error("yt-dlp did not produce an audio file.");
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

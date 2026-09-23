/**
 * One entry point for "turn this source into text": uploaded files (pdf/docx/pptx/md/txt/audio/video)
 * and URLs (YouTube, TED, Vimeo, podcast RSS feeds, direct audio links, plain web pages).
 */
import path from "node:path";
import { cuesToText, parseSrt, parseVtt, type Cue } from "./captions.js";
import { extractPptx, slidesToText } from "./pptx.js";
import { downloadToTemp, fetchFeed, isAudioUrl } from "./podcast.js";
import { isAudioOrVideo, transcribeFile } from "./transcribe.js";
import { downloadAudio, fetchCaptions, mediaInfo, ytDlpAvailable } from "./ytdlp.js";
import { extractTextFromBuffer } from "../extract.js";
import { htmlToText, titleFromHtml } from "../documents.js";

// These moved to ingest/documents.ts, which uploads and URLs both read from; kept exported here
// because this module is the documented entry point for turning a source into text.
export { htmlToText, titleFromHtml };

export type SourceKind = "file" | "video" | "podcast" | "audio" | "slides" | "url";

export interface SourceDocument {
  /** Display name (file name, video title, episode title). */
  fileName: string;
  text: string;
  kind: SourceKind;
  url?: string;
}

export interface SourceOptions {
  /** For podcast feeds: how many most-recent episodes to ingest (default 1). */
  episodes?: number;
  /** Caption language for videos. */
  lang?: string;
  onProgress?: (msg: string) => void;
}

/** Uploaded bytes -> document. Adds pptx and audio/video on top of extractTextFromBuffer. */
export async function documentFromUpload(buffer: Buffer, fileName: string, opts: SourceOptions = {}): Promise<SourceDocument> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pptx") {
    const slides = await extractPptx(buffer);
    return { fileName, text: slidesToText(slides, fileName), kind: "slides" };
  }
  if (isAudioOrVideo(fileName)) {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-upload-"));
    const file = path.join(dir, `media${ext}`);
    fs.writeFileSync(file, buffer);
    try {
      opts.onProgress?.(`Transcribing ${fileName}`);
      const cues = await transcribeFile(file);
      return { fileName, text: cuesToText(cues, { title: fileName }), kind: ext === ".mp4" || ext === ".webm" ? "video" : "audio" };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const d = await extractTextFromBuffer(buffer, fileName);
  return { ...d, kind: "file" };
}

/** URL -> one or more documents. */
export async function documentsFromUrl(url: string, opts: SourceOptions = {}): Promise<SourceDocument[]> {
  const u = new URL(url);
  if (isAudioUrl(url)) return [await transcribeRemoteAudio(url, path.basename(u.pathname), opts)];
  if (/\.(xml|rss)$/i.test(u.pathname) || /feed|rss|podcast/i.test(url)) {
    const feed = await tryFeed(url);
    if (feed) {
      const n = opts.episodes ?? 1;
      const out: SourceDocument[] = [];
      for (const ep of feed.episodes.slice(0, n)) {
        opts.onProgress?.(`Podcast "${feed.title}": episode "${ep.title}"`);
        // Podcasting 2.0 feeds may ship a transcript; use it before paying for speech-to-text.
        const published = ep.transcriptUrl ? await tryPublishedTranscript(ep.transcriptUrl, ep.transcriptType) : undefined;
        const doc = published
          ? { fileName: ep.title, kind: "podcast" as const, url: ep.audioUrl, text: cuesToText(published, { title: ep.title }) }
          : await transcribeRemoteAudio(ep.audioUrl, ep.title, opts);
        out.push({ ...doc, kind: "podcast", url: ep.audioUrl, text: (ep.description ? `${ep.description}\n\n` : "") + doc.text });
      }
      return out;
    }
  }
  if (/(^|\.)ted\.com$/i.test(u.hostname)) {
    // TED publishes transcripts on the talk page; yt-dlp's TED extractor is unreliable, so try the page first.
    const res = await fetch(url, { headers: { "user-agent": "homeschool-ai/0.1" } });
    if (res.ok) {
      const html = await res.text();
      const cues = tedCuesFromHtml(html);
      if (cues) {
        const title = titleFromHtml(html) ?? url;
        opts.onProgress?.(`TED: "${title}" (transcript from page)`);
        return [{ fileName: title, kind: "video", url, text: cuesToText(cues, { title }) }];
      }
    }
  }
  if (await ytDlpAvailable()) {
    // yt-dlp covers YouTube, TED, Vimeo, and most video/audio hosts.
    try {
      const info = await mediaInfo(url);
      opts.onProgress?.(`${info.extractor}: "${info.title}"${info.durationSec ? ` (${Math.round(info.durationSec / 60)} min)` : ""}`);
      const captions = await fetchCaptions(url, opts.lang ?? "en");
      let cues = captions;
      if (!cues) {
        opts.onProgress?.("No captions; downloading audio for transcription");
        const { file, cleanup } = await downloadAudio(url);
        try {
          cues = await transcribeFile(file);
        } finally {
          cleanup();
        }
      }
      const header = [info.uploader ? `Speaker/channel: ${info.uploader}` : "", info.description ? `Description: ${info.description.slice(0, 1500)}` : ""].filter(Boolean).join("\n");
      return [{ fileName: info.title, kind: "video", url: info.webpageUrl, text: (header ? `${header}\n\n` : "") + cuesToText(cues, { title: info.title }) }];
    } catch (err) {
      if (!/Unsupported URL|is not a valid URL/i.test(String(err))) throw err;
    }
  } else if (/youtube\.com|youtu\.be|ted\.com|vimeo\.com/i.test(url)) {
    throw new Error("yt-dlp is required for video URLs. Install it (pip install yt-dlp) or set YTDLP_BIN.");
  }
  // Plain web page: strip tags.
  opts.onProgress?.(`Fetching page ${url}`);
  const res = await fetch(url, { headers: { "user-agent": "homeschool-ai/0.1" } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  return [{ fileName: titleFromHtml(html) ?? url, kind: "url", url, text: htmlToText(html) }];
}

async function tryPublishedTranscript(url: string, type?: string): Promise<Cue[] | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const body = await res.text();
    const t = (type ?? "").toLowerCase();
    if (t.includes("vtt") || body.startsWith("WEBVTT")) return parseVtt(body);
    if (t.includes("srt") || /^\d+\s*\n\d{2}:\d{2}:\d{2},/.test(body)) return parseSrt(body);
    if (t.includes("json") || body.trim().startsWith("{")) {
      const j = JSON.parse(body) as { segments?: Array<{ startTime: number; endTime?: number; body: string }> };
      return j.segments?.map((s) => ({ start: s.startTime, end: s.endTime ?? s.startTime, text: s.body.trim() })).filter((c) => c.text);
    }
    return body.trim() ? [{ start: 0, end: 0, text: body.trim() }] : undefined;
  } catch {
    return undefined;
  }
}

async function tryFeed(url: string) {
  try {
    return await fetchFeed(url);
  } catch {
    return undefined;
  }
}

async function transcribeRemoteAudio(audioUrl: string, name: string, opts: SourceOptions): Promise<SourceDocument> {
  const ext = path.extname(new URL(audioUrl).pathname) || ".mp3";
  opts.onProgress?.(`Downloading ${name}`);
  const { file, cleanup } = await downloadToTemp(audioUrl, ext);
  try {
    opts.onProgress?.(`Transcribing ${name}`);
    const cues = await transcribeFile(file);
    return { fileName: name, kind: "audio", url: audioUrl, text: cuesToText(cues, { title: name }) };
  } finally {
    cleanup();
  }
}

/**
 * TED talk pages embed the talk data (including transcript cues) in a Next.js `__NEXT_DATA__` blob.
 * Best effort: deep-search that JSON for an array of cue-like objects. Returns undefined if not found.
 */
export function tedCuesFromHtml(html: string): Cue[] | undefined {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return undefined;
  }
  const found = findCueArray(data, 0);
  return found?.length ? found : undefined;
}

function findCueArray(node: unknown, depth: number): Cue[] | undefined {
  if (depth > 12 || node == null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    if (node.length > 3 && node.every((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).text === "string")) {
      const cues = node.map((x) => {
        const o = x as Record<string, unknown>;
        const startMs = num(o.start_ms ?? o.startMs ?? o.time ?? o.start ?? 0);
        const durMs = num(o.duration_ms ?? o.durationMs ?? o.duration ?? 0);
        return { start: startMs / 1000, end: (startMs + durMs) / 1000, text: String(o.text).replace(/\s+/g, " ").trim() };
      });
      if (cues.some((c) => c.start > 0)) return cues;
    }
    for (const item of node) {
      const r = findCueArray(item, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const r = findCueArray(v, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

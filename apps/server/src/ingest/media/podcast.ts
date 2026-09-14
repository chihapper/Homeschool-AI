/**
 * Podcast ingestion: RSS feed -> episodes (title, audio enclosure URL, description).
 * A direct .mp3/.m4a URL is also accepted as a single "episode".
 */
import { XMLParser } from "fast-xml-parser";

export interface Episode {
  title: string;
  audioUrl: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  /** Podcasting 2.0 <podcast:transcript url type> if the publisher provides one. */
  transcriptUrl?: string;
  transcriptType?: string;
}

export interface Feed {
  title: string;
  episodes: Episode[];
}

export function parseFeed(xml: string): Feed {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
  const doc = parser.parse(xml) as { rss?: { channel?: Record<string, unknown> } };
  const channel = doc.rss?.channel;
  if (!channel) throw new Error("Not an RSS podcast feed.");
  const itemsRaw = channel.item;
  const items = (Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : []) as Array<Record<string, unknown>>;
  const episodes: Episode[] = [];
  for (const it of items) {
    const enc = it.enclosure as { "@_url"?: string } | undefined;
    const url = enc?.["@_url"];
    if (!url) continue;
    const trRaw = it["podcast:transcript"] as Array<Record<string, string>> | Record<string, string> | undefined;
    const transcripts = (Array.isArray(trRaw) ? trRaw : trRaw ? [trRaw] : []).filter((t) => t?.["@_url"]);
    const preferred = transcripts.find((t) => /vtt|srt|json/i.test(t["@_type"] ?? "")) ?? transcripts[0];
    episodes.push({
      transcriptUrl: preferred?.["@_url"],
      transcriptType: preferred?.["@_type"],
      title: text(it.title) ?? "Untitled episode",
      audioUrl: url,
      description: text(it["content:encoded"]) ?? text(it.description) ?? text(it["itunes:summary"]),
      publishedAt: text(it.pubDate),
      durationSec: parseDuration(text(it["itunes:duration"])),
    });
  }
  return { title: text(channel.title) ?? "Podcast", episodes };
}

function text(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"]).trim();
  return undefined;
}

export function parseDuration(d?: string): number | undefined {
  if (!d) return undefined;
  if (/^\d+$/.test(d)) return Number(d);
  const parts = d.split(":").map(Number);
  return parts.some(Number.isNaN) ? undefined : parts.reduce((a, n) => a * 60 + n, 0);
}

export function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|wav|ogg|flac|aac)(\?.*)?$/i.test(url);
}

export async function fetchFeed(url: string): Promise<Feed> {
  const res = await fetch(url, { headers: { accept: "application/rss+xml, application/xml, text/xml, */*" } });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  return parseFeed(await res.text());
}

export async function downloadToTemp(url: string, ext: string): Promise<{ file: string; cleanup: () => void }> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsai-dl-"));
  const file = path.join(dir, `audio${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

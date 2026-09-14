import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { cuesToText, fmt, parseSrt, parseVtt } from "../src/ingest/media/captions.js";
import { extractPptx, slidesToText, textFromSlideXml } from "../src/ingest/media/pptx.js";
import { parseDuration, parseFeed } from "../src/ingest/media/podcast.js";
import { deepgramToCues } from "../src/ingest/media/transcribe.js";
import { htmlToText, tedCuesFromHtml, titleFromHtml } from "../src/ingest/media/sources.js";

describe("captions", () => {
  it("parses WebVTT with inline tags and de-duplicates rolling auto captions", () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
<c>Plants</c> make<00:00:01.000> food

00:00:02.000 --> 00:00:04.000
Plants make food

00:01:05.000 --> 00:01:07.000
from sunlight.
`;
    const cues = parseVtt(vtt);
    expect(cues).toEqual([
      { start: 0, end: 2, text: "Plants make food" },
      { start: 65, end: 67, text: "from sunlight." },
    ]);
    const text = cuesToText(cues, { title: "Photosynthesis", markerEverySec: 60 });
    expect(text).toBe("# Photosynthesis\n\n[0:00] Plants make food\n\n[1:05] from sunlight.");
  });

  it("parses SRT", () => {
    const cues = parseSrt("1\n00:00:01,500 --> 00:00:03,000\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nagain\n");
    expect(cues.map((c) => c.text)).toEqual(["Hello there", "again"]);
    expect(cues[0].start).toBe(1.5);
  });

  it("formats timestamps", () => {
    expect(fmt(65)).toBe("1:05");
    expect(fmt(3725)).toBe("1:02:05");
  });
});

describe("pptx", () => {
  const slide = (title: string, bullets: string[]) =>
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:txBody>${bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  it("extracts titles, bullets and notes in slide order", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", slide("Respiration", ["Uses O2 &amp; glucose", "Releases energy"]));
    zip.file("ppt/slides/slide1.xml", slide("Photosynthesis", ["Light", "Water", "CO2"]));
    zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes><p:txBody><a:p><a:r><a:t>Ask what plants eat.</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:notes>`);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const slides = await extractPptx(buf);
    expect(slides.map((s) => s.index)).toEqual([1, 2]);
    expect(slides[0]).toEqual({ index: 1, title: "Photosynthesis", body: "Light\nWater\nCO2", notes: "Ask what plants eat." });
    expect(slides[1].body).toBe("Uses O2 & glucose\nReleases energy");
    const text = slidesToText(slides, "bio.pptx");
    expect(text).toContain("# bio\n\n## Slide 1: Photosynthesis\n\nLight\nWater\nCO2\n\nSpeaker notes: Ask what plants eat.");
  });

  it("handles slides without a title placeholder", () => {
    expect(textFromSlideXml("<p:sld><a:p><a:r><a:t>Only body</a:t></a:r></a:p></p:sld>")).toEqual({ title: undefined, paragraphs: ["Only body"] });
  });
});

describe("podcast feeds", () => {
  it("parses items with enclosures", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Science Pod</title>
      <item><title>Ep 2</title><enclosure url="https://x/ep2.mp3" type="audio/mpeg"/><itunes:duration>01:02:03</itunes:duration><description><![CDATA[About cells]]></description></item>
      <item><title>Ep 1</title><enclosure url="https://x/ep1.mp3" type="audio/mpeg"/><itunes:duration>1800</itunes:duration><podcast:transcript url="https://x/ep1.txt" type="text/plain"/><podcast:transcript url="https://x/ep1.vtt" type="text/vtt"/></item>
      <item><title>No audio</title></item>
    </channel></rss>`;
    const feed = parseFeed(xml);
    expect(feed.title).toBe("Science Pod");
    expect(feed.episodes.map((e) => e.title)).toEqual(["Ep 2", "Ep 1"]);
    expect(feed.episodes[0]).toMatchObject({ audioUrl: "https://x/ep2.mp3", durationSec: 3723, description: "About cells" });
    expect(feed.episodes[1].durationSec).toBe(1800);
    expect(feed.episodes[1].transcriptUrl).toBe("https://x/ep1.vtt");
    expect(feed.episodes[0].transcriptUrl).toBeUndefined();
    expect(parseDuration("5:00")).toBe(300);
    expect(() => parseFeed("<html/>")).toThrow(/Not an RSS/);
  });
});

describe("deepgram response mapping", () => {
  it("prefers utterances, then paragraphs, then transcript", () => {
    expect(deepgramToCues({ results: { utterances: [{ start: 1, end: 2, transcript: " hi " }] } })).toEqual([{ start: 1, end: 2, text: "hi" }]);
    expect(deepgramToCues({ results: { channels: [{ alternatives: [{ paragraphs: { paragraphs: [{ start: 0, end: 3, sentences: [{ text: "A." }, { text: "B." }] }] } }] }] } })).toEqual([{ start: 0, end: 3, text: "A. B." }]);
    expect(deepgramToCues({ results: { channels: [{ alternatives: [{ transcript: "plain" }] }] } })).toEqual([{ start: 0, end: 0, text: "plain" }]);
    expect(deepgramToCues({})).toEqual([]);
  });
});

describe("html", () => {
  it("extracts title and readable text with headings", () => {
    const html = `<html><head><title> TED | Why we learn </title><style>x{}</style></head><body><nav>menu</nav><h1>Why we learn</h1><p>First &amp; second.</p><script>bad()</script></body></html>`;
    expect(titleFromHtml(html)).toBe("TED | Why we learn");
    expect(htmlToText(html)).toBe("# Why we learn\n\nFirst & second.");
  });
});

describe("TED page transcript", () => {
  it("finds cue arrays inside __NEXT_DATA__", () => {
    const data = { props: { pageProps: { talk: { title: "T" }, transcriptData: { translation: { paragraphs: [{ cues: [
      { text: "Hello", time: 0 }, { text: "world", time: 1200 }, { text: "again", time: 2400 }, { text: "end", time: 61000 },
    ] }] } } } } };
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
    const cues = tedCuesFromHtml(html)!;
    expect(cues.map((c) => c.text)).toEqual(["Hello", "world", "again", "end"]);
    expect(cues[1].start).toBe(1.2);
    expect(tedCuesFromHtml("<html>no data</html>")).toBeUndefined();
  });
});

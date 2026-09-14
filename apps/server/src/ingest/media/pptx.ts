/**
 * PowerPoint (.pptx) text extraction: slide text + speaker notes, in slide order.
 * A .pptx is a zip of XML; we read ppt/slides/slideN.xml and ppt/notesSlides/notesSlideN.xml.
 * Legacy binary .ppt is not supported (convert to .pptx first).
 */
import JSZip from "jszip";

export interface SlideText {
  index: number;
  title?: string;
  body: string;
  notes?: string;
}

/** Pull the text runs (<a:t>) out of a slide XML, grouping runs by paragraph (<a:p>). */
export function textFromSlideXml(xml: string): { title?: string; paragraphs: string[] } {
  const paragraphs: string[] = [];
  const paraRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml))) {
    const runs = [...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((r) => decode(r[1]));
    const text = runs.join("").trim();
    if (text) paragraphs.push(text);
  }
  // Title placeholder: <p:ph type="title"|"ctrTitle"> inside a shape.
  const titleShape = xml.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph[^>]*type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/);
  const title = titleShape ? [...titleShape[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((r) => decode(r[1])).join("").trim() : undefined;
  return { title: title || undefined, paragraphs };
}

function decode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export async function extractPptx(buffer: Buffer): Promise<SlideText[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => num(a) - num(b));
  const out: SlideText[] = [];
  for (const file of slideFiles) {
    const n = num(file);
    const { title, paragraphs } = textFromSlideXml(await zip.file(file)!.async("string"));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    let notes: string | undefined;
    if (notesFile) {
      const np = textFromSlideXml(await notesFile.async("string")).paragraphs.filter((p) => !/^\d+$/.test(p)); // drop slide-number placeholder
      notes = np.join("\n").trim() || undefined;
    }
    const body = paragraphs.filter((p) => p !== title).join("\n");
    out.push({ index: n, title, body, notes });
  }
  return out;
}

/** Render slides as markdown-ish text with headings so the chunker keeps slide boundaries. */
export function slidesToText(slides: SlideText[], deckName: string): string {
  const parts = [`# ${deckName.replace(/\.pptx$/i, "")}`];
  for (const s of slides) {
    parts.push(`## Slide ${s.index}${s.title ? `: ${s.title}` : ""}`);
    if (s.body) parts.push(s.body);
    if (s.notes) parts.push(`Speaker notes: ${s.notes}`);
  }
  return parts.join("\n\n");
}

function num(f: string): number {
  return Number(f.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

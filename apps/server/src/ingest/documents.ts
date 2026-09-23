/**
 * Document formats whose text lives inside markup: EPUB and ODT (both zips of XML, like .pptx),
 * RTF, and raw HTML.
 *
 * Also the shared text helpers, so `extract.ts` (uploads) and `media/sources.ts` (URLs) can both use
 * them without importing each other. Both re-export what they used to own, so existing imports of
 * `normalize`, `htmlToText` and `titleFromHtml` keep working from where they were.
 *
 * Every reader here produces markdown-ish plain text: headings as `#` lines, paragraphs separated by
 * blank lines. That is what `chunk.ts` reads to keep heading context, so a chapter title in an EPUB
 * ends up as the heading path on its chunks.
 */
import JSZip from "jszip";

/** Collapse whitespace noise from PDF extraction without destroying paragraph breaks. */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Is this file bytes rather than text? A NUL byte never occurs in UTF-8 text, and a scattering of
 * other control characters means the same thing. Without this check an unrecognised binary is read as
 * UTF-8, normalised into plausible-looking mojibake, and handed to the curriculum agent, which builds
 * a course out of it. Failing loudly is the whole point.
 */
export function looksBinary(buffer: Buffer): boolean {
  const n = Math.min(buffer.length, 4096);
  if (!n) return false;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buffer[i];
    if (b === 0) return true;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) odd++;
  }
  return odd / n > 0.02;
}

export function titleFromHtml(html: string): string | undefined {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string): string {
  return normalize(
    html
      .replace(/<head[\s\S]*?<\/head>/i, " ")
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<(h[1-6])[^>]*>/gi, (_m, h: string) => `\n\n${"#".repeat(Number(h[1]))} `)
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .split("\n")
      .map((l) => l.trim())
      .join("\n"),
  );
}

// ---- EPUB ------------------------------------------------------------------------------------

/**
 * An EPUB is a zip whose `META-INF/container.xml` names a package file (.opf). That package lists
 * every file (the manifest) and the order a reader should show them in (the spine). Reading the spine
 * rather than the zip's own file order is what keeps chapters in the order the author intended.
 */
export function spineOrder(opf: string): string[] {
  const hrefById = new Map<string, string>();
  for (const [tag] of opf.matchAll(/<item\b[^>]*\/?>/g)) {
    const id = tag.match(/\bid="([^"]*)"/)?.[1];
    const href = tag.match(/\bhref="([^"]*)"/)?.[1];
    const type = tag.match(/\bmedia-type="([^"]*)"/)?.[1] ?? "";
    if (id && href && /x?html/i.test(type)) hrefById.set(id, href);
  }
  const order: string[] = [];
  for (const [tag] of opf.matchAll(/<itemref\b[^>]*\/?>/g)) {
    const idref = tag.match(/\bidref="([^"]*)"/)?.[1];
    const href = idref ? hrefById.get(idref) : undefined;
    if (href) order.push(href);
  }
  // A spine is required, but tolerate a malformed one rather than returning an empty book.
  return order.length ? order : [...hrefById.values()];
}

/** Resolve an href that is relative to the package file's own folder. */
export function resolveHref(opfPath: string, href: string): string {
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const joined = `${base}${decodeURIComponent(href.split("#")[0])}`;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export async function epubToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container?.match(/<rootfile\b[^>]*\bfull-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("This .epub has no META-INF/container.xml, so it is not a readable EPUB.");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error(`This .epub names a package file (${opfPath}) that is not in the archive.`);

  const parts: string[] = [];
  for (const href of spineOrder(opf)) {
    const text = await zip.file(resolveHref(opfPath, href))?.async("string");
    if (text) parts.push(htmlToText(text));
  }
  return normalize(parts.filter(Boolean).join("\n\n"));
}

// ---- ODT (LibreOffice / OpenOffice) ----------------------------------------------------------

/**
 * ODT keeps the whole document in `content.xml`. Headings carry their level as an attribute, which we
 * turn into markdown `#` so the chunker sees the document's structure.
 */
export function odtXmlToText(xml: string): string {
  const body = xml.replace(/[\s\S]*?<office:body\b[^>]*>/, "").replace(/<\/office:body>[\s\S]*/, "");
  return normalize(
    body
      .replace(/<text:h\b([^>]*)>/g, (_m, attrs: string) => {
        const level = Number(attrs.match(/text:outline-level="(\d+)"/)?.[1] ?? 1);
        return `\n\n${"#".repeat(Math.min(Math.max(level, 1), 6))} `;
      })
      .replace(/<text:tab\b[^>]*\/>/g, " ")
      .replace(/<text:s\b[^>]*\/>/g, " ")
      .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      .replace(/<\/text:(h|p)>/g, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .split("\n")
      .map((l) => l.trim())
      .join("\n"),
  );
}

export async function odtToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("content.xml")?.async("string");
  if (!xml) throw new Error("This .odt has no content.xml, so it is not a readable OpenDocument file.");
  return odtXmlToText(xml);
}

// ---- RTF -------------------------------------------------------------------------------------

/**
 * Rich Text Format is a flat text file of nested `{...}` groups and `\control` words. This reads the
 * words and the paragraph breaks and ignores everything else — fonts, colours, tables and embedded
 * images are all dropped. Good enough for a worksheet or a reading; not a faithful converter.
 */
export function rtfToText(rtf: string): string {
  let s = rtf;
  // Destination groups hold metadata, not readable text: {\*\generator ...}, {\fonttbl ...}, pictures.
  s = s.replace(/\{\\\*[\s\S]*?\}/g, " ");
  for (const dest of ["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer"]) {
    s = s.replace(new RegExp(`\\{\\\\${dest}[\\s\\S]*?\\}`, "g"), " ");
  }
  s = s
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\s?\??/g, (_m, code: string) => String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)))
    .replace(/\\(par|line|pard)\b\s?/g, "\n\n")
    .replace(/\\tab\b\s?/g, " ")
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\([\\{}])/g, "$1");
  return normalize(s);
}

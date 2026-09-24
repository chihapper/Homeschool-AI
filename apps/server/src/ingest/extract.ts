/**
 * Turn an uploaded file into plain text.
 *
 * Read directly: .pdf, .docx, .epub, .odt, .rtf, .html, .md, .txt and anything else text-like.
 * Read by the model: .png, .jpg, .gif, .webp — scans and photographs of pages (see `ocr.ts`).
 * Unpacked: .zip, whose readable members are read and concatenated.
 *
 * Anything else fails with a message saying what to do about it, rather than being read as UTF-8.
 * That fallback used to apply to every unknown file, so a binary produced mojibake that looked enough
 * like text to build a course from.
 *
 * Slides (.pptx) and audio/video are handled a layer up, in `media/sources.ts`, which is the single
 * entry point for "turn this source into text".
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import mammoth from "mammoth";
import JSZip from "jszip";
import { epubToText, htmlToText, looksBinary, normalize, odtToText, rtfToText } from "./documents.js";
import { isImage, transcribeImage } from "./ocr.js";
import { pagerender, type PdfPageLike } from "./pdf-text.js";

const require = createRequire(import.meta.url);

export { normalize };

export interface ExtractedDocument {
  fileName: string;
  text: string;
}

/** A file we recognise but cannot read. The message always says how to get a readable version. */
export class UnsupportedFileError extends Error {
  constructor(
    readonly fileName: string,
    reason: string,
  ) {
    super(`${fileName}: ${reason}`);
    this.name = "UnsupportedFileError";
  }
}

/** Formats with a well-known conversion path. Being specific here saves a support round-trip. */
const CONVERT_FIRST: Record<string, string> = {
  ".doc": "Word 97-2003 (.doc) is a binary format with no reliable text reader. Open it in Word or LibreOffice and save as .docx.",
  ".ppt": "PowerPoint 97-2003 (.ppt) cannot be read. Open it and save as .pptx.",
  ".xls": "Spreadsheets are not course material this tool can teach from. Export the sheet as .csv if the text matters.",
  ".xlsx": "Spreadsheets are not course material this tool can teach from. Export the sheet as .csv if the text matters.",
  ".pages": "Apple Pages. Use File > Export To > PDF (or Word) and upload that.",
  ".key": "Apple Keynote. Use File > Export To > PDF (or PowerPoint) and upload that.",
  ".numbers": "Apple Numbers. Export the sheet as .csv if the text matters.",
  ".mobi": "Kindle format. Convert it to EPUB (Calibre does this) and upload that.",
  ".azw": "Kindle format. Convert it to EPUB (Calibre does this) and upload that.",
  ".azw3": "Kindle format. Convert it to EPUB (Calibre does this) and upload that.",
  ".tif": "TIFF scans cannot be sent to the model. Save the page as .png or .jpg.",
  ".tiff": "TIFF scans cannot be sent to the model. Save the page as .png or .jpg.",
  ".bmp": "BMP scans cannot be sent to the model. Save the page as .png or .jpg.",
  ".heic": "iPhone photos in HEIC cannot be sent to the model. Export the photo as .jpg.",
};

/** Extensions that are plain text under another name, so the default reader is right for them. */
const TEXT_LIKE = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".rst", ".org", ".json", ".xml", ".vtt", ".srt", ""]);

const MARKUP = new Set([".html", ".htm", ".xhtml"]);

/**
 * Can this extension be read at this layer? Used to pick members out of an archive. `.zip` is included
 * so a nested archive is refused by name in the skipped list, rather than dropped without explanation.
 */
export function canExtract(ext: string): boolean {
  return (
    ext === ".pdf" || ext === ".docx" || ext === ".epub" || ext === ".odt" || ext === ".rtf" || ext === ".zip" || MARKUP.has(ext) || TEXT_LIKE.has(ext) || isImage(`x${ext}`)
  );
}

export async function extractText(filePath: string, originalName?: string): Promise<ExtractedDocument> {
  const fileName = originalName ?? path.basename(filePath);
  return extractTextFromBuffer(fs.readFileSync(filePath), fileName);
}

export async function extractTextFromBuffer(buffer: Buffer, fileName: string, depth = 0): Promise<ExtractedDocument> {
  const ext = path.extname(fileName).toLowerCase();
  if (CONVERT_FIRST[ext]) throw new UnsupportedFileError(fileName, CONVERT_FIRST[ext]);

  switch (ext) {
    case ".pdf": {
      // pdf-parse v1 is CommonJS; load lazily so the module isn't required for non-PDF runs.
      const pdfParse = require("pdf-parse") as (data: Buffer, options?: { pagerender: (page: PdfPageLike) => Promise<string> }) => Promise<{ text: string }>;
      // Pages are joined by glyph geometry (pdf-text.ts): the default renderer fuses the words of a scan's OCR layer.
      const { text } = await pdfParse(buffer, { pagerender });
      const out = normalize(text);
      if (!out) {
        throw new UnsupportedFileError(
          fileName,
          "this PDF has no text layer, which means it is a scan. Export its pages as .png or .jpg images and upload those, and they will be read as scans.",
        );
      }
      return { fileName, text: out };
    }
    case ".docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return { fileName, text: normalize(value) };
    }
    case ".epub":
      return { fileName, text: await epubToText(buffer) };
    case ".odt":
      return { fileName, text: await odtToText(buffer) };
    case ".rtf":
      return { fileName, text: rtfToText(buffer.toString("utf8")) };
    case ".zip":
      return { fileName, text: await zipToText(buffer, fileName, depth) };
    default:
      if (isImage(fileName)) return { fileName, text: await transcribeImage(buffer, fileName) };
      if (MARKUP.has(ext)) return { fileName, text: htmlToText(buffer.toString("utf8")) };
      if (looksBinary(buffer)) {
        throw new UnsupportedFileError(
          fileName,
          `this is not a text file and ${ext || "a file with no extension"} is not a format this tool can read. Readable formats: PDF, Word (.docx), EPUB, ODT, RTF, HTML, markdown, plain text, PowerPoint (.pptx), page scans (.png/.jpg), audio and video.`,
        );
      }
      return { fileName, text: normalize(buffer.toString("utf8")) };
  }
}

/**
 * A zip of course material: read every member we can and concatenate them in name order, each under a
 * heading of its own filename so the chunker keeps track of which file a passage came from.
 *
 * Members this layer cannot read are listed rather than silently dropped. Slides and audio inside a
 * zip are among them: those readers live a layer up, and reaching back up to them from here would
 * make the two modules import each other.
 */
async function zipToText(buffer: Buffer, fileName: string, depth: number): Promise<string> {
  if (depth > 0) throw new UnsupportedFileError(fileName, "a zip inside a zip is not unpacked. Extract it and upload the files.");
  const zip = await JSZip.loadAsync(buffer);
  const members = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith("__MACOSX/") && !path.basename(f.name).startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const parts: string[] = [];
  const skipped: string[] = [];
  for (const member of members.slice(0, 200)) {
    if (!canExtract(path.extname(member.name).toLowerCase())) {
      skipped.push(member.name);
      continue;
    }
    try {
      const doc = await extractTextFromBuffer(await member.async("nodebuffer"), member.name, depth + 1);
      if (doc.text.trim()) parts.push(`# ${member.name}\n\n${doc.text}`);
    } catch (err) {
      skipped.push(`${member.name} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  if (!parts.length) {
    throw new UnsupportedFileError(
      fileName,
      `nothing readable in this archive. It holds ${members.length} file(s): ${members.slice(0, 8).map((m) => m.name).join(", ")}${members.length > 8 ? ", ..." : ""}`,
    );
  }
  if (skipped.length) console.warn(`[ingest] ${fileName}: skipped ${skipped.length} member(s): ${skipped.slice(0, 5).join("; ")}`);
  return normalize(parts.join("\n\n"));
}

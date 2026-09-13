/**
 * Turn an uploaded file into plain text. Supported: .pdf, .docx, .md, .txt (and anything text-like).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);

export interface ExtractedDocument {
  fileName: string;
  text: string;
}

export async function extractText(filePath: string, originalName?: string): Promise<ExtractedDocument> {
  const fileName = originalName ?? path.basename(filePath);
  return extractTextFromBuffer(fs.readFileSync(filePath), fileName);
}

export async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf": {
      // pdf-parse v1 is CommonJS; load lazily so the module isn't required for non-PDF runs.
      const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<{ text: string }>;
      const { text } = await pdfParse(buffer);
      return { fileName, text: normalize(text) };
    }
    case ".docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return { fileName, text: normalize(value) };
    }
    default:
      return { fileName, text: normalize(buffer.toString("utf8")) };
  }
}

/** Collapse whitespace noise from PDF extraction without destroying paragraph breaks. */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

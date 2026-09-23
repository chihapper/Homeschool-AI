/**
 * Scanned pages and photographed worksheets.
 *
 * A photo of a page has no text layer, so nothing can read it by parsing bytes. The model reads it
 * instead: the image goes to Claude with an instruction to transcribe, and the transcript joins the
 * ingestion pipeline as if it had been a text file all along.
 *
 * Grounding is a product requirement for this app: the tutor must not assert facts outside the course
 * material. A transcriber that guesses at a blurred word would quietly manufacture course material,
 * so the prompt demands verbatim text and an explicit `[illegible]` for anything unreadable. Treat a
 * scan as lower-confidence source material than a text file, and check it in "Source passages" before
 * teaching from it.
 *
 * The API call sits behind an injectable `ImageReader` so tests stay pure (no network), the same seam
 * `agents/base.ts` uses for streaming.
 */
import path from "node:path";
import { config } from "../config.js";
import { anthropic, assertNotRefused, reasoningParams, textOf } from "../llm/client.js";

/** Image formats the Anthropic API accepts. Anything else has to be converted first. */
const MEDIA_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 5 MB is the API's per-image ceiling; base64 inflates by about a third, so check before encoding. */
const MAX_IMAGE_BYTES = 3_700_000;

export const TRANSCRIPTION_PROMPT =
  "This is a scan or photograph of a page of teaching material. Transcribe it.\n\n" +
  "Rules:\n" +
  "- Write out every word exactly as it appears. Do not paraphrase, summarise, correct spelling, or fix grammar.\n" +
  "- Do not add anything that is not on the page: no explanations, no answers to the questions, no commentary.\n" +
  "- Keep the reading order of the page. Use a markdown heading (#, ##) for a line that is clearly a title or a section heading, and keep numbered or bulleted lists as lists.\n" +
  "- For a diagram, chart or photograph, write one line in square brackets describing what it shows, e.g. [Diagram: cross-section of a leaf, labelled].\n" +
  "- If a word or passage is cut off, blurred or unreadable, write [illegible] in its place. Never guess at it.\n" +
  "- If the page has no readable text at all, reply with exactly: [no text]\n\n" +
  "Output only the transcription.";

export function isImage(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() in MEDIA_TYPES;
}

export type ImageReader = (args: { buffer: Buffer; mediaType: string; fileName: string }) => Promise<string>;

/** The real call. Effort is low and thinking is off: this is transcription, not reasoning. */
const readWithClaude: ImageReader = async ({ buffer, mediaType }) => {
  const res = await anthropic.messages.create({
    model: config.model,
    max_tokens: 8_000,
    ...reasoningParams(config.model, "low", "disabled"),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data: buffer.toString("base64") } },
          { type: "text", text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
  });
  assertNotRefused(res);
  return textOf(res.content);
};

/**
 * Read a scanned page. Returns "" when the page holds no text, which the caller reports as an empty
 * document rather than inventing one.
 */
export async function transcribeImage(buffer: Buffer, fileName: string, read: ImageReader = readWithClaude): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`${fileName}: ${ext} images cannot be read. Save it as .png or .jpg and upload that.`);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `${fileName} is ${(buffer.length / 1e6).toFixed(1)} MB, over the 3.7 MB limit for a page image. Scan at a lower resolution, or save it as a PDF instead.`,
    );
  }
  const text = (await read({ buffer, mediaType, fileName })).trim();
  return text === "[no text]" ? "" : text;
}

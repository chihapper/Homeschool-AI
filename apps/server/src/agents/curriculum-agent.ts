/**
 * Curriculum Agent: uploaded material -> structured Course.
 *
 * Runs offline (not latency-sensitive). Uses structured outputs so the result is schema-valid,
 * and processes large sources in batches of chunks that are merged deterministically.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import { config } from "../config.js";
import { CurriculumExtractionSchema, type Course, type CurriculumExtraction, type SourceChunk } from "../domain/types.js";
import { chunkDocument, slug } from "../ingest/chunk.js";
import type { ExtractedDocument } from "../ingest/extract.js";
import type { SourceDocument } from "../ingest/media/sources.js";
import { buildSystem, type AgentSpec } from "./base.js";
import { courses } from "../store/index.js";

export const curriculumAgent: AgentSpec = {
  name: "Curriculum Agent",
  role:
    "You convert a homeschool parent's raw teaching material into a structured course that a Socratic tutor can teach from. " +
    "You are meticulous and faithful to the source. You never add content the material does not contain.",
  skills: ["curriculum-parsing", "grounding"],
  get model() {
    return config.model;
  },
  get effort() {
    return config.analysisEffort;
  },
};

/**
 * Budget per extraction call, in characters of source text. The binding limit is the 32k-token output
 * ceiling, not the input: at this level of detail the model writes roughly 0.6-0.8 characters of course
 * JSON per character of source, and 32k tokens is about 85k characters of JSON. Measured 2026-09-23 on the
 * 49-page Ancient Rome guide (142k chars in one call): cut off at 85,558 characters. So a call takes at
 * most ~100k characters, a unit of that size or less is one call, and a bigger unit is split; parts run in
 * parallel and `mergeExtractions` concatenates their lessons and dedupes concepts by id.
 */
export const BATCH_CHARS = 100_000;

export interface IngestOptions {
  titleHint?: string;
  onProgress?: (msg: string) => void;
}

export async function ingestCourse(docs: Array<ExtractedDocument | SourceDocument>, opts: IngestOptions = {}): Promise<Course> {
  const chunks: SourceChunk[] = docs.flatMap((d) => chunkDocument(d.text, d.fileName));
  if (!chunks.length) throw new Error("No text could be extracted from the uploaded material.");

  const batches = batchChunks(chunks, BATCH_CHARS);
  // Parts are independent ("extract only what is in this part"), so they run at the same time: a unit that
  // splits in two takes as long as one part, not two.
  const extractions: CurriculumExtraction[] = await Promise.all(
    batches.map((batch, i) => {
      opts.onProgress?.(`Extracting batch ${i + 1}/${batches.length} (${batch.length} chunks)`);
      return extractBatch(batch, opts.titleHint, i, batches.length, docs, opts.onProgress);
    }),
  );

  const merged = mergeExtractions(extractions);
  const id = `${slug(opts.titleHint ?? merged.title)}-${Date.now().toString(36)}`;
  const course: Course = {
    id,
    title: opts.titleHint ?? merged.title,
    subject: merged.subject,
    level: merged.level,
    description: merged.description,
    lessons: merged.lessons.map((l, i) => ({ ...l, id: `${slug(l.title)}-${i + 1}`, order: i })),
    concepts: merged.concepts,
    chunks,
    sourceFiles: docs.map((d) => d.fileName),
    sources: docs.map((d) => ({ name: d.fileName, kind: "kind" in d ? d.kind : "file", url: "url" in d ? d.url : undefined })),
    createdAt: new Date().toISOString(),
  };
  validateReferences(course);
  return courses.put(course);
}

async function extractBatch(
  batch: SourceChunk[],
  titleHint: string | undefined,
  index: number,
  total: number,
  docs: Array<ExtractedDocument | SourceDocument>,
  onProgress?: (msg: string) => void,
): Promise<CurriculumExtraction> {
  const system = buildSystem(curriculumAgent, []);
  const spoken = docs.filter((d) => "kind" in d && (d.kind === "video" || d.kind === "podcast" || d.kind === "audio")).map((d) => d.fileName);
  const slides = docs.filter((d) => "kind" in d && d.kind === "slides").map((d) => d.fileName);
  const material = batch
    .map((c) => `<chunk id="${c.id}" heading="${c.headingPath.join(" > ")}">\n${c.text}\n</chunk>`)
    .join("\n\n");
  const instructions = [
    titleHint ? `The parent calls this course "${titleHint}".` : "",
    total > 1 ? `This is part ${index + 1} of ${total} of the material. Extract only what is in this part.` : "",
    spoken.length ? `These sources are transcripts of spoken recordings (${spoken.join("; ")}): paragraphs start with [mm:ss] timestamps. Segment lessons by topic shift, not by timestamp; quote the speaker's own phrasing in key facts; ignore filler, sponsor reads, and intros.` : "",
    slides.length ? `These sources are slide decks (${slides.join("; ")}): treat "Speaker notes" as the lecturer's explanation of the slide; a run of slides on one idea is one concept.` : "",
    "Extract the course structure from the material below. Reference chunks by their id in sourceChunkIds.",
  ]
    .filter(Boolean)
    .join("\n");

  // Streamed: a unit-sized batch at high effort generates for ten minutes or more, longer than any
  // non-streaming request survives (see streamParsed).
  let reported = 0;
  const { message, parsed } = await streamParsed<CurriculumExtraction>(
    {
      model: curriculumAgent.model,
      max_tokens: 32_000,
      system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
      output_config: { effort: curriculumAgent.effort, format: zodOutputFormat(CurriculumExtractionSchema) },
      messages: [{ role: "user", content: `${instructions}\n\n<material>\n${material}\n</material>` }],
    },
    {
      onProgress: (chars) => {
        if (chars - reported < 20_000) return;
        reported = chars;
        onProgress?.(`Still extracting part ${index + 1}/${total}: ${Math.round(chars / 1000)}k characters of course structure so far`);
      },
    },
  );
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") {
    throw new Error(`Curriculum extraction hit the output limit on part ${index + 1}/${total} (${batch.length} chunks). Lower BATCH_CHARS in curriculum-agent.ts so each part is smaller.`);
  }
  if (!parsed) throw new Error("Curriculum extraction returned no parsable output.");
  return parsed;
}

export function batchChunks(chunks: SourceChunk[], maxChars: number): SourceChunk[][] {
  const out: SourceChunk[][] = [];
  let cur: SourceChunk[] = [];
  let len = 0;
  for (const c of chunks) {
    if (len + c.text.length > maxChars && cur.length) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(c);
    len += c.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function mergeExtractions(parts: CurriculumExtraction[]): CurriculumExtraction {
  const first = parts[0];
  const conceptIds = new Set<string>();
  const concepts = parts
    .flatMap((p) => p.concepts)
    .filter((c) => {
      if (conceptIds.has(c.id)) return false;
      conceptIds.add(c.id);
      return true;
    });
  return {
    title: first.title,
    subject: first.subject,
    level: first.level,
    description: parts.map((p) => p.description).join(" "),
    lessons: parts.flatMap((p) => p.lessons),
    concepts,
  };
}

/** Drop dangling references so downstream code can trust ids. */
export function validateReferences(course: Course): void {
  const chunkIds = new Set(course.chunks.map((c) => c.id));
  const conceptIds = new Set(course.concepts.map((c) => c.id));
  for (const c of course.concepts) {
    c.sourceChunkIds = c.sourceChunkIds.filter((id) => chunkIds.has(id));
    c.prerequisites = c.prerequisites.filter((id) => conceptIds.has(id) && id !== c.id);
  }
  for (const l of course.lessons) l.conceptIds = l.conceptIds.filter((id) => conceptIds.has(id));
  course.lessons = course.lessons.filter((l) => l.conceptIds.length > 0);
}

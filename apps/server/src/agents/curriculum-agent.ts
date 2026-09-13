/**
 * Curriculum Agent: uploaded material -> structured Course.
 *
 * Runs offline (not latency-sensitive). Uses structured outputs so the result is schema-valid,
 * and processes large sources in batches of chunks that are merged deterministically.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, assertNotRefused } from "../llm/client.js";
import { config } from "../config.js";
import { CurriculumExtractionSchema, type Course, type CurriculumExtraction, type SourceChunk } from "../domain/types.js";
import { chunkDocument, slug } from "../ingest/chunk.js";
import type { ExtractedDocument } from "../ingest/extract.js";
import { buildSystem, type AgentSpec } from "./base.js";
import { courses } from "../store/index.js";

export const curriculumAgent: AgentSpec = {
  name: "Curriculum Agent",
  role:
    "You convert a homeschool parent's raw teaching material into a structured course that a Socratic tutor can teach from. " +
    "You are meticulous and faithful to the source. You never add content the material does not contain.",
  skills: ["curriculum-parsing", "grounding"],
  model: config.model,
  effort: config.analysisEffort,
};

/** Rough budget per extraction call, in characters of source text. */
const BATCH_CHARS = 120_000;

export interface IngestOptions {
  titleHint?: string;
  onProgress?: (msg: string) => void;
}

export async function ingestCourse(docs: ExtractedDocument[], opts: IngestOptions = {}): Promise<Course> {
  const chunks: SourceChunk[] = docs.flatMap((d) => chunkDocument(d.text, d.fileName));
  if (!chunks.length) throw new Error("No text could be extracted from the uploaded material.");

  const batches = batchChunks(chunks, BATCH_CHARS);
  const extractions: CurriculumExtraction[] = [];
  for (const [i, batch] of batches.entries()) {
    opts.onProgress?.(`Extracting batch ${i + 1}/${batches.length} (${batch.length} chunks)`);
    extractions.push(await extractBatch(batch, opts.titleHint, i, batches.length));
  }

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
    createdAt: new Date().toISOString(),
  };
  validateReferences(course);
  return courses.put(course);
}

async function extractBatch(batch: SourceChunk[], titleHint: string | undefined, index: number, total: number): Promise<CurriculumExtraction> {
  const system = buildSystem(curriculumAgent, []);
  const material = batch
    .map((c) => `<chunk id="${c.id}" heading="${c.headingPath.join(" > ")}">\n${c.text}\n</chunk>`)
    .join("\n\n");
  const instructions = [
    titleHint ? `The parent calls this course "${titleHint}".` : "",
    total > 1 ? `This is part ${index + 1} of ${total} of the material. Extract only what is in this part.` : "",
    "Extract the course structure from the material below. Reference chunks by their id in sourceChunkIds.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.parse({
    model: curriculumAgent.model,
    max_tokens: 32_000,
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: curriculumAgent.effort, format: zodOutputFormat(CurriculumExtractionSchema) },
    messages: [{ role: "user", content: `${instructions}\n\n<material>\n${material}\n</material>` }],
  });
  assertNotRefused(response);
  if (!response.parsed_output) throw new Error("Curriculum extraction returned no parsable output.");
  return response.parsed_output;
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

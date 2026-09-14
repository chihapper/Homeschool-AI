/**
 * Ingest course material from the command line.
 *
 *   npm run ingest -- --title "Life Science 7" path/to/chapter1.pdf path/to/lecture.pptx
 *   npm run ingest -- --title "Cells" https://www.youtube.com/watch?v=... https://www.ted.com/talks/...
 *   npm run ingest -- --episodes 3 https://feeds.example.com/podcast.rss
 */
import { ingestCourse } from "../agents/curriculum-agent.js";
import fs from "node:fs";
import path from "node:path";
import { documentFromUpload, documentsFromUrl, type SourceDocument } from "../ingest/media/sources.js";
import { requireAnthropicKey } from "../config.js";

async function main(): Promise<void> {
  requireAnthropicKey();
  const args = process.argv.slice(2);
  let title: string | undefined;
  let episodes = 1;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title") title = args[++i];
    else if (args[i] === "--episodes") episodes = Number(args[++i]);
    else inputs.push(args[i]);
  }
  if (!inputs.length) {
    console.error("Usage: npm run ingest -- [--title \"Course title\"] [--episodes N] <file-or-url> [...]");
    process.exit(1);
  }
  const docs: SourceDocument[] = [];
  for (const input of inputs) {
    if (/^https?:\/\//.test(input)) {
      docs.push(...(await documentsFromUrl(input, { episodes, onProgress: (m) => console.log(`  ${m}`) })));
    } else {
      docs.push(await documentFromUpload(fs.readFileSync(input), path.basename(input), { onProgress: (m) => console.log(`  ${m}`) }));
    }
    const d = docs.at(-1)!;
    console.log(`Extracted ${d.text.length.toLocaleString()} chars from ${d.fileName} (${d.kind})`);
  }
  const course = await ingestCourse(docs, { titleHint: title, onProgress: (m) => console.log(m) });
  console.log(`\nCourse "${course.title}" (${course.id})`);
  console.log(`  ${course.subject} · ${course.level}`);
  console.log(`  ${course.lessons.length} lessons, ${course.concepts.length} concepts, ${course.chunks.length} chunks`);
  for (const l of course.lessons) console.log(`  - ${l.title} [${l.id}]: ${l.conceptIds.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

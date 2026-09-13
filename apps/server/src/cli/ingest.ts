/**
 * Ingest course material from the command line.
 *
 *   npm run ingest -- --title "Life Science 7" path/to/chapter1.pdf path/to/worksheet.docx
 */
import { ingestCourse } from "../agents/curriculum-agent.js";
import { extractText } from "../ingest/extract.js";
import { requireAnthropicKey } from "../config.js";

async function main(): Promise<void> {
  requireAnthropicKey();
  const args = process.argv.slice(2);
  let title: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title") title = args[++i];
    else files.push(args[i]);
  }
  if (!files.length) {
    console.error("Usage: npm run ingest -- [--title \"Course title\"] <file> [<file> ...]");
    process.exit(1);
  }
  const docs = [];
  for (const f of files) {
    const d = await extractText(f);
    console.log(`Extracted ${d.text.length.toLocaleString()} chars from ${d.fileName}`);
    docs.push(d);
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

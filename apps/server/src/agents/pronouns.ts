/**
 * A record about a child must not give them a gender nobody stated.
 *
 * The intake skills say so, and the model still does it from the name alone: on 2026-10-05 a scripted "Maya"
 * came back with "her answers" in the tutoring guidance and a scripted "Eli" with "He did not yet know" in the
 * summary for the parent, though neither student nor parent had used a pronoun. A wrong pronoun follows the
 * child into every prompt and every report. So the two intake extractions are checked after they are written:
 * the detection here is plain code, and when it finds something the record is sent back once to be reworded.
 *
 * Only the parent's notes can license a pronoun ("he shuts down if rushed"). The student's own words cannot:
 * they speak in the first person, and a "he" in their speech is about somebody else.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config.js";
import { assertNotRefused, streamParsed } from "../llm/client.js";

export type PronounFamily = "he" | "she";
const FAMILY: Record<PronounFamily, RegExp> = {
  he: /\b(he|him|his|himself)\b/i,
  she: /\b(she|her|hers|herself)\b/i,
};

/**
 * Text with quoted speech taken out: what a student said about someone else is not the record's own voice.
 * Double quotes and curly quotes always; single quotes only when they are not apostrophes inside a word.
 */
export function outsideQuotes(text: string): string {
  return text
    .replace(/"[^"\n]*"/g, " ")
    .replace(/“[^”\n]*”/g, " ")
    .replace(/(?<![A-Za-z])'[^\n]*?'(?![A-Za-z])/g, " ");
}

/** The pronoun families a parent's notes use for their child, which the records may then use too. */
export function licensedBy(parentNotes: string | undefined): Set<PronounFamily> {
  const notes = parentNotes ?? "";
  return new Set((Object.keys(FAMILY) as PronounFamily[]).filter((f) => FAMILY[f].test(notes)));
}

/**
 * The sentences of a record that use a gendered pronoun in the record's own voice, when nobody licensed it.
 * Deliberately broad: a pronoun for someone else ("Caesar named it after himself") is caught too, and the
 * rewording pass is told to leave those alone. A needless second look costs one short call; a missed "her"
 * stays on a child's record.
 */
export function genderedSentences(texts: string[], licensed: Set<PronounFamily> = new Set()): string[] {
  const unlicensed = (Object.keys(FAMILY) as PronounFamily[]).filter((f) => !licensed.has(f));
  const out: string[] = [];
  for (const text of texts) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const bare = outsideQuotes(sentence);
      if (unlicensed.some((f) => FAMILY[f].test(bare))) out.push(sentence.trim());
    }
  }
  return out;
}

/**
 * Send a freshly written record back once to have unlicensed pronouns for the student reworded, when the check
 * finds any. Returns the record unchanged when there is nothing to fix, or when the second pass fails: a
 * record with a stray pronoun is better than no record.
 */
export async function withoutAssignedGender<T>(record: T, schema: z.ZodType<T>, opts: { name: string; parentNotes?: string; texts: (r: T) => string[] }): Promise<T> {
  const licensed = licensedBy(opts.parentNotes);
  const flagged = genderedSentences(opts.texts(record), licensed);
  if (!flagged.length) return record;
  const first = opts.name.split(/\s+/)[0];
  try {
    const { message, parsed } = await streamParsed<T>({
      model: config.model,
      max_tokens: 16_000,
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      messages: [
        {
          role: "user",
          content:
            `This record about a student named ${first} uses "he" or "she" for them in places, and nothing ${first} or a parent said gives a gender. ` +
            `Return the same record with every pronoun that refers to ${first} reworded: use the name ${first}, or they/them/their. ` +
            `Change nothing else: not a fact, not a quotation, not the order, and not a pronoun that refers to anyone other than ${first} (a person in the material, a relative, a character). ` +
            `Words inside quotation marks are ${first}'s own and stay exactly as they are.\n\n` +
            `Sentences to look at:\n${flagged.map((s) => `- ${s}`).join("\n")}\n\n<record>\n${JSON.stringify(record, null, 1)}\n</record>`,
        },
      ],
    });
    assertNotRefused(message);
    return parsed ?? record;
  } catch (err) {
    console.warn("[intake] could not reword pronouns in a record:", err instanceof Error ? err.message : err);
    return record;
  }
}

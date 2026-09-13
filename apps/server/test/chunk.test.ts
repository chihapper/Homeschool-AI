import { describe, expect, it } from "vitest";
import { chunkDocument, detectHeading } from "../src/ingest/chunk.js";

describe("detectHeading", () => {
  it("recognises markdown, chapter, lesson and ALL CAPS headings", () => {
    expect(detectHeading("# Photosynthesis")).toEqual({ level: 1, title: "Photosynthesis" });
    expect(detectHeading("### The light reactions")).toEqual({ level: 3, title: "The light reactions" });
    expect(detectHeading("Chapter 3: Cells")?.level).toBe(1);
    expect(detectHeading("Lesson 2 - Membranes")?.level).toBe(2);
    expect(detectHeading("KEY VOCABULARY")?.level).toBe(2);
    expect(detectHeading("The mitochondria is the powerhouse of the cell.")).toBeUndefined();
  });
});

describe("chunkDocument", () => {
  const text = [
    "# Unit 1",
    "",
    "## Photosynthesis",
    "",
    "Plants make sugar from light. ".repeat(20),
    "",
    "The light reactions happen in the thylakoid. ".repeat(20),
    "",
    "## Respiration",
    "",
    "Cells break sugar down to release energy. ".repeat(10),
  ].join("\n");

  it("keeps heading context on every chunk", () => {
    const chunks = chunkDocument(text, "bio.md", { maxChars: 700, minChars: 200 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].headingPath).toEqual(["Unit 1", "Photosynthesis"]);
    expect(chunks.at(-1)?.headingPath).toEqual(["Unit 1", "Respiration"]);
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it("splits very long paragraphs on sentence boundaries", () => {
    const long = "This is a sentence. ".repeat(300);
    const chunks = chunkDocument(long, "long.txt", { maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 520)).toBe(true);
  });
});

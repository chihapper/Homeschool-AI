import { describe, expect, it } from "vitest";
import { BATCH_CHARS, batchChunks, mergeExtractions } from "../src/agents/curriculum-agent.js";
import type { CurriculumExtraction, SourceChunk } from "../src/domain/types.js";

const chunk = (i: number, size: number): SourceChunk => ({ id: `c${i}`, source: "unit.pdf", headingPath: [], text: "x".repeat(size), order: i });
const sizes = (parts: SourceChunk[][]) => parts.map((p) => p.reduce((a, c) => a + c.text.length, 0));

describe("splitting a unit into extraction parts", () => {
  it("keeps a unit under the budget in one part", () => {
    const parts = batchChunks(Array.from({ length: 40 }, (_, i) => chunk(i, 1_500)), BATCH_CHARS);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(40);
  });

  it("balances a bigger unit across the fewest parts instead of filling the first to the brim", () => {
    // The Ancient Rome guide: ~142k characters in 94 chunks, budget 100k. Greedy filling gave 100k + 42k;
    // the first part then ran into the model's output ceiling.
    const chunks = Array.from({ length: 94 }, (_, i) => chunk(i, 1_517));
    const parts = batchChunks(chunks, 100_000);
    expect(parts).toHaveLength(2);
    const [a, b] = sizes(parts);
    expect(Math.abs(a - b)).toBeLessThan(3_000);
    expect(Math.max(a, b)).toBeLessThanOrEqual(100_000);
    // Nothing lost, order kept.
    expect(parts.flat().map((c) => c.id)).toEqual(chunks.map((c) => c.id));
  });

  it("never returns an empty part, and gives an oversized chunk a part of its own", () => {
    expect(batchChunks([], 100)).toEqual([]);
    const parts = batchChunks([chunk(0, 50), chunk(1, 500), chunk(2, 50)], 100);
    expect(parts.map((p) => p.map((c) => c.id))).toEqual([["c0"], ["c1"], ["c2"]]);
  });
});

describe("merging the parts", () => {
  const part = (title: string, lessons: string[], concepts: string[]): CurriculumExtraction => ({
    title, subject: "History", level: "7", publisher: "", grades: "", description: `${title}.`,
    lessons: lessons.map((t) => ({ title: t, objectives: [], conceptIds: [], guidingQuestions: [], practiceItems: [] })),
    concepts: concepts.map((id) => ({ id, name: id, summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] })),
  });

  it("concatenates lessons in part order and keeps the first copy of a concept seen twice", () => {
    const merged = mergeExtractions([part("Rome", ["Food", "Clothing"], ["diet", "toga"]), part("Rome part 2", ["Government"], ["toga", "senate"])]);
    expect(merged.title).toBe("Rome");
    expect(merged.lessons.map((l) => l.title)).toEqual(["Food", "Clothing", "Government"]);
    expect(merged.concepts.map((c) => c.id)).toEqual(["diet", "toga", "senate"]);
    expect(merged.description).toBe("Rome. Rome part 2.");
  });
});

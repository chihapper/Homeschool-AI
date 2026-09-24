import { describe, expect, it } from "vitest";
import { ChunkIndex, searchWithLearner } from "../src/ingest/retrieval.js";
import { chunkDocument } from "../src/ingest/chunk.js";
import type { SourceChunk } from "../src/domain/types.js";

describe("ChunkIndex", () => {
  const chunks = chunkDocument(
    [
      "# Cells",
      "",
      "The cell membrane controls what enters and leaves the cell. It is selectively permeable.",
      "",
      "# Photosynthesis",
      "",
      "Chlorophyll absorbs light energy in the chloroplast. Plants produce glucose and oxygen.",
      "",
      "# Weather",
      "",
      "Warm air rises and cools, forming clouds when water vapour condenses.",
    ].join("\n"),
    "science.md",
    { minChars: 10, maxChars: 200 },
  );
  const index = new ChunkIndex(chunks);

  it("ranks the relevant passage first", () => {
    expect(index.search("what does chlorophyll do")[0].chunk.headingPath).toEqual(["Photosynthesis"]);
    expect(index.search("selectively permeable membrane")[0].chunk.headingPath).toEqual(["Cells"]);
  });

  it("returns nothing for stop-words only or unmatched queries", () => {
    expect(index.search("the and of")).toEqual([]);
    expect(index.search("quantum chromodynamics")).toEqual([]);
  });
});

describe("searching with the learner's words as well as the tutor's", () => {
  // The Ancient Rome shape: many passages talk about the Etruscans and Rome in general; exactly one
  // mentions coinage, and the tutor's query never uses that word.
  const rome = (id: string, text: string): SourceChunk => ({ id, source: "rome.pdf", headingPath: ["ROME"], text, order: Number(id.slice(1)) });
  const chunks = [
    rome("c0", "The Etruscans ruled Rome for about a century. Rome lived under the Etruscan kings, and the Etruscans gave Rome much."),
    rome("c1", "The Etruscans to the north dominated Rome; the Etruscans and Rome were united with Latium. The Etruscans gave Rome the plain."),
    rome("c2", "Under the Etruscans Rome grew. The Etruscans gave Rome roads and Rome gave the Etruscans soldiers."),
    rome("c3", "Rome threw off the Etruscans in 510 B.C. The Etruscans gave Rome a republic to build, and Rome built it."),
    rome("c4", "When Rome was small the Etruscans gave Rome kings, and Rome and the Etruscans traded."),
    rome("c5", "The Etruscans also introduced coinage to the Romans, and they were the first to construct public buildings in Rome."),
  ];
  const index = new ChunkIndex(chunks);

  it("finds the one passage the learner named even when the tutor's query alone misses it", () => {
    const tutorOnly = index.search("what the Etruscans gave Rome", 4).map((h) => h.chunk.id);
    expect(tutorOnly).not.toContain("c5");
    const both = searchWithLearner(index, "what the Etruscans gave Rome", "Quick question: what did the Etruscans actually give Rome? I heard coinage.").map((h) => h.chunk.id);
    expect(both.slice(0, 4)).toEqual(tutorOnly); // the tutor's hits come first, unchanged
    expect(both).toContain("c5");
    expect(both.length).toBeLessThanOrEqual(6);
  });

  it("adds nothing when the learner said nothing new, and never repeats a passage", () => {
    const hits = searchWithLearner(index, "coinage", "coinage", 4);
    expect(hits.map((h) => h.chunk.id)).toEqual(["c5"]);
    expect(searchWithLearner(index, "coinage", undefined).map((h) => h.chunk.id)).toEqual(["c5"]);
    expect(searchWithLearner(index, "coinage", "   ").map((h) => h.chunk.id)).toEqual(["c5"]);
  });
});

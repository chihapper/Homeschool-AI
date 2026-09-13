import { describe, expect, it } from "vitest";
import { ChunkIndex } from "../src/ingest/retrieval.js";
import { chunkDocument } from "../src/ingest/chunk.js";

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

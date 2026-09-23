import { describe, expect, it } from "vitest";
import { joinTextItems, LINE_GAP, pagerender, WORD_GAP, type PdfTextItem } from "../src/ingest/pdf-text.js";

/** Lay words out on a line the way an OCR text layer does: one item per word, no space glyphs. */
function line(y: number, words: Array<[text: string, x: number, width: number]>): PdfTextItem[] {
  return words.map(([str, x, width]) => ({ str, transform: [10, 0, 0, 10, x, y], width }));
}

describe("joining PDF text items by geometry", () => {
  it("puts a space between items only when there is a real gap", () => {
    // "Wh" + "ile" are one word split by kerning (gap 0.5); "many" starts 3 units later.
    expect(joinTextItems(line(700, [["Wh", 10, 8], ["ile", 18.5, 9], ["many", 30.5, 16]]))).toBe("While many");
    expect(joinTextItems(line(700, [["a", 10, 4], ["b", 10 + 4 + WORD_GAP, 4]]))).toBe("ab"); // exactly the threshold is not a gap
  });

  it("reconstructs a fused sentence with single spaces", () => {
    const words = ["While", "many", "of", "the", "details", "have", "been", "questioned"];
    let x = 72;
    const items = line(680, words.map((w) => { const item: [string, number, number] = [w, x, w.length * 5]; x += w.length * 5 + 3; return item; }));
    expect(joinTextItems(items)).toBe("While many of the details have been questioned");
  });

  it("starts a new line when the baseline moves, and ignores scan jitter on the same line", () => {
    const items = [...line(700, [["first", 72, 20]]), ...line(700 - LINE_GAP, [["line", 96, 18]]), ...line(686, [["second", 72, 28]])];
    expect(joinTextItems(items)).toBe("first line\nsecond");
    // A new line never gets a leading space, even if the x position jumped.
    expect(joinTextItems([...line(700, [["end", 300, 12]]), ...line(686, [["start", 72, 20]])])).toBe("end\nstart");
  });

  it("skips empty marker items without inserting stray spaces", () => {
    const items: PdfTextItem[] = [...line(700, [["one", 10, 12]]), { str: "", transform: [1, 0, 0, 1, 500, 700], width: 0 }, ...line(700, [["two", 25, 12]])];
    expect(joinTextItems(items)).toBe("one two");
    expect(joinTextItems([])).toBe("");
  });

  it("asks pdf.js for uncombined items and joins them", async () => {
    let asked: unknown;
    const page = { getTextContent: async (o: { disableCombineTextItems: boolean }) => { asked = o; return { items: line(700, [["hello", 0, 25], ["world", 28, 25]]) }; } };
    await expect(pagerender(page)).resolves.toBe("hello world");
    expect(asked).toEqual({ disableCombineTextItems: true });
  });
});

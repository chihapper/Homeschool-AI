/**
 * Text from PDF pages by geometry, not by trusting the text layer's own spaces.
 *
 * pdf-parse's default page renderer concatenates a page's text items and only breaks a line when the
 * baseline changes. A born-digital PDF usually carries its spaces inside the items, so that works. The OCR
 * layer of a scanned page, and some exported PDFs, store each word as its own item with no space glyph
 * between them, so the words fuse: "Whilemanyofthedetailsofthisstory". Fused words defeat the tutor's
 * passage search, which matches whole words, and make quoted evidence unreadable.
 *
 * Measured 2026-09-23 on the Ancient Rome unit (a 49-page scan): 7,889 words the default way, 24,632 by
 * geometry; identical output on two born-digital guides; a third guide that the default fused (40 words)
 * came out whole (513).
 */

export interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix; [4] is x and [5] is y of the item's origin, in PDF user-space units. */
  transform: number[];
  width: number;
}

/** A horizontal gap wider than this between two items is a word space (roughly points). */
export const WORD_GAP = 1.5;
/** A baseline shift larger than this is a new line; smaller shifts are jitter on the same line. */
export const LINE_GAP = 2;

export function joinTextItems(items: PdfTextItem[]): string {
  let out = "";
  let rightEdge: number | undefined;
  let baseline: number | undefined;
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    if (baseline !== undefined && Math.abs(y - baseline) > LINE_GAP) out += "\n";
    else if (rightEdge !== undefined && x - rightEdge > WORD_GAP) out += " ";
    out += item.str;
    rightEdge = x + item.width;
    baseline = y;
  }
  return out;
}

export interface PdfPageLike {
  getTextContent(options: { disableCombineTextItems: boolean }): Promise<{ items: PdfTextItem[] }>;
}

/** pdf-parse's `pagerender` hook: every page goes through the geometry join. */
export function pagerender(page: PdfPageLike): Promise<string> {
  return page.getTextContent({ disableCombineTextItems: true }).then((content) => joinTextItems(content.items));
}

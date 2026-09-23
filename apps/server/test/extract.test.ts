import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { canExtract, extractTextFromBuffer, UnsupportedFileError } from "../src/ingest/extract.js";
import { looksBinary, odtXmlToText, resolveHref, rtfToText, spineOrder } from "../src/ingest/documents.js";
import { transcribeImage } from "../src/ingest/ocr.js";

async function epubFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file(
    "OEBPS/book.opf",
    `<package><manifest>
       <item id="css" href="style.css" media-type="text/css"/>
       <item id="two" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
       <item id="one" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
     </manifest>
     <spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  );
  zip.file("OEBPS/text/ch1.xhtml", `<html><head><title>ignored</title></head><body><h1>Cells</h1><p>A cell is the smallest unit of life.</p></body></html>`);
  zip.file("OEBPS/text/ch2.xhtml", `<html><body><h1>Tissues</h1><p>Cells of one kind form a tissue.</p></body></html>`);
  zip.file("OEBPS/style.css", "body { margin: 0 }");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("EPUB", () => {
  it("reads chapters in spine order, not zip order, and skips non-HTML items", () => {
    const opf = `<manifest>
      <item id="c" href="s.css" media-type="text/css"/>
      <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
      <item id="a" href="a.html" media-type="text/html"/>
    </manifest><spine><itemref idref="a"/><itemref idref="b"/></spine>`;
    expect(spineOrder(opf)).toEqual(["a.html", "b.xhtml"]);
    // A book with no usable spine still returns its readable files rather than nothing.
    expect(spineOrder(`<manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>`)).toEqual(["a.xhtml"]);
  });

  it("resolves hrefs against the package file's folder", () => {
    expect(resolveHref("OEBPS/book.opf", "text/ch1.xhtml")).toBe("OEBPS/text/ch1.xhtml");
    expect(resolveHref("OEBPS/sub/book.opf", "../images/../text/ch1.xhtml#start")).toBe("OEBPS/text/ch1.xhtml");
    expect(resolveHref("book.opf", "ch1.xhtml")).toBe("ch1.xhtml");
    expect(resolveHref("OEBPS/book.opf", "text/a%20b.xhtml")).toBe("OEBPS/text/a b.xhtml");
  });

  it("turns a book into headed text the chunker can read", async () => {
    const { text } = await extractTextFromBuffer(await epubFixture(), "life-science.epub");
    expect(text).toBe("# Cells\n\nA cell is the smallest unit of life.\n\n# Tissues\n\nCells of one kind form a tissue.");
  });
});

describe("ODT", () => {
  it("keeps heading levels and drops styling", () => {
    const xml = `<?xml version="1.0"?><office:document-content><office:automatic-styles><style:style style:name="P1"/></office:automatic-styles><office:body><office:text>
      <text:h text:style-name="H1" text:outline-level="1">Unit 3</text:h>
      <text:h text:outline-level="2">Photosynthesis</text:h>
      <text:p>Plants make<text:s/>their own food.</text:p>
      <text:p>Inputs:<text:tab/>light, water &amp; CO<text:span>2</text:span>.</text:p>
    </office:text></office:body></office:document-content>`;
    expect(odtXmlToText(xml)).toBe("# Unit 3\n\n## Photosynthesis\n\nPlants make their own food.\n\nInputs: light, water & CO2.");
  });
});

describe("RTF", () => {
  it("reads the words and the paragraph breaks, and drops the rest", () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\froman Times;}}{\*\generator Riched20}\f0\fs24 Lesson 1: Cells\par A cell is 60\'b5m across.\par \b Bold\b0  text.\par}`;
    expect(rtfToText(rtf)).toBe("Lesson 1: Cells\n\nA cell is 60µm across.\n\nBold text.");
  });
});

describe("binary detection", () => {
  it("tells a text file from bytes", () => {
    expect(looksBinary(Buffer.from("Plants make their own food.\n\nLight, water, CO2."))).toBe(false);
    expect(looksBinary(Buffer.from("Café — naïve résumé ✓"))).toBe(false);
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true); // a zip's first bytes
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe("the dispatcher", () => {
  it("reads HTML as headed text", async () => {
    const html = `<html><head><title>x</title></head><body><nav>Home</nav><h2>Cell walls</h2><p>Only plant cells have one.</p></body></html>`;
    const { text } = await extractTextFromBuffer(Buffer.from(html), "lesson.html");
    expect(text).toBe("## Cell walls\n\nOnly plant cells have one.");
  });

  it("still reads plain text with an unfamiliar extension", async () => {
    const { text } = await extractTextFromBuffer(Buffer.from("# Notes\n\nplants"), "notes.study");
    expect(text).toBe("# Notes\n\nplants");
  });

  it("refuses a binary instead of turning it into mojibake", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x1a, 0x0a, 0x00, 0x00]);
    await expect(extractTextFromBuffer(bytes, "mystery.dat")).rejects.toBeInstanceOf(UnsupportedFileError);
    await expect(extractTextFromBuffer(bytes, "mystery.dat")).rejects.toThrow(/not a text file/);
  });

  it("names the conversion for formats with a known path out", async () => {
    await expect(extractTextFromBuffer(Buffer.from("x"), "unit3.doc")).rejects.toThrow(/save as \.docx/);
    await expect(extractTextFromBuffer(Buffer.from("x"), "book.mobi")).rejects.toThrow(/Convert it to EPUB/);
    await expect(extractTextFromBuffer(Buffer.from("x"), "page.tif")).rejects.toThrow(/\.png or \.jpg/);
    await expect(extractTextFromBuffer(Buffer.from("x"), "syllabus.pages")).rejects.toThrow(/Export To/);
  });
});

describe("zip archives", () => {
  it("reads what it can, heads each file with its name, and keeps them in order", async () => {
    const zip = new JSZip();
    zip.file("02-tissues.md", "Cells of one kind form a tissue.");
    zip.file("01-cells.md", "A cell is the smallest unit of life.");
    zip.file("__MACOSX/._01-cells.md", "junk");
    zip.file(".DS_Store", "junk");
    zip.file("photo.dat", Buffer.from([0, 1, 2, 3]));
    const { text } = await extractTextFromBuffer(await zip.generateAsync({ type: "nodebuffer" }), "unit.zip");
    expect(text).toBe("# 01-cells.md\n\nA cell is the smallest unit of life.\n\n# 02-tissues.md\n\nCells of one kind form a tissue.");
  });

  it("does not unpack a zip inside a zip", async () => {
    const inner = new JSZip();
    inner.file("a.md", "hello");
    const outer = new JSZip();
    outer.file("inner.zip", await inner.generateAsync({ type: "nodebuffer" }));
    await expect(extractTextFromBuffer(await outer.generateAsync({ type: "nodebuffer" }), "outer.zip")).rejects.toThrow(/nothing readable/);
  });

  it("says what was in an archive it could not read", async () => {
    const zip = new JSZip();
    zip.file("slides.key", "x");
    await expect(extractTextFromBuffer(await zip.generateAsync({ type: "nodebuffer" }), "course.zip")).rejects.toThrow(/slides\.key/);
  });

  it("agrees with itself about which members are worth opening", () => {
    for (const ext of [".pdf", ".docx", ".epub", ".odt", ".rtf", ".html", ".md", ".txt", ".png", ".jpg", ".zip", ""]) expect(canExtract(ext)).toBe(true);
    for (const ext of [".doc", ".key", ".mp3", ".pptx", ".exe"]) expect(canExtract(ext)).toBe(false);
  });
});

describe("scanned pages", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("sends the page to the reader and returns what it transcribed", async () => {
    const seen: string[] = [];
    const text = await transcribeImage(png, "worksheet.png", async ({ mediaType, fileName }) => {
      seen.push(`${fileName} ${mediaType}`);
      return "  # Worksheet 4\n\n1. Name the three inputs.  ";
    });
    expect(seen).toEqual(["worksheet.png image/png"]);
    expect(text).toBe("# Worksheet 4\n\n1. Name the three inputs.");
  });

  it("reports an empty page as empty rather than inventing one", async () => {
    expect(await transcribeImage(png, "blank.jpg", async () => "[no text]")).toBe("");
  });

  it("refuses formats the API cannot take, and pages too big to send", async () => {
    await expect(transcribeImage(png, "scan.tiff", async () => "x")).rejects.toThrow(/\.png or \.jpg/);
    await expect(transcribeImage(Buffer.alloc(4_000_000), "huge.png", async () => "x")).rejects.toThrow(/lower resolution/);
  });
});

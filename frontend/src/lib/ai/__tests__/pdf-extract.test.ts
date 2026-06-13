// Unit tests for the PDF extraction utility (BeakerAI lane, 2026-06-13).
//
// The extraction function depends on pdfjs-dist, which requires a real PDF binary
// to exercise end-to-end. That path is tested by Grant in the browser (attach a real
// PDF, confirm extraction + the draft fan-out cards appear). These unit tests mock
// pdfjs-dist to pin the isolation logic: per-page joins, the truncation cap, the
// truncated flag, and empty-page skipping. They do NOT test that pdfjs-dist can
// actually parse a PDF, only that our wrapper handles its output correctly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractPdfText, TEXT_BUDGET_CHARS } from "../pdf-extract";

// ---- Mock pdfjs-dist --------------------------------------------------------
//
// We mock the module so no real PDF worker is needed. The mock exposes a
// getDocument() that accepts a { data } arg and resolves to a fake PDF object
// whose pages return configurable text content.

type FakePage = {
  items: Array<{ str: string }>;
};

// Registry of per-test page content. Reset in beforeEach.
let fakePages: FakePage[] = [];

vi.mock("pdfjs-dist", () => {
  const GlobalWorkerOptions = { workerSrc: "" };

  return {
    GlobalWorkerOptions,
    getDocument: (_opts: unknown) => ({
      promise: Promise.resolve({
        numPages: fakePages.length,
        getPage: (pageNum: number) =>
          Promise.resolve({
            getTextContent: () =>
              Promise.resolve({ items: fakePages[pageNum - 1]?.items ?? [] }),
          }),
        // PDFDocumentProxy exposes cleanup(), not destroy().
        cleanup: vi.fn(async () => undefined),
      }),
    }),
  };
});

beforeEach(() => {
  fakePages = [];
});

// ---- helpers ----------------------------------------------------------------

function makePages(texts: string[]): FakePage[] {
  return texts.map((t) => ({ items: [{ str: t }] }));
}

// ---- tests ------------------------------------------------------------------

describe("extractPdfText: basic extraction", () => {
  it("extracts text from a single page", async () => {
    fakePages = makePages(["This is the abstract."]);
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.text).toBe("This is the abstract.");
    expect(result.pageCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("concatenates multiple pages with double newlines", async () => {
    fakePages = makePages(["Page one content.", "Page two content.", "Page three."]);
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.text).toBe("Page one content.\n\nPage two content.\n\nPage three.");
    expect(result.pageCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("skips pages that are empty after joining", async () => {
    // A page whose items produce only whitespace after join+trim is skipped.
    fakePages = [
      { items: [{ str: "Real content here." }] },
      { items: [{ str: "   " }] }, // whitespace only, should be skipped
      { items: [{ str: "More content." }] },
    ];
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.text).toBe("Real content here.\n\nMore content.");
    expect(result.truncated).toBe(false);
  });

  it("reports the correct pageCount even when pages are empty", async () => {
    fakePages = [
      { items: [] }, // empty items
      { items: [{ str: "Has text." }] },
    ];
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.pageCount).toBe(2);
    expect(result.text).toBe("Has text.");
  });

  it("returns an empty string for a document with no extractable text", async () => {
    fakePages = [{ items: [] }, { items: [] }];
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.text).toBe("");
    expect(result.pageCount).toBe(2);
    expect(result.truncated).toBe(false);
  });
});

describe("extractPdfText: truncation cap", () => {
  it("does not truncate text that fits within TEXT_BUDGET_CHARS", async () => {
    const short = "x".repeat(100);
    fakePages = makePages([short]);
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.text).toBe(short);
    expect(result.truncated).toBe(false);
  });

  it("truncates text that exceeds TEXT_BUDGET_CHARS and sets truncated=true", async () => {
    // The separator between pages is "\n\n" (2 chars). So if the first page is
    // TEXT_BUDGET_CHARS - 10 chars, the separator takes 2 of the remaining 10,
    // leaving 8 chars for the second page before the budget is hit.
    const firstPage = "a".repeat(TEXT_BUDGET_CHARS - 10);
    const secondPage = "b".repeat(200); // will be cut to 8 chars (budget: 10 - 2 sep = 8)
    fakePages = makePages([firstPage, secondPage]);
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(TEXT_BUDGET_CHARS);
    // 8 "b"s after the separator, accounting for the "\n\n".
    expect(result.text.endsWith("b".repeat(8))).toBe(true);
  });

  it("stops processing pages once the budget is hit", async () => {
    // Three pages; the first page exactly fills the budget. When the loop
    // reaches the second page, separator + remaining = "\n\n" + 0 = negative
    // remaining, so it marks truncated=true and stops. Text length equals the budget.
    const bigPage = "z".repeat(TEXT_BUDGET_CHARS);
    fakePages = makePages([bigPage, "should never appear", "also never appear"]);
    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(TEXT_BUDGET_CHARS);
    expect(result.text).not.toContain("should never appear");
    // pageCount still reflects the real total pages (3), even though we stopped early.
    expect(result.pageCount).toBe(3);
  });

  it("TEXT_BUDGET_CHARS is 60000", () => {
    expect(TEXT_BUDGET_CHARS).toBe(60_000);
  });
});

describe("extractPdfText: File source", () => {
  it("accepts a File object (reads its arrayBuffer)", async () => {
    fakePages = makePages(["From a File."]);
    // A real File.arrayBuffer() returns empty bytes; the mock ignores the bytes
    // and just returns fakePages. We only need to confirm the function does not
    // throw when given a File.
    const file = new File(["fake pdf bytes"], "paper.pdf", { type: "application/pdf" });
    const result = await extractPdfText(file);
    expect(result.text).toBe("From a File.");
    expect(result.pageCount).toBe(1);
  });
});

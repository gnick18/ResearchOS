// PDF text extraction utility for BeakerBot PDF attach (BeakerAI lane, 2026-06-13).
//
// Extracts the text of every page from a PDF File or ArrayBuffer using pdfjs-dist,
// concatenating pages with double newlines. The result is capped to TEXT_BUDGET_CHARS
// (60,000 chars) so a 200-page monograph does not overwhelm the context window.
//
// pdf.js worker approach: the worker .mjs file is copied into frontend/public/ at
// build time (frontend/public/pdf.worker.min.mjs) and served as a static asset.
// workerSrc is set to "/pdf.worker.min.mjs" (a root-relative public path).
// This is the most reliable pattern under Next 16 + Turbopack because:
//   - `new URL(..., import.meta.url)` requires special handling Turbopack may not
//     have at the time of writing and is fragile across CDN deployments.
//   - A ?url import requires explicit Turbopack config entries.
//   - A copied public file requires zero extra config and is guaranteed resolvable
//     at runtime by the browser's own fetch logic.
// If the worker file is missing from public/, pdf.js falls back to inline loading
// (slower first-call) but does not crash; extraction still works.
//
// The import is dynamic (inside the function body) so pdfjs-dist is NOT included
// in the main bundle. It only loads when the user picks a PDF.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const TEXT_BUDGET_CHARS = 60_000;

export type PdfExtractResult = {
  /** Concatenated text from all pages, up to TEXT_BUDGET_CHARS. */
  text: string;
  /** Total page count of the document. */
  pageCount: number;
  /** True when the extracted text was cut at TEXT_BUDGET_CHARS. */
  truncated: boolean;
};

/**
 * Extract the text of all pages from a PDF File or ArrayBuffer.
 *
 * Dynamically imports pdfjs-dist (so it is bundle-split, only loaded on demand).
 * Sets the worker to /pdf.worker.min.mjs (a copied static asset in public/).
 *
 * @param source A PDF File object or an ArrayBuffer containing the PDF bytes.
 * @returns { text, pageCount, truncated }
 */
export async function extractPdfText(
  source: File | ArrayBuffer,
): Promise<PdfExtractResult> {
  // Dynamic import: pdfjs-dist is only loaded when this function is called,
  // not at module-evaluation time. This keeps it out of the initial bundle.
  const pdfjsLib = await import("pdfjs-dist");

  // Set the worker source to the copied static file. The assignment is safe to
  // repeat; pdf.js guards against re-initialization for the same workerSrc.
  // Use a root-relative path so it works regardless of base-path configuration.
  if (pdfjsLib.GlobalWorkerOptions.workerSrc !== "/pdf.worker.min.mjs") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  // Normalize the source to a typed array so pdfjs accepts it.
  let data: ArrayBuffer;
  if (source instanceof File) {
    data = await source.arrayBuffer();
  } else {
    data = source;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;

  // Build the output incrementally as a single string so the budget accounts for
  // the "\n\n" page separators added when joining. Tracking a separate parts[]
  // array and joining at the end would undercount by 2 chars per separator boundary.
  let text = "";
  let truncated = false;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    if (truncated) break;
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    // pdf.js returns items with a .str field for each text chunk on the page.
    // Join with a space, then separate pages with a blank line so paragraph
    // boundaries survive in the combined text.
    const pageText = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .join(" ")
      .trim();

    if (!pageText) continue;

    // Account for the separator that will be prepended between pages.
    const separator = text.length > 0 ? "\n\n" : "";
    const remaining = TEXT_BUDGET_CHARS - text.length - separator.length;

    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (pageText.length <= remaining) {
      text += separator + pageText;
    } else {
      // This page would push us past the budget. Take what fits, mark truncated.
      text += separator + pageText.slice(0, remaining);
      truncated = true;
    }
  }

  // cleanup() frees the pdfjs worker memory without destroying the transport.
  // PDFDocumentProxy does not expose destroy(); cleanup() is the correct method.
  await pdfDoc.cleanup();

  return {
    text,
    pageCount,
    truncated,
  };
}

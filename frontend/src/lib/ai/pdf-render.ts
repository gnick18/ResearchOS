// PDF page-image rendering for BeakerBot's figure picker (BeakerAI lane, 2026-06-14).
//
// The reproduce-from-PDF flow's Output 4 (match a figure's visual style onto the
// user's own tree) is vision driven, so the figure has to reach the model as an
// IMAGE. pdf-extract.ts is text-only on purpose (cheap, no vision), so this module
// is the companion that turns PDF PAGES into images, and turns a user-selected
// REGION of a page into one high-resolution cropped figure image for vision.
//
// Design (Grant, 2026-06-14, the "efficiency is the name of ResearchOS" call):
// we render page thumbnails so the user can SEE and POINT at the figure, then crop
// to exactly the figure region so the vision model gets a clean image and produces
// a faithful style match, with zero wrong-figure failures. A clean cropped figure
// beats sending the whole paper and hoping the model finds the right panel.
//
// Like pdf-extract.ts, pdfjs-dist is dynamically imported so it stays out of the
// main bundle, and the worker is the copied /pdf.worker.min.mjs static asset.
//
// Rendering needs a real <canvas> 2d context, so the render functions are
// browser-only. The pure geometry helpers (scale + crop math) are exported and
// unit-tested separately so the arithmetic is provable without a DOM.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** A normalized crop rectangle, each field a fraction in [0, 1] of the page. */
export type NormRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** One rendered page thumbnail (a small JPEG data URL for the picker grid). */
export type PdfPageThumb = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

export type PdfThumbResult = {
  thumbs: PdfPageThumb[];
  /** Total pages in the document. */
  pageCount: number;
  /** True when not every page was rendered (long doc capped at maxPages). */
  capped: boolean;
};

/** Cap thumbnail rendering for very long documents so the picker stays snappy. */
export const MAX_THUMB_PAGES = 60;
/** Target on-screen width of a thumbnail in CSS-ish pixels. */
export const THUMB_TARGET_WIDTH = 240;
/** The full crop rectangle (the whole page). */
export const FULL_PAGE_RECT: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Clamp a normalized rect into [0, 1] and guarantee a minimum size so a stray
 * click (a zero-area drag) does not produce an empty crop. Pure, unit-tested.
 */
export function normalizeRect(rect: NormRect, minSize = 0.02): NormRect {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  let x = clamp01(Math.min(rect.x, rect.x + rect.w));
  let y = clamp01(Math.min(rect.y, rect.y + rect.h));
  let w = clamp01(Math.abs(rect.w));
  let h = clamp01(Math.abs(rect.h));
  // Keep the rect inside the page after clamping the origin.
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  // A degenerate (too-small) selection falls back to the whole page.
  if (w < minSize || h < minSize) return { ...FULL_PAGE_RECT };
  // Re-clamp the origin if a min bump would overflow (defensive, rarely hit).
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

/**
 * Compute the render plan for a region of a page. Pure + tested.
 *
 * The region is rendered DIRECTLY into a region-sized canvas (via a page-render
 * transform that shifts the region's top-left to the canvas origin), so there is
 * no full-page canvas to blow up memory. `scale` is chosen so the region is about
 * `targetWidth` px wide (crisp for vision), never below 1, and clamped so neither
 * output dimension exceeds `maxOut` px (a guard against pathological thin-strip
 * selections). Returns the render scale, the region origin in rendered px (sx, sy,
 * the transform offset), and the output canvas size (sw, sh).
 */
export function computeRegionPlan(
  pageWidth: number,
  pageHeight: number,
  rect: NormRect,
  targetWidth = 1400,
  maxOut = 2200,
): { scale: number; sx: number; sy: number; sw: number; sh: number } {
  const region = normalizeRect(rect);
  const regionW1 = Math.max(1, region.w * pageWidth);
  const regionH1 = Math.max(1, region.h * pageHeight);
  const wantScale = targetWidth / regionW1;
  // Keep both output dimensions within maxOut.
  const widthCap = maxOut / regionW1;
  const heightCap = maxOut / regionH1;
  const scale = Math.max(1, Math.min(wantScale, widthCap, heightCap));
  const sx = Math.round(region.x * pageWidth * scale);
  const sy = Math.round(region.y * pageHeight * scale);
  const sw = Math.max(1, Math.round(region.w * pageWidth * scale));
  const sh = Math.max(1, Math.round(region.h * pageHeight * scale));
  return { scale, sx, sy, sw, sh };
}

// Shared lazy pdfjs loader, mirroring pdf-extract.ts so the worker is set once.
async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  if (pdfjsLib.GlobalWorkerOptions.workerSrc !== "/pdf.worker.min.mjs") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjsLib;
}

function toUint8(source: File | ArrayBuffer): Promise<Uint8Array> {
  if (source instanceof File) {
    return source.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return Promise.resolve(new Uint8Array(source));
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Page count + render plan, reported as soon as the document opens (before any
 *  page renders) so the picker can show "0 of N" and reserve the grid. */
export type PdfThumbStart = {
  pageCount: number;
  /** How many pages will actually be rendered (capped at maxPages). */
  renderCount: number;
  capped: boolean;
};

export type RenderThumbOpts = {
  maxPages?: number;
  targetWidth?: number;
  /** Fired once, right after the document opens, with the page counts. */
  onStart?: (info: PdfThumbStart) => void;
  /** Fired after EACH page renders, so the picker can show thumbnails
   *  progressively instead of waiting for the whole document. */
  onThumb?: (thumb: PdfPageThumb, info: PdfThumbStart) => void;
};

/**
 * Render up to MAX_THUMB_PAGES page thumbnails as small JPEG data URLs for the
 * picker grid. Browser-only (needs a canvas). Each thumb is about
 * THUMB_TARGET_WIDTH px wide.
 *
 * Progressive: pass `onStart` to learn the page count up front and `onThumb` to
 * receive each thumbnail the moment it renders, so a long PDF shows pages as they
 * arrive instead of behind one blank wait. The full result is still returned for
 * callers that just want the array.
 */
export async function renderPdfThumbnails(
  source: File | ArrayBuffer,
  opts?: RenderThumbOpts,
): Promise<PdfThumbResult> {
  const maxPages = opts?.maxPages ?? MAX_THUMB_PAGES;
  const targetWidth = opts?.targetWidth ?? THUMB_TARGET_WIDTH;
  const pdfjsLib = await loadPdfjs();
  const data = await toUint8(source);
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = pdfDoc.numPages;
  const renderCount = Math.min(pageCount, maxPages);
  const info: PdfThumbStart = { pageCount, renderCount, capped: pageCount > renderCount };
  opts?.onStart?.(info);
  const thumbs: PdfPageThumb[] = [];

  for (let pageNum = 1; pageNum <= renderCount; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = makeCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const thumb: PdfPageThumb = {
      pageNumber: pageNum,
      dataUrl: canvas.toDataURL("image/jpeg", 0.7),
      width: canvas.width,
      height: canvas.height,
    };
    thumbs.push(thumb);
    opts?.onThumb?.(thumb, info);
  }

  await pdfDoc.cleanup();
  return { thumbs, pageCount, capped: pageCount > renderCount };
}

/**
 * Render one page (or a normalized region of it) to a high-resolution PNG data
 * URL suitable for the vision model. Browser-only. Pass FULL_PAGE_RECT for the
 * whole page. The PNG keeps tree line-art crisp.
 */
export async function renderPdfRegion(
  source: File | ArrayBuffer,
  args: { pageNumber: number; rect?: NormRect; targetWidth?: number },
): Promise<string> {
  const pdfjsLib = await loadPdfjs();
  const data = await toUint8(source);
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  try {
    const page = await pdfDoc.getPage(args.pageNumber);
    const base = page.getViewport({ scale: 1 });
    const rect = args.rect ?? FULL_PAGE_RECT;
    const plan = computeRegionPlan(base.width, base.height, rect, args.targetWidth);
    const viewport = page.getViewport({ scale: plan.scale });

    // Render ONLY the region: the canvas is region-sized, and the transform shifts
    // the page so the region's top-left lands at the canvas origin. Content outside
    // the canvas is clipped, so there is no full-page canvas to allocate.
    const out = makeCanvas(plan.sw, plan.sh);
    const outCtx = out.getContext("2d");
    if (!outCtx) throw new Error("no 2d context");
    // White backstop so transparent PDF backgrounds export as white, not black.
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, out.width, out.height);
    await page.render({
      canvas: out,
      canvasContext: outCtx,
      viewport,
      transform: [1, 0, 0, 1, -plan.sx, -plan.sy],
    }).promise;
    return out.toDataURL("image/png");
  } finally {
    await pdfDoc.cleanup();
  }
}

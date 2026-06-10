import { fileService } from "@/lib/file-system/file-service";

/**
 * OCR sidecar for handwriting note capture.
 *
 * Each image that has been through on-device OCR (Apple Vision on iOS,
 * ML Kit on Android, or Florence-2 in the browser) carries a second sidecar
 * next to the raw file and its existing metadata / annotation sidecars:
 *
 *   results/task-12/Images/
 *     bench-notes.jpg              enhanced (rectified, cleaned) image
 *     bench-notes.jpg.json         existing metadata sidecar (caption / tags)
 *     bench-notes.jpg.annot.json   photo-annotation layer (annotations.ts)
 *     bench-notes.jpg.ocr.json     OCR layer (this file's schema)   <-- NEW
 *
 * The raw image and the annotation sidecar are never modified here. The OCR
 * result is an additive, separate sidecar so an image can carry both at once
 * with zero collision. `<OcrImage>` renders the reveal panel beneath the image;
 * `<AnnotatedImage>` continues to render the annotation overlay above it.
 *
 * bbox values are natural image pixels [x, y, w, h], matching the annotation
 * overlay coordinate space, so they scale identically via
 * `viewBox="0 0 imageW imageH"`.
 *
 * The `edited` flag is set to true on any human correction of `text`. Anything
 * that re-runs OCR on the same image (a re-scan, a batch re-run) MUST check
 * `edited` before clobbering. This module does NOT set the flag; the display
 * component (`OcrImage`) sets it on write-back.
 *
 * See `docs/proposals/HANDWRITING_NOTE_CAPTURE.md` for the full rationale
 * and `docs/proposals/HANDWRITING_DISPLAY_SPEC.md` for the display contract.
 */

export const OCR_SCHEMA_VERSION = 1 as const;

export interface OcrLine {
  text: string;
  /**
   * Bounding box in natural image pixels: [x, y, width, height].
   * Relative to imageW / imageH, identical to the annotation overlay space.
   */
  bbox: [number, number, number, number];
  /** 0..1 per-line recognition confidence from the OCR engine. */
  confidence: number;
}

export interface OcrResult {
  version: typeof OCR_SCHEMA_VERSION;
  /** Which on-device engine produced this result. */
  engine: "apple-vision" | "mlkit" | "florence-2" | "trocr-base";
  /** ISO timestamp of when the extraction ran. */
  extractedAt: string;
  /** Natural pixel width of the enhanced image the bboxes are relative to. */
  imageW: number;
  /** Natural pixel height of the enhanced image the bboxes are relative to. */
  imageH: number;
  /** Full extracted text; lines joined with newlines. */
  text: string;
  lines: OcrLine[];
  /**
   * True once a human edits the extracted text. A re-OCR of the same image
   * MUST NOT overwrite a sidecar whose `edited` is true.
   */
  edited: boolean;
  /**
   * Present only when the raw (un-enhanced) original is retained alongside the
   * enhanced scan. Optional; may not be set in v1.
   */
  rawImagePath?: string;
}

/**
 * Path of the OCR sidecar for an image. Mirrors `annotPath()` in annotations.ts
 * but uses the `.ocr.json` suffix so the two sidecars never collide.
 *
 *   ocrPath("results/task-12", "bench-notes.jpg")
 *   // => "results/task-12/Images/bench-notes.jpg.ocr.json"
 */
export function ocrPath(basePath: string, imageName: string): string {
  return `${basePath}/Images/${imageName}.ocr.json`;
}

/**
 * Read the OCR sidecar for an image, or `null` when none exists (the common
 * case: most images will not have OCR results). A malformed or empty file is
 * treated as missing and never throws, matching the `readAnnotations` contract.
 */
export async function readOcr(
  basePath: string,
  imageName: string,
): Promise<OcrResult | null> {
  try {
    const doc = await fileService.readJson<OcrResult>(ocrPath(basePath, imageName));
    if (!doc || typeof doc.text !== "string" || !Array.isArray(doc.lines)) {
      return null;
    }
    return doc;
  } catch {
    // Defensive: a malformed sidecar should never crash a render path.
    return null;
  }
}

/**
 * Atomically write the OCR sidecar for an image. `fileService.writeJson`
 * routes through the `.tmp` + `move()` atomic pattern, so we never touch
 * `createWritable` on the final path directly. The raw image is never written
 * here.
 */
export async function writeOcr(
  basePath: string,
  imageName: string,
  doc: OcrResult,
): Promise<void> {
  await fileService.writeJson(ocrPath(basePath, imageName), doc);
}

/**
 * Aggregate all OCR text for one note/task base, for the search index. Lists
 * `${basePath}/Images/` once and reads ONLY the `.ocr.json` sidecars, so a base
 * with no scanned pages costs a single directory list and zero reads. Returns
 * the concatenated text (newline-joined), or "" when there is none. Never throws
 * (a missing Images dir or a malformed sidecar is treated as empty).
 */
export async function readBaseOcrText(basePath: string): Promise<string> {
  const dir = `${basePath}/Images`;
  let files: string[];
  try {
    files = await fileService.listFiles(dir);
  } catch {
    return "";
  }
  const ocrFiles = files.filter((f) => f.endsWith(".ocr.json"));
  if (ocrFiles.length === 0) return "";
  const texts: string[] = [];
  for (const f of ocrFiles) {
    try {
      const doc = await fileService.readJson<OcrResult>(`${dir}/${f}`);
      if (doc && typeof doc.text === "string" && doc.text.trim()) {
        texts.push(doc.text);
      }
    } catch {
      // Skip a malformed sidecar; never let it break indexing.
    }
  }
  return texts.join("\n");
}

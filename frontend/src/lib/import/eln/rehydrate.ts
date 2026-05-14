/**
 * Post-import bulk rehydration of LabArchives Form-B inline images.
 *
 * The ELN-import wizard's `apply.ts` writes the same logic in-line for the
 * first-time path. This module re-exposes the disk-write + markdown-rewrite
 * + sidecar-shrink steps so the persistent banner in `TaskDetailPopup`'s Lab
 * Notes tab (and any future surface that needs to fold rehydrated images
 * into an already-imported task) can call it without dragging the full
 * wizard pipeline along.
 *
 * The flow:
 *   1. For every `{ kind: "ok" }` entry in `fetched`, find the matching
 *      `MissingInlineImage` in the sidecar.
 *   2. Pick a collision-safe filename in `${notesBase}/Images/` and write the
 *      bytes there.
 *   3. Rewrite the `Images/missing-<orig>` reference in `notes.md` to point at
 *      the new on-disk path.
 *   4. Drop that entry from the sidecar's `missingInlineImages` array so the
 *      banner's count shrinks and the broken-image popup stops re-surfacing
 *      for that image.
 *
 * Non-blocking: a single failure (write error, missing sidecar entry) is
 * logged via the returned `warnings` and the rest of the batch continues.
 *
 * Demo / wiki-capture mode is unaffected — this module only touches files
 * that are already in the user's open data folder. The fetched bytes come
 * from whichever cred-less path (DevTools script, manual drop, or API)
 * staged them, all of which are demo-safe per their respective gates.
 */

import { fileService } from "@/lib/file-system/file-service";
import type { FetchedImage } from "@/lib/labarchives/api-client";
import type { ELNImportSidecar, MissingInlineImage } from "./types";

const SIDECAR_FILENAME = "_import_source.json";

export interface RehydrateOptions {
  /** Notes base for the task. Equivalent to
   *  `taskNotesBase({ id, owner })` (i.e.
   *  `users/<owner>/results/task-<id>/notes`). */
  notesBase: string;
  /** Path to the markdown file we rewrite refs in. Typically
   *  `users/<owner>/results/task-<id>/notes.md`. */
  notesMarkdownPath: string;
  /** Pre-fetched images, keyed by `MissingInlineImage.originalUrl`. */
  fetched: Map<string, FetchedImage>;
}

export interface RehydrateResult {
  /** Count of images successfully written + rewritten. */
  applied: number;
  /** Per-image errors that didn't halt the batch. */
  warnings: Array<{ filename: string; message: string }>;
  /** Post-write sidecar shape (or `null` if the sidecar was missing).
   *  Returned for callers that want to refresh in-memory state without a
   *  re-read. */
  sidecar: ELNImportSidecar | null;
}

function splitFilename(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Find a free filename inside `${notesBase}/Images/`. Mirrors the style used
 * by the in-wizard apply path AND by the per-image popup recovery's
 * `pickUniqueImageFilename` in `sidecar-lookup.ts`: trailing ` (2)`,
 * ` (3)`, … suffix before the extension.
 *
 * Pulls in a synchronous "seen this batch" set on top of the FSA check so
 * two fetched images sharing the same filename within the same batch don't
 * both resolve to the same name. The on-disk check covers the cross-batch
 * case (existing body attachment with the same name); the in-memory set
 * covers the intra-batch case.
 */
async function pickUniqueImageName(
  imagesDir: string,
  desired: string,
  takenInBatch: Set<string>,
): Promise<string> {
  const lowerTaken = (name: string) => takenInBatch.has(name.toLowerCase());
  if (!lowerTaken(desired) && !(await fileService.fileExists(`${imagesDir}/${desired}`))) {
    takenInBatch.add(desired.toLowerCase());
    return desired;
  }
  const { stem, ext } = splitFilename(desired);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (lowerTaken(candidate)) continue;
    if (!(await fileService.fileExists(`${imagesDir}/${candidate}`))) {
      takenInBatch.add(candidate.toLowerCase());
      return candidate;
    }
  }
  // Pathological fallback: timestamp-suffix so the function stays total.
  const fallback = `${stem} (${Date.now()})${ext}`;
  takenInBatch.add(fallback.toLowerCase());
  return fallback;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite every `Images/missing-<oldName>` reference in `body` to
 * `Images/<newName>`. Handles all three shapes the editor / parser can
 * produce: markdown image syntax (with or without alt), HTML `<img>`, and
 * bare path mentions. Mirrors `applyImageRewrites` in `apply.ts`.
 *
 * Returns the rewritten body; if no rewrites apply, returns the input
 * unchanged.
 */
function applyMarkdownRewrites(
  body: string,
  rewrites: Map<string, string>,
): string {
  if (rewrites.size === 0) return body;
  let out = body;
  for (const [from, to] of rewrites) {
    out = out.replace(new RegExp(escapeRegex(from), "g"), to);
  }
  return out;
}

async function readSidecar(notesBase: string): Promise<ELNImportSidecar | null> {
  try {
    const sidecar = await fileService.readJson<ELNImportSidecar>(
      `${notesBase}/${SIDECAR_FILENAME}`,
    );
    return sidecar ?? null;
  } catch {
    return null;
  }
}

async function readNotesMarkdown(path: string): Promise<string | null> {
  try {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) return null;
    return await blob.text();
  } catch {
    return null;
  }
}

/**
 * Apply a batch of pre-fetched LabArchives Form-B images to an already-
 * imported task. Best-effort: returns a structured result instead of
 * throwing on per-image failures so the caller can surface a partial-success
 * UI without losing the wins.
 *
 * Pre-conditions: the task must have an `_import_source.json` sidecar at
 * `${options.notesBase}/_import_source.json`. Callers that don't know
 * whether the sidecar exists should gate on the banner-eligibility check
 * (sidecar present AND `missingInlineImages.length > 0`).
 */
export async function rehydrateMissingImages(
  options: RehydrateOptions,
): Promise<RehydrateResult> {
  const { notesBase, notesMarkdownPath, fetched } = options;
  const warnings: Array<{ filename: string; message: string }> = [];

  const sidecar = await readSidecar(notesBase);
  if (!sidecar) {
    return { applied: 0, warnings, sidecar: null };
  }
  if (fetched.size === 0 || sidecar.missingInlineImages.length === 0) {
    return { applied: 0, warnings, sidecar };
  }

  const imagesDir = `${notesBase}/Images`;
  const takenInBatch = new Set<string>();

  // First pass: write the bytes to disk, building up the rewrite map.
  const rewrites = new Map<string, string>();
  const successfullyRewrittenFilenames = new Set<string>();

  for (const missing of sidecar.missingInlineImages) {
    const f = fetched.get(missing.originalUrl);
    if (!f || f.kind !== "ok") continue;
    try {
      const finalName = await pickUniqueImageName(
        imagesDir,
        missing.filename,
        takenInBatch,
      );
      await fileService.writeFileFromBlob(`${imagesDir}/${finalName}`, f.blob);
      rewrites.set(`Images/missing-${missing.filename}`, `Images/${finalName}`);
      successfullyRewrittenFilenames.add(missing.filename);
    } catch (err) {
      warnings.push({
        filename: missing.filename,
        message: err instanceof Error ? err.message : "Failed to write image to disk.",
      });
    }
  }

  if (rewrites.size === 0) {
    return { applied: 0, warnings, sidecar };
  }

  // Second pass: rewrite the markdown body.
  const md = await readNotesMarkdown(notesMarkdownPath);
  if (md !== null) {
    const next = applyMarkdownRewrites(md, rewrites);
    if (next !== md) {
      try {
        await fileService.writeFileFromBlob(
          notesMarkdownPath,
          new Blob([next], { type: "text/markdown" }),
        );
      } catch (err) {
        warnings.push({
          filename: "notes.md",
          message: err instanceof Error ? err.message : "Failed to rewrite notes.md.",
        });
        // We deliberately do NOT shrink the sidecar if the markdown
        // rewrite fails — the on-disk image bytes are now orphaned, but the
        // banner re-running will pick the same images back up (idempotent
        // by URL) and a second markdown rewrite is harmless.
        return { applied: 0, warnings, sidecar };
      }
    }
  }
  // If `md === null` (read failed), we still shrink the sidecar — the bytes
  // are on disk under the correct names, and a future markdown rewrite (or
  // the user's next save) will pick them up. Surfacing this as a hard
  // failure would lose progress.

  // Third pass: shrink the sidecar.
  const nextSidecar: ELNImportSidecar = {
    ...sidecar,
    missingInlineImages: sidecar.missingInlineImages.filter(
      (m) => !successfullyRewrittenFilenames.has(m.filename),
    ),
  };
  try {
    await fileService.writeJson(`${notesBase}/${SIDECAR_FILENAME}`, nextSidecar);
  } catch (err) {
    warnings.push({
      filename: SIDECAR_FILENAME,
      message: err instanceof Error ? err.message : "Failed to update import sidecar.",
    });
  }

  return {
    applied: successfullyRewrittenFilenames.size,
    warnings,
    sidecar: nextSidecar,
  };
}

/**
 * Light-weight helper: peek at the sidecar's `missingInlineImages` array so
 * the banner can render a count + decide whether to show. Returns `null`
 * when the sidecar isn't present (i.e. the task was NOT imported via ELN,
 * OR the import predates the sidecar feature).
 */
export async function readMissingInlineImageCount(
  notesBase: string,
): Promise<{ sidecar: ELNImportSidecar; missing: MissingInlineImage[] } | null> {
  const sidecar = await readSidecar(notesBase);
  if (!sidecar) return null;
  return { sidecar, missing: sidecar.missingInlineImages };
}

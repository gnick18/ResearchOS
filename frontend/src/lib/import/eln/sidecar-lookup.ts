/**
 * Helpers for the per-image post-import recovery UX driven from
 * `LiveMarkdownEditor`'s broken-image popup. When an `.eln` import leaves a
 * `Images/missing-<filename>` placeholder behind (Form-B online-only image
 * that the LabArchives fetch step skipped or couldn't retrieve), the editor
 * needs to:
 *
 *   1. Read the `_import_source.json` sidecar that the import pipeline
 *      writes alongside the notes folder.
 *   2. Look up the missing entry by `filename` so the popup can offer the
 *      original LabArchives URL ("Find on LabArchives") and a "Replace from
 *      disk" file-picker.
 *   3. After the user replaces the file, rewrite the markdown ref AND prune
 *      that entry from the sidecar so future opens of the same note don't
 *      re-surface the popup for an image we've already recovered.
 *
 * Demo / wiki-capture mode is unaffected — these helpers only act on data
 * that's already on disk in the user's data folder.
 */

import { fileService } from "@/lib/file-system/file-service";
import type { ELNImportSidecar, MissingInlineImage } from "./types";

/**
 * The "Images/missing-<filename>" prefix the parser stamps onto Form-B
 * online-only image refs at parse time. Anchored on `Images/missing-` so we
 * don't accidentally match user-authored filenames that happen to start
 * with the literal word "missing-".
 */
const MISSING_REF_PREFIX = "Images/missing-";

/**
 * Extract the original `MissingInlineImage.filename` from a markdown image
 * ref that matches the parser's `Images/missing-<filename>` shape. Returns
 * `null` for any ref that doesn't fit the pattern.
 *
 * The ref is taken straight from the markdown body (after CommonMark title
 * and angle-bracket stripping) so query-string variants don't need handling
 * here — the parser writes plain `Images/missing-<filename>` with no query
 * string.
 */
export function extractMissingFilename(originalSrc: string): string | null {
  if (!originalSrc.startsWith(MISSING_REF_PREFIX)) return null;
  const tail = originalSrc.slice(MISSING_REF_PREFIX.length);
  if (!tail || tail.includes("/")) return null;
  return tail;
}

/**
 * Read the `_import_source.json` sidecar from the per-tab notes base.
 * Returns `null` when the file doesn't exist or fails to parse — the popup
 * caller treats `null` as "this broken image is NOT a LabArchives
 * placeholder, fall back to the existing Remove-from-note behavior".
 */
export async function readImportSidecar(
  imageBasePath: string,
): Promise<ELNImportSidecar | null> {
  try {
    const sidecar = await fileService.readJson<ELNImportSidecar>(
      `${imageBasePath}/_import_source.json`,
    );
    return sidecar ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the `MissingInlineImage` record matching a given filename. Matches
 * are case-sensitive — LabArchives filenames are consistent within a single
 * notebook export, and case-folding here could collide two legitimately
 * distinct images.
 */
export function findMissingInlineImage(
  sidecar: ELNImportSidecar,
  filename: string,
): MissingInlineImage | null {
  return (
    sidecar.missingInlineImages.find((m) => m.filename === filename) ?? null
  );
}

/**
 * Convenience: given the editor's `imageBasePath` and a markdown ref, return
 * the matched LabArchives missing-image record if (and only if) the ref
 * fits the `Images/missing-<filename>` shape AND the sidecar contains a
 * matching entry. Returns `null` in every other case so the caller can fall
 * straight back to the legacy "Remove reference from note" behavior.
 */
export async function lookupMissingInlineImage(
  imageBasePath: string | undefined,
  originalSrc: string,
): Promise<{ sidecar: ELNImportSidecar; entry: MissingInlineImage } | null> {
  if (!imageBasePath) return null;
  const filename = extractMissingFilename(originalSrc);
  if (!filename) return null;
  const sidecar = await readImportSidecar(imageBasePath);
  if (!sidecar) return null;
  const entry = findMissingInlineImage(sidecar, filename);
  if (!entry) return null;
  return { sidecar, entry };
}

function splitFilename(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Find a free filename in `${imageBasePath}/Images/`. Mirrors the suffix
 * style used by the ELN apply pipeline (`pickUniqueFilename` in
 * `apply.ts`): collisions get a trailing ` (2)`, ` (3)`, … before the
 * extension. Anchored on a real existence check against the FSA so users
 * can manually drop files into `Images/` between import and recovery
 * without hitting a silent overwrite.
 */
export async function pickUniqueImageFilename(
  imagesDir: string,
  desired: string,
): Promise<string> {
  if (!(await fileService.fileExists(`${imagesDir}/${desired}`))) {
    return desired;
  }
  const { stem, ext } = splitFilename(desired);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await fileService.fileExists(`${imagesDir}/${candidate}`))) {
      return candidate;
    }
  }
  // Pathological fallback. Extremely unlikely (>1000 collisions) but keeps
  // the function total so the caller doesn't have to handle `null`.
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * Update the on-disk sidecar after a single image has been rehydrated from
 * a user-provided local file. Drops the matching entry from
 * `missingInlineImages` (so future opens of the note don't re-surface the
 * popup) and is a no-op if the sidecar can't be read.
 *
 * The persistent counters on the sidecar are stored on the
 * `ELNImportResult` (in-memory summary), NOT in the sidecar itself — see
 * `apply.ts`'s `rehydratedInlineImages` field on the per-task result. So
 * "incrementing totalRehydratedInlineImages" really means "shrinking
 * `missingInlineImages` by one"; the wizard's summary is already
 * post-import and there's no on-disk counter to bump.
 */
export async function removeMissingInlineImageFromSidecar(
  imageBasePath: string,
  filename: string,
): Promise<void> {
  const sidecar = await readImportSidecar(imageBasePath);
  if (!sidecar) return;
  const next: ELNImportSidecar = {
    ...sidecar,
    missingInlineImages: sidecar.missingInlineImages.filter(
      (m) => m.filename !== filename,
    ),
  };
  await fileService.writeJson(`${imageBasePath}/_import_source.json`, next);
}

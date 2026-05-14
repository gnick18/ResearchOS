"use client";

/**
 * Browser-side helpers for the credentials-free image-rehydration paths
 * (manual file-drop + DevTools-script ZIP). Given a flat list of dropped
 * `File`s (which may include a `.zip` that needs unpacking) and the
 * `MissingInlineImage[]` from the parsed notebook, produce the same
 * `Map<originalUrl, FetchedInlineImage>` shape the API path emits so the
 * apply pipeline doesn't need to know which path the bytes came from.
 *
 * Matching rules:
 *  - Filenames are matched case-insensitively against `MissingInlineImage.filename`.
 *  - If no exact-name match is found, we fall back to a stem-only match
 *    (i.e. ignoring extension). This is forgiving for users who rename the
 *    file when saving from the browser, or whose extension differs from what
 *    LabArchives reports.
 *  - If multiple dropped files match the same missing-image entry, the first
 *    one wins; the rest are reported as "unused" so the user knows.
 *  - The collision-suffix logic that turns matched bytes into
 *    `Images/<unique-name>` lives in `apply.ts` already — we don't try to
 *    replicate it here. We just key by `originalUrl` and let apply do the
 *    final naming.
 */

import JSZip from "jszip";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import type { FetchedInlineImage } from "@/lib/import/eln/apply";

export interface DropMatchResult {
  /** Map keyed by `MissingInlineImage.originalUrl` — feeds straight into
   *  the apply pipeline's `fetchedImages` option. Only contains successful
   *  matches; unmatched missing-image refs stay out of the map and fall
   *  through to the placeholder. */
  byUrl: Map<string, FetchedInlineImage>;
  /** Missing-image entries that DID get a match. */
  matched: MissingInlineImage[];
  /** Missing-image entries we couldn't find any dropped file for. These
   *  stay as `Images/missing-<orig>` placeholders after apply. */
  unmatched: MissingInlineImage[];
  /** Dropped files we couldn't match to any missing-image entry. Surfaced
   *  to the user so they know we ignored those. Not an error. */
  unusedFiles: Array<{ name: string; size: number }>;
}

/** Single dropped file paired with whatever path it came in under (used
 *  only for human-readable diagnostics). */
export interface DroppedFile {
  /** The actual File handle. May be a synthetic File produced from a ZIP
   *  entry. */
  file: File;
  /** Human-readable path. For raw drops this is the filename; for ZIP
   *  entries it's the entry path inside the archive. */
  displayPath: string;
}

/**
 * Extract the basename + stem from any path-shaped string.
 *  - "foo/bar/Image (1).png" → { base: "image (1).png", stem: "image (1)", ext: "png" }
 *  - "Image.PNG"             → { base: "image.png",     stem: "image",     ext: "png" }
 */
function parsePathName(p: string): { base: string; stem: string; ext: string } {
  const slashIdx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = (slashIdx >= 0 ? p.slice(slashIdx + 1) : p).toLowerCase();
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0) return { base, stem: base, ext: "" };
  return {
    base,
    stem: base.slice(0, dotIdx),
    ext: base.slice(dotIdx + 1),
  };
}

/**
 * Walk a DataTransferItemList (i.e. the `e.dataTransfer.items` you get
 * from a real drop event) and resolve all files in the drop, recursing
 * into directories. Returns a flat list of `DroppedFile`s.
 *
 * Falls back to `dataTransfer.files` (a flat FileList, no directories)
 * if the browser doesn't expose the webkitGetAsEntry API.
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> {
  type WebkitEntry = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath?: string;
    file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
    createReader?: () => {
      readEntries: (cb: (es: WebkitEntry[]) => void, err: (e: unknown) => void) => void;
    };
  };

  const out: DroppedFile[] = [];

  const items = dataTransfer.items;
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
    const roots: WebkitEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "file") continue;
      const entry = it.webkitGetAsEntry() as WebkitEntry | null;
      if (entry) roots.push(entry);
    }

    async function walk(entry: WebkitEntry, prefix: string): Promise<void> {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => {
          entry.file?.(
            (f) => resolve(f),
            () => resolve(null),
          );
        });
        if (file) out.push({ file, displayPath: path });
        return;
      }
      if (entry.isDirectory && entry.createReader) {
        const reader = entry.createReader();
        // readEntries() returns at most ~100 entries per call; loop until empty.
        for (;;) {
          const batch = await new Promise<WebkitEntry[]>((resolve) => {
            reader.readEntries(
              (es) => resolve(es),
              () => resolve([]),
            );
          });
          if (batch.length === 0) break;
          for (const child of batch) {
            await walk(child, path);
          }
        }
      }
    }

    for (const r of roots) {
      await walk(r, "");
    }
    return out;
  }

  // Fallback: flat file list.
  const files = dataTransfer.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      out.push({ file: files[i], displayPath: files[i].name });
    }
  }
  return out;
}

/**
 * If a dropped entry is a `.zip`, expand it into its constituent files.
 * Returns a new list where ZIPs have been replaced by their contents.
 *
 * Failures (corrupt ZIP, etc.) are surfaced via the returned `zipErrors`
 * array — they don't throw, so a partial-but-usable result still flows
 * to the matcher.
 */
export async function expandZips(
  input: DroppedFile[],
): Promise<{ files: DroppedFile[]; zipErrors: Array<{ name: string; message: string }> }> {
  const out: DroppedFile[] = [];
  const zipErrors: Array<{ name: string; message: string }> = [];
  for (const item of input) {
    const isZip =
      item.file.name.toLowerCase().endsWith(".zip") ||
      item.file.type === "application/zip" ||
      item.file.type === "application/x-zip-compressed";
    if (!isZip) {
      out.push(item);
      continue;
    }
    try {
      const zip = await JSZip.loadAsync(item.file);
      const entryNames = Object.keys(zip.files);
      for (const name of entryNames) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        // Skip the macOS metadata noise that sneaks into hand-zipped folders.
        if (name.startsWith("__MACOSX/") || name.endsWith("/.DS_Store") || name === ".DS_Store") {
          continue;
        }
        const blob = await entry.async("blob");
        // Synthesize a File so downstream code can treat ZIP entries the
        // same as raw drops.
        const basename = name.split("/").pop() ?? name;
        const synthetic = new File([blob], basename, { type: blob.type });
        out.push({ file: synthetic, displayPath: `${item.file.name}:${name}` });
      }
    } catch (err) {
      zipErrors.push({
        name: item.file.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { files: out, zipErrors };
}

/**
 * Build the matched `byUrl` map. Pure-function — no I/O, no DOM. Tested
 * indirectly via the wizard step; can be unit-tested directly if
 * needed.
 */
export function matchDroppedFilesToMissing(
  dropped: DroppedFile[],
  missing: MissingInlineImage[],
): DropMatchResult {
  // Build two lookup maps over the missing-image set: exact name → entry,
  // and stem → entry. First-write-wins so duplicate stems just take the
  // first occurrence; LabArchives `filename`s within a single notebook
  // are generally unique enough (they include a timestamp/ep_id).
  const byExact = new Map<string, MissingInlineImage>();
  const byStem = new Map<string, MissingInlineImage>();
  for (const m of missing) {
    const { base, stem } = parsePathName(m.filename);
    if (!byExact.has(base)) byExact.set(base, m);
    if (!byStem.has(stem)) byStem.set(stem, m);
  }

  const byUrl = new Map<string, FetchedInlineImage>();
  const matched: MissingInlineImage[] = [];
  const consumed = new Set<string>(); // originalUrl
  const unusedFiles: Array<{ name: string; size: number }> = [];

  for (const d of dropped) {
    const { base, stem } = parsePathName(d.file.name);
    let target = byExact.get(base);
    if (!target) target = byStem.get(stem);
    if (!target || consumed.has(target.originalUrl)) {
      unusedFiles.push({ name: d.displayPath, size: d.file.size });
      continue;
    }
    consumed.add(target.originalUrl);
    matched.push(target);
    byUrl.set(target.originalUrl, {
      kind: "ok",
      blob: d.file, // File extends Blob
      contentType: d.file.type || guessContentType(d.file.name),
    });
  }

  const unmatched = missing.filter((m) => !consumed.has(m.originalUrl));
  return { byUrl, matched, unmatched, unusedFiles };
}

/** Last-ditch content-type inference when `File.type` is empty (common
 *  for synthesized Files from ZIP entries). */
function guessContentType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

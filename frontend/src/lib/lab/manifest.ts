// SHA-256 file manifest for the lab retention registry (LAB_ARCHIVE_CONTINUITY
// .md). The integrity anchor: a deterministic per-file hash list plus one
// combined hash, so a PI can later prove a retained folder is intact (or
// re-verify a drive against the recorded manifest). Fills a RetentionEntry's
// manifest_sha256.
//
// sha256Hex + buildManifest are pure (unit-tested). computeFolderManifest is the
// integration layer that walks a folder via fileService, reads each file, and
// hands the bytes to buildManifest. The PI verifies the walk live.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";

export interface ManifestEntry {
  /** Path relative to the data root. */
  path: string;
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string;
  /** File size in bytes. */
  size: number;
}

export interface FolderManifest {
  /** Per-file entries, sorted by path for determinism. */
  entries: ManifestEntry[];
  /** A single hash over all "path:sha256" lines, the one value to record. */
  combined: string;
  fileCount: number;
  totalBytes: number;
}

/** Lowercase hex SHA-256 of a byte array. Uses the Web Crypto subtle API
 *  (available in the browser and in the node test env). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast to BufferSource: a Uint8Array is a valid digest input at runtime, but
  // the TS 5.7 generic Uint8Array<ArrayBufferLike> does not match BufferSource.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a manifest from already-read files. Deterministic: entries are sorted by
 * path, and the combined hash is SHA-256 over the joined "path:sha256" lines, so
 * the same set of files always yields the same combined value regardless of read
 * order.
 */
export async function buildManifest(
  files: { path: string; bytes: Uint8Array }[],
): Promise<FolderManifest> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const entries: ManifestEntry[] = [];
  let totalBytes = 0;
  for (const f of sorted) {
    entries.push({
      path: f.path,
      sha256: await sha256Hex(f.bytes),
      size: f.bytes.length,
    });
    totalBytes += f.bytes.length;
  }
  const combinedInput = new TextEncoder().encode(
    entries.map((e) => `${e.path}:${e.sha256}`).join("\n"),
  );
  const combined = await sha256Hex(combinedInput);
  return { entries, combined, fileCount: entries.length, totalBytes };
}

/** Recursively collect every file path under a directory (relative to the data
 *  root), depth-first. Names from fileService are joined onto the dir path. */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const names = await fileService.listFiles(dir);
  for (const name of names) out.push(`${dir}/${name}`);
  const subdirs = await fileService.listDirectories(dir);
  for (const sub of subdirs) {
    out.push(...(await collectFiles(`${dir}/${sub}`)));
  }
  return out;
}

/**
 * Walk a folder under the connected data root, read every file, and compute its
 * manifest. Integration layer (FSA reads); the pure buildManifest does the
 * hashing. A file that cannot be read is skipped (it simply is not in the
 * manifest, which a re-verify would then flag).
 */
export async function computeFolderManifest(
  dirPath: string,
): Promise<FolderManifest> {
  const paths = await collectFiles(dirPath);
  const read: { path: string; bytes: Uint8Array }[] = [];
  for (const path of paths) {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) continue;
    read.push({ path, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return buildManifest(read);
}

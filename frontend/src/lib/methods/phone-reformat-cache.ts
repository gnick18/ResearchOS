// Phone-friendly reformat cache (method phone projection reformatter, Phase 2,
// 2026-06-14).
//
// The LLM reformat of a method body is a DERIVED, regenerable artifact, so we
// cache it next to the source markdown rather than recomputing (and re-billing)
// on every snapshot. Following the sequence-store paired-sidecar precedent
// (`{id}.gb` + `{id}.meta.json`), the reformat for `methods/foo.md` lives at
// `methods/foo.phone.md`.
//
// Self-invalidation: the sidecar's first line is a marker carrying the SHA of the
// source body it was built from. On read we only honor the sidecar when that SHA
// still matches the live source file's SHA (filesApi.readFile returns the sha).
// If the user edits the method, the SHAs diverge and the stale reformat is
// ignored (we fall back to the raw body, which the phone parser still renders).
// A single fixed sidecar path per source means a new reformat overwrites the old
// one, so stale files never accumulate and we never need a single-file delete.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { filesApi } from "@/lib/local-api";

const MARKER_PREFIX = "<!-- ros-phone-reformat src-sha:";

/** The sidecar path for a method source markdown path. `methods/foo.md` ->
 *  `methods/foo.phone.md`; a non-.md path just gets `.phone.md` appended. Returns
 *  null for the scheme-based source paths (`pcr://...`) that carry no body. */
export function phoneReformatPath(sourcePath: string | null | undefined): string | null {
  if (!sourcePath || sourcePath.includes("://")) return null;
  return sourcePath.replace(/\.md$/i, "") + ".phone.md";
}

/** Serialize a reformat into sidecar file contents: the SHA marker line, a blank
 *  line, then the reformatted markdown. */
export function encodePhoneReformat(srcSha: string, reformatted: string): string {
  return `${MARKER_PREFIX} ${srcSha} -->\n\n${reformatted.trimEnd()}\n`;
}

/** Parse a sidecar file. Returns the embedded source SHA and the body with the
 *  marker line stripped, or null when the file does not carry our marker. */
export function decodePhoneReformat(
  fileContent: string,
): { srcSha: string; body: string } | null {
  const nl = fileContent.indexOf("\n");
  const firstLine = (nl === -1 ? fileContent : fileContent.slice(0, nl)).trim();
  if (!firstLine.startsWith(MARKER_PREFIX)) return null;
  const m = firstLine.match(/src-sha:\s*([^\s]+)\s*-->/);
  if (!m) return null;
  const body = fileContent.slice(nl === -1 ? fileContent.length : nl + 1).replace(/^\n+/, "");
  return { srcSha: m[1], body: body.trimEnd() };
}

/**
 * Best-effort read of a cached phone reformat for a source path, valid only when
 * its embedded SHA matches `srcSha` (the live source body's SHA). Returns the
 * reformatted markdown on a fresh hit, or null on miss / stale / any read error
 * (callers fall back to the raw body, so this never throws).
 */
export async function readFreshPhoneReformat(
  sourcePath: string | null | undefined,
  srcSha: string,
): Promise<string | null> {
  const path = phoneReformatPath(sourcePath);
  if (!path) return null;
  try {
    const file = await filesApi.readFile(path);
    const decoded = decodePhoneReformat(file.content);
    if (!decoded) return null;
    return decoded.srcSha === srcSha ? decoded.body : null;
  } catch {
    // No sidecar yet, or unreadable: a cache miss, not an error.
    return null;
  }
}

/**
 * Write a phone reformat sidecar next to the source. Overwrites any prior sidecar
 * (single fixed path), so stale reformats never pile up. Returns true on success.
 */
export async function writePhoneReformat(
  sourcePath: string | null | undefined,
  srcSha: string,
  reformatted: string,
): Promise<boolean> {
  const path = phoneReformatPath(sourcePath);
  if (!path) return false;
  try {
    await filesApi.writeFile(
      path,
      encodePhoneReformat(srcSha, reformatted),
      "Cache phone-friendly method reformat",
    );
    return true;
  } catch {
    return false;
  }
}

// Lab BYO ("bring your own") static-site hosting, pure core (lab-domains BYO
// Slice 1, social lane).
//
// BYO lets a paid lab upload its OWN static website (raw HTML/CSS/JS it wrote, e.g.
// a paper's companion site) and have us host it under the lab's domain. The
// untrusted bytes are served from research-os.com (the assets domain, R2-backed,
// NO auth / NO cookies, a DIFFERENT registrable domain from the app's
// research-os.app) at a per-lab subdomain `<labSlug>.research-os.com`, so the lab's
// JS is automatically cookie-isolated from the authed app. See the handoff for the
// wildcard-DNS go-live step.
//
// This module is the PURE core (IO-free, no Next.js / DB / R2 / unzip), so the
// load-bearing security + routing decisions are unit-testable without
// infrastructure:
//   1. sanitizeZipEntryPath  reject / normalize every zip entry path (zip-slip),
//      so an entry like "../../etc/x" or "/abs/x" can never escape the lab prefix.
//   2. contentTypeForPath    the Content-Type to store / serve per extension, so
//      the browser renders HTML as HTML and never sniffs untrusted bytes.
//   3. resolveByoServePath   given a request path, the file to serve, defaulting a
//      directory / root to index.html.
//   4. labSlugFromHost       parse `<labSlug>.research-os.com` from a Host header
//      so the serve route is host-aware once the wildcard DNS exists.
//   5. parseByoManifest      validate the stored file-list manifest defensively.
//
// A lab is referenced ONLY by its lab_owner_key (the billing owner-key hash). This
// module imports NOTHING from lib/sharing/**, lib/billing/**, or the R2 client.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { hostedAssetId } from "./lab-site-hosted";

// ---------------------------------------------------------------------------
// Per-lab BYO identifiers (R2 key namespace + billing asset id)
// ---------------------------------------------------------------------------

/**
 * The short, safe per-lab fragment used to NAMESPACE a lab's BYO files under the
 * R2 prefix (`byo-sites/<labFragment>/...`). Derived from the billing owner key
 * exactly like hostedAssetId's lab fragment, so a BYO file is always attributable
 * to a lab from its key alone. Pure, so the upload route and the serve route derive
 * the SAME fragment from the SAME owner key.
 */
export function byoLabFragment(labOwnerKey: string): string {
  const frag = String(labOwnerKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return frag || "lab";
}

/**
 * The single stable billing asset id for a lab's BYO site. One BYO site per lab,
 * so the whole site is metered as ONE asset (the sum of all file bytes), reported
 * to billing via setHostedAssetBytes(byoAssetId, labOwnerKey, totalBytes). Re-using
 * hostedAssetId with a fixed (path, href) sentinel keeps the id in the same
 * isValidAssetId shape and stable across re-uploads, so a re-upload overwrites the
 * same billing row rather than leaking a new one.
 */
export function byoAssetId(labOwnerKey: string): string {
  return hostedAssetId(labOwnerKey, "__byo_site__", "site");
}

// ---------------------------------------------------------------------------
// Caps (defensive bounds on an untrusted upload)
// ---------------------------------------------------------------------------

/** Hard cap on the total UNZIPPED bytes of one BYO site (50 MB). */
export const BYO_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Hard cap on the number of files in one BYO site. */
export const BYO_MAX_ENTRY_COUNT = 2000;

/** Hard cap on a single sanitized entry path length. */
export const BYO_MAX_PATH_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Zip-entry path sanitization (zip-slip defense)
// ---------------------------------------------------------------------------

/**
 * Sanitize ONE zip entry path into a safe, relative, forward-slash key, or null
 * when the entry must be rejected. This is the single zip-slip boundary: every
 * stored / served BYO file path passes through here.
 *
 * Rejects (returns null):
 *   - a directory entry (trailing slash, no file component)
 *   - any component equal to ".." (path traversal), even after backslash folding
 *   - an empty result after normalization
 *   - a path longer than BYO_MAX_PATH_LENGTH
 *   - a Windows drive-letter prefix ("C:...") or a NUL byte
 *
 * Normalizes:
 *   - backslashes to forward slashes (zip entries may use either)
 *   - a leading "/" (absolute) to relative
 *   - "." components and empty components are dropped
 *
 * The result is a clean relative path like "index.html" or "assets/app.js" that is
 * safe to append to a per-lab R2 key prefix.
 */
export function sanitizeZipEntryPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // A NUL byte is never legitimate and can truncate paths in some consumers.
  if (raw.includes("\0")) return null;
  // Fold Windows separators so "..\.." is caught the same as "../..".
  let p = raw.replace(/\\/g, "/");
  // A Windows drive-letter absolute path ("C:/..." or "C:...") is rejected.
  if (/^[a-zA-Z]:/.test(p)) return null;
  // A trailing slash means a pure directory entry, which has no bytes to store.
  if (p.endsWith("/")) return null;
  // Strip a leading slash so an "absolute" entry is treated as relative.
  while (p.startsWith("/")) p = p.slice(1);

  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue; // collapse empty + current-dir
    if (seg === "..") return null; // any parent-dir hop escapes the prefix -> reject
    out.push(seg);
  }
  if (out.length === 0) return null;
  const joined = out.join("/");
  if (joined.length > BYO_MAX_PATH_LENGTH) return null;
  return joined;
}

// ---------------------------------------------------------------------------
// Content-Type per extension
// ---------------------------------------------------------------------------

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  pdf: "application/pdf",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  wasm: "application/wasm",
  webm: "video/webm",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  parquet: "application/vnd.apache.parquet",
};

/** Fallback for an unknown / extensionless file. octet-stream + nosniff means an
 *  unknown type is downloaded, never executed in the page. */
export const BYO_DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * The Content-Type for a (already-sanitized) BYO file path, chosen by lowercased
 * extension. Unknown / extensionless paths return octet-stream so an unexpected
 * type is never served as HTML or script.
 */
export function contentTypeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return BYO_DEFAULT_CONTENT_TYPE;
  const ext = path.slice(dot + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? BYO_DEFAULT_CONTENT_TYPE;
}

// ---------------------------------------------------------------------------
// Serving path resolution
// ---------------------------------------------------------------------------

/** The conventional index file served for a directory / root request. */
export const BYO_INDEX_FILE = "index.html";

/**
 * Resolve the BYO file to serve for an incoming request path, or null when the
 * request is malformed (an escaping path). A directory-style request (empty, "/",
 * or trailing "/") resolves to that directory's index.html. Otherwise the
 * sanitized path is returned as-is. The caller then looks the resolved path up in
 * the site manifest; a path not present is a 404 (decided by the caller, not here).
 *
 * Examples:
 *   ""              -> "index.html"
 *   "/"             -> "index.html"
 *   "/about/"       -> "about/index.html"
 *   "/about"        -> "about" (a file named "about"; if absent the caller 404s)
 *   "assets/app.js" -> "assets/app.js"
 *   "/../secret"    -> null   (zip-slip style request, rejected)
 */
export function resolveByoServePath(requestPath: string): string | null {
  let p = typeof requestPath === "string" ? requestPath : "";
  p = p.replace(/\\/g, "/");
  // Strip a single leading slash (the route gives us the sub-path under the site).
  while (p.startsWith("/")) p = p.slice(1);
  // Root / empty -> the site index.
  if (p === "" ) return BYO_INDEX_FILE;
  // A directory request (trailing slash) -> that directory's index.
  const wantsIndex = p.endsWith("/");
  if (wantsIndex) p = p.slice(0, -1);

  // Reuse the zip-slip sanitizer to reject any traversal in the REQUEST path too,
  // so a crafted serve request can never read outside the site prefix.
  const safe = sanitizeZipEntryPath(p);
  if (safe === null) {
    // sanitizeZipEntryPath rejects a trailing slash / empty; a directory request
    // collapsed to "" above means root, already handled. Here a null means the
    // path contained ".." or similar -> reject.
    return null;
  }
  return wantsIndex ? `${safe}/${BYO_INDEX_FILE}` : safe;
}

// ---------------------------------------------------------------------------
// Host -> lab slug
// ---------------------------------------------------------------------------

/** The registrable assets domain that hosts BYO sites. A DIFFERENT registrable
 *  domain from the app's research-os.app, so BYO JS is cookie-isolated. Overridable
 *  via env for preview deployments. */
export const BYO_ASSETS_DOMAIN =
  process.env.LAB_BYO_ASSETS_DOMAIN ?? "research-os.com";

/**
 * Parse the lab slug from a Host header of the form `<labSlug>.research-os.com`
 * (case-insensitive, optional port). Returns null when the host is not a BYO
 * subdomain (e.g. the bare assets domain, or the app host), so the serve route can
 * fall back to an explicit slug param for local testing without the wildcard DNS.
 *
 * Only a SINGLE-label subdomain of the assets domain is accepted (so
 * `a.b.research-os.com` is rejected), and the label must be a valid slug
 * character set, so this never trusts an arbitrary attacker-chosen host.
 */
export function labSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  // Drop a port and lowercase.
  const h = host.split(":")[0]?.trim().toLowerCase() ?? "";
  const suffix = `.${BYO_ASSETS_DOMAIN.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, h.length - suffix.length);
  // Exactly one subdomain label (no dots) and a clean slug character set.
  if (label.length === 0 || label.includes(".")) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(label)) return null;
  return label;
}

// ---------------------------------------------------------------------------
// BYO site manifest (stored per lab)
// ---------------------------------------------------------------------------

/** One stored BYO file entry. path is the sanitized relative path (the R2 key
 *  tail under the lab prefix); bytes is its unzipped size. */
export interface ByoFileEntry {
  path: string;
  bytes: number;
}

/** The BYO site manifest stored for one lab (one BYO site per lab). */
export interface ByoSiteManifest {
  version: 1;
  /** The entry document served at the site root ("index.html" when present). */
  indexPath: string;
  /** Every stored file, sanitized relative path + byte size. */
  files: ByoFileEntry[];
  /** Sum of file bytes (also the value reported to billing). */
  totalBytes: number;
}

/** Hard cap on a serialized manifest (defensive against a giant blob). The
 *  manifest holds only metadata, never file bytes, so this is generous. */
export const BYO_MAX_MANIFEST_BYTES = 5_000_000;

/** The empty-but-valid manifest, returned for an absent or malformed input. */
export function emptyByoManifest(): ByoSiteManifest {
  return { version: 1, indexPath: BYO_INDEX_FILE, files: [], totalBytes: 0 };
}

function isByoFileEntry(value: unknown): value is ByoFileEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as { path?: unknown; bytes?: unknown };
  return (
    typeof e.path === "string" &&
    e.path.length > 0 &&
    sanitizeZipEntryPath(e.path) === e.path &&
    typeof e.bytes === "number" &&
    Number.isFinite(e.bytes) &&
    e.bytes >= 0
  );
}

/**
 * Validate an untrusted BYO manifest (from the DB column) into a safe
 * ByoSiteManifest. Never throws: a wrong shape collapses to the empty manifest,
 * and any file entry that is not the exact expected shape (or whose path fails the
 * zip-slip sanitizer) is dropped. Accepts an already-parsed object OR a raw JSON
 * string (the DB column is text).
 */
export function parseByoManifest(input: unknown): ByoSiteManifest {
  let value = input;
  if (typeof value === "string") {
    if (value.length > BYO_MAX_MANIFEST_BYTES) return emptyByoManifest();
    try {
      value = JSON.parse(value);
    } catch {
      return emptyByoManifest();
    }
  }
  if (!value || typeof value !== "object") return emptyByoManifest();
  const v = value as {
    version?: unknown;
    indexPath?: unknown;
    files?: unknown;
    totalBytes?: unknown;
  };
  if (v.version !== 1) return emptyByoManifest();
  if (!Array.isArray(v.files)) return emptyByoManifest();

  const files: ByoFileEntry[] = [];
  let total = 0;
  for (const entry of v.files) {
    if (!isByoFileEntry(entry)) continue;
    files.push({ path: entry.path, bytes: entry.bytes });
    total += entry.bytes;
    if (files.length >= BYO_MAX_ENTRY_COUNT) break;
  }
  const indexPath =
    typeof v.indexPath === "string" && sanitizeZipEntryPath(v.indexPath) === v.indexPath
      ? v.indexPath
      : BYO_INDEX_FILE;
  return { version: 1, indexPath, files, totalBytes: total };
}

/** Serialize a BYO manifest for storage in the text column, or null when over the
 *  byte cap or empty (no files). */
export function serializeByoManifest(manifest: ByoSiteManifest): string | null {
  if (manifest.files.length === 0) return null;
  const json = JSON.stringify(manifest);
  if (json.length > BYO_MAX_MANIFEST_BYTES) return null;
  return json;
}

// ---------------------------------------------------------------------------
// Zip unpacking result -> validated file set
// ---------------------------------------------------------------------------

/** A single unzipped file: a sanitized relative path + its raw bytes. */
export interface ByoUnpackedFile {
  path: string;
  bytes: Uint8Array;
}

/** The outcome of validating an unzipped set against the BYO caps + sanitizer. */
export type ByoValidateResult =
  | {
      ok: true;
      files: ByoUnpackedFile[];
      manifest: ByoSiteManifest;
    }
  | {
      ok: false;
      error:
        | "empty"
        | "too-many-files"
        | "too-large"
        | "bad-entry"
        | "no-index";
    };

/**
 * Validate a raw unzipped entry map (entry path -> bytes) against every BYO rule.
 * PURE so the whole accept/reject decision is unit-tested without a real zip:
 *   - every entry path is sanitized (zip-slip): a single rejected path fails the
 *     WHOLE upload ("bad-entry"), so a malicious archive is never partially stored.
 *   - the file count is capped ("too-many-files").
 *   - the total bytes are capped ("too-large").
 *   - the set must be non-empty ("empty") and contain an index.html somewhere so
 *     the root request can resolve ("no-index" otherwise).
 *
 * On success returns the sanitized file list + the manifest to store. The caller
 * (route) then PUTs each file to R2 and records the manifest.
 */
export function validateByoEntries(
  entries: Array<{ rawPath: string; bytes: Uint8Array }>,
): ByoValidateResult {
  if (entries.length === 0) return { ok: false, error: "empty" };

  const files: ByoUnpackedFile[] = [];
  let total = 0;
  for (const entry of entries) {
    // Skip archive noise (directory entries, __MACOSX, .DS_Store) up front so they
    // never count toward the caps or get stored. These carry no traversal risk.
    if (isBenignSkippableEntry(entry.rawPath)) continue;
    const safe = sanitizeZipEntryPath(entry.rawPath);
    // A non-benign entry that fails the sanitizer is a TRAVERSAL / unsafe entry,
    // which must hard-fail the WHOLE upload (never partially store a bad archive).
    if (safe === null) {
      return { ok: false, error: "bad-entry" };
    }
    files.push({ path: safe, bytes: entry.bytes });
    total += entry.bytes.byteLength;
    if (files.length > BYO_MAX_ENTRY_COUNT) {
      return { ok: false, error: "too-many-files" };
    }
    if (total > BYO_MAX_TOTAL_BYTES) {
      return { ok: false, error: "too-large" };
    }
  }

  if (files.length === 0) return { ok: false, error: "empty" };

  // The site must have an index.html (at root or in a single top-level folder a
  // common export shape) so the root request resolves. We require a root index.html
  // OR exactly-one top-level folder whose index.html we can map; to keep Slice 1
  // simple we require a root-level index.html.
  const hasRootIndex = files.some((f) => f.path === BYO_INDEX_FILE);
  if (!hasRootIndex) return { ok: false, error: "no-index" };

  const manifest: ByoSiteManifest = {
    version: 1,
    indexPath: BYO_INDEX_FILE,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes.byteLength })),
    totalBytes: total,
  };
  return { ok: true, files, manifest };
}

/** True when a rejected (null-sanitized) entry is a benign one to SKIP rather than
 *  hard-fail on: a pure directory entry (trailing slash) or a Mac/zip metadata
 *  entry. A traversal entry ("../x") is NOT benign and fails the whole upload. */
export function isBenignSkippableEntry(rawPath: string): boolean {
  const p = rawPath.replace(/\\/g, "/");
  if (p.endsWith("/")) return true; // directory entry, no bytes
  // Common archive metadata that carries no traversal risk.
  if (p === "__MACOSX" || p.startsWith("__MACOSX/")) return true;
  if (p.endsWith("/.DS_Store") || p === ".DS_Store") return true;
  return false;
}

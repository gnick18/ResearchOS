// Lab BYO ("bring your own") static-site GitHub source client (lab-domains BYO
// GitHub-connect Slice A, social lane).
//
// Instead of uploading a ZIP by hand, a lab can connect a PUBLIC GitHub repo (its
// paper-companion repo) as the site source. We pull the repo's ZIPBALL, unzip it,
// strip the single top-level `{repo}-{sha}/` wrapper folder GitHub adds (plus an
// optional configured subdir), and hand the resulting file entries to the SAME
// validateByoEntries path a manual zip upload uses, so a malicious repo is held to
// the exact same security bar (zip-slip sanitize + caps + require root index.html).
//
// PUBLIC repos ONLY for Slice A: a public repo's zipball downloads with no auth, so
// no GitHub App / OAuth is needed. Private repos (App install) + webhook auto-sync
// are a DEFERRED later slice. An optional GITHUB_TOKEN env, when present, is sent as
// a Bearer token, which raises the 60/hr unauthenticated rate limit (and is the hook
// for private repos later), but Slice A works WITHOUT it for public repos.
//
// SECURITY / SSRF. The ONLY hosts this module ever fetches are api.github.com and
// codeload.github.com, both hard-coded. owner / repo / ref are validated against a
// strict charset BEFORE being interpolated into the URL, so a value like "../" or a
// full "https://evil/" can never redirect the fetch off GitHub. The pure
// path-strip logic (stripZipballPrefix) is IO-free and unit-testable on its own.
//
// This module imports the social lane's OWN pure core (lab-byo.ts) for the caps and
// the file-entry shape. It does NOT import lib/sharing/**, lib/billing/** writes, or
// the R2 client (the route wires those, exactly like the upload route).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { unzipSync } from "fflate";

import {
  BYO_MAX_ENTRY_COUNT,
  BYO_MAX_TOTAL_BYTES,
  isBenignSkippableEntry,
} from "./lab-byo";

// ---------------------------------------------------------------------------
// owner / repo / ref / subdir validation (SSRF + path-safety boundary)
// ---------------------------------------------------------------------------

/** A GitHub owner (user or org) login: letters, digits, and single hyphens, max
 *  39 chars (GitHub's own limit). No dots, no slashes, no traversal. */
const GH_OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/** A GitHub repository name: letters, digits, dot, underscore, hyphen. GitHub
 *  forbids names that are "." or ".." and our charset also forbids a slash, so a
 *  repo value can never inject a path segment into the zipball URL. */
const GH_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

/** A git ref (branch / tag / sha): a conservative subset that is safe to place in
 *  a URL path segment. Allows slashes (feature/foo branches) but forbids any "."
 *  run that would form a traversal, leading/trailing slash, and the dangerous
 *  chars. Validated component-by-component in isSafeRef. */
const GH_REF_SEGMENT_RE = /^[a-zA-Z0-9._-]{1,200}$/;

/** True when an owner login is a safe GitHub owner (no traversal, no host). */
export function isSafeOwner(owner: string): boolean {
  return typeof owner === "string" && GH_OWNER_RE.test(owner);
}

/** True when a repo name is a safe GitHub repo (no slash, not "." / ".."). */
export function isSafeRepo(repo: string): boolean {
  if (typeof repo !== "string") return false;
  if (repo === "." || repo === "..") return false;
  return GH_REPO_RE.test(repo);
}

/**
 * True when a ref is a safe git ref to interpolate into the zipball URL. A ref may
 * contain slashes (feature branches), so it is validated SEGMENT by segment: every
 * "/"-separated part must match the safe segment charset and must not be "." or
 * ".." (so "../" or a "feature/../etc" ref can never escape the repo path). An
 * empty ref is rejected; the caller defaults to a branch name instead.
 */
export function isSafeRef(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) return false;
  if (ref.startsWith("/") || ref.endsWith("/")) return false;
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return false;
    if (!GH_REF_SEGMENT_RE.test(seg)) return false;
  }
  return true;
}

/**
 * Normalize + validate an optional subdir (the folder within the repo that is the
 * actual site root, e.g. "site" or "docs/public"). Returns the cleaned relative
 * path (no leading / trailing slash, "." and empty segments dropped) or null on a
 * traversal / unsafe value. An absent / blank subdir returns "" (the repo root).
 * Reuses the SAME zip-slip rejection rule as the entry sanitizer (".." => reject).
 */
export function normalizeSubdir(subdir: string | null | undefined): string | null {
  if (subdir === null || subdir === undefined) return "";
  if (typeof subdir !== "string") return null;
  const p = subdir.replace(/\\/g, "/").trim();
  if (p === "") return "";
  if (p.includes("\0")) return null;
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null; // a parent hop would escape the repo root
    if (!GH_REF_SEGMENT_RE.test(seg)) return null;
    out.push(seg);
  }
  return out.join("/");
}

// ---------------------------------------------------------------------------
// A recorded GitHub connection (input to a pull / sync)
// ---------------------------------------------------------------------------

/** The connection a lab records to source its BYO site from a public repo. */
export interface GithubConnection {
  owner: string;
  repo: string;
  /** The branch / tag / commit to pull. */
  ref: string;
  /** Optional folder within the repo that is the site root ("" = repo root). */
  subdir: string;
}

/** Validate a raw, untrusted connection (owner/repo/ref/subdir) into a clean
 *  GithubConnection, or null when any field fails its safe charset. The route
 *  calls this before recording the connection AND before every pull. */
export function parseGithubConnection(input: {
  owner?: unknown;
  repo?: unknown;
  ref?: unknown;
  subdir?: unknown;
}): GithubConnection | null {
  const owner = typeof input.owner === "string" ? input.owner.trim() : "";
  const repo = typeof input.repo === "string" ? input.repo.trim() : "";
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (!isSafeOwner(owner)) return null;
  if (!isSafeRepo(repo)) return null;
  if (!isSafeRef(ref)) return null;
  const subdir = normalizeSubdir(
    typeof input.subdir === "string" ? input.subdir : "",
  );
  if (subdir === null) return null;
  return { owner, repo, ref, subdir };
}

// ---------------------------------------------------------------------------
// Zipball URL (hard-coded host, validated path)
// ---------------------------------------------------------------------------

/** The GitHub API host. The ONLY host this client ever fetches from. */
export const GITHUB_API_HOST = "api.github.com";

/**
 * Build the zipball URL for a VALIDATED connection. The host is hard-coded and the
 * owner/repo/ref are charset-validated by the caller (parseGithubConnection), so
 * the only variable parts are safe path segments. encodeURIComponent is still
 * applied per segment as defense in depth (the ref's slashes are preserved by
 * encoding each ref segment, not the whole ref).
 *
 * Example: https://api.github.com/repos/smithlab/companion/zipball/main
 */
export function zipballUrl(conn: GithubConnection): string {
  const owner = encodeURIComponent(conn.owner);
  const repo = encodeURIComponent(conn.repo);
  const ref = conn.ref.split("/").map(encodeURIComponent).join("/");
  return `https://${GITHUB_API_HOST}/repos/${owner}/${repo}/zipball/${ref}`;
}

// ---------------------------------------------------------------------------
// Top-level wrapper-folder + subdir strip (PURE, unit-testable)
// ---------------------------------------------------------------------------

/** One raw entry from an unzipped GitHub zipball. */
export interface RawZipEntry {
  rawPath: string;
  bytes: Uint8Array;
}

/**
 * Strip GitHub's single top-level wrapper folder from every entry path, then strip
 * an optional subdir, returning entries whose paths are SITE-ROOT-RELATIVE (ready
 * for validateByoEntries). PURE (no IO), so the whole strip decision is unit-tested
 * without a real download.
 *
 * GitHub wraps a zipball in ONE top-level folder named `{repo}-{sha}/...` (the sha
 * is the resolved commit, not the ref). We do NOT trust the repo name to derive it;
 * instead we DETECT the common top-level segment shared by every non-benign entry
 * and strip exactly that one segment. This is robust to the exact folder name and
 * still safe, because validateByoEntries re-sanitizes every resulting path.
 *
 * If a subdir is given, only entries UNDER that subdir (after the wrapper strip)
 * are kept, and the subdir prefix is removed so its index.html becomes the site
 * root index.html. Benign archive noise (directory entries, __MACOSX, .DS_Store)
 * is dropped here so it never affects the common-prefix detection.
 *
 * Returns the stripped entries. An empty result (no files, or nothing under the
 * subdir) is returned as [] and the caller surfaces it as a validation "empty" /
 * "no-index" error via validateByoEntries.
 */
export function stripZipballPrefix(
  entries: RawZipEntry[],
  subdir: string,
): RawZipEntry[] {
  // Drop benign archive noise up front so it never skews the common-prefix detect.
  const real = entries.filter((e) => !isBenignSkippableEntry(e.rawPath));
  if (real.length === 0) return [];

  // Detect the single shared top-level segment (the `{repo}-{sha}` wrapper). If
  // every entry shares the SAME first path segment, that segment is the wrapper and
  // is stripped. If they do not all share one (an unexpected archive shape), strip
  // nothing and let validateByoEntries judge the raw paths.
  const firstSegment = (p: string): string => {
    const norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = norm.indexOf("/");
    return idx < 0 ? norm : norm.slice(0, idx);
  };
  const top = firstSegment(real[0].rawPath);
  const allShareTop =
    top.length > 0 && real.every((e) => firstSegment(e.rawPath) === top);

  const wrapperPrefix = allShareTop ? `${top}/` : "";
  // The subdir is matched AFTER the wrapper strip, so its prefix is relative to the
  // repo root inside the wrapper.
  const subPrefix = subdir ? `${subdir}/` : "";

  const out: RawZipEntry[] = [];
  for (const entry of real) {
    let rel = entry.rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (wrapperPrefix && rel.startsWith(wrapperPrefix)) {
      rel = rel.slice(wrapperPrefix.length);
    }
    if (subPrefix) {
      // Keep ONLY files inside the configured subdir, and re-root them so the
      // subdir's index.html becomes the site index.html.
      if (!rel.startsWith(subPrefix)) continue;
      rel = rel.slice(subPrefix.length);
    }
    if (rel === "") continue; // the folder entry itself, nothing to store
    out.push({ rawPath: rel, bytes: entry.bytes });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The IO edge: download + unzip the zipball
// ---------------------------------------------------------------------------

/** The outcome of pulling a repo's zipball. On success, entries are already
 *  wrapper-stripped + subdir-rerooted, ready for validateByoEntries. */
export type GithubPullResult =
  | { ok: true; entries: RawZipEntry[]; resolvedRef: string }
  | {
      ok: false;
      error:
        | "bad-connection"
        | "not-found"
        | "rate-limited"
        | "too-large"
        | "fetch-failed"
        | "bad-zip";
    };

/** Request headers the GitHub zipball fetch sends. A GITHUB_TOKEN, when present,
 *  raises the unauthenticated rate limit (and is the hook for private repos in a
 *  later slice). Slice A works WITHOUT it for public repos. */
function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    // Identify ourselves (GitHub requires a User-Agent) and pin the API version.
    "user-agent": "research-os-lab-byo",
    accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Download + unzip a PUBLIC GitHub repo's zipball for a VALIDATED connection, then
 * strip the wrapper folder + subdir, returning site-root-relative entries for
 * validateByoEntries. The ONLY network call is to api.github.com (which 302s to
 * codeload.github.com, an allowed GitHub host; fetch follows that redirect).
 *
 * Caps: a Content-Length over the BYO total-bytes cap short-circuits before
 * buffering, and the unzipped total is the real gate in validateByoEntries. The
 * fetch is the IO edge; the pure strip logic above does the path work.
 *
 * The connection MUST already be validated (parseGithubConnection); this re-checks
 * defensively and returns "bad-connection" rather than fetching an unsafe URL.
 */
export async function pullGithubZipball(
  conn: GithubConnection,
): Promise<GithubPullResult> {
  // Defense in depth: never fetch from an unvalidated connection.
  if (
    !isSafeOwner(conn.owner) ||
    !isSafeRepo(conn.repo) ||
    !isSafeRef(conn.ref) ||
    normalizeSubdir(conn.subdir) === null
  ) {
    return { ok: false, error: "bad-connection" };
  }

  const url = zipballUrl(conn);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: githubHeaders(),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: "fetch-failed" };
  }

  if (res.status === 404) return { ok: false, error: "not-found" };
  // GitHub signals a primary rate limit with 403 + a zero remaining, or 429.
  if (res.status === 429) return { ok: false, error: "rate-limited" };
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") return { ok: false, error: "rate-limited" };
    return { ok: false, error: "not-found" };
  }
  if (!res.ok) return { ok: false, error: "fetch-failed" };

  // Early size guard via Content-Length before buffering the whole body.
  const lenHeader = res.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > BYO_MAX_TOTAL_BYTES) {
      return { ok: false, error: "too-large" };
    }
  }

  let zipBytes: Uint8Array;
  try {
    const buf = await res.arrayBuffer();
    zipBytes = new Uint8Array(buf);
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  if (zipBytes.byteLength === 0) return { ok: false, error: "bad-zip" };
  if (zipBytes.byteLength > BYO_MAX_TOTAL_BYTES) {
    return { ok: false, error: "too-large" };
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    return { ok: false, error: "bad-zip" };
  }

  // A defensive entry-count guard before the strip (the unzip can yield many
  // entries; validateByoEntries caps again after the strip).
  const rawEntries: RawZipEntry[] = Object.entries(unzipped).map(
    ([rawPath, bytes]) => ({ rawPath, bytes }),
  );
  if (rawEntries.length > BYO_MAX_ENTRY_COUNT * 2) {
    return { ok: false, error: "too-large" };
  }

  const subdir = normalizeSubdir(conn.subdir) ?? "";
  const entries = stripZipballPrefix(rawEntries, subdir);

  // Resolve the wrapper folder name (the `{repo}-{sha}`), which carries the sha we
  // can surface as the resolved ref for the handoff / dashboard. Best-effort.
  const resolvedRef = resolvedRefFromEntries(rawEntries) ?? conn.ref;

  return { ok: true, entries, resolvedRef };
}

/** Best-effort extract the resolved commit sha from the wrapper folder name
 *  `{repo}-{sha}`. Returns the trailing sha-like token, or null. Purely cosmetic
 *  (shown to the lab head); never used for any security decision. */
export function resolvedRefFromEntries(entries: RawZipEntry[]): string | null {
  for (const e of entries) {
    if (isBenignSkippableEntry(e.rawPath)) continue;
    const norm = e.rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = norm.indexOf("/");
    const top = idx < 0 ? norm : norm.slice(0, idx);
    const dash = top.lastIndexOf("-");
    if (dash > 0 && dash < top.length - 1) {
      const tail = top.slice(dash + 1);
      if (/^[0-9a-f]{7,40}$/i.test(tail)) return tail;
    }
    return null;
  }
  return null;
}

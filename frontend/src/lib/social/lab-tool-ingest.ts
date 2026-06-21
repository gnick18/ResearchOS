// Tool-repo ingest: fetch README + GitHub wiki pages for a software tool repo
// (Phase A, social lane).
//
// When classifyRepo() returns "tool", this module runs at connect-time (mirroring
// the BYO GitHub-connect IO pattern) to fetch the repo's README and wiki pages,
// then stores them as native lab-site pages via the existing page store. No new
// schema is needed: README becomes the home page (""), and each wiki page becomes
// a "wiki/<slug>" page. An additive "source" field is passed in the title prefix
// to distinguish ingest-sourced pages from hand-authored ones in the dashboard.
//
// SSRF: the ONLY hosts fetched are api.github.com and raw.githubusercontent.com,
// both hard-coded. owner and repo are validated via the existing isSafeOwner and
// isSafeRepo guards from lab-byo-github.ts BEFORE interpolation. Wiki page names
// parsed from the sidebar/Home are validated via isSafeWikiPage (this module)
// before being interpolated into the raw.githubusercontent.com URL.
//
// Wiki fetch strategy (no git access needed):
//   1. Try to fetch /_Sidebar.md from the wiki raw URL. If it exists, parse all
//      markdown links in it to enumerate wiki pages.
//   2. If _Sidebar.md is absent (404), fetch Home.md and parse its markdown links.
//   3. Always include "Home" in the list (maps to ""). Other pages are fetched as
//      <Page>.md (spaces become hyphens in raw URLs per GitHub convention).
//   4. Missing pages (404) are silently skipped; a partial wiki is fine.
//
// The wiki parsing helpers (parseSidebarLinks, wikiPageToRawFilename) are PURE
// and unit-tested independently of IO.
//
// Storage: upsertPage + publishPage from lab-site-db.ts. The page path is
// "" for Home and "wiki/<normalized-name>" for other pages. On re-connect (sync)
// existing pages are overwritten because upsertPage uses ON CONFLICT DO UPDATE,
// which resets to draft, and publishPage immediately re-publishes. This mirrors
// how the BYO sync re-uploads the whole site bundle.
//
// This module is SERVER-SIDE ONLY (reads process.env for GITHUB_TOKEN). It does
// not import any client-only Next.js APIs.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isSafeOwner, isSafeRepo } from "./lab-byo-github";
import { upsertPage, publishPage } from "./lab-site-db";
import { upsertToolGithub } from "./lab-tool-db";

// ---------------------------------------------------------------------------
// Allowed fetch hosts (SSRF allowlist)
// ---------------------------------------------------------------------------

/** The GitHub REST API host. Used for repo metadata and root contents. */
const GH_API_HOST = "api.github.com";

/** The GitHub raw content host. Used for README and wiki markdown. */
const GH_RAW_HOST = "raw.githubusercontent.com";

// ---------------------------------------------------------------------------
// Wiki page name validation (SSRF + path-safety boundary)
// ---------------------------------------------------------------------------

/**
 * Safe wiki page name: letters, digits, spaces, hyphens, underscores, and
 * dots. GitHub wiki page names follow these rules; slashes and traversal
 * sequences are rejected. Max 200 chars. The name is validated BEFORE being
 * interpolated into a raw.githubusercontent.com URL.
 */
const WIKI_PAGE_NAME_RE = /^[a-zA-Z0-9 ._-]{1,200}$/;

/**
 * Returns true when a wiki page name is safe to interpolate into the wiki
 * raw URL. Rejects empty strings, traversal sequences, and names with
 * slashes or shell-special characters.
 */
export function isSafeWikiPage(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name === "." || name === "..") return false;
  if (!WIKI_PAGE_NAME_RE.test(name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pure wiki-link parsers (unit-testable without IO)
// ---------------------------------------------------------------------------

/**
 * Parse markdown link targets from a _Sidebar.md or Home.md wiki page. Returns
 * the raw link text targets (the href inside [[...]] or [label](target)) that
 * look like internal wiki page references (no http/https scheme, no anchors).
 *
 * GitHub wiki markdown uses two link styles:
 *   [[Page Name]]          -- wiki link (target = label)
 *   [label](Page-Name)     -- standard markdown, target is the slug form
 *
 * This parser is intentionally conservative: it only extracts names that pass
 * isSafeWikiPage so the result is always safe for URL interpolation without a
 * second validation pass. "Home" is never returned here (the caller always
 * prepends it).
 */
export function parseSidebarLinks(markdown: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  // [[Page Name]] style.
  const wikiLinkRe = /\[\[([^\]]+)]]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiLinkRe.exec(markdown)) !== null) {
    const raw = m[1].trim();
    // Skip "Home" (always injected by caller) and anchored links (contain #).
    if (raw.toLowerCase() === "home" || raw.includes("#")) continue;
    // [[label|target]] form: take the part after the pipe if present.
    const name = raw.includes("|") ? raw.split("|")[1].trim() : raw;
    if (isSafeWikiPage(name) && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  // [label](target) style. Target must not start with http/https (not an external link)
  // and must not contain slashes (no cross-repo links).
  const mdLinkRe = /\[([^\]]*?)]\(([^)]+)\)/g;
  while ((m = mdLinkRe.exec(markdown)) !== null) {
    const target = m[2].trim();
    if (target.startsWith("http") || target.includes("/") || target.includes("#")) continue;
    // GitHub raw wiki URLs use the page name with spaces as hyphens, but the
    // _Sidebar sometimes uses the display name (with spaces). Accept either form.
    const decoded = decodeURIComponent(target).replace(/-/g, " ");
    if (decoded.toLowerCase() === "home") continue;
    // Use decoded (human-readable) form for the fetch target so wikiPageToRawFilename
    // can apply the space-to-hyphen convention uniformly.
    if (isSafeWikiPage(decoded) && !seen.has(decoded)) {
      seen.add(decoded);
      names.push(decoded);
    }
  }

  return names;
}

/**
 * Convert a wiki page display name to the raw filename GitHub serves on
 * raw.githubusercontent.com/wiki/<owner>/<repo>/<filename>.
 *
 * GitHub wiki converts spaces to hyphens in the raw filename. The extension
 * is always ".md". "Home" maps to "Home.md". Examples:
 *   "Home"                 -> "Home.md"
 *   "Step-by-step-tutorial"-> "Step-by-step-tutorial.md"
 *   "Installation Guide"   -> "Installation-Guide.md"
 */
export function wikiPageToRawFilename(displayName: string): string {
  return displayName.replace(/ /g, "-") + ".md";
}

/**
 * Convert a wiki page display name to a normalized lab-site page path.
 * "Home" maps to "" (the lab home). Others map to "wiki/<slug>" where slug
 * is lowercase, spaces replaced by hyphens, and any non-slug chars stripped.
 *
 * Examples:
 *   "Home"                  -> ""
 *   "Installation"          -> "wiki/installation"
 *   "Step-by-step-tutorial" -> "wiki/step-by-step-tutorial"
 *   "Manual"                -> "wiki/manual"
 */
export function wikiPageToPath(displayName: string): string {
  if (displayName.toLowerCase() === "home") return "";
  const slug = displayName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `wiki/${slug}` : `wiki/${displayName.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Repo metadata types
// ---------------------------------------------------------------------------

/** Metadata fetched from the GitHub API for a tool repo. */
export interface ToolRepoMeta {
  /** Repo name (e.g. "starfish"). */
  name: string;
  /** Owner login (e.g. "egluckthaler"). */
  owner: string;
  /** Short description from GitHub, or null if absent. */
  description: string | null;
  /** Primary language as reported by GitHub (e.g. "Perl"), or null. */
  primaryLanguage: string | null;
  /** SPDX license identifier (e.g. "MIT"), or null. */
  license: string | null;
  /** Canonical GitHub URL (e.g. "https://github.com/egluckthaler/starfish"). */
  htmlUrl: string;
  /**
   * Tag name of the latest release, or null when the repo has no releases.
   * Fetched from GET /repos/{owner}/{repo}/releases/latest.
   */
  latestRelease: string | null;
  /**
   * URL to a logo asset in the repo's assets/ directory, or null. Detected by
   * scanning the root contents list for an assets/ directory, then fetching
   * its contents and looking for a file whose name contains "logo" or "Logo"
   * (case-insensitive). Returns the raw.githubusercontent.com URL so it can be
   * rendered directly in an <img> tag without a proxy.
   */
  logoUrl: string | null;
  /** The root file/dir names (already fetched for classification). */
  rootFileNames: string[];
}

// ---------------------------------------------------------------------------
// GitHub headers (mirrored from lab-byo-github.ts)
// ---------------------------------------------------------------------------

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": "research-os-lab-byo",
    accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// Safe URL builders (hard-coded hosts, validated path segments)
// ---------------------------------------------------------------------------

function apiRepoUrl(owner: string, repo: string, path: string): string {
  return `https://${GH_API_HOST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
}

function rawWikiUrl(owner: string, repo: string, filename: string): string {
  // raw.githubusercontent.com/wiki/<owner>/<repo>/<filename>
  return `https://${GH_RAW_HOST}/wiki/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(filename)}`;
}

function rawContentUrl(owner: string, repo: string, ref: string, filePath: string): string {
  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<filePath>
  // filePath is validated by the caller (README filename from detectReadmeFilename).
  return `https://${GH_RAW_HOST}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${filePath}`;
}

/**
 * Rewrite RELATIVE image sources in README markdown to absolute
 * raw.githubusercontent.com URLs. A relative repo image like assets/logo.png,
 * left as-is, resolves against the lab-site origin
 * (<slug>.research-os.com/assets/logo.png) where the catch-all returns the HTML
 * shell with a 200, so the <img> is broken. Rewriting to the repo raw URL makes
 * it a real external image (which the lab-public CSP img-src then allows).
 *
 * Absolute (http/https), protocol-relative (//), data:, and anchor (#) sources
 * are left untouched. Covers markdown ![alt](src) and HTML <img src="...">.
 * `ref` is the git ref the README was fetched at (HEAD for the default branch).
 * Pure + exported so the rewrite is unit-tested without a network fetch.
 */
export function rewriteRelativeReadmeImages(
  markdown: string,
  owner: string,
  repo: string,
  ref: string,
): string {
  const rawBase = `https://${GH_RAW_HOST}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/`;
  const toAbsolute = (src: string): string => {
    const s = src.trim();
    if (
      /^(https?:)?\/\//i.test(s) ||
      s.startsWith("data:") ||
      s.startsWith("#")
    ) {
      return src;
    }
    // Strip a leading "./" or a repo-root-relative "/" so the path joins cleanly.
    const clean = s.replace(/^\.?\//, "");
    return rawBase + clean;
  };
  // Markdown image syntax: ![alt](src) or ![alt](src "title"). Capture the src up
  // to the first whitespace or closing paren so an optional title is preserved.
  let out = markdown.replace(
    /(!\[[^\]]*\]\()([^)\s]+)/g,
    (_m, prefix: string, src: string) => prefix + toAbsolute(src),
  );
  // HTML <img src="..."> (single or double quoted).
  out = out.replace(
    /(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi,
    (_m, prefix: string, q: string, src: string) =>
      `${prefix}${q}${toAbsolute(src)}${q}`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

/** Fetch a text resource, returning null on 404 or network error. */
async function fetchText(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Fetch JSON, returning null on failure. */
async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata fetch
// ---------------------------------------------------------------------------

/** Raw shape of a GitHub /repos/{owner}/{repo} API response (subset). */
interface GhRepoJson {
  name?: string;
  description?: string | null;
  language?: string | null;
  html_url?: string;
  license?: { spdx_id?: string | null } | null;
}

/** Raw shape of a GitHub /repos/{owner}/{repo}/releases/latest response. */
interface GhReleaseJson {
  tag_name?: string;
}

/** Raw shape of a GitHub /repos/{owner}/{repo}/contents/assets entry. */
interface GhContentsEntry {
  name: string;
  type: "file" | "dir" | string;
  download_url?: string | null;
}

/**
 * Fetch repo metadata needed for the tool page header. Returns null when the
 * owner/repo fails validation or the API returns an error.
 */
export async function fetchToolRepoMeta(
  owner: string,
  repo: string,
): Promise<ToolRepoMeta | null> {
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return null;

  const headers = githubHeaders();

  // Fetch repo info and root contents in parallel.
  const [repoJson, contentsJson, releaseJson] = await Promise.all([
    fetchJson<GhRepoJson>(apiRepoUrl(owner, repo, ""), headers),
    fetchJson<GhContentsEntry[]>(apiRepoUrl(owner, repo, "/contents"), headers),
    fetchJson<GhReleaseJson>(apiRepoUrl(owner, repo, "/releases/latest"), headers),
  ]);

  if (!repoJson) return null;

  const rootFileNames: string[] = Array.isArray(contentsJson)
    ? contentsJson.map((e) => e.name)
    : [];

  // Try to find a logo asset in the assets/ directory.
  let logoUrl: string | null = null;
  if (Array.isArray(contentsJson)) {
    const assetsDir = contentsJson.find(
      (e) => e.name.toLowerCase() === "assets" && e.type === "dir",
    );
    if (assetsDir) {
      const assetsContents = await fetchJson<GhContentsEntry[]>(
        apiRepoUrl(owner, repo, "/contents/assets"),
        headers,
      );
      if (Array.isArray(assetsContents)) {
        const logoEntry = assetsContents.find((e) =>
          e.type === "file" && /logo/i.test(e.name),
        );
        if (logoEntry?.download_url) {
          logoUrl = logoEntry.download_url;
        }
      }
    }
  }

  return {
    name: repoJson.name ?? repo,
    owner,
    description: repoJson.description ?? null,
    primaryLanguage: repoJson.language ?? null,
    license: repoJson.license?.spdx_id ?? null,
    htmlUrl: repoJson.html_url ?? `https://github.com/${owner}/${repo}`,
    latestRelease: releaseJson?.tag_name ?? null,
    logoUrl,
    rootFileNames,
  };
}

// ---------------------------------------------------------------------------
// README fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the README content for a repo. The readmeFilename is detected by the
 * caller via detectReadmeFilename (from lab-repo-classify.ts) to avoid a
 * hardcoded "README.md" that 404s on repos using README.rst etc. Falls back
 * to "HEAD" as the ref (GitHub's alias for the default branch).
 *
 * Returns null when the README is absent or the fetch fails.
 */
export async function fetchReadme(
  owner: string,
  repo: string,
  readmeFilename: string,
): Promise<string | null> {
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return null;
  // readmeFilename is produced by detectReadmeFilename (validates against a
  // known safe set), but we defensively check isSafeWikiPage-like chars.
  if (!WIKI_PAGE_NAME_RE.test(readmeFilename.replace(/\//g, ""))) return null;
  const url = rawContentUrl(owner, repo, "HEAD", readmeFilename);
  return fetchText(url, githubHeaders());
}

// ---------------------------------------------------------------------------
// Wiki page enumeration + fetch
// ---------------------------------------------------------------------------

/**
 * Enumerate wiki page names for a repo. Tries _Sidebar.md first, then
 * Home.md, then returns at minimum ["Home"]. The returned list always starts
 * with "Home".
 *
 * This is the only place that makes wiki-URL IO calls; the link parsers
 * (parseSidebarLinks, wikiPageToRawFilename) are pure and called from here.
 */
export async function enumerateWikiPages(
  owner: string,
  repo: string,
): Promise<string[]> {
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return ["Home"];

  const headers = githubHeaders();

  // Try _Sidebar.md first.
  const sidebarMd = await fetchText(rawWikiUrl(owner, repo, "_Sidebar.md"), headers);
  if (sidebarMd !== null) {
    const extra = parseSidebarLinks(sidebarMd);
    return ["Home", ...extra];
  }

  // Fall back to parsing Home.md for links to other pages.
  const homeMd = await fetchText(rawWikiUrl(owner, repo, "Home.md"), headers);
  if (homeMd !== null) {
    const extra = parseSidebarLinks(homeMd);
    return ["Home", ...extra];
  }

  // No wiki at all: just Home (which will also 404, handled gracefully below).
  return ["Home"];
}

/**
 * Fetch a single wiki page's markdown content. Returns null on 404/error.
 * displayName must pass isSafeWikiPage before calling.
 */
export async function fetchWikiPage(
  owner: string,
  repo: string,
  displayName: string,
): Promise<string | null> {
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return null;
  if (!isSafeWikiPage(displayName)) return null;
  const filename = wikiPageToRawFilename(displayName);
  return fetchText(rawWikiUrl(owner, repo, filename), githubHeaders());
}

// ---------------------------------------------------------------------------
// Top-level ingest entry point
// ---------------------------------------------------------------------------

/** The result of a full tool ingest: what was stored. */
export interface ToolIngestResult {
  /** The pages that were created/updated (by path). */
  upsertedPaths: string[];
  /** The pages that were successfully published. */
  publishedPaths: string[];
  /** The tool repo metadata fetched (for callers that want to display it). */
  meta: ToolRepoMeta;
}

/**
 * Ingest a tool repo into the lab-site page store: fetch README + wiki pages
 * and store them as published native pages. Safe to call on re-connect (sync):
 * upsertPage + publishPage are idempotent over the same (labOwnerKey, path).
 *
 * The README becomes the home page (""). Each wiki page that returns 200
 * becomes a "wiki/<slug>" page. Missing wiki pages are silently skipped.
 *
 * Returns null when owner/repo validation fails or repo metadata cannot be
 * fetched (which means the repo does not exist or is private).
 */
export async function ingestToolRepo(opts: {
  labOwnerKey: string;
  owner: string;
  repo: string;
  readmeFilename: string;
}): Promise<ToolIngestResult | null> {
  const { labOwnerKey, owner, repo, readmeFilename } = opts;
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return null;

  // Fetch metadata, README, and wiki page list in parallel.
  const [meta, readmeMd, wikiPageNames] = await Promise.all([
    fetchToolRepoMeta(owner, repo),
    fetchReadme(owner, repo, readmeFilename),
    enumerateWikiPages(owner, repo),
  ]);

  if (!meta) return null;

  const upsertedPaths: string[] = [];
  const publishedPaths: string[] = [];

  // Helper to upsert + publish a page.
  async function store(path: string, title: string, bodyMd: string): Promise<void> {
    await upsertPage({ labOwnerKey, path, title, bodyMd });
    upsertedPaths.push(path);
    await publishPage(labOwnerKey, path, null, null);
    publishedPaths.push(path);
  }

  // Persist the tool repo metadata so the render route can display the tool
  // header (name, description, language, license, links) without a GitHub API
  // round-trip on every page view.
  const latestReleaseUrl = meta.latestRelease
    ? `${meta.htmlUrl}/releases/tag/${encodeURIComponent(meta.latestRelease)}`
    : null;
  await upsertToolGithub({
    labOwnerKey,
    owner: meta.owner,
    repo: meta.name,
    repoName: meta.name,
    repoDescription: meta.description,
    primaryLanguage: meta.primaryLanguage,
    license: meta.license,
    htmlUrl: meta.htmlUrl,
    latestRelease: meta.latestRelease,
    latestReleaseUrl,
    logoUrl: meta.logoUrl,
  });

  // README -> home page (""). Rewrite relative image paths to absolute raw URLs
  // first, so repo-relative images (e.g. assets/logo.png) load on the public lab
  // site instead of resolving against the lab origin (where the catch-all returns
  // the HTML shell, a broken image). "HEAD" matches the ref fetchReadme used.
  const homeBody = readmeMd
    ? rewriteRelativeReadmeImages(readmeMd, owner, repo, "HEAD")
    : `# ${meta.name}\n\n${meta.description ?? ""}`;
  await store("", meta.name, homeBody);

  // Wiki pages -> "wiki/<slug>".
  // Fetch all wiki pages in parallel; store them sequentially to avoid
  // overwhelming the DB (upsertPage is a DB write).
  const wikiExtras = wikiPageNames.filter((n) => n.toLowerCase() !== "home");
  const wikiContents = await Promise.all(
    wikiExtras.map((name) => fetchWikiPage(owner, repo, name)),
  );

  for (let i = 0; i < wikiExtras.length; i++) {
    const name = wikiExtras[i];
    const content = wikiContents[i];
    if (content === null) continue; // 404 or network error: skip silently
    const path = wikiPageToPath(name);
    const title = name.replace(/-/g, " ");
    await store(path, title, content);
  }

  return { upsertedPaths, publishedPaths, meta };
}

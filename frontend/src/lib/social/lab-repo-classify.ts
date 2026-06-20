// Repo-type classifier for lab GitHub-connected sites (Phase A, social lane).
//
// A lab's connected GitHub repo can be a STATIC SITE (has a root index.html,
// GitHub Pages is configured, or a static-site generator marker like _config.yml)
// or a SOFTWARE TOOL (has a README but none of the site markers above). Each type
// gets a different public render: "site" follows the existing BYO path; "tool"
// gets a native software-companion page (ToolSitePageView).
//
// This classifier is PURE: it takes the root file list and metadata flags as
// plain arguments so it is unit-testable without any IO. The IO boundary (the
// GitHub API fetch that produces the inputs) lives in lab-tool-ingest.ts.
//
// Examples:
//   gnick18/FungalICS_Website  -- has index.html          -> "site"
//   egluckthaler/starfish      -- Perl, README, no index   -> "tool"
//   egluckthaler/chtc          -- Shell, README, no index  -> "tool"
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two repo types this classifier produces. */
export type RepoType = "site" | "tool";

/**
 * The pure inputs the classifier needs. All sourced from the GitHub REST API
 * (contents list + pages endpoint) without IO in this module.
 */
export interface ClassifyRepoInput {
  /**
   * The list of file and directory names at the repo root. Only names, no
   * paths (the classifier never looks inside subdirectories). The caller
   * fetches these from GET /repos/{owner}/{repo}/contents (returns an array of
   * {name, type} objects; pass the names only for testability).
   */
  rootFileNames: string[];
  /**
   * True when GitHub Pages is enabled for this repo (source is non-null in the
   * GET /repos/{owner}/{repo}/pages response, or a 200 response itself means
   * Pages is configured). False or undefined when the Pages endpoint 404s
   * (Pages not configured) or is inaccessible.
   */
  pagesEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Site-marker file names (case-insensitive match)
// ---------------------------------------------------------------------------

/**
 * Root file names whose presence makes a repo a static site. The list covers
 * the major static-site generators (Jekyll, Hugo, Gatsby, VitePress, etc.)
 * and the canonical browser entry point.
 *
 * index.html  -- the canonical browser entry point; the BYO path already
 *                requires it, so this is the most reliable signal.
 * _config.yml -- Jekyll configuration (GitHub Pages default).
 * config.toml -- Hugo or Zola configuration.
 * gatsby-config.js / gatsby-config.ts -- Gatsby.
 * next.config.js / next.config.ts -- Next.js (static-export mode).
 * vitepress.config.ts etc. -- covered by checking the "vitepress" substring.
 * .nojekyll   -- presence means the author is treating the repo as a plain
 *                site (GitHub Pages directive).
 * CNAME       -- custom domain for GitHub Pages, a strong site signal.
 */
const SITE_MARKER_NAMES_LOWER = new Set([
  "index.html",
  "index.htm",
  "_config.yml",
  "_config.yaml",
  "config.toml",
  "config.yaml",
  "gatsby-config.js",
  "gatsby-config.ts",
  "next.config.js",
  "next.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  ".nojekyll",
  "cname",
]);

/**
 * Returns true when the lowercased file name is a site marker. Kept separate
 * from the Set so callers can apply it without constructing the Set themselves.
 */
function isSiteMarkerName(lower: string): boolean {
  if (SITE_MARKER_NAMES_LOWER.has(lower)) return true;
  // vitepress.config.* and similar framework configs that embed "vitepress" or
  // "docusaurus" in the filename.
  if (lower.includes("vitepress") || lower.includes("docusaurus")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a connected GitHub repo as a "site" or a "tool".
 *
 * "site" when ANY of these conditions is true:
 *   1. The repo has a root index.html (or index.htm).
 *   2. GitHub Pages is explicitly enabled (pagesEnabled = true).
 *   3. A known static-site generator marker (_config.yml, config.toml,
 *      gatsby-config.js, next.config.js, .nojekyll, CNAME, etc.) is present
 *      at the repo root.
 *
 * "tool" when NONE of the above is true and at least one of the root names
 * looks like a README (README.md, README.rst, README, readme.md, etc.).
 *
 * "tool" is also the fallback when neither site markers nor a README are
 * found, because an empty / ambiguous repo still benefits from the software
 * page treatment (it avoids showing a blank BYO site).
 */
export function classifyRepo(input: ClassifyRepoInput): RepoType {
  if (input.pagesEnabled) return "site";

  const lower = input.rootFileNames.map((n) => n.toLowerCase());

  // Site marker scan: first match short-circuits.
  for (const name of lower) {
    if (isSiteMarkerName(name)) return "site";
  }

  // No site marker found: treat as a tool (README present or absent).
  return "tool";
}

// ---------------------------------------------------------------------------
// README detector (shared with the ingest layer)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical README filename from the root file list, preferring
 * README.md > README.rst > README.txt > README (case-insensitive). Returns
 * null when no README is found. The ingest layer uses this to pick the fetch
 * target rather than hardcoding "README.md", which avoids a 404 for repos
 * that use a non-markdown readme.
 */
export function detectReadmeFilename(rootFileNames: string[]): string | null {
  // Priority order for README formats.
  const priority = ["readme.md", "readme.rst", "readme.txt", "readme"];
  const lower = rootFileNames.map((n) => n.toLowerCase());
  for (const candidate of priority) {
    const idx = lower.indexOf(candidate);
    if (idx >= 0) return rootFileNames[idx]; // return original casing
  }
  return null;
}

#!/usr/bin/env node
/**
 * Wiki search index builder.
 *
 * Walks every `frontend/src/app/wiki/.../page.tsx` and extracts:
 *   - the title (from `title="..."` on `<WikiPage>`, the `WIKI_NAV` label, or a
 *     fallback derived from the slug)
 *   - the breadcrumbs (top-level wiki section + path labels)
 *   - the top-level `categoryId` (first segment under `/wiki`, e.g.
 *     `features`, `getting-started`, `integrations`, `security`,
 *     `shared-lab-accounts`, or `quickstart` for the landing page)
 *   - the visible headings (`<h2>` / `<h3>` text)
 *   - body text from `<p>`, `<li>`, callout body strings, and the `intro` prop
 *
 * Writes the result as a single JSON file at
 *   `frontend/public/wiki-search-index.json`
 * which the runtime `WikiSearch` component fetches once on mount.
 *
 * Modes:
 *   - `node scripts/build-wiki-search-index.mjs` (default) — writes the JSON
 *     and prints a small stats summary. Exit 0.
 *   - `--quiet` — same, but suppresses non-error output (used by prebuild).
 *
 * No npm dependencies: we use a tolerant, hand-rolled JSX/TSX scanner instead
 * of pulling in @babel/parser. Wiki pages follow a tight house style (the
 * `WikiPage` wrapper, plus a small set of helpers) so a regex-driven walker
 * picks up the content we care about without false positives. If the house
 * style changes the script's stats-line guardrail catches under-coverage at
 * build time.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WIKI_DIR = path.join(REPO_ROOT, "frontend", "src", "app", "wiki");
const NAV_FILE = path.join(REPO_ROOT, "frontend", "src", "lib", "wiki", "nav.ts");
const OUT_FILE = path.join(REPO_ROOT, "frontend", "public", "wiki-search-index.json");

const isQuiet = process.argv.includes("--quiet");

/* ───────────── nav parsing ────────────────────────────────────────────── */

/** Very small WIKI_NAV literal parser. Pulls `{ href, label }` pairs out of
 *  the file so we don't need to evaluate TypeScript. Children are recovered
 *  by walking the tree in href order (every leaf carries its full href path,
 *  so we can rebuild ancestry without nested braces). */
function parseWikiNav() {
  const source = readFileSync(NAV_FILE, "utf8");
  const start = source.indexOf("WIKI_NAV: WikiNode[]");
  if (start === -1) throw new Error("Couldn't find WIKI_NAV in nav.ts");
  // The literal starts after the `=` sign. Look for the assignment first
  // so the `[]` in the `WikiNode[]` type annotation doesn't confuse us.
  const assign = source.indexOf("=", start);
  const openBracket = source.indexOf("[", assign);
  if (openBracket === -1) throw new Error("Couldn't find WIKI_NAV start bracket");
  // Walk forward, tracking bracket depth, to find the matching closing `];`
  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Couldn't find WIKI_NAV end bracket");
  const body = source.slice(openBracket + 1, end);

  // Each WikiNode looks like `{ href: "...", label: "...", ... }`. We extract
  // each href/label pair in order. Same flat pass works for children since
  // the literal is order-preserving and every node carries the full href.
  const nodes = [];
  const re = /href:\s*"([^"]+)"[\s\S]*?label:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    nodes.push({ href: m[1], label: m[2].replace(/\\"/g, '"') });
  }
  return nodes;
}

/** Build href → { label, breadcrumbs, categoryId } via the flat list.
 *  Breadcrumbs are the chain of labels from the top-level section down to
 *  the leaf. The category id is the first path segment under `/wiki`. */
function buildHrefMeta(navList) {
  const byHref = new Map(navList.map((n) => [n.href, n]));
  const meta = new Map();
  for (const node of navList) {
    const { href, label } = node;
    const breadcrumbs = [];
    const segments = href.split("/").filter(Boolean); // ['wiki', 'features', 'gantt']
    let accum = "";
    for (let i = 0; i < segments.length; i++) {
      accum += "/" + segments[i];
      if (accum === "/wiki") continue;
      const found = byHref.get(accum);
      if (found) breadcrumbs.push(found.label);
    }
    // categoryId is the first segment under /wiki, or 'quickstart' for the
    // landing page (which has no further segments).
    const segs = href.replace(/^\/wiki\/?/, "").split("/").filter(Boolean);
    const categoryId = segs.length === 0 ? "quickstart" : segs[0];
    meta.set(href, { label, breadcrumbs, categoryId });
  }
  return meta;
}

/* ───────────── tsx → href ─────────────────────────────────────────────── */

/** Walk the wiki page tree and yield { absPath, href } for each page.tsx. */
function discoverWikiPages() {
  const out = [];
  function walk(dir, hrefBase) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith("_") || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, hrefBase + "/" + entry);
      } else if (entry === "page.tsx") {
        // The href for a `page.tsx` is the directory it sits in.
        out.push({ absPath: full, href: hrefBase || "/wiki" });
      }
    }
  }
  walk(WIKI_DIR, "/wiki");
  // Stable order for reproducible builds.
  out.sort((a, b) => a.href.localeCompare(b.href));
  return out;
}

/* ───────────── tsx text extraction ────────────────────────────────────── */

/** Strip imports + comment blocks before content extraction so we don't
 *  pull JSX-prop names or developer notes into the search index. */
function preprocess(source) {
  // Drop import statements.
  let s = source.replace(/^\s*import[\s\S]*?;[ \t]*\n/gm, "");
  // Drop // line comments (only when the entire line is a comment, to avoid
  // chewing through URL-with-slashes inside string literals).
  s = s.replace(/^[ \t]*\/\/.*$/gm, "");
  // Drop /* … */ block comments.
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return s;
}

/** Resolve `&apos;`, `&quot;`, `&amp;`, `&rsquo;`, `&ldquo;`, `&rdquo;`,
 *  `&mdash;`, `&ndash;`, `&hellip;`, `&rarr;` and numeric entities to plain
 *  text. The wiki source is heavy on these. */
function decodeEntities(s) {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&rarr;/g, "->")
    .replace(/&larr;/g, "<-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Collapse runs of whitespace and trim. */
function squish(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** Pull the inner-text out of a JSX/TSX snippet, dropping all JSX tags and
 *  expression containers (`{...}`). Code-block content (anything inside a
 *  `<code>` or `<pre>` tag) is dropped wholesale: we don't want to surface
 *  raw filenames or JSON snippets in body matches.
 *
 *  This is intentionally tolerant: we don't parse JSX, we just strip it.
 *  For our wiki's house style (short curated copy inside <p> / <li> /
 *  <Callout> bodies) this picks up the right text without false positives. */
function extractTextFromJsx(jsx) {
  let s = jsx;
  // Drop <code>…</code> and <pre>…</pre> blocks entirely.
  s = s.replace(/<code[\s\S]*?<\/code>/g, " ");
  s = s.replace(/<pre[\s\S]*?<\/pre>/g, " ");
  // Drop JSX expression containers: {x.y.z}, {foo && bar}, {/* … */}, etc.
  // We need to handle nested braces, so do this with a depth-tracking sweep.
  s = stripJsxExpressions(s);
  // Drop React Fragments (`<>` and `</>`).
  s = s.replace(/<\/?>/g, " ");
  // Drop every remaining JSX tag (open, close, or self-closing).
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, " ");
  // Entities & whitespace.
  s = decodeEntities(s);
  return squish(s);
}

/** Strip `{ ... }` JSX expression containers, respecting nesting. We can't
 *  just regex this away because `{ foo && <span>bar</span> }` has nested
 *  braces inside JSX. */
function stripJsxExpressions(s) {
  let out = "";
  let i = 0;
  let inStr = null; // tracks " or ' or ` for string literals at depth 0
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") {
        out += ch + (s[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        const c2 = s[i];
        if (c2 === "{") depth++;
        else if (c2 === "}") depth--;
        i++;
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Find every `<TagName ...>…</TagName>` block in `s` and return their
 *  inner content. Handles nested same-name tags by depth-tracking. Skips
 *  self-closing variants. */
function findBlocks(s, tagName) {
  const out = [];
  const openRe = new RegExp(`<${tagName}\\b[^>]*?>`, "g");
  let m;
  while ((m = openRe.exec(s)) !== null) {
    // Skip self-closing (`<Foo …/>`)
    const tag = m[0];
    if (tag.endsWith("/>")) continue;
    const start = m.index + tag.length;
    // Walk forward, tracking <TagName …> / </TagName> pairs.
    let depth = 1;
    let i = start;
    while (i < s.length && depth > 0) {
      // Skip code blocks so nested <Tag inside <code>…</code> doesn't confuse depth.
      if (s.startsWith("<code", i)) {
        const close = s.indexOf("</code>", i);
        if (close === -1) break;
        i = close + "</code>".length;
        continue;
      }
      if (s.startsWith("<pre", i)) {
        const close = s.indexOf("</pre>", i);
        if (close === -1) break;
        i = close + "</pre>".length;
        continue;
      }
      if (s.startsWith(`</${tagName}>`, i)) {
        depth--;
        if (depth === 0) {
          out.push(s.slice(start, i));
          i += `</${tagName}>`.length;
          // Reset the openRe lastIndex so we keep scanning past this close.
          openRe.lastIndex = i;
          break;
        }
        i += `</${tagName}>`.length;
        continue;
      }
      // Detect nested same-tag opens that are not self-closing.
      const openMatch = s.slice(i).match(new RegExp(`^<${tagName}\\b[^>]*?>`));
      if (openMatch && !openMatch[0].endsWith("/>")) {
        depth++;
        i += openMatch[0].length;
        continue;
      }
      i++;
    }
  }
  return out;
}

/** Pull the value of a JSX string prop like `title="…"` from an open tag. */
function getStringProp(openTag, propName) {
  const re = new RegExp(`\\b${propName}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = openTag.match(re);
  if (!m) return null;
  return decodeEntities(m[1]).trim();
}

/** Pull a JSX prop value that may be a string literal (`title="..."`) OR
 *  an expression container (`title={...}`). For expression containers we
 *  extract just the readable string portion (quoted string fragments and
 *  Capital-cased <strong>/<em>/<Link> bodies are common patterns inside
 *  the wiki's intro prop). */
function getMixedProp(openTag, propName) {
  const literal = getStringProp(openTag, propName);
  if (literal !== null) return literal;
  // Match `intro={...}` — find the matching brace then extract text.
  const idx = openTag.search(new RegExp(`\\b${propName}\\s*=\\s*\\{`));
  if (idx === -1) return null;
  // Walk braces inside openTag (which is just the open tag, no nested
  // children). Most cases here are short single-line fragments.
  const start = openTag.indexOf("{", idx);
  let depth = 1;
  let i = start + 1;
  while (i < openTag.length && depth > 0) {
    const c = openTag[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  const exprBody = openTag.slice(start + 1, i);
  // Best-effort text extraction: drop tags, decode entities, collapse.
  return extractTextFromJsx(exprBody) || null;
}

/** Open-tag finder for `<WikiPage …>` (the outer wrapper, multiline). We
 *  read everything up to the first non-escaped `>` that closes the open tag.
 *  WikiPage always wraps its children, never self-closes. */
function findWikiPageOpenTag(s) {
  const idx = s.indexOf("<WikiPage");
  if (idx === -1) return null;
  // Walk forward, counting brace depth so a `>` inside `{...}` doesn't end the tag.
  let depth = 0;
  let inStr = null;
  for (let i = idx + "<WikiPage".length; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) {
      return s.slice(idx, i + 1);
    }
  }
  return null;
}

/** Extract the body strings of Callout components. Callout uses `title="..."`
 *  on the open tag (already grabbed as a heading) plus children we want as
 *  body text. */
function extractCalloutContent(jsx) {
  const blocks = findBlocks(jsx, "Callout");
  const headings = [];
  const bodies = [];
  // For each Callout block we also need the open-tag title prop. Re-scan from
  // each block's start index using a positional walker.
  const openRe = /<Callout\b[^>]*?>/g;
  let m;
  while ((m = openRe.exec(jsx)) !== null) {
    const openTag = m[0];
    if (openTag.endsWith("/>")) continue;
    const title = getStringProp(openTag, "title");
    if (title) headings.push(title);
  }
  for (const body of blocks) {
    const text = extractTextFromJsx(body);
    if (text) bodies.push(text);
  }
  return { headings, bodies };
}

/** Walk a tsx source file and return the searchable content for that page. */
function extractPageContent(source) {
  const pre = preprocess(source);

  const headings = [];
  const bodySnippets = [];

  // Pull out the WikiPage open tag so we can read its `title` and `intro` props.
  const wikiPageOpen = findWikiPageOpenTag(pre);
  let titleProp = null;
  let introText = null;
  if (wikiPageOpen) {
    titleProp = getStringProp(wikiPageOpen, "title");
    introText = getMixedProp(wikiPageOpen, "intro");
    if (introText) bodySnippets.push(introText);
  }

  // <h2> / <h3> headings.
  for (const tag of ["h2", "h3", "h4"]) {
    for (const block of findBlocks(pre, tag)) {
      const text = extractTextFromJsx(block);
      if (text) headings.push(text);
    }
  }

  // Paragraphs + list items.
  for (const tag of ["p", "li"]) {
    for (const block of findBlocks(pre, tag)) {
      const text = extractTextFromJsx(block);
      if (text && text.length > 4) bodySnippets.push(text);
    }
  }

  // Step bodies (wiki uses <Step>…</Step> for ordered guides).
  for (const block of findBlocks(pre, "Step")) {
    const text = extractTextFromJsx(block);
    if (text) bodySnippets.push(text);
  }

  // Callouts.
  const cal = extractCalloutContent(pre);
  for (const h of cal.headings) headings.push(h);
  for (const b of cal.bodies) bodySnippets.push(b);

  // Screenshot captions.
  const screenshotRe = /<Screenshot\b[^>]*?\/?>/g;
  let s;
  while ((s = screenshotRe.exec(pre)) !== null) {
    const caption = getStringProp(s[0], "caption");
    if (caption) bodySnippets.push(caption);
    const alt = getStringProp(s[0], "alt");
    if (alt) bodySnippets.push(alt);
  }

  // De-duplicate (a paragraph that's also a Callout body would double-count).
  const dedupe = (arr) => Array.from(new Set(arr));
  return {
    titleProp,
    headings: dedupe(headings),
    bodySnippets: dedupe(bodySnippets),
  };
}

/* ───────────── main ───────────────────────────────────────────────────── */

function fallbackTitleFromHref(href) {
  // /wiki -> "ResearchOS Wiki"; /wiki/features/foo-bar -> "Foo Bar"
  if (href === "/wiki") return "ResearchOS Wiki";
  const last = href.split("/").filter(Boolean).pop() ?? "";
  return last
    .split("-")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function main() {
  const nav = parseWikiNav();
  const hrefMeta = buildHrefMeta(nav);
  const pages = discoverWikiPages();

  const entries = [];
  let pagesWithoutMeta = 0;
  let totalBodyChars = 0;

  for (const { absPath, href } of pages) {
    const source = readFileSync(absPath, "utf8");
    const content = extractPageContent(source);
    const navMeta = hrefMeta.get(href);
    const title =
      content.titleProp ?? navMeta?.label ?? fallbackTitleFromHref(href);
    const breadcrumbs =
      navMeta?.breadcrumbs && navMeta.breadcrumbs.length > 0
        ? navMeta.breadcrumbs
        : [title];
    const categoryId = navMeta?.categoryId ?? deriveCategoryId(href);
    if (!navMeta) pagesWithoutMeta++;

    // Cap body snippets to keep the JSON manageable: max 30 snippets, each
    // truncated to 280 chars. Wiki pages have long paragraphs we don't need
    // to ship verbatim; the snippet just needs enough context for the search
    // UI to highlight the match.
    const trimmedBody = content.bodySnippets
      .slice(0, 60)
      .map((s) => (s.length > 280 ? s.slice(0, 277) + "..." : s));
    totalBodyChars += trimmedBody.reduce((n, s) => n + s.length, 0);

    entries.push({
      href,
      title,
      breadcrumbs,
      categoryId,
      headings: content.headings.slice(0, 30),
      bodySnippets: trimmedBody,
    });
  }

  // Always include a tiny `_categories` section so the runtime UI can render
  // a stable category order (matches WIKI_NAV top-level order). Building it
  // here means the client doesn't need to re-import nav.ts (smaller bundle).
  const seen = new Set();
  const categories = [];
  for (const node of nav) {
    const segs = node.href.replace(/^\/wiki\/?/, "").split("/").filter(Boolean);
    const id = segs.length === 0 ? "quickstart" : segs[0];
    if (seen.has(id)) continue;
    if (segs.length > 1) continue; // only top-level entries
    seen.add(id);
    categories.push({ id, label: node.label });
  }

  const json = {
    generatedAt: new Date().toISOString(),
    pageCount: entries.length,
    categories,
    entries,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(json, null, 2) + "\n", "utf8");

  if (!isQuiet) {
    process.stdout.write(
      [
        "Wiki search index built",
        "=".repeat(40),
        `Pages scanned:        ${pages.length}`,
        `Entries written:      ${entries.length}`,
        `Pages without nav meta: ${pagesWithoutMeta}`,
        `Total body chars:     ${totalBodyChars.toLocaleString()}`,
        `Output:               ${path.relative(REPO_ROOT, OUT_FILE)}`,
        "",
      ].join("\n"),
    );
  }
}

function deriveCategoryId(href) {
  const segs = href.replace(/^\/wiki\/?/, "").split("/").filter(Boolean);
  return segs.length === 0 ? "quickstart" : segs[0];
}

// Only auto-run when invoked as a script. Importing this file from a test
// should not write to disk.
const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) main();

// Exported for tests.
export {
  extractPageContent,
  parseWikiNav,
  buildHrefMeta,
  fallbackTitleFromHref,
  deriveCategoryId,
  main,
};

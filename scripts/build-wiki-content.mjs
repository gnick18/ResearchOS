#!/usr/bin/env node
/**
 * Wiki content bundle builder for the mobile app.
 *
 * Walks every `frontend/src/app/wiki/.../page.tsx` and emits a full
 * content bundle at `frontend/public/wiki-content.json` that the mobile
 * native reader consumes directly. Re-run any time wiki source changes.
 *
 * Output shape per entry:
 *   {
 *     slug: string,           // unique key (href with /wiki/ stripped + slashes -> -)
 *     href: string,           // canonical href, e.g. "/wiki/features/gantt"
 *     section: string,        // categoryId from nav
 *     title: string,
 *     summary: string | null, // intro prop text
 *     blurb: string | null,   // WIKI_NAV blurb
 *     breadcrumbs: string[],
 *     blocks: Block[]
 *   }
 *
 * Block union (kept small, mobile-renderable):
 *   { kind: "heading";   level: 2|3|4; text: string }
 *   { kind: "paragraph"; text: string }
 *   { kind: "list";      ordered: boolean; items: string[] }
 *   { kind: "callout";   variant: string; title: string | null; text: string }
 *   { kind: "code";      text: string }
 *   { kind: "image";     src: string; alt: string; caption: string | null }
 *
 * Modes:
 *   node scripts/build-wiki-content.mjs           -- write JSON, print stats
 *   node scripts/build-wiki-content.mjs --quiet   -- write JSON, suppress output
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WIKI_DIR = path.join(REPO_ROOT, "frontend", "src", "app", "wiki");
const NAV_FILE = path.join(REPO_ROOT, "frontend", "src", "lib", "wiki", "nav.ts");
const OUT_FILE = path.join(REPO_ROOT, "frontend", "public", "wiki-content.json");

const isQuiet = process.argv.includes("--quiet");

/* ──────────────────── nav parsing (shared with search index) ───────────── */

function parseWikiNav() {
  const source = readFileSync(NAV_FILE, "utf8");
  const start = source.indexOf("WIKI_NAV: WikiNode[]");
  if (start === -1) throw new Error("Could not find WIKI_NAV in nav.ts");
  const assign = source.indexOf("=", start);
  const openBracket = source.indexOf("[", assign);
  if (openBracket === -1) throw new Error("Could not find WIKI_NAV start bracket");
  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error("Could not find WIKI_NAV end bracket");
  const body = source.slice(openBracket + 1, end);
  const nodes = [];
  // Capture href, label, AND blurb (optional).
  const re = /href:\s*"([^"]+)"[\s\S]*?label:\s*"((?:[^"\\]|\\.)*)"/g;
  const blurbRe = /blurb:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  // First pass: href + label
  while ((m = re.exec(body)) !== null) {
    nodes.push({ href: m[1], label: m[2].replace(/\\"/g, '"'), blurb: null });
  }
  // Second pass: pick up blurbs by position. The blurb always follows
  // the label in the same object literal block. We re-scan and attach the
  // blurb to the closest preceding node by linear scan since the structure
  // is order-preserving.
  const allHrefOffsets = [];
  const re2 = /href:\s*"([^"]+)"/g;
  while ((m = re2.exec(body)) !== null) {
    allHrefOffsets.push({ href: m[1], offset: m.index });
  }
  blurbRe.lastIndex = 0;
  while ((m = blurbRe.exec(body)) !== null) {
    const blurbOffset = m.index;
    // Find the last href offset that is before this blurb.
    let bestIdx = -1;
    for (let i = 0; i < allHrefOffsets.length; i++) {
      if (allHrefOffsets[i].offset < blurbOffset) bestIdx = i;
    }
    if (bestIdx >= 0 && bestIdx < nodes.length) {
      nodes[bestIdx].blurb = m[1].replace(/\\"/g, '"');
    }
  }
  return nodes;
}

function buildHrefMeta(navList) {
  const byHref = new Map(navList.map((n) => [n.href, n]));
  const meta = new Map();
  for (const node of navList) {
    const { href, label, blurb } = node;
    const breadcrumbs = [];
    const segments = href.split("/").filter(Boolean);
    let accum = "";
    for (let i = 0; i < segments.length; i++) {
      accum += "/" + segments[i];
      if (accum === "/wiki") continue;
      const found = byHref.get(accum);
      if (found) breadcrumbs.push(found.label);
    }
    const segs = href.replace(/^\/wiki\/?/, "").split("/").filter(Boolean);
    const categoryId = segs.length === 0 ? "quickstart" : segs[0];
    meta.set(href, { label, blurb: blurb ?? null, breadcrumbs, categoryId });
  }
  return meta;
}

/* ──────────────────── file discovery ───────────────────────────────────── */

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
        out.push({ absPath: full, href: hrefBase || "/wiki" });
      }
    }
  }
  walk(WIKI_DIR, "/wiki");
  out.sort((a, b) => a.href.localeCompare(b.href));
  return out;
}

/* ──────────────────── shared text helpers ──────────────────────────────── */

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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

function squish(s) {
  return s.replace(/\s+/g, " ").trim();
}

function stripJsxExpressions(s) {
  let out = "";
  let i = 0;
  let inStr = null;
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") { out += ch + (s[i + 1] ?? ""); i += 2; continue; }
      if (ch === inStr) inStr = null;
      out += ch; i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; out += ch; i++; continue; }
    if (ch === "{") {
      let depth = 1; i++;
      while (i < s.length && depth > 0) {
        const c2 = s[i];
        if (c2 === "{") depth++;
        else if (c2 === "}") depth--;
        i++;
      }
      out += " "; continue;
    }
    out += ch; i++;
  }
  return out;
}

function extractTextFromJsx(jsx) {
  let s = jsx;
  s = s.replace(/<code[\s\S]*?<\/code>/g, " ");
  s = s.replace(/<pre[\s\S]*?<\/pre>/g, " ");
  s = stripJsxExpressions(s);
  s = s.replace(/<\/?>/g, " ");
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, " ");
  s = decodeEntities(s);
  return squish(s);
}

function getStringProp(openTag, propName) {
  const re = new RegExp(`\\b${propName}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = openTag.match(re);
  if (!m) return null;
  return decodeEntities(m[1]).trim();
}

function getMixedProp(openTag, propName) {
  const literal = getStringProp(openTag, propName);
  if (literal !== null) return literal;
  const idx = openTag.search(new RegExp(`\\b${propName}\\s*=\\s*\\{`));
  if (idx === -1) return null;
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
  return extractTextFromJsx(exprBody) || null;
}

function findWikiPageOpenTag(s) {
  const idx = s.indexOf("<WikiPage");
  if (idx === -1) return null;
  let depth = 0;
  let inStr = null;
  for (let i = idx + "<WikiPage".length; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return s.slice(idx, i + 1);
  }
  return null;
}

/** Find every <TagName …>…</TagName> block, returns inner content strings. */
function findBlocks(s, tagName) {
  const out = [];
  const openRe = new RegExp(`<${tagName}\\b[^>]*?>`, "g");
  let m;
  while ((m = openRe.exec(s)) !== null) {
    const tag = m[0];
    if (tag.endsWith("/>")) continue;
    const start = m.index + tag.length;
    let depth = 1;
    let i = start;
    while (i < s.length && depth > 0) {
      if (s.startsWith("<code", i)) {
        const close = s.indexOf("</code>", i);
        if (close === -1) break;
        i = close + "</code>".length; continue;
      }
      if (s.startsWith("<pre", i)) {
        const close = s.indexOf("</pre>", i);
        if (close === -1) break;
        i = close + "</pre>".length; continue;
      }
      if (s.startsWith(`</${tagName}>`, i)) {
        depth--;
        if (depth === 0) {
          out.push(s.slice(start, i));
          i += `</${tagName}>`.length;
          openRe.lastIndex = i;
          break;
        }
        i += `</${tagName}>`.length; continue;
      }
      const openMatch = s.slice(i).match(new RegExp(`^<${tagName}\\b[^>]*?>`));
      if (openMatch && !openMatch[0].endsWith("/>")) {
        depth++; i += openMatch[0].length; continue;
      }
      i++;
    }
  }
  return out;
}

/** Find open-tag text for each instance of a component (including self-closing). */
function findOpenTags(s, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b[^>]*?/?>`, "g");
  let m;
  while ((m = re.exec(s)) !== null) out.push({ tag: m[0], offset: m.index });
  return out;
}

/* ──────────────────── preprocessing ───────────────────────────────────── */

function preprocess(source) {
  // Strip only real top-level import statements. Anchor at column 0 with a word
  // boundary so an indented prose line like "imported from PubChem ..." is NOT
  // matched (the old /^\s*import[\s\S]*?;/ ate from such a line to the next
  // entity semicolon, e.g. &apos;, silently truncating the rest of the page).
  // Handles `import X from "y";`, `import type {…} from "y";`, and side-effect
  // `import "y";`, single- or multi-line.
  let s = source.replace(
    /^import\b(?:[\s\S]*?\bfrom\s+)?["'][^"']+["']\s*;[ \t]*$/gm,
    "",
  );
  s = s.replace(/^[ \t]*\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return s;
}

/* ──────────────────── block extraction ─────────────────────────────────── */

/**
 * Extract structured blocks from a tsx wiki page.
 * Returns { blocks, titleProp, introText, flagged }.
 */
function extractBlocks(source) {
  const pre = preprocess(source);
  const blocks = [];
  const flagged = [];

  // Wiki page wrapper info.
  const wikiPageOpen = findWikiPageOpenTag(pre);
  let titleProp = null;
  let introText = null;
  if (wikiPageOpen) {
    titleProp = getStringProp(wikiPageOpen, "title");
    introText = getMixedProp(wikiPageOpen, "intro");
    if (introText) {
      blocks.push({ kind: "paragraph", text: introText });
    }
  }

  // We do a positional scan of the source to emit blocks in document order.
  // Strategy: find the start of each recognizable element, record (offset, block),
  // then sort and emit in order.
  const positioned = [];

  // Headings h2/h3/h4.
  for (const level of [2, 3, 4]) {
    const tag = `h${level}`;
    const openRe = new RegExp(`<${tag}\\b[^>]*?>`, "g");
    let m;
    while ((m = openRe.exec(pre)) !== null) {
      if (m[0].endsWith("/>")) continue;
      const start = m.index + m[0].length;
      const close = pre.indexOf(`</${tag}>`, start);
      if (close === -1) continue;
      const inner = pre.slice(start, close);
      const text = extractTextFromJsx(inner);
      if (text) positioned.push({ offset: m.index, block: { kind: "heading", level, text } });
    }
  }

  // Paragraphs.
  {
    const openRe = /<p\b[^>]*?>/g;
    let m;
    while ((m = openRe.exec(pre)) !== null) {
      if (m[0].endsWith("/>")) continue;
      const start = m.index + m[0].length;
      const close = pre.indexOf("</p>", start);
      if (close === -1) continue;
      const inner = pre.slice(start, close);
      const text = extractTextFromJsx(inner);
      if (text && text.length > 4) {
        positioned.push({ offset: m.index, block: { kind: "paragraph", text } });
      }
    }
  }

  // Ordered and unordered lists (collect <li> items under their parent <ol>/<ul>).
  for (const listTag of ["ol", "ul"]) {
    const ordered = listTag === "ol";
    const blocks2 = findBlocks(pre, listTag);
    // Find offsets of each list open tag to preserve document order.
    const openRe = new RegExp(`<${listTag}\\b[^>]*?>`, "g");
    let m;
    let blockIdx = 0;
    while ((m = openRe.exec(pre)) !== null) {
      if (m[0].endsWith("/>")) continue;
      if (blockIdx >= blocks2.length) break;
      const listBody = blocks2[blockIdx++];
      const items = [];
      const liBlocks = findBlocks(listBody, "li");
      for (const li of liBlocks) {
        const text = extractTextFromJsx(li);
        if (text) items.push(text);
      }
      if (items.length > 0) {
        positioned.push({ offset: m.index, block: { kind: "list", ordered, items } });
      }
    }
  }

  // Callouts.
  {
    const openRe = /<Callout\b[^>]*?>/g;
    let m;
    let calloutIdx = 0;
    const calloutBodies = findBlocks(pre, "Callout");
    while ((m = openRe.exec(pre)) !== null) {
      if (m[0].endsWith("/>")) continue;
      const openTag = m[0];
      const variant = getStringProp(openTag, "variant") ?? "tip";
      const title = getStringProp(openTag, "title");
      const body = calloutBodies[calloutIdx++];
      const text = body ? extractTextFromJsx(body) : "";
      if (title || text) {
        positioned.push({
          offset: m.index,
          block: { kind: "callout", variant, title: title ?? null, text },
        });
      }
    }
  }

  // Code blocks (inline <code> are stripped; only fenced pre/code blocks are here).
  {
    const openRe = /<pre\b[^>]*?>/g;
    let m;
    while ((m = openRe.exec(pre)) !== null) {
      const start = m.index + m[0].length;
      const close = pre.indexOf("</pre>", start);
      if (close === -1) continue;
      const inner = pre.slice(start, close);
      // Strip JSX tags inside (e.g. <code> wrapper) but keep text.
      const text = squish(
        decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
      );
      if (text) positioned.push({ offset: m.index, block: { kind: "code", text } });
    }
  }

  // Screenshots.
  {
    const screenshotRe = /<Screenshot\b[^>]*?\/?>/g;
    let m;
    while ((m = screenshotRe.exec(pre)) !== null) {
      const tag = m[0];
      const src = getStringProp(tag, "src") ?? "";
      const alt = getStringProp(tag, "alt") ?? "";
      const caption = getStringProp(tag, "caption");
      if (src || alt) {
        positioned.push({
          offset: m.index,
          block: { kind: "image", src, alt, caption: caption ?? null },
        });
      }
    }
  }

  // Sort by document order and append after the intro paragraph.
  positioned.sort((a, b) => a.offset - b.offset);
  for (const { block } of positioned) blocks.push(block);

  // Flag pages with many image blocks since we only have alt text, not real images.
  const imageCount = blocks.filter((b) => b.kind === "image").length;
  if (imageCount > 3) flagged.push(`heavy-images (${imageCount} screenshots)`);

  // Flag pages with zero text content (custom-component-heavy pages).
  const textCount = blocks.filter(
    (b) => b.kind !== "image" && b.kind !== "heading"
  ).length;
  if (textCount === 0 && blocks.length <= imageCount + 2) {
    flagged.push("sparse-text (likely custom components)");
  }

  return { blocks, titleProp, introText, flagged };
}

/* ──────────────────── slug helper ─────────────────────────────────────── */

function hrefToSlug(href) {
  // "/wiki" -> "wiki", "/wiki/features/gantt" -> "features-gantt"
  const stripped = href.replace(/^\/wiki\/?/, "");
  return stripped === "" ? "wiki" : stripped.replace(/\//g, "-");
}

function fallbackTitle(href) {
  if (href === "/wiki") return "ResearchOS Wiki";
  const last = href.split("/").filter(Boolean).pop() ?? "";
  return last
    .split("-")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

/* ──────────────────── main ─────────────────────────────────────────────── */

function main() {
  const nav = parseWikiNav();
  const hrefMeta = buildHrefMeta(nav);
  const pages = discoverWikiPages();

  const entries = [];
  const flaggedPages = [];

  for (const { absPath, href } of pages) {
    const source = readFileSync(absPath, "utf8");
    const { blocks, titleProp, introText, flagged } = extractBlocks(source);
    const navMeta = hrefMeta.get(href);

    const title = titleProp ?? navMeta?.label ?? fallbackTitle(href);
    const summary = introText ?? null;
    const blurb = navMeta?.blurb ?? null;
    const breadcrumbs =
      navMeta?.breadcrumbs && navMeta.breadcrumbs.length > 0
        ? navMeta.breadcrumbs
        : [title];
    const section = navMeta?.categoryId ?? href.replace(/^\/wiki\/?/, "").split("/")[0] ?? "quickstart";
    const slug = hrefToSlug(href);

    if (flagged.length > 0) {
      flaggedPages.push({ href, reasons: flagged });
    }

    entries.push({
      slug,
      href,
      section,
      title,
      summary,
      blurb,
      breadcrumbs,
      blocks,
    });
  }

  // Top-level section metadata (mirrors search index categories).
  const seen = new Set();
  const sections = [];
  for (const node of nav) {
    const segs = node.href.replace(/^\/wiki\/?/, "").split("/").filter(Boolean);
    const id = segs.length === 0 ? "quickstart" : segs[0];
    if (seen.has(id)) continue;
    if (segs.length > 1) continue;
    seen.add(id);
    sections.push({ id, label: node.label, blurb: node.blurb ?? null });
  }

  const json = {
    generatedAt: new Date().toISOString(),
    pageCount: entries.length,
    sections,
    entries,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(json) + "\n", "utf8");

  if (!isQuiet) {
    process.stdout.write(
      [
        "Wiki content bundle built",
        "=".repeat(44),
        `Pages scanned:        ${pages.length}`,
        `Entries written:      ${entries.length}`,
        `Pages flagged:        ${flaggedPages.length}`,
        `Output:               frontend/public/wiki-content.json`,
        "",
        flaggedPages.length > 0 ? "FLAGGED pages:" : "",
        ...flaggedPages.map((f) => `  ${f.href}  [${f.reasons.join(", ")}]`),
        "",
      ]
        .filter((l) => l !== undefined)
        .join("\n")
    );
  }

  return { entries, flaggedPages };
}

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) main();

export { extractBlocks, hrefToSlug, fallbackTitle, main };

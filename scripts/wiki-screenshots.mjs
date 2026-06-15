#!/usr/bin/env node
// wiki-screenshots.mjs — keep wiki Screenshot references and the on-disk image
// set in sync.
//
// The wiki pages live at frontend/src/app/wiki/**/page.tsx and reference images
// under frontend/public/wiki/screenshots/. A reference whose file is missing
// renders a broken image (404) in the web app and ships a dead block to the
// mobile bundle. This script finds those, can fill them with a clearly-marked
// placeholder PNG so nothing 404s while the real capture is pending, and writes
// a checklist of what still needs a real screenshot.
//
// Usage:
//   node scripts/wiki-screenshots.mjs           # check: report missing + unused
//   node scripts/wiki-screenshots.mjs --fill    # generate placeholders for the
//                                               # missing ones + write the TODO
//   node scripts/wiki-screenshots.mjs --prune   # delete unused image files
//                                               # (only ones no page references)
//
// Placeholders are real, valid PNGs (a slate panel with a border and a diagonal
// cross, the universal "image pending" mark) so they are obviously not a real
// screenshot. Capturing the real image is just overwriting the file in place.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_DIR = join(ROOT, "frontend/src/app/wiki");
const SHOTS_DIR = join(ROOT, "frontend/public/wiki/screenshots");
const TODO_PATH = join(ROOT, "docs/wiki-screenshots-todo.md");

const args = new Set(process.argv.slice(2));
const FILL = args.has("--fill");
const PRUNE = args.has("--prune");

// ---- find every page.tsx under the wiki tree ----
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name === "page.tsx") out.push(p);
  }
  return out;
}

// ---- parse Screenshot blocks so the TODO carries alt/caption context ----
function parsePage(file) {
  const text = readFileSync(file, "utf8");
  const refs = [];
  // Every <Screenshot ... /> block (multi-line). alt/caption pulled per block.
  for (const m of text.matchAll(/<Screenshot\b[\s\S]*?\/>/g)) {
    const block = m[0];
    const src = block.match(/src=\{?["']([^"']+)["']\}?/)?.[1];
    if (!src) continue;
    const alt = block.match(/alt=\{?["']([^"']*)["']\}?/)?.[1] ?? "";
    const caption = block.match(/caption=\{?["']([^"']*)["']\}?/)?.[1] ?? "";
    refs.push({ src, alt, caption });
  }
  // Catch any stray /wiki/screenshots ref outside a Screenshot block too.
  for (const m of text.matchAll(/\/wiki\/screenshots\/[\w.\-/]+/g)) {
    if (!refs.some((r) => r.src === m[0])) refs.push({ src: m[0], alt: "", caption: "" });
  }
  return refs;
}

const pages = walk(WIKI_DIR);
const refsByFile = new Map(); // basename -> [{page, alt, caption}]
for (const page of pages) {
  for (const ref of parsePage(page)) {
    const base = ref.src.replace(/^.*\/wiki\/screenshots\//, "");
    if (!base) continue;
    if (!refsByFile.has(base)) refsByFile.set(base, []);
    refsByFile.get(base).push({ page: relative(ROOT, page), alt: ref.alt, caption: ref.caption });
  }
}

const onDisk = new Set(existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR).filter((f) => !f.startsWith(".")) : []);
const referenced = new Set(refsByFile.keys());

const missing = [...referenced].filter((f) => !onDisk.has(f)).sort();
const unused = [...onDisk].filter((f) => !referenced.has(f)).sort();

// ---- placeholder PNG generation (pure node, no deps) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function placeholderPng(w = 1280, h = 720) {
  const BG = [226, 232, 240]; // slate-200
  const FG = [148, 163, 184]; // slate-400
  const set = (raw, x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = FG[0];
    raw[o + 1] = FG[1];
    raw[o + 2] = FG[2];
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = BG[0];
      raw[o + 1] = BG[1];
      raw[o + 2] = BG[2];
    }
  }
  const B = 6; // border
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < B || y < B || x >= w - B || y >= h - B) set(raw, x, y);
  // diagonal cross, ~3px thick
  for (let x = 0; x < w; x++) {
    const y = Math.round((x * (h - 1)) / (w - 1));
    for (let d = -1; d <= 1; d++) {
      set(raw, x, y + d);
      set(raw, x, h - 1 - y + d);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2: truecolor
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- report ----
console.log(`wiki screenshots: ${referenced.size} referenced, ${onDisk.size} on disk`);
console.log(`  missing (referenced, no file): ${missing.length}`);
for (const f of missing) console.log(`    - ${f}  <- ${refsByFile.get(f).map((r) => r.page).join(", ")}`);
console.log(`  unused (file, never referenced): ${unused.length}`);
for (const f of unused) console.log(`    - ${f}`);

if (FILL && missing.length) {
  if (!existsSync(SHOTS_DIR)) mkdirSync(SHOTS_DIR, { recursive: true });
  const png = placeholderPng();
  for (const f of missing) writeFileSync(join(SHOTS_DIR, f), png);
  const todo = [
    "# Wiki screenshots to capture",
    "",
    "Auto-generated by `scripts/wiki-screenshots.mjs --fill`. Each entry below is a",
    "placeholder PNG currently shipping on a wiki page. Capture the real screenshot",
    "in the authed app and overwrite the file in place (same path), then re-run the",
    "wiki bundle build (`node scripts/build-wiki-content.mjs`).",
    "",
    ...missing.flatMap((f) => {
      const uses = refsByFile.get(f);
      return [
        `## \`${f}\``,
        ...uses.map((u) => `- page: \`${u.page}\``),
        uses[0]?.alt ? `- alt: ${uses[0].alt}` : null,
        uses[0]?.caption ? `- caption: ${uses[0].caption}` : null,
        "",
      ].filter(Boolean);
    }),
  ].join("\n");
  writeFileSync(TODO_PATH, todo + "\n");
  console.log(`\nfilled ${missing.length} placeholder(s); wrote ${relative(ROOT, TODO_PATH)}`);
}

if (PRUNE && unused.length) {
  for (const f of unused) rmSync(join(SHOTS_DIR, f));
  console.log(`\npruned ${unused.length} unused image(s)`);
}

if (!FILL && !PRUNE && missing.length) {
  console.log(`\nrun with --fill to generate placeholders for the ${missing.length} missing image(s)`);
  process.exitCode = 1;
}

#!/usr/bin/env node
// Preview a few toned-down click-annotation styles on a real capture, so we can
// pick one. Self-contained: measures the target live, screenshots clean, then
// composites each variant. Writes docs/mockups/annot-variant-*.png.
//
// Usage: node scripts/wiki-annot-variants.mjs   (needs the dev server on :3001)

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { annotateBuffer } from "./lib/wiki-annotate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO, "frontend", "package.json"));
const { chromium } = require("playwright");

const BASE = process.env.WIKI_CAPTURE_BASE_URL ?? "http://localhost:3001";
const OUT = path.join(REPO, "docs", "mockups");
const SCALE = 2;

const VARIANTS = [
  { name: "a-ring-cursor", opts: { ring: true, pulses: 0, cursor: true, ringWidth: 2.4 }, label: "Ring + cursor (no pulse)" },
  { name: "b-thinring-cursor", opts: { ring: true, pulses: 0, cursor: true, ringWidth: 1.7 }, label: "Thin ring + cursor" },
  { name: "c-cursor-onepulse", opts: { ring: false, pulses: 1, cursor: true }, label: "Cursor + one click-circle (no ring)" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
await page.goto(`${BASE}/?connect=1`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Open a folder", { timeout: 8000 });
await page.waitForTimeout(500);

// hide dev FABs + animation overlays (same idea as applyClean)
await page.evaluate(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" && cs.pointerEvents === "none") {
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.85 && r.height >= vh * 0.85) el.style.display = "none";
    }
  }
  for (const el of document.querySelectorAll("button, a")) {
    if (/^Dev:/i.test((el.textContent || "").trim())) {
      let n = el;
      for (let i = 0; i < 4 && n; i++) { if (getComputedStyle(n).position === "fixed") { n.style.display = "none"; break; } n = n.parentElement; }
      el.style.display = "none";
    }
  }
});

const rect = await page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll("button, a, [role='button']"));
  const el = cands.find((e) => (e.textContent || "").trim().toLowerCase().includes("open a folder"));
  if (!el) return null;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (!rect) { console.error("target not found"); await browser.close(); process.exit(1); }
const box = { x: rect.x * SCALE, y: rect.y * SCALE, width: rect.width * SCALE, height: rect.height * SCALE };

const clean = await page.screenshot({ fullPage: false });
await browser.close();

for (const v of VARIANTS) {
  const { buffer, color } = await annotateBuffer(clean, box, v.opts);
  await writeFile(path.join(OUT, `annot-variant-${v.name}.png`), buffer);
  console.log(`${v.name}  (${v.label})  color=${color}`);
}
console.log("done -> docs/mockups/annot-variant-*.png");

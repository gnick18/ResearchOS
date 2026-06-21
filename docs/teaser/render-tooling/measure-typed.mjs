// Measures the exact rendered pixel width of the typing-target text elements
// in a scene, so the width keyframe can land the caret exactly at the last
// character (no trailing blank-space drift after typing finishes).
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scene = resolve(process.cwd(), process.argv[2]);
const sel = process.argv[3] || '.typed,.title-typed';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(scene).href, { waitUntil: 'networkidle0' });
await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
const out = await page.evaluate((selectors) => {
  const els = document.querySelectorAll(selectors);
  return [...els].map((el) => {
    // Temporarily release the width animation/clamp to read natural text width.
    const prevW = el.style.width, prevAnim = el.style.animation, prevOv = el.style.overflow;
    el.style.animation = 'none';
    el.style.width = 'max-content';
    el.style.overflow = 'visible';
    // getBoundingClientRect is sub-pixel accurate; scrollWidth rounds DOWN and
    // a hard width:<scrollWidth>px clips the last glyph's fractional tail (very
    // visible at 4K). Always use ceil + an 8px safety pad for the width target.
    const exact = el.getBoundingClientRect().width;
    el.style.width = prevW; el.style.animation = prevAnim; el.style.overflow = prevOv;
    const safe = Math.ceil(exact) + 8;
    return { text: el.textContent.trim(), chars: el.textContent.trim().length, pxExact: Math.round(exact * 100) / 100, widthTarget: safe, note: `use @keyframes type{to{width:${safe}px}} + steps(${el.textContent.trim().length})` };
  });
}, sel);
console.log(JSON.stringify(out, null, 2));
await browser.close();

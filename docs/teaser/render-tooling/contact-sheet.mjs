// Builds a single labeled contact-sheet PNG from the Act 2 review thumbnails,
// so the whole montage can be reviewed at a glance.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(process.cwd(), '../out');
const THUMBS = resolve(OUT, '_thumbs');

// Narrative montage order (accelerating arc): heroes-of-act-2 first, flashes last.
const ITEMS = [
  ['sequences', 'Sequences'],
  ['chemistry', 'Chemistry'],
  ['gantt', 'GANTT'],
  ['methods', 'Methods'],
  ['phylo', 'Phylo Tree'],
  ['figure', 'Figure Composer'],
  ['lab-sites', 'Lab Sites'],
  ['network', 'Network'],
  ['calendar', 'Calendar  (flash)'],
  ['inventory', 'Inventory  (flash)'],
  ['purchases', 'Purchases  (flash)'],
  ['companion', 'Companion app  (phone)'],
];

const cards = ITEMS.map(([slug, label], i) => {
  const b64 = readFileSync(resolve(THUMBS, `${slug}.jpg`)).toString('base64');
  return `<div class="card"><div class="num">${String(i + 1).padStart(2, '0')}</div>
    <img src="data:image/jpeg;base64,${b64}" alt="${label}"/>
    <div class="cap">${label}</div></div>`;
}).join('\n');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#eef2f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:34px 38px}
  .head{display:flex;align-items:baseline;gap:14px;margin-bottom:22px}
  .head h1{font-size:26px;font-weight:700;color:#15243b}
  .head span{font-size:15px;color:#7a869b}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
  .card{background:#fff;border:1px solid #e2e8f3;border-radius:16px;box-shadow:0 14px 34px rgba(20,40,80,.08);overflow:hidden;position:relative}
  .card img{width:100%;display:block;border-bottom:1px solid #eef1f7}
  .num{position:absolute;top:10px;left:10px;width:26px;height:26px;border-radius:8px;background:rgba(18,131,201,.92);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .cap{padding:11px 14px;font-size:15px;font-weight:600;color:#15243b}
</style></head><body>
  <div class="head"><h1>Act 2 montage</h1><span>12 designed scenes, settled frame shown. Accelerating order, top-left to bottom-right.</span></div>
  <div class="grid">${cards}</div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1400, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle0' });
const el = await page.$('body');
await el.screenshot({ path: resolve(OUT, 'act2-contact-sheet.png') });
await browser.close();
console.log('Wrote out/act2-contact-sheet.png');

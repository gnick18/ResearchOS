// Contact sheet of all 15 title cards (morph ball + word), for review at a glance.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(process.cwd(), '../out');
const TH = resolve(OUT, '_tthumbs');

const ITEMS = [
  ['lab-notes', 'Lab notes'], ['data-hub', 'Data Hub'], ['beakerbot', 'BeakerBot'],
  ['sequences', 'Sequences'], ['chemistry', 'Chemistry'], ['gantt', 'GANTT'],
  ['methods', 'Methods'], ['phylo', 'Phylo trees'], ['figures', 'Figures'],
  ['lab-sites', 'Lab sites'], ['network', 'Network'], ['calendar', 'Calendar'],
  ['inventory', 'Inventory'], ['purchases', 'Purchases'], ['companion', 'Companion'],
];

const cards = ITEMS.map(([slug, label], i) => {
  const b64 = readFileSync(resolve(TH, `${slug}.jpg`)).toString('base64');
  return `<div class="card"><div class="num">${String(i + 1).padStart(2, '0')}</div>
    <img src="data:image/jpeg;base64,${b64}" alt="${label}"/></div>`;
}).join('\n');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#eef2f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:32px 36px}
  .head{display:flex;align-items:baseline;gap:14px;margin-bottom:20px}
  .head h1{font-size:25px;font-weight:700;color:#15243b}
  .head span{font-size:14px;color:#7a869b}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .card{position:relative;background:#fff;border:1px solid #e2e8f3;border-radius:14px;box-shadow:0 12px 28px rgba(20,40,80,.07);overflow:hidden}
  .card img{width:100%;display:block}
  .num{position:absolute;top:9px;left:9px;width:24px;height:24px;border-radius:7px;background:rgba(18,131,201,.92);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
</style></head><body>
  <div class="head"><h1>Title cards</h1><span>15 morph-ball word titles, settled frame. One drops before each feature clip.</span></div>
  <div class="grid">${cards}</div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1320, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await (await page.$('body')).screenshot({ path: resolve(OUT, 'title-cards-contact-sheet.png') });
await browser.close();
console.log('Wrote out/title-cards-contact-sheet.png');

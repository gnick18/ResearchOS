// Render the ResearchOS mobile app icon set from brand/src/mobile-icon.html.
// Uses the Playwright vendored in frontend/node_modules. Run from repo root:
//   node brand/src/render-mobile-icons.mjs
//
// Outputs straight into mobile/assets/images/ (and 512 Play icon + 1024 iOS master
// into brand/png/). iOS master + Play icon get their alpha channel stripped via PIL
// (Apple rejects icons with an alpha channel); call this script's PIL step after.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = await import(`file://${repo}/frontend/node_modules/playwright/index.js`);
const chromium = pw.chromium ?? pw.default.chromium;
const htmlUrl = `file://${repo}/brand/src/mobile-icon.html`;

const mobileImg = path.join(repo, 'mobile', 'assets', 'images');
const brandPng = path.join(repo, 'brand', 'png');

// [mode, size, outPath, omitBackground]
const jobs = [
  ['ios', 1024, path.join(brandPng, 'researchos-mobile-icon-1024.png'), false],
  ['ios', 1024, path.join(mobileImg, 'icon.png'), false],
  ['ios', 1024, path.join(mobileImg, 'splash-icon.png'), false],
  ['ios', 512, path.join(brandPng, 'researchos-mobile-play-512.png'), false],
  ['ios', 196, path.join(mobileImg, 'favicon.png'), false],
  ['foreground', 1024, path.join(mobileImg, 'android-icon-foreground.png'), true],
  ['background', 1024, path.join(mobileImg, 'android-icon-background.png'), false],
  ['monochrome', 1024, path.join(mobileImg, 'android-icon-monochrome.png'), true],
];

const browser = await chromium.launch();
for (const [mode, size, out, omit] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto(`${htmlUrl}?mode=${mode}&size=${size}`);
  await page.locator('#art').waitFor();
  await page.screenshot({ path: out, omitBackground: omit, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`rendered ${mode} ${size} -> ${path.relative(repo, out)}`);
}
await browser.close();
console.log('done');

// Deterministic frame-stepped renderer for teaser scenes.
// Loads an HTML scene in system Chrome (headless), freezes the clock, and for
// each frame sets every CSS animation's currentTime to t = frame/fps, then
// screenshots at 4K. Frames are PNGs; ffmpeg stitches them into an mp4.
//
// Usage:
//   node render-scene.mjs <scene.html> <outDir> [--fps 60] [--dur 9] [--w 3840] [--h 2160]
//
// The deterministic stepping (no real-time playback) means the output is
// frame-exact regardless of render speed, and pauses/jank never leak in.

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const sceneArg = process.argv[2];
const outArg = process.argv[3];
if (!sceneArg || !outArg || sceneArg.startsWith('--')) {
  console.error('Usage: node render-scene.mjs <scene.html> <outDir> [--fps 60] [--dur 9] [--w 3840] [--h 2160]');
  process.exit(1);
}

const fps = Number(arg('--fps', '60'));
const dur = Number(arg('--dur', '9'));
const W = Number(arg('--w', '3840'));
const H = Number(arg('--h', '2160'));
// Render at logical 1280x720 with deviceScaleFactor to hit 4K crisply.
const baseW = 1280, baseH = 720;
const dsf = W / baseW;

const scenePath = isAbsolute(sceneArg) ? sceneArg : resolve(process.cwd(), sceneArg);
const outDir = isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const totalFrames = Math.round(fps * dur);
console.log(`Rendering ${scenePath}`);
console.log(`  ${totalFrames} frames @ ${fps}fps (${dur}s), ${W}x${H} (dsf ${dsf.toFixed(2)})`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: baseW, height: baseH, deviceScaleFactor: dsf });
  await page.goto(pathToFileURL(scenePath).href, { waitUntil: 'networkidle0' });

  // Pause the document clock so animations only advance when we set currentTime.
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => { a.pause(); });
  });
  // Let fonts settle.
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

  for (let f = 0; f < totalFrames; f++) {
    const tMs = (f / fps) * 1000;
    await page.evaluate((t) => {
      const anims = document.getAnimations();
      for (const a of anims) {
        try { a.currentTime = t; } catch {}
      }
    }, tMs);
    const name = `frame_${String(f).padStart(5, '0')}.png`;
    await page.screenshot({ path: resolve(outDir, name) });
    if (f % 30 === 0) process.stdout.write(`\r  frame ${f}/${totalFrames}`);
  }
  process.stdout.write(`\r  frame ${totalFrames}/${totalFrames}\n`);
  console.log('Done.');
} finally {
  await browser.close();
}

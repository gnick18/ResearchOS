#!/usr/bin/env node
// Prototype: draw an adaptive, non-blue click annotation (ring + click-pulse +
// cursor) onto an existing wiki screenshot. Samples the pixels just outside the
// target box to pick a high-visibility color that is never blue, amber on dark
// backgrounds, rose on light ones, each with a casing so it pops either way.
//
// This is a style preview on real captures. The production pipeline will record
// each target's bounding box during capture and composite the same way.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// @napi-rs/canvas is a frontend dep, resolve it from there.
const requireFromFrontend = createRequire(
  path.resolve(__dirname, "..", "frontend", "package.json"),
);
const { createCanvas, loadImage } = requireFromFrontend("@napi-rs/canvas");
const SHOTS = path.resolve(__dirname, "..", "frontend", "public", "wiki", "screenshots");
const OUT = path.resolve(__dirname, "..", "docs", "mockups");

// Targets as fractional boxes {x0,y0,x1,y1} of the full image, plus a mode.
const JOBS = [
  { file: "folder-connect.png", out: "annot-sample-dark.png", box: { x0: 0.305, y0: 0.618, x1: 0.695, y1: 0.683 }, label: "Link Folder (dark page)" },
  { file: "methods-library.png", out: "annot-sample-light.png", box: { x0: 0.862, y0: 0.082, x1: 0.987, y1: 0.137 }, label: "New Method (light page)" },
];

function relLum(r, g, b) {
  // perceived luminance 0..1
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Sample an annulus just outside the box to read the background the ring sits on.
function sampleBackground(ctx, bx, W, H) {
  const pad = Math.round(Math.min(W, H) * 0.02);
  const x0 = Math.max(0, bx.x0 - pad), y0 = Math.max(0, bx.y0 - pad);
  const x1 = Math.min(W, bx.x1 + pad), y1 = Math.min(H, bx.y1 + pad);
  const samples = [];
  const step = Math.max(2, Math.round((x1 - x0) / 40));
  // top and bottom strips of the annulus
  for (let x = x0; x < x1; x += step) {
    for (const y of [Math.max(0, bx.y0 - pad), Math.min(H - 1, bx.y1 + pad)]) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      samples.push(relLum(d[0], d[1], d[2]));
    }
  }
  return samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCursor(ctx, x, y, s, fill, stroke) {
  // classic arrow pointer, tip at (x,y)
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.5, 11.5);
  ctx.lineTo(7.5, 18);
  ctx.lineTo(10, 17);
  ctx.lineTo(7, 11);
  ctx.lineTo(13, 11);
  ctx.closePath();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

async function run(job) {
  const img = await loadImage(path.join(SHOTS, job.file));
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const bx = {
    x0: Math.round(job.box.x0 * W), y0: Math.round(job.box.y0 * H),
    x1: Math.round(job.box.x1 * W), y1: Math.round(job.box.y1 * H),
  };
  const lum = sampleBackground(ctx, bx, W, H);
  const light = lum > 0.5;
  // Non-blue, high-visibility. Amber for dark backgrounds, rose for light.
  const color = light ? "#E11D6B" : "#FFC400";
  const casing = light ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.55)";
  const cw = Math.max(1, Math.round(W / 480)); // base stroke width scaled to image

  const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2;
  const padR = Math.round(Math.min(W, H) * 0.012);
  const rx0 = bx.x0 - padR, ry0 = bx.y0 - padR;
  const rw = (bx.x1 - bx.x0) + padR * 2, rh = (bx.y1 - bx.y0) + padR * 2;
  const radius = Math.round(rh * 0.42);

  // 1. casing under the ring (slightly wider, contrasting with background)
  roundRect(ctx, rx0, ry0, rw, rh, radius);
  ctx.lineWidth = cw * 5;
  ctx.strokeStyle = casing;
  ctx.stroke();
  // 2. main ring
  roundRect(ctx, rx0, ry0, rw, rh, radius);
  ctx.lineWidth = cw * 3;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = cw * 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 3. click-pulse: concentric rings just under-right of the ring corner,
  //    centered on the click point at the button center.
  const pulseBase = Math.round(rh * 0.55);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, pulseBase + i * pulseBase * 0.7, 0, Math.PI * 2);
    ctx.lineWidth = cw * (2.2 - i * 0.5);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55 - i * 0.16;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 4. cursor pointer, tip landing just inside the button, body below-right so
  //    it does not cover the label. White fill, dark outline reads on any bg.
  const cs = Math.max(1.5, W / 320);
  drawCursor(ctx, cx + rw * 0.18, cy + rh * 0.18, cs, "#ffffff", "#0f172a");

  const buf = canvas.toBuffer("image/png");
  writeFileSync(path.join(OUT, job.out), buf);
  console.log(`${job.out}  bgLum=${lum.toFixed(2)} (${light ? "light->rose" : "dark->amber"})  color=${color}`);
}

for (const job of JOBS) await run(job);
console.log("done. samples in docs/mockups/");

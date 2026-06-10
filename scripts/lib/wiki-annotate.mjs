// Shared wiki screenshot annotator. Draws an adaptive, non-blue "click here"
// mark (ring + click-pulse + cursor) onto a captured PNG. The color is chosen
// from the pixels around the target so it always pops, amber on dark
// backgrounds, rose on light ones, each with a contrasting casing. Never blue,
// because the app itself is blue-heavy and a blue mark would disappear.
//
// box is in DEVICE pixels (already multiplied by the capture deviceScaleFactor),
// matching the PNG's own pixel space: { x, y, width, height }.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromFrontend = createRequire(
  path.resolve(__dirname, "..", "..", "frontend", "package.json"),
);
const { createCanvas, loadImage } = requireFromFrontend("@napi-rs/canvas");

function relLum(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Average luminance of an annulus just outside the box, the background the ring
// will sit on (not the button fill itself).
function sampleBackground(ctx, b, W, H) {
  const pad = Math.round(Math.min(W, H) * 0.02);
  const xs = [];
  const x0 = Math.max(0, b.x - pad), x1 = Math.min(W - 1, b.x + b.width + pad);
  const yTop = Math.max(0, b.y - pad), yBot = Math.min(H - 1, b.y + b.height + pad);
  const step = Math.max(2, Math.round((x1 - x0) / 40));
  for (let x = x0; x < x1; x += step) {
    for (const y of [yTop, yBot]) {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      xs.push(relLum(d[0], d[1], d[2]));
    }
  }
  return xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0.5;
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

/**
 * Draw the annotation onto an existing canvas context.
 * @param {object} opts
 *   ring   - draw the outline around the target (default true)
 *   pulses - number of concentric click-pulse rings (default 0)
 *   cursor - draw the pointer (default true)
 *   ringWidth - stroke multiplier for the ring (default 2.4)
 * @returns {{ color: string, lum: number }}
 */
export function drawAnnotation(ctx, box, W, H, opts = {}) {
  const ring = opts.ring !== false;
  const cursor = opts.cursor !== false;
  const pulses = opts.pulses ?? 0;
  const ringMul = opts.ringWidth ?? 2.4;
  const lum = sampleBackground(ctx, box, W, H);
  const light = lum > 0.5;
  const color = light ? "#E11D6B" : "#FFC400"; // rose on light, amber on dark
  const casing = light ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.5)";
  const cw = Math.max(1, W / 480);

  const padR = Math.round(Math.min(W, H) * 0.012);
  const rx = box.x - padR, ry = box.y - padR;
  const rw = box.width + padR * 2, rh = box.height + padR * 2;
  const radius = Math.max(6, Math.round(Math.min(rh, rw) * 0.42));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  if (ring) {
    // thin casing under the ring for contrast on any background
    roundRect(ctx, rx, ry, rw, rh, radius);
    ctx.lineWidth = cw * (ringMul + 1.6);
    ctx.strokeStyle = casing;
    ctx.stroke();
    // main ring, soft glow only (no heavy stack)
    roundRect(ctx, rx, ry, rw, rh, radius);
    ctx.lineWidth = cw * ringMul;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = cw * 5;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  for (let i = 0; i < pulses; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.round(rh * 0.55) * (1 + i * 0.7), 0, Math.PI * 2);
    ctx.lineWidth = cw * (2.2 - i * 0.5);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5 - i * 0.16;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (cursor) {
    const cs = Math.max(1.5, W / 320);
    drawCursor(ctx, cx + rw * 0.18, cy + rh * 0.18, cs, "#ffffff", "#0f172a");
  }
  return { color, lum };
}

/**
 * Composite the annotation onto a PNG buffer and return a new PNG buffer.
 * box is in device pixels matching the PNG.
 */
export async function annotateBuffer(pngBuffer, box, opts = {}) {
  const img = await loadImage(pngBuffer);
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const info = drawAnnotation(ctx, box, W, H, opts);
  return { buffer: canvas.toBuffer("image/png"), ...info };
}

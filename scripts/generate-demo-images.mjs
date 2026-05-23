#!/usr/bin/env node
/**
 * Generates the 10 fake PNG images that ship with the Demo Lab.
 *
 * Every image carries a visible "FAKE DEMO" watermark so there is zero risk
 * a viewer mistakes it for real data. Watermarks are placed bottom-center
 * in semi-transparent white over the image.
 *
 * Categories:
 *   - 3 fake gels (PCR screen, gDNA quality, qPCR products)
 *   - 2 growth curves (OD600 vs time, heat-shock survival bar plot)
 *   - 2 96-well fluorescence plates (plate heat-maps)
 *   - 2 colony / patch plates (random circular colonies)
 *   - 1 Telegram-styled bench photo (plus its sidecar .json)
 *
 * Run: `node scripts/generate-demo-images.mjs` (requires @napi-rs/canvas
 * which is installed as a devDependency in frontend/).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(REPO_ROOT, "frontend", "public", "demo-data");

// @napi-rs/canvas lives in frontend/node_modules; load it via createRequire
// so this ESM script can pick it up without a parallel install.
const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const { createCanvas } = require("@napi-rs/canvas");

// Tiny seeded RNG so the same script produces the same PNGs every time —
// the on-disk + zipped output should be reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function watermark(ctx, w, h, text) {
  ctx.save();
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 4;
  // Center-tilted watermark
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 12);
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();

  // Bottom-right badge as a second confirmation
  ctx.save();
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255, 0, 0, 0.9)";
  ctx.fillRect(w - 130, h - 26, 120, 18);
  ctx.fillStyle = "white";
  ctx.fillText("FAKE DEMO", w - 16, h - 11);
  ctx.restore();
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function save(canvas, relPath) {
  const abs = path.join(DEMO_DIR, relPath);
  ensureDir(abs);
  fs.writeFileSync(abs, canvas.toBuffer("image/png"));
  return abs;
}

// ─── Fake gel ──────────────────────────────────────────────────────────────────

function drawGel(opts) {
  const { lanes = 12, hits = [], title = "Demo gel", seed = 1, ladder = true } = opts;
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  // Background
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, W, H);

  // Title bar
  ctx.fillStyle = "white";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(title, 20, 30);

  // Lane geometry
  const padTop = 80;
  const padBottom = 60;
  const padX = 40;
  const laneW = (W - padX * 2) / lanes;
  const gelH = H - padTop - padBottom;

  // Wells
  for (let i = 0; i < lanes; i++) {
    const x = padX + i * laneW + 6;
    ctx.fillStyle = "#222";
    ctx.fillRect(x, padTop - 18, laneW - 12, 8);
  }

  // Bands per lane
  for (let i = 0; i < lanes; i++) {
    const x = padX + i * laneW + 6;
    const lw = laneW - 12;

    // Soft background smear
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + gelH);
    grad.addColorStop(0, "rgba(255,255,255,0.04)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.07)");
    grad.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, padTop, lw, gelH);

    if (i === 0 && ladder) {
      // Ladder lane
      const rungs = [0.07, 0.13, 0.21, 0.32, 0.43, 0.56, 0.69, 0.82, 0.94];
      for (const f of rungs) {
        const y = padTop + f * gelH;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(x, y, lw, 3);
      }
      continue;
    }

    const hit = hits.includes(i);
    // Primary target band (~1/3 down the gel)
    if (hit) {
      const y = padTop + (0.34 + rng() * 0.02) * gelH;
      const intensity = 0.7 + rng() * 0.25;
      ctx.fillStyle = `rgba(255,255,255,${intensity.toFixed(2)})`;
      ctx.fillRect(x, y, lw, 4 + Math.floor(rng() * 2));
    }
    // Primer-dimer smear at the bottom of every lane
    {
      const y = padTop + (0.92 + rng() * 0.02) * gelH;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(x, y, lw, 3);
    }
  }

  // Lane numbers
  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < lanes; i++) {
    const cx = padX + i * laneW + laneW / 2;
    const label = i === 0 && ladder ? "L" : String(i);
    ctx.fillText(label, cx, padTop - 28);
  }

  watermark(ctx, W, H, "FAKE GEL — DEMO DATA");
  return canvas;
}

// ─── Growth curve ──────────────────────────────────────────────────────────────

function drawGrowthCurve({ title = "Demo growth curve", seed = 1, curves = 4 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  // Background + axes
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 80;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  // Axis frame
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(padX, padY, plotW, plotH);

  // Grid
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const y = padY + (plotH * i) / 6;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + plotW, y);
    ctx.stroke();
  }
  for (let i = 1; i < 9; i++) {
    const x = padX + (plotW * i) / 9;
    ctx.beginPath();
    ctx.moveTo(x, padY);
    ctx.lineTo(x, padY + plotH);
    ctx.stroke();
  }

  // Title + axes
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, padX, padY - 30);
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("time (h)", W / 2, H - 25);
  ctx.save();
  ctx.translate(25, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("OD600", 0, 0);
  ctx.restore();

  // Axis ticks
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 9; i++) {
    const x = padX + (plotW * i) / 9;
    ctx.fillText(String(i * 2), x, padY + plotH + 18);
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= 6; i++) {
    const od = (1.0 - i / 6).toFixed(1);
    const y = padY + (plotH * i) / 6 + 4;
    ctx.fillText(od, padX - 8, y);
  }

  // Curves — Gompertz-ish
  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
  for (let c = 0; c < curves; c++) {
    const color = palette[c % palette.length];
    const lag = 1 + rng() * 2;
    const rate = 0.4 + rng() * 0.3;
    const asym = 0.7 + rng() * 0.25;
    const noise = 0.012;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let t = 0; t <= 18; t += 0.25) {
      const od = asym * Math.exp(-Math.exp(-rate * (t - lag - 2)));
      const odN = Math.max(0, od + (rng() - 0.5) * noise);
      const x = padX + (plotW * t) / 18;
      const y = padY + plotH * (1 - Math.min(1, odN));
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Legend
    const lx = padX + 16;
    const ly = padY + 16 + c * 18;
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly - 8, 14, 4);
    ctx.fillStyle = "#0a0a0a";
    ctx.textAlign = "left";
    ctx.fillText(`replicate ${c + 1}`, lx + 20, ly);
  }

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── Heat-shock survival bar plot ──────────────────────────────────────────────

function drawHeatshockSurvival({ title = "Heat-shock survival (demo)", seed = 7 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 90;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(padX, padY, plotW, plotH);

  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(title, padX, padY - 30);

  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("strain", W / 2, H - 25);
  ctx.save();
  ctx.translate(25, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("% survival", 0, 0);
  ctx.restore();

  const strains = [
    { name: "FakeYeast-001", color: "#3b82f6", mean: 78 },
    { name: "FY-Δgal80", color: "#10b981", mean: 64 },
    { name: "DemoStrain ΔADE2", color: "#f59e0b", mean: 41 },
  ];
  const barW = plotW / (strains.length * 2 + 1);

  // y-axis ticks
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#0a0a0a";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const v = 100 - i * 20;
    const y = padY + (plotH * i) / 5 + 4;
    ctx.fillText(String(v), padX - 8, y);
  }

  strains.forEach((s, i) => {
    const x = padX + barW * (1 + i * 2);
    const v = s.mean + (rng() - 0.5) * 8;
    const bh = (v / 100) * plotH;
    ctx.fillStyle = s.color;
    ctx.fillRect(x, padY + plotH - bh, barW, bh);
    // Error bar
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 1.5;
    const err = 4 + rng() * 4;
    const cx = x + barW / 2;
    ctx.beginPath();
    ctx.moveTo(cx, padY + plotH - bh - (err / 100) * plotH);
    ctx.lineTo(cx, padY + plotH - bh + (err / 100) * plotH);
    ctx.moveTo(cx - 8, padY + plotH - bh - (err / 100) * plotH);
    ctx.lineTo(cx + 8, padY + plotH - bh - (err / 100) * plotH);
    ctx.moveTo(cx - 8, padY + plotH - bh + (err / 100) * plotH);
    ctx.lineTo(cx + 8, padY + plotH - bh + (err / 100) * plotH);
    ctx.stroke();

    // Label
    ctx.fillStyle = "#0a0a0a";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(s.name, cx, padY + plotH + 18);
  });

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── 96-well fluorescence plate ───────────────────────────────────────────────

function draw96Plate({ title = "96-well fluorescence (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  // Background
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, W, H);

  // Plate plastic
  const plate = { x: 60, y: 90, w: W - 120, h: H - 160 };
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 2;
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
  ctx.strokeRect(plate.x, plate.y, plate.w, plate.h);

  // Title
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(title, plate.x, 50);

  const cols = 12;
  const rows = 8;
  const wellsW = plate.w - 80;
  const wellsH = plate.h - 60;
  const cellW = wellsW / cols;
  const cellH = wellsH / rows;
  const ox = plate.x + 40;
  const oy = plate.y + 40;

  // Row labels A–H
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  for (let i = 0; i < rows; i++) {
    ctx.fillText(String.fromCharCode(65 + i), ox - 18, oy + cellH * (i + 0.6));
  }
  for (let j = 0; j < cols; j++) {
    ctx.fillText(String(j + 1), ox + cellW * (j + 0.5), oy - 10);
  }

  // Wells
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const cx = ox + cellW * (j + 0.5);
      const cy = oy + cellH * (i + 0.5);
      const r = Math.min(cellW, cellH) * 0.4;
      // Color by column "hit" probability
      let v;
      if (j === 0) v = 0.05 + rng() * 0.05; // WT negative
      else if (j === cols - 1) v = 0.9 + rng() * 0.07; // positive control
      else v = rng() < 0.4 ? 0.65 + rng() * 0.25 : 0.1 + rng() * 0.2;

      const r0 = Math.floor(20 + 235 * (1 - v));
      const g0 = Math.floor(235 - 100 * (1 - v));
      const b0 = Math.floor(80 - 60 * v);
      ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  watermark(ctx, W, H, "FAKE PLATE — DEMO");
  return canvas;
}

// ─── Colony / patch plate ─────────────────────────────────────────────────────

function drawColonyPlate({ title = "Colony plate (demo)", seed = 3, colonies = 60, picks = [], stickerLines = ["SD-Ura selection", "FakeYeast-001 + pYES-GAL1::flbA"] } = {}) {
  const W = 800;
  const H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  // Bench background
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, W, H);

  // Petri dish
  const cx = W / 2;
  const cy = H / 2 + 10;
  const R = 320;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  // Agar
  const grad = ctx.createRadialGradient(cx, cy - 60, 40, cx, cy, R);
  grad.addColorStop(0, "#fef3c7");
  grad.addColorStop(1, "#facc15");
  ctx.fillStyle = grad;
  ctx.fill();
  // Rim
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 8;
  ctx.stroke();

  // Title (above plate)
  ctx.fillStyle = "white";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 30, 40);

  // Colonies (jittered). Record positions so we can ring the picks on top.
  const positions = [];
  for (let i = 0; i < colonies; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 30);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const cr = 2 + rng() * 5;
    const shade = 220 + Math.floor(rng() * 30);
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${shade},${shade - 30},${shade - 90})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(80,40,0,0.6)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    positions.push({ x, y, cr });
  }

  // Pick markers (cyan ring + sequential number) on top of the colonies.
  picks.forEach((idx, k) => {
    if (idx < 0 || idx >= positions.length) return;
    const { x, y, cr } = positions[idx];
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, cr + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(k + 1), x + cr + 10, y - 3);
  });

  // Label sticker
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 1;
  ctx.fillRect(30, H - 90, 240, 60);
  ctx.strokeRect(30, H - 90, 240, 60);
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "13px sans-serif";
  ctx.fillText(stickerLines[0] ?? "", 42, H - 65);
  ctx.fillText(stickerLines[1] ?? "", 42, H - 48);

  watermark(ctx, W, H, "FAKE — AI-styled demo image");
  return canvas;
}

// ─── Bench photo (Telegram inbox style) ───────────────────────────────────────

function drawBenchPhoto({ title = "Bench photo (demo)", seed = 5 } = {}) {
  const W = 900;
  const H = 1200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  // Bench (wood-ish gradient)
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#9c8166");
  grad.addColorStop(1, "#7c6244");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Lab notebook page
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.08);
  ctx.fillStyle = "#fefce8";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 18;
  ctx.fillRect(-300, -380, 600, 760);
  ctx.shadowBlur = 0;

  // Ruled lines
  ctx.strokeStyle = "rgba(100,100,100,0.3)";
  ctx.lineWidth = 1;
  for (let i = -340; i < 360; i += 24) {
    ctx.beginPath();
    ctx.moveTo(-280, i);
    ctx.lineTo(280, i);
    ctx.stroke();
  }

  // Margin line
  ctx.strokeStyle = "rgba(220,38,38,0.6)";
  ctx.beginPath();
  ctx.moveTo(-220, -380);
  ctx.lineTo(-220, 380);
  ctx.stroke();

  // Handwriting
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "italic 22px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("2026-05-12  bench notes", -200, -300);
  ctx.font = "16px sans-serif";
  const handwritten = [
    "• pYES-GAL1::flbA mini-prep:",
    "    A260/280 = 1.88, conc 142 ng/uL",
    "• Heat shock 40 min, plate SD-Ura",
    "• Need to reorder Phusion",
    "• colony PCR tomorrow w/ DemoCheck primers",
    "    (annealing 58°C — see protocol)",
    "",
    "TODO:",
    "  - send sequencing top 4 transformants",
    "  - update gantt - bump screen by 1d",
  ];
  let yy = -260;
  for (const line of handwritten) {
    ctx.fillText(line, -200, yy);
    yy += 28;
  }
  ctx.restore();

  // Pen
  ctx.save();
  ctx.translate(W * 0.18, H * 0.78);
  ctx.rotate(-0.4);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, 180, 14);
  ctx.fillStyle = "#374151";
  ctx.fillRect(170, -2, 22, 18);
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(-12, 2, 14, 10);
  ctx.restore();

  // Random "splash" / coffee stain
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(101, 67, 33, ${0.2 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(W * 0.82 + rng() * 60, H * 0.18 + rng() * 60, 14 + rng() * 12, 0, Math.PI * 2);
    ctx.fill();
  }

  watermark(ctx, W, H, "FAKE — AI-styled demo photo");
  return canvas;
}

// ─── Shared plot helpers ──────────────────────────────────────────────────────

function plotFrame(ctx, opts) {
  const { x, y, w, h, title, xLabel, yLabel } = opts;
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const yy = y + (h * i) / 6;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    const xx = x + (w * i) / 6;
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke();
  }

  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, x, y - 30);

  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, x + w / 2, y + h + 48);
  ctx.save();
  ctx.translate(x - 60, y + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function plotXTicks(ctx, x, y, w, h, vals, fmt = (v) => String(v)) {
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  vals.forEach((v, i) => {
    const xx = x + (w * i) / (vals.length - 1);
    ctx.fillText(fmt(v), xx, y + h + 18);
  });
}

function plotYTicks(ctx, x, y, w, h, vals, fmt = (v) => String(v)) {
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  vals.forEach((v, i) => {
    const yy = y + (h * (vals.length - 1 - i)) / (vals.length - 1) + 4;
    ctx.fillText(fmt(v), x - 8, yy);
  });
}

// Box-Muller normal draw using a seeded RNG.
function randn(rng) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Kinetic fluorescence reads ───────────────────────────────────────────────

function drawKineticReads({ title = "Kinetic GFP reads (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  plotFrame(ctx, { x: padX, y: padY, w: plotW, h: plotH, title, xLabel: "time post-induction (h)", yLabel: "GFP fluorescence (a.u.)" });

  plotXTicks(ctx, padX, padY, plotW, plotH, [0, 1, 2, 3, 4, 5, 6]);
  const yMax = 10000;
  plotYTicks(ctx, padX, padY, plotW, plotH, [0, 2000, 4000, 6000, 8000, 10000]);

  const tx = (t) => padX + (plotW * t) / 6;
  const yp = (v) => padY + plotH * (1 - Math.min(1, Math.max(0, v / yMax)));

  const groups = [
    { name: "Positive ctrl (col 12, n=6)", color: "#10b981", plateau: 8800, rate: 1.4, lag: 0.2, noise: 100, flat: false },
    { name: "Hits (n=8)",                  color: "#3b82f6", plateau: 5800, rate: 0.50, lag: 0.4, noise: 90,  flat: false },
    { name: "Candidates (weak, n=52)",     color: "#f59e0b", plateau: 1450, rate: 0.70, lag: 0.5, noise: 60,  flat: false },
    { name: "WT (col 1, n=6)",             color: "#6b7280", plateau: 350,  rate: 0,    lag: 0,   noise: 25,  flat: true  },
  ];

  for (const g of groups) {
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    let started = false;
    for (let t = 0; t <= 6; t += 0.1) {
      let v;
      if (g.flat) {
        v = g.plateau + (rng() - 0.5) * g.noise;
      } else {
        v = g.plateau * (1 - Math.exp(-g.rate * Math.max(0, t - g.lag))) + (rng() - 0.5) * g.noise;
      }
      const xx = tx(t);
      const yy = yp(Math.max(0, v));
      if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }

  // Legend (top-right, inside the plot)
  ctx.font = "12px sans-serif";
  let ly = padY + 18;
  for (const g of groups) {
    ctx.fillStyle = g.color;
    ctx.fillRect(padX + plotW - 220, ly - 8, 14, 4);
    ctx.fillStyle = "#0a0a0a";
    ctx.textAlign = "left";
    ctx.fillText(g.name, padX + plotW - 200, ly);
    ly += 18;
  }

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── Generic scatter (optionally with threshold line) ─────────────────────────

function drawScatter({
  title,
  seed = 1,
  xLabel,
  yLabel,
  xRange,
  yRange,
  groups,
  threshold,
  thresholdLabel,
  watermarkText = "FAKE DATA — for tutorial only",
} = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  plotFrame(ctx, { x: padX, y: padY, w: plotW, h: plotH, title, xLabel, yLabel });

  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xTicks = [];
  const yTicks = [];
  for (let i = 0; i <= 6; i++) {
    xTicks.push(xMin + (xMax - xMin) * (i / 6));
    yTicks.push(yMin + (yMax - yMin) * (i / 6));
  }
  plotXTicks(ctx, padX, padY, plotW, plotH, xTicks, (v) => v.toFixed(2));
  plotYTicks(ctx, padX, padY, plotW, plotH, yTicks, (v) => v.toFixed(2));

  const px = (x) => padX + (plotW * (x - xMin)) / (xMax - xMin);
  const py = (y) => padY + plotH * (1 - (y - yMin) / (yMax - yMin));

  // Threshold line (horizontal dashed)
  if (threshold !== undefined) {
    ctx.strokeStyle = "#dc2626";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    const yT = py(threshold);
    ctx.beginPath();
    ctx.moveTo(padX, yT);
    ctx.lineTo(padX + plotW, yT);
    ctx.stroke();
    ctx.setLineDash([]);
    if (thresholdLabel) {
      ctx.fillStyle = "#dc2626";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(thresholdLabel, padX + 10, yT - 6);
    }
  }

  // Points (gaussian cloud per group, seeded)
  for (const g of groups) {
    ctx.fillStyle = g.color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.6;
    const r = g.radius || 4.5;
    for (let i = 0; i < g.count; i++) {
      const x = g.xMean + randn(rng) * g.xSD;
      const y = g.yMean + randn(rng) * g.ySD;
      ctx.beginPath();
      ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Legend (top-left, inside plot)
  ctx.font = "12px sans-serif";
  let ly = padY + 18;
  for (const g of groups) {
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(padX + 22, ly - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = "#0a0a0a";
    ctx.textAlign = "left";
    ctx.fillText(g.name, padX + 34, ly);
    ly += 18;
  }

  watermark(ctx, W, H, watermarkText);
  return canvas;
}

// ─── qPCR amplification curves ────────────────────────────────────────────────

function drawAmplificationCurves({ title = "qPCR amplification curves (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  plotFrame(ctx, { x: padX, y: padY, w: plotW, h: plotH, title, xLabel: "PCR cycle", yLabel: "Normalized fluorescence (Rn)" });

  const xMin = 0, xMax = 40;
  const yMin = 0, yMax = 1.2;
  plotXTicks(ctx, padX, padY, plotW, plotH, [0, 8, 16, 24, 32, 40]);
  plotYTicks(ctx, padX, padY, plotW, plotH, [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2], (v) => v.toFixed(1));

  const px = (c) => padX + (plotW * (c - xMin)) / (xMax - xMin);
  const py = (v) => padY + plotH * (1 - (v - yMin) / (yMax - yMin));

  const samples = [
    { name: "Hit-B7 fakeGFP (Ct 22.1)",  color: "#1d4ed8", ct: 22.1, plateau: 1.0,  k: 0.70, baseline: 0.02 },
    { name: "Hit-D11 fakeGFP (Ct 22.7)", color: "#3b82f6", ct: 22.7, plateau: 1.0,  k: 0.70, baseline: 0.02 },
    { name: "Hit-G5 fakeGFP (Ct 23.4)",  color: "#60a5fa", ct: 23.4, plateau: 1.0,  k: 0.70, baseline: 0.02 },
    { name: "ACT1 ref (Ct 18.5)",        color: "#10b981", ct: 18.5, plateau: 1.0,  k: 0.70, baseline: 0.02 },
    { name: "WT fakeGFP (Ct 36.8)",      color: "#f59e0b", ct: 36.8, plateau: 1.0,  k: 0.55, baseline: 0.02 },
    { name: "NTC (no template)",         color: "#9ca3af", ct: null, plateau: 0,    k: 0,    baseline: 0.02 },
  ];

  // Threshold (0.5 Rn) — drawn first so curves are on top
  const yThr = py(0.5);
  ctx.strokeStyle = "#dc2626";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, yThr);
  ctx.lineTo(padX + plotW, yThr);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#dc2626";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("threshold (Rn = 0.5)", padX + 10, yThr - 6);

  for (const s of samples) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (let c = 0; c <= 40; c += 0.25) {
      let v;
      if (s.ct === null) {
        v = s.baseline + (rng() - 0.5) * 0.012;
      } else {
        v = s.baseline + s.plateau / (1 + Math.exp(-s.k * (c - s.ct))) + (rng() - 0.5) * 0.012;
      }
      const xx = px(c);
      const yy = py(Math.max(0, Math.min(yMax, v)));
      if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // Ct tick mark on the x-axis
    if (s.ct !== null && s.ct < 40) {
      const xT = px(s.ct);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xT, padY + plotH);
      ctx.lineTo(xT, padY + plotH + 6);
      ctx.stroke();
    }
  }

  // Legend (top-left)
  ctx.font = "12px sans-serif";
  let ly = padY + 18;
  for (const s of samples) {
    ctx.fillStyle = s.color;
    ctx.fillRect(padX + 12, ly - 8, 14, 4);
    ctx.fillStyle = "#0a0a0a";
    ctx.textAlign = "left";
    ctx.fillText(s.name, padX + 32, ly);
    ly += 18;
  }

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── qPCR melt curves (-dF/dT vs temperature) ─────────────────────────────────

function drawMeltCurves({ title = "qPCR melt curves (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  plotFrame(ctx, { x: padX, y: padY, w: plotW, h: plotH, title, xLabel: "Temperature (°C)", yLabel: "-dF / dT" });

  const xMin = 60, xMax = 90;
  const yMin = 0, yMax = 4000;
  plotXTicks(ctx, padX, padY, plotW, plotH, [60, 65, 70, 75, 80, 85, 90]);
  plotYTicks(ctx, padX, padY, plotW, plotH, [0, 800, 1600, 2400, 3200, 4000]);

  const px = (t) => padX + (plotW * (t - xMin)) / (xMax - xMin);
  const py = (v) => padY + plotH * (1 - (v - yMin) / (yMax - yMin));

  const curves = [
    { name: "fakeGFP (hits)",     color: "#3b82f6", peak: 82.4, width: 0.7, height: 3500 },
    { name: "ACT1 (ref)",         color: "#10b981", peak: 79.8, width: 0.7, height: 3000 },
    { name: "NTC primer-dimer",   color: "#9ca3af", peak: 70.0, width: 3.5, height: 380  },
    { name: "WT (faint signal)",  color: "#a3a3a3", peak: 82.4, width: 0.9, height: 260  },
  ];

  for (const c of curves) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (let t = xMin; t <= xMax; t += 0.1) {
      const v = c.height * Math.exp(-(((t - c.peak) / c.width) ** 2)) + (rng() - 0.5) * 35;
      const xx = px(t);
      const yy = py(Math.max(0, v));
      if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    if (c.height > 1500) {
      const lx = px(c.peak);
      const ly = py(c.height) - 8;
      ctx.fillStyle = c.color;
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Tm ${c.peak.toFixed(1)} °C`, lx, ly);
    }
  }

  // Legend (top-left — keeps clear of the Tm labels on the right side)
  ctx.font = "12px sans-serif";
  let ly = padY + 18;
  for (const c of curves) {
    ctx.fillStyle = c.color;
    ctx.fillRect(padX + 12, ly - 8, 14, 4);
    ctx.fillStyle = "#0a0a0a";
    ctx.textAlign = "left";
    ctx.fillText(c.name, padX + 32, ly);
    ly += 18;
  }

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── 96-well CV heat-map ──────────────────────────────────────────────────────

function draw96PlateCV({ title = "96-well CV baseline (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, W, H);

  // Plate plastic — leave room on the right for the colorbar legend.
  const plate = { x: 50, y: 90, w: W - 200, h: H - 160 };
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 2;
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
  ctx.strokeRect(plate.x, plate.y, plate.w, plate.h);

  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, plate.x, 50);

  const cols = 12;
  const rows = 8;
  const wellsW = plate.w - 70;
  const wellsH = plate.h - 60;
  const cellW = wellsW / cols;
  const cellH = wellsH / rows;
  const ox = plate.x + 36;
  const oy = plate.y + 36;

  // Row/col labels
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  for (let i = 0; i < rows; i++) {
    ctx.fillText(String.fromCharCode(65 + i), ox - 16, oy + cellH * (i + 0.6));
  }
  for (let j = 0; j < cols; j++) {
    ctx.fillText(String(j + 1), ox + cellW * (j + 0.5), oy - 10);
  }

  // CV color ramp: green (low CV, good) -> yellow -> red (high CV, bad), 0-6%.
  const cvColor = (cv) => {
    const t = Math.max(0, Math.min(1, cv / 6));
    let r, g, b;
    if (t < 0.5) {
      const k = t / 0.5;
      r = Math.round(34 + (250 - 34) * k);
      g = Math.round(197 + (204 - 197) * k);
      b = Math.round(94 + (21 - 94) * k);
    } else {
      const k = (t - 0.5) / 0.5;
      r = Math.round(250 + (220 - 250) * k);
      g = Math.round(204 + (38 - 204) * k);
      b = Math.round(21 + (38 - 21) * k);
    }
    return `rgb(${r},${g},${b})`;
  };

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const cx = ox + cellW * (j + 0.5);
      const cy = oy + cellH * (i + 0.5);
      const r = Math.min(cellW, cellH) * 0.42;

      const isEdge = i === 0 || i === rows - 1 || j === 0 || j === cols - 1;
      const isCorner = (i === 0 || i === rows - 1) && (j === 0 || j === cols - 1);

      let cv;
      if (i === 7 && j === 5) {
        // H6 outlier
        cv = 5.0 + (rng() - 0.5) * 0.2;
      } else if (isCorner) {
        cv = 3.8 + (rng() - 0.5) * 0.3;
      } else if (isEdge) {
        cv = 3.0 + (rng() - 0.5) * 0.5;
      } else {
        cv = 1.9 + (rng() - 0.5) * 0.4;
      }

      ctx.fillStyle = cvColor(cv);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cv.toFixed(1), cx, cy);
      ctx.textBaseline = "alphabetic";
    }
  }

  // Colorbar (vertical, right side of plate)
  const cb = { x: W - 110, y: plate.y + 30, w: 22, h: plate.h - 60 };
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const t = 1 - i / steps;
    const cv = t * 6;
    ctx.fillStyle = cvColor(cv);
    ctx.fillRect(cb.x, cb.y + (cb.h * i) / steps, cb.w, cb.h / steps + 1);
  }
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1;
  ctx.strokeRect(cb.x, cb.y, cb.w, cb.h);
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i <= 6; i++) {
    const v = 6 - i;
    const y = cb.y + (cb.h * i) / 6 + 4;
    ctx.fillText(`${v}%`, cb.x + cb.w + 6, y);
  }
  ctx.save();
  ctx.translate(cb.x + cb.w + 56, cb.y + cb.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = "12px sans-serif";
  ctx.fillText("well CV (%)", 0, 0);
  ctx.restore();

  watermark(ctx, W, H, "FAKE PLATE — DEMO");
  return canvas;
}

// ─── Fluorescein standard curve (linear fit overlay) ─────────────────────────

function drawStandardCurve({ title = "Fluorescein standard curve (demo)", seed = 1 } = {}) {
  const W = 900;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(seed);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  const padX = 90;
  const padY = 80;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  plotFrame(ctx, { x: padX, y: padY, w: plotW, h: plotH, title, xLabel: "[fluorescein] (nM)", yLabel: "RFU" });

  const xMin = 0, xMax = 525;
  const yMin = 0, yMax = 50000;
  plotXTicks(ctx, padX, padY, plotW, plotH, [0, 100, 200, 300, 400, 500]);
  plotYTicks(ctx, padX, padY, plotW, plotH, [0, 10000, 20000, 30000, 40000, 50000]);

  const px = (x) => padX + (plotW * (x - xMin)) / (xMax - xMin);
  const py = (y) => padY + plotH * (1 - (y - yMin) / (yMax - yMin));

  // Linear fit: RFU = 90.4 * nM + 247
  const slope = 90.4;
  const intercept = 247;
  const concentrations = [0, 25, 50, 100, 200, 350, 500];
  const reps = 3;

  // Fit line first so points sit on top
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(xMin), py(slope * xMin + intercept));
  ctx.lineTo(px(xMax), py(Math.min(yMax, slope * xMax + intercept)));
  ctx.stroke();

  // Replicate points
  ctx.fillStyle = "#1d4ed8";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 0.6;
  for (const c of concentrations) {
    const trueRFU = slope * c + intercept;
    // Tiny gaussian noise around the line (R² = 0.998 means very tight)
    const noiseSD = Math.max(60, 0.012 * trueRFU);
    for (let r = 0; r < reps; r++) {
      const rfu = trueRFU + randn(rng) * noiseSD;
      ctx.beginPath();
      ctx.arc(px(c), py(rfu), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Equation + R²
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("RFU = 90.4 × [nM] + 247", padX + 24, padY + 32);
  ctx.fillText("R² = 0.998", padX + 24, padY + 52);
  ctx.font = "12px sans-serif";
  ctx.fillText("7 concentrations × 3 replicates", padX + 24, padY + 72);

  watermark(ctx, W, H, "FAKE DATA — for tutorial only");
  return canvas;
}

// ─── Drive ────────────────────────────────────────────────────────────────────

const generated = [];

// Gels (4)
generated.push(save(drawGel({ lanes: 12, hits: [2, 3, 6, 7, 9, 10], title: "PCR screen — DemoCheck primers", seed: 42 }), "users/alex/results/task-5/Images/gel-pcr-screen.png"));
generated.push(save(drawGel({ lanes: 10, hits: [1, 2, 3, 4, 5, 6, 7, 8, 9], title: "gDNA quality check — 8 transformants", seed: 17 }), "users/alex/results/task-4/Images/gel-gdna-quality.png"));
generated.push(save(drawGel({ lanes: 12, hits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: "qPCR products on agarose (demo)", seed: 91 }), "users/morgan/results/task-3/Images/gel-qpcr-products.png"));
// Pilot Gibson backbone test: 4 mock backbones, lanes 1-3 hit, lane 4 fails
generated.push(save(drawGel({ lanes: 6, hits: [1, 2, 3], title: "Pilot Gibson — backbone linearization check", seed: 13, ladder: true }), "users/alex/results/task-18/Images/gel-gibson-pilot.png"));

// Growth curves (3)
generated.push(save(drawGrowthCurve({ title: "Growth in YPD (FakeYeast vs FY-Δgal80)", seed: 33, curves: 5 }), "users/alex/results/task-10/Images/growth-curve-YPD.png"));
generated.push(save(drawGrowthCurve({ title: "Baseline growth — FakeYeast-001 in YPD/2% glucose", seed: 87, curves: 3 }), "users/alex/results/task-19/Images/growth-curve-baseline.png"));
generated.push(save(drawHeatshockSurvival({ title: "Heat-shock survival (demo)", seed: 55 }), "users/alex/results/task-11/Images/heatshock-survival.png"));

// 96-well fluorescence plates (2)
generated.push(save(draw96Plate({ title: "96-well fluorescence (plate A, demo)", seed: 11 }), "users/morgan/results/task-1/Images/plate-96-fluo.png"));
generated.push(save(draw96Plate({ title: "Fluorescence reader heat-map (demo)", seed: 71 }), "users/morgan/results/task-2/Images/fluo-scan-results.png"));

// Morgan custom plots (7) — used to live only in git and have to be `git
// checkout`-ed after every full regen. Now produced by the image generator
// so the SoT pair (generate-demo-data.mjs + generate-demo-images.mjs)
// can rebuild morgan's results tree without manual restore.
generated.push(save(drawColonyPlate({
  title: "Colony-picking plate — 8 transformants ringed",
  seed: 137,
  colonies: 140,
  picks: [7, 23, 41, 56, 78, 92, 113, 128],
  stickerLines: ["SD-Ura selection", "FY-Δgal80 + pYES-fakeGFP (n=8 picked)"],
}), "users/morgan/results/task-1/Images/colony-picking.png"));
generated.push(save(drawKineticReads({
  title: "Kinetic GFP read — 0 to 6 h post-induction",
  seed: 211,
}), "users/morgan/results/task-2/Images/gfp-kinetics.png"));
generated.push(save(drawScatter({
  title: "GFP/OD600 vs final OD600",
  seed: 233,
  xLabel: "OD600 (final)",
  yLabel: "GFP/OD600 (relative to positive)",
  xRange: [0.4, 0.95],
  yRange: [0, 1.2],
  threshold: 0.6,
  thresholdLabel: "hit threshold = 0.6× positive ctrl",
  groups: [
    { name: "Candidates (<0.6×, n=52)", color: "#f59e0b", count: 52, xMean: 0.62, xSD: 0.06, yMean: 0.18,  ySD: 0.10,  radius: 4 },
    { name: "Hits (≥0.6×, n=8)",        color: "#3b82f6", count: 8,  xMean: 0.65, xSD: 0.05, yMean: 0.77,  ySD: 0.06,  radius: 5 },
    { name: "Positive ctrl (col 12, n=6)", color: "#10b981", count: 6, xMean: 0.71, xSD: 0.04, yMean: 1.00, ySD: 0.05,  radius: 5 },
    { name: "WT (col 1, n=6)",          color: "#6b7280", count: 6,  xMean: 0.78, xSD: 0.03, yMean: 0.025, ySD: 0.012, radius: 5 },
  ],
}), "users/morgan/results/task-2/Images/od-vs-gfp-scatter.png"));
generated.push(save(drawAmplificationCurves({
  title: "qPCR amplification — fakeGFP + ACT1 ref",
  seed: 307,
}), "users/morgan/results/task-3/Images/qpcr-amplification-curves.png"));
generated.push(save(drawMeltCurves({
  title: "qPCR melt curves — fakeGFP (82.4 °C) + ACT1 (79.8 °C)",
  seed: 401,
}), "users/morgan/results/task-3/Images/melt-curves.png"));
generated.push(save(draw96PlateCV({
  title: "96-well CV baseline — empty plate, 60 nM fluorescein",
  seed: 503,
}), "users/morgan/results/task-7/Images/cv-baseline.png"));
generated.push(save(drawStandardCurve({
  title: "Fluorescein standard curve — BioTek H1, gain 60",
  seed: 599,
}), "users/morgan/results/task-7/Images/standard-curve.png"));

// Colony / patch plates (3)
generated.push(save(drawColonyPlate({ title: "Transformation plate (SD-Ura)", seed: 99, colonies: 42 }), "users/alex/results/task-2/Images/transformation-plate.png"));
generated.push(save(drawColonyPlate({ title: "Patch plate (8 candidate transformants)", seed: 23, colonies: 8 }), "users/alex/results/task-3/Images/patch-plate.png"));
// Pilot transformation plate: a strain-choice pilot, more colonies than usual
generated.push(save(drawColonyPlate({ title: "Pilot transformation — strain choice (SD-Ura)", seed: 7, colonies: 75 }), "users/alex/results/task-17/Images/pilot-transformation-plate.png"));

// Telegram inbox bench photo (1)
const benchPath = save(drawBenchPhoto({ seed: 5 }), "users/alex/inbox/Images/photo-2026-05-12.png");
generated.push(benchPath);

// Sidecar JSON for the inbox photo
const sidecar = {
  caption: "Demo bench notes from 2026-05-12 — pYES transformation summary.",
  sender: "alex",
  received_at: "2026-05-12T16:42:00Z",
  source: "telegram-bot-demo",
  is_demo: true,
};
fs.writeFileSync(
  path.join(DEMO_DIR, "users/alex/inbox/Images/photo-2026-05-12.png.json"),
  JSON.stringify(sidecar, null, 2) + "\n",
  "utf8",
);

console.log(`Generated ${generated.length} PNG images:`);
for (const p of generated) {
  console.log(`  ${path.relative(REPO_ROOT, p)}`);
}

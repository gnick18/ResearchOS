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

function drawColonyPlate({ title = "Colony plate (demo)", seed = 3, colonies = 60 } = {}) {
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

  // Colonies (jittered)
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
  }

  // Label sticker
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 1;
  ctx.fillRect(30, H - 90, 240, 60);
  ctx.strokeRect(30, H - 90, 240, 60);
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "13px sans-serif";
  ctx.fillText("SD-Ura selection", 42, H - 65);
  ctx.fillText("FakeYeast-001 + pYES-GAL1::flbA", 42, H - 48);

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

// ─── Drive ────────────────────────────────────────────────────────────────────

const generated = [];

// Gels (3)
generated.push(save(drawGel({ lanes: 12, hits: [2, 3, 6, 7, 9, 10], title: "PCR screen — DemoCheck primers", seed: 42 }), "users/alex/results/task-5/Images/gel-pcr-screen.png"));
generated.push(save(drawGel({ lanes: 10, hits: [1, 2, 3, 4, 5, 6, 7, 8, 9], title: "gDNA quality check — 8 transformants", seed: 17 }), "users/alex/results/task-4/Images/gel-gdna-quality.png"));
generated.push(save(drawGel({ lanes: 12, hits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: "qPCR products on agarose (demo)", seed: 91 }), "users/morgan/results/task-3/Images/gel-qpcr-products.png"));

// Growth curves (2)
generated.push(save(drawGrowthCurve({ title: "Growth in YPD (FakeYeast vs FY-Δgal80)", seed: 33, curves: 5 }), "users/alex/results/task-10/Images/growth-curve-YPD.png"));
generated.push(save(drawHeatshockSurvival({ title: "Heat-shock survival (demo)", seed: 55 }), "users/alex/results/task-11/Images/heatshock-survival.png"));

// 96-well fluorescence plates (2)
generated.push(save(draw96Plate({ title: "96-well fluorescence (plate A, demo)", seed: 11 }), "users/morgan/results/task-1/Images/plate-96-fluo.png"));
generated.push(save(draw96Plate({ title: "Fluorescence reader heat-map (demo)", seed: 71 }), "users/morgan/results/task-2/Images/fluo-scan-results.png"));

// Colony / patch plates (2)
generated.push(save(drawColonyPlate({ title: "Transformation plate (SD-Ura)", seed: 99, colonies: 42 }), "users/alex/results/task-2/Images/transformation-plate.png"));
generated.push(save(drawColonyPlate({ title: "Patch plate (8 candidate transformants)", seed: 23, colonies: 8 }), "users/alex/results/task-3/Images/patch-plate.png"));

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

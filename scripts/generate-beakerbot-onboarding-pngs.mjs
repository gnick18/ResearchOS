#!/usr/bin/env node
/**
 * One-off generator for the two BeakerBot PNG assets the Onboarding v4
 * walkthrough drops onto the page during P5 (image-drop demo) and P6
 * (Telegram synthetic-image flow). Both PNGs need:
 *
 *   - transparent background (the drop targets sit on colored cards),
 *   - sky-blue body matching `text-sky-500` (#0ea5e9),
 *   - ~200x200, under 50 KB each,
 *   - DIFFERENT silly poses so the user reads them as two distinct
 *     personality moments rather than the same sticker twice.
 *
 * Approach: build a standalone, animation-free SVG for each pose by
 * inlining the geometry that BeakerBot.tsx renders for that pose. We
 * skip the CSS animations entirely (we want a frozen "snapshot" frame)
 * and bake in manual transforms where the pose is animation-driven
 * (rolling-laughing's sideways body, for example). Then we rasterize
 * the SVG to PNG via @napi-rs/canvas and compress with sharp.
 *
 * Run:
 *   node scripts/generate-beakerbot-onboarding-pngs.mjs
 *
 * Output:
 *   frontend/public/onboarding/beakerbot-selfie.png
 *   frontend/public/onboarding/beakerbot-telegram-silly.png
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "frontend/public/onboarding");

// @napi-rs/canvas and sharp are devDeps of `frontend/`, not the repo
// root. Resolve them via a require anchored to frontend/package.json so
// this script works whether you run it from the repo root or from
// frontend/. Same trick `capture-wiki-screenshots.mjs` uses for
// playwright.
const requireFromFrontend = createRequire(
  resolve(REPO_ROOT, "frontend", "package.json"),
);
const { Image, createCanvas } = requireFromFrontend("@napi-rs/canvas");
const sharp = requireFromFrontend("sharp");

// text-sky-500 from tailwind. Used everywhere BeakerBot.tsx renders
// `stroke="currentColor"` or `fill="currentColor"`.
const SKY_500 = "#0ea5e9";

// Pastel rainbow gradient stops, matching BeakerBot.tsx exactly.
const RAINBOW_STOPS = [
  { offset: "0%", color: "#FFD2B0" },
  { offset: "25%", color: "#FFF1A8" },
  { offset: "50%", color: "#B7EBB1" },
  { offset: "75%", color: "#A6D2F4" },
  { offset: "100%", color: "#D6B5F0" },
];

/**
 * Common BeakerBot core: white body fill, rainbow liquid, hair flick,
 * body outline, beaker lip, eyes (with optional wink override), mouth
 * (smile by default; open-laugh override available), and cheek dashes.
 * Pose-specific arms / decorations get appended by the caller.
 *
 * `eyes`:
 *   - "normal"  : both eyes as dots
 *   - "wink"    : left eye dot, right eye closed line (for bow-wink)
 * `mouth`:
 *   - "smile"   : standard smile arc
 *   - "laugh"   : open-laugh filled "ha ha" shape (for giggle / roll)
 */
function coreBody({ eyes = "normal", mouth = "smile" } = {}) {
  return `
    <!-- white body fill (legibility backdrop for eyes/mouth) -->
    <path d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
          fill="white" stroke="none" />
    <!-- rainbow liquid -->
    <path d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
          fill="url(#beaker-liquid)" stroke="none" />
    <!-- hair flick -->
    <path d="M22 8 C 22 6, 24 4, 26 6" />
    <!-- body outline -->
    <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
    <!-- beaker lip -->
    <path d="M11 12 L29 12" />
    <!-- left eye -->
    <circle cx="17" cy="18" r="1.2" fill="${SKY_500}" stroke="none" />
    <!-- right eye -->
    ${
      eyes === "wink"
        ? `<path d="M21.6 18 L24.4 18" stroke="${SKY_500}" stroke-width="1.4" />`
        : `<circle cx="23" cy="18" r="1.2" fill="${SKY_500}" stroke="none" />`
    }
    <!-- mouth -->
    ${
      mouth === "laugh"
        ? `<path d="M17 22 Q 20 26.5, 23 22 Q 20 23.5, 17 22 Z"
              fill="${SKY_500}" stroke="${SKY_500}" stroke-width="1" />`
        : `<path d="M18 22 Q 20 24, 22 22" />`
    }
    <!-- cheek dashes -->
    <path d="M14 26 L15.5 26" />
    <path d="M24.5 26 L26 26" />
  `;
}

/**
 * Pose: cheering. Both arms up in a V, hand dots, two sparkles. Reads
 * as "ta-da photo" — exactly what we want for a goofy selfie. The
 * cheering pose has a celebratory bounce animation, but the static
 * silhouette already carries enough personality on its own, so we
 * render it un-rotated.
 */
function cheeringSvg() {
  // Tightened viewbox: cheering content lives in x≈5-35, y≈4-33 so we
  // crop the empty padding and let BeakerBot fill the rendered PNG.
  // The 30x30 box keeps the aspect square (matches the 200x200 output).
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 4 30 30" fill="none"
     stroke="${SKY_500}" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
  <defs>
    <linearGradient id="beaker-liquid" x1="0" y1="0" x2="0" y2="1">
      ${RAINBOW_STOPS.map(
        (s) => `<stop offset="${s.offset}" stop-color="${s.color}" />`,
      ).join("\n      ")}
    </linearGradient>
  </defs>
  ${coreBody({ eyes: "normal", mouth: "smile" })}
  <!-- left arm up -->
  <path d="M12 18 L8 10" />
  <!-- right arm up -->
  <path d="M28 18 L32 10" />
  <!-- hand dots -->
  <circle cx="8" cy="10" r="1" fill="${SKY_500}" stroke="none" />
  <circle cx="32" cy="10" r="1" fill="${SKY_500}" stroke="none" />
  <!-- sparkles -->
  <path d="M6 6 L7 7 M7 6 L6 7" />
  <path d="M33 6 L34 7 M34 6 L33 7" />
</svg>`;
}

/**
 * Pose: rolling-laughing. Frozen at roughly the 25% keyframe — body
 * rotated ~85deg (sideways on the ground) with the HAHA! speech bubble
 * upright above what is now the right side. Captures the "fell over
 * laughing" peak of the animation in a single still.
 *
 * The animation translates ~15% downward AND rotates ~92deg at peak.
 * For the snapshot we ease back to 85deg + a smaller offset so the
 * body stays comfortably inside the 40x40 viewbox without clipping.
 */
function rollingLaughingSvg() {
  // Body rotated about its own center (~20, 22 sits roughly mid-mass).
  // We also nudge it slightly down so the head + the speech bubble
  // both fit inside the viewbox after the rotation.
  const bodyTransform = "translate(0, 2) rotate(85, 20, 22)";
  // The speech bubble + HAHA text in the live component is positioned
  // at SVG coords (24.5..39.5, 4.4..10.6). When the body rotates 85deg
  // the bubble would swing wildly, so the original component uses a
  // counter-rotation on .laughTextRoll to keep it upright. For the
  // still, we just leave the bubble at its un-rotated position above
  // the (now-horizontal) body.
  // Tightened viewbox: rotated body + speech bubble together span
  // roughly x≈7-32, y≈3-32. We use a square 29x29 box (slight extra
  // horizontal headroom so the rotated arm doesn't kiss the edge), and
  // the canvas pre-scales us to a square 200x200 output.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 3 29 29" fill="none"
     stroke="${SKY_500}" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
  <defs>
    <linearGradient id="beaker-liquid" x1="0" y1="0" x2="0" y2="1">
      ${RAINBOW_STOPS.map(
        (s) => `<stop offset="${s.offset}" stop-color="${s.color}" />`,
      ).join("\n      ")}
    </linearGradient>
  </defs>
  <g transform="${bodyTransform}">
    ${coreBody({ eyes: "normal", mouth: "laugh" })}
  </g>
  <!-- HAHA! speech bubble, counter-rotated to stay upright. Pulled
       toward the upper-left corner so the rotated body has room. -->
  <g transform="translate(-12, 0)">
    <rect x="24.5" y="4.4" width="15" height="6.2" rx="3.1" ry="3.1"
          fill="white" stroke="${SKY_500}" stroke-width="0.5" />
    <text x="32" y="8.9" text-anchor="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
          font-size="3.6" font-weight="700"
          fill="${SKY_500}" stroke="none">HAHA!</text>
  </g>
</svg>`;
}

/**
 * Rasterize an SVG string to a 200x200 transparent PNG. Three stages:
 *   1) Render the SVG at 4x supersample (800x800) via @napi-rs/canvas
 *      with smoothing on, so the strokes stay crisp at the final size.
 *   2) Downsample to 200x200 with sharp's lanczos3 filter (high-quality
 *      supersample collapse, avoids the muddy look that a single
 *      one-shot 200x200 raster produces).
 *   3) Re-encode the PNG with palette compression so the file fits
 *      comfortably under the 50 KB per-asset budget. BeakerBot art is
 *      mostly flat color (sky-blue outline + five pastel-rainbow stops
 *      + white) so a 64-color palette is plenty.
 */
async function rasterize(svg, outPath) {
  const FINAL_SIZE = 200;
  const SUPER = 4; // 4x supersample for crisp strokes.
  const RENDER_SIZE = FINAL_SIZE * SUPER;
  // @napi-rs/canvas's Image reads the intrinsic SVG dimensions from
  // the SVG's own width/height attributes. We inject those so the SVG
  // rasterizes natively at supersample resolution, then draw it 1:1
  // onto a same-sized canvas. (drawImage with a smaller dest scales by
  // bitmap, which is fuzzy; native-size SVG render keeps vector
  // precision through to the final pixels.)
  const sized = svg.replace(
    /<svg ([^>]*)>/,
    `<svg $1 width="${RENDER_SIZE}" height="${RENDER_SIZE}">`,
  );
  const img = new Image();
  img.src = Buffer.from(sized);
  const canvas = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = canvas.getContext("2d");
  // Transparent background by default; we explicitly skip any
  // fillRect/clearRect setup to keep alpha=0 outside the silhouette.
  ctx.drawImage(img, 0, 0);
  const rawPng = canvas.toBuffer("image/png");

  // sharp downsamples the supersampled raster to FINAL_SIZE with the
  // lanczos3 kernel (better edge fidelity than the canvas's own
  // smoothing), then palette-encodes for size.
  const compressed = await sharp(rawPng)
    .resize(FINAL_SIZE, FINAL_SIZE, {
      kernel: "lanczos3",
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: true, quality: 90, colors: 96, compressionLevel: 9 })
    .toBuffer();

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, compressed);
  return compressed.length;
}

async function main() {
  const selfiePath = resolve(OUT_DIR, "beakerbot-selfie.png");
  const sillyPath = resolve(OUT_DIR, "beakerbot-telegram-silly.png");

  const selfieSize = await rasterize(cheeringSvg(), selfiePath);
  const sillySize = await rasterize(rollingLaughingSvg(), sillyPath);

  console.log(`wrote ${selfiePath} (${selfieSize} bytes)`);
  console.log(`wrote ${sillyPath} (${sillySize} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

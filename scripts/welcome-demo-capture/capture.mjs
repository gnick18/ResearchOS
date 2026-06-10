// Welcome demo-clip capture rig.
//
// Records the public /demo fixture straight from the browser's compositor via
// Playwright's in-browser video (no macOS Screen Recording permission needed),
// forces light mode, hides the dev/demo floating chrome, waits out the loader,
// and auto-trims the measured lead-in. Produces an mp4 + a poster jpg per clip,
// sized to match the welcome page's DemoLoop slots.
//
// Prereqs:
//   - A ResearchOS dev server running (default http://localhost:3000). Set
//     BASE_URL to point elsewhere.
//   - Playwright + its Chromium installed in frontend/ (already a dep), and
//     ffmpeg on PATH (brew install ffmpeg).
//
// Usage (from anywhere):
//   node scripts/welcome-demo-capture/capture.mjs <clipName|all>
//   node scripts/welcome-demo-capture/capture.mjs sequence-editor-a
//
// Output: $TMPDIR/welcome-clips/mp4/<name>.mp4 and <name>.poster.jpg
// Then upload those to the Blob bucket (see README.md) and the welcome page's
// DemoLoop src/poster URLs pick them up by filename.
//
// The clip clickpaths below track the live /demo UI; when a surface changes,
// update that clip's function and re-run just that clip.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  readdirSync,
  renameSync,
  rmSync,
  mkdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Resolve Playwright from frontend/node_modules regardless of cwd.
const { chromium } = require(
  path.resolve(__dirname, "../../frontend/node_modules/playwright"),
);

const BASE = process.env.BASE_URL || "http://localhost:3000";
const W = 1440;
const H = 810;
const ROOT = path.join(os.tmpdir(), "welcome-clips");
const RAW = path.join(ROOT, "raw");
const OUT = path.join(ROOT, "mp4");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hide the dev/demo floating chrome (Leave Demo, view-as toggle, Read the docs,
// Dev buttons, companion circles) so the frame is clean product UI.
const HIDE = () => {
  const KILL =
    /leave demo|exit tour|view as (lab head|member)|read the docs|dev:|fresh ephemeral|restart server|companion|skip setup|open the companion/i;
  for (const el of document.querySelectorAll("a,button")) {
    const t =
      (el.getAttribute("aria-label") || "") + " " + (el.textContent || "");
    if (KILL.test(t)) {
      let n = el;
      while (n && n !== document.body) {
        if (getComputedStyle(n).position === "fixed") {
          n.style.setProperty("display", "none", "important");
          break;
        }
        n = n.parentElement;
      }
      el.style.setProperty("display", "none", "important");
    }
  }
  // Any small fixed element parked in a bottom corner = a floating chip.
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    const bottomBand = r.top > window.innerHeight - 210;
    const corner = r.right > window.innerWidth - 220 || r.left < 220;
    if (bottomBand && corner && r.width < 260 && r.height < 130) {
      el.style.setProperty("display", "none", "important");
    }
  }
};

// Mutated by settle() so record() knows how much loader lead-in to trim.
const marks = { leadMs: 0, t0: 0 };

async function settle(page) {
  // Wait out the StagedLoadingScreen, then a real app surface, then chrome-hide.
  await page
    .waitForFunction(
      () => !document.body.innerText.includes("Loading ResearchOS"),
      { timeout: 25000 },
    )
    .catch(() => {});
  await page.waitForSelector("header, nav", { timeout: 15000 }).catch(() => {});
  await sleep(1600);
  await page.evaluate(HIDE);
  await sleep(400);
  await page.evaluate(HIDE);
  // Everything up to here is loader + theme-flash + chrome-hide: trim it.
  marks.leadMs = Date.now() - marks.t0;
}

async function clickNav(page, name) {
  const link = page.getByRole("link", { name, exact: true }).first();
  await link.click({ timeout: 8000 }).catch(async () => {
    await page.getByText(name, { exact: true }).first().click({ timeout: 8000 });
  });
}

// ---- clip registry: each performs its loopable sequence ---------------------
const CLIPS = {
  "replaces-5-tools": async (page) => {
    await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
    await settle(page);
    for (const tab of ["GANTT", "Methods", "Sequences", "Calendar"]) {
      await clickNav(page, tab).catch(() => {});
      await sleep(600);
      await page.evaluate(HIDE);
      await sleep(1500);
    }
    await clickNav(page, "Workbench").catch(() => {});
    await sleep(600);
    await page.evaluate(HIDE);
    await sleep(1400);
  },

  "sequence-editor-a": async (page) => {
    await page.goto(`${BASE}/demo/sequences`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await sleep(800);
    await page
      .getByText(/pEGFP|plasmid|\.gb|seq/i)
      .first()
      .click({ timeout: 8000 })
      .catch(async () => {
        await page
          .locator("main button, main a")
          .first()
          .click()
          .catch(() => {});
      });
    await sleep(2000);
    await page.evaluate(HIDE);
    await page.getByText(/^Map$/).first().click({ timeout: 6000 }).catch(() => {});
    await sleep(1600);
    await page.getByText(/Restrict/i).first().click({ timeout: 6000 }).catch(() => {});
    await sleep(2200);
  },

  "methods-library": async (page) => {
    await page.goto(`${BASE}/demo/methods`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await sleep(800);
    await page
      .getByRole("button", { name: /^Template library$/ })
      .first()
      .click({ timeout: 8000 })
      .catch(() => {});
    await sleep(1300);
    await page.evaluate(HIDE);
    await page
      .getByText("Templates", { exact: true })
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await sleep(1800);
    await page
      .getByText(/Q5 high-fidelity PCR/i)
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await sleep(2400);
  },

  "pi-lab-overview": async (page) => {
    // demoViewAs=mira flips the demo fixture to the lab head so /lab-overview
    // (gated to lab_head) renders. See DemoViewAsButton + wiki-capture-mock.
    await page.goto(`${BASE}/demo/lab-overview?demoViewAs=mira`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    await sleep(1500);
    await page.mouse.wheel(0, 350);
    await sleep(1800);
    await page.mouse.wheel(0, 350);
    await sleep(1800);
    await page.mouse.wheel(0, -700);
    await sleep(1400);
  },

  // own-your-data intentionally omitted: that slot keeps a real Finder
  // recording (the notebook-is-a-folder-on-disk story), which a headless
  // browser cannot show. Re-add a clip function here only if that changes.

  "snap-from-bench": async (page) => {
    await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page
      .getByRole("button", { name: /items in your inbox|Inbox/i })
      .first()
      .click({ timeout: 8000 })
      .catch(() => {});
    await sleep(1400);
    await page.getByText(/^Photos$/).first().click({ timeout: 5000 }).catch(() => {});
    await sleep(2600);
  },

  "nih-zenodo": async (page) => {
    await page.goto(`${BASE}/demo/workbench`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.getByText(/^Experiments$/).first().click({ timeout: 8000 }).catch(() => {});
    await sleep(1500);
    await page
      .getByText(/PCR-screen integrants/i)
      .first()
      .click({ timeout: 8000 })
      .catch(() => {});
    await sleep(1900);
    await page.evaluate(HIDE);
    await page
      .getByRole("button", { name: /^Deposit to a repository$/ })
      .first()
      .click({ timeout: 6000 })
      .catch(() => {});
    await sleep(1800);
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: /^(Next|Continue)$/ })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
      await sleep(1900);
    }
  },

  "gibson-cloning": async (page) => {
    await page.goto(`${BASE}/demo/sequences`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page
      .getByText(/pEGFP|plasmid|\.gb/i)
      .first()
      .click({ timeout: 8000 })
      .catch(() => {});
    await sleep(1800);
    await page.evaluate(HIDE);
    await page
      .getByText(/Assemble|Cloning/i)
      .first()
      .click({ timeout: 6000 })
      .catch(() => {});
    await sleep(1600);
    await page.getByText(/Overlap/i).first().click({ timeout: 5000 }).catch(() => {});
    await sleep(2400);
  },
};

function ffprobeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(out.toString().trim()) || 0;
}

async function record(name) {
  const fn = CLIPS[name];
  if (!fn) throw new Error(`unknown clip ${name}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    colorScheme: "light",
    recordVideo: { dir: RAW, size: { width: W, height: H } },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("researchos-theme", "light");
    } catch {}
  });
  const page = await context.newPage();
  marks.t0 = Date.now();
  marks.leadMs = 0;
  await fn(page);
  await page.close();
  await context.close();
  await browser.close();

  // Newest raw (hash-named) webm by mtime; ignore already-renamed clips.
  const webm = readdirSync(RAW)
    .filter((f) => f.endsWith(".webm") && f.includes("@"))
    .map((f) => path.join(RAW, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const renamed = path.join(RAW, `${name}.webm`);
  rmSync(renamed, { force: true });
  renameSync(webm, renamed);

  // Trim the measured loader lead-in (0.4s buffer keeps the first action),
  // scale to 1600 wide, encode h264 loop-friendly.
  const ss = Math.max(0, marks.leadMs / 1000 - 0.4).toFixed(2);
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-ss", ss, "-i", renamed,
    "-vf", "scale=1600:-2,fps=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23",
    "-an", "-movflags", "+faststart", mp4,
  ], { stdio: "ignore" });

  // Poster at 60% through (past the loader, into the meaningful content).
  const poster = path.join(OUT, `${name}.poster.jpg`);
  const at = (ffprobeDuration(mp4) * 0.6).toFixed(2);
  execFileSync("ffmpeg", [
    "-y", "-ss", at, "-i", mp4, "-vframes", "1", "-q:v", "3", poster,
  ], { stdio: "ignore" });

  return mp4;
}

const which = process.argv[2] || "all";
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const names = which === "all" ? Object.keys(CLIPS) : [which];
for (const n of names) {
  process.stdout.write(`recording ${n} ... `);
  try {
    const mp4 = await record(n);
    console.log(`ok -> ${mp4}`);
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}
console.log(`done. outputs in ${OUT}`);

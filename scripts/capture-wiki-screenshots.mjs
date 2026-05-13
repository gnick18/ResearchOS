#!/usr/bin/env node
/**
 * Capture wiki screenshots against a running dev server.
 *
 * Usage:
 *   # 1. Start the dev server in another terminal
 *   cd frontend && npm run dev
 *
 *   # 2. Run this script
 *   node scripts/capture-wiki-screenshots.mjs
 *
 * Or, combined:
 *   cd frontend && npm run wiki:screenshots
 *
 * What it captures right now:
 *   - The folder-connect screen at /
 *   - Every /wiki/* page (the wiki rendering itself, useful for QA)
 *
 * What it does NOT capture (yet):
 *   - In-app feature pages like /gantt, /experiments, /methods, /settings.
 *     Those need a connected folder with realistic fixture data. Until
 *     `?wikiCapture=1` fixture-mode lands (see WIKI_SCREENSHOTS.md →
 *     "TODO: fixture mode"), capture those interactively via Chrome MCP
 *     or by running the app against a real folder and using DevTools'
 *     screenshot command. The Screenshot component in the wiki renders
 *     a graceful "screenshot pending" placeholder until the PNG lands.
 *
 * Output:
 *   frontend/public/wiki/screenshots/<name>.png
 *
 * Requirements:
 *   npm install --no-save playwright
 *   npx playwright install chromium   # one-time
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "frontend", "public", "wiki", "screenshots");
const BASE_URL = process.env.WIKI_CAPTURE_BASE_URL ?? "http://localhost:3000";

/** Routes that are public (no folder connection required) and can be captured
 *  with a plain Playwright run. Each entry → one PNG in OUT_DIR. */
const PUBLIC_ROUTES = [
  // Wiki itself
  { path: "/wiki", file: "wiki-landing.png" },
  { path: "/wiki/getting-started", file: "wiki-getting-started.png" },
  { path: "/wiki/getting-started/browser-requirements", file: "wiki-browser-requirements.png" },
  { path: "/wiki/getting-started/connecting-your-folder", file: "wiki-connecting-folder.png" },
  { path: "/wiki/getting-started/creating-a-user", file: "wiki-creating-user.png" },
  { path: "/wiki/shared-lab-accounts", file: "wiki-shared-lab-accounts.png" },
  { path: "/wiki/shared-lab-accounts/onedrive", file: "wiki-onedrive.png" },
  { path: "/wiki/shared-lab-accounts/google-drive", file: "wiki-google-drive.png" },
  { path: "/wiki/shared-lab-accounts/dropbox", file: "wiki-dropbox.png" },
  { path: "/wiki/shared-lab-accounts/icloud", file: "wiki-icloud.png" },
  // The folder-connect screen at "/" before any folder is picked
  { path: "/", file: "folder-connect.png", waitForSelector: "button" },
];

const VIEWPORT = { width: 1440, height: 900 };

async function ensureOut() {
  await mkdir(OUT_DIR, { recursive: true });
}

async function capture() {
  console.log(`Capturing screenshots → ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);

  await ensureOut();

  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-experimental-web-platform-features"],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });

  let failed = 0;
  for (const route of PUBLIC_ROUTES) {
    const page = await context.newPage();
    const url = `${BASE_URL}${route.path}`;
    const out = path.join(OUT_DIR, route.file);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      if (route.waitForSelector) {
        await page.waitForSelector(route.waitForSelector, { timeout: 10000 });
      }
      // Tiny settle to let fonts and async paints finish.
      await page.waitForTimeout(300);
      await page.screenshot({ path: out, fullPage: route.fullPage ?? false });
      console.log(`  ✓ ${route.path.padEnd(50)} → ${route.file}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${route.path.padEnd(50)} → ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  if (failed > 0) {
    console.error(`\n${failed} route(s) failed. Is the dev server running at ${BASE_URL}?`);
    process.exit(1);
  }
  console.log(`\nDone. ${PUBLIC_ROUTES.length} screenshots saved.`);
  console.log(
    "\nNote: In-app feature page screenshots (Gantt, Experiments, etc.) " +
      "must be captured separately — see scripts/WIKI_SCREENSHOTS.md.",
  );
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});

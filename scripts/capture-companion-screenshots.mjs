#!/usr/bin/env node
/**
 * Capture the Companion (mobile) wiki screenshots from a running Android emulator.
 *
 * The WEB wiki screenshots come from scripts/capture-wiki-screenshots.mjs
 * (Playwright + ?wikiCapture=1 fixture mode). The Companion is a mobile app, so
 * its shots come from the emulator over adb instead. This is the mobile analog,
 * and it writes to the same output folder the wiki <Screenshot> placeholders
 * point at (frontend/public/wiki/screenshots/companion-*.png).
 *
 * Usage:
 *   1. Start the Android emulator and the Companion dev-client, and put the app
 *      in DEMO mode (Pair this phone, then Try the demo) so the screens carry
 *      sample data instead of an empty "pair this phone" state.
 *   2. node scripts/capture-companion-screenshots.mjs
 *
 * Override the adb path with ADB=/path/to/adb if it is not at the default macOS
 * Android SDK location.
 *
 * What it auto-captures (tab screens with demo data):
 *   - companion-home       the Notebook tab
 *   - companion-today      the Notebook tab with the Today pull-down expanded
 *   - companion-inventory  the Inventory tab
 *
 * What still needs a manual or physical-device pass (this script lists them but
 * does not automate them, because the emulator cannot produce these states):
 *   - companion-scan       the document scanner is hidden on the emulator (no
 *                          native scanner is linked), so shoot this on a real
 *                          device where the scanner is present.
 *   - companion-method     needs the laptop to publish a method to a paired
 *                          phone, so run the real pair + View-method flow.
 *   - companion-pairing-qr the pairing screen is a live camera view, so shoot it
 *                          on a real device mid-pairing.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "frontend", "public", "wiki", "screenshots");

const ADB =
  process.env.ADB ??
  path.join(os.homedir(), "Library", "Android", "sdk", "platform-tools", "adb");

function adb(args, asText = false) {
  return execFileSync(ADB, args, asText ? { encoding: "utf8" } : {});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Device resolution, so the tab taps are proportional across phones. */
function deviceSize() {
  const out = adb(["shell", "wm", "size"], true).trim(); // "Physical size: 1080x2400"
  const m = out.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`could not read device size from: ${out}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** Five-tab bar at the bottom. Tab i center x = w*(2i+1)/10, y near the bottom. */
function tapTab(i, size) {
  const x = Math.round((size.w * (2 * i + 1)) / 10);
  const y = Math.round(size.h * 0.965);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

function capture(name) {
  const png = adb(["exec-out", "screencap", "-p"]); // raw PNG bytes
  const file = path.join(OUT_DIR, `companion-${name}.png`);
  writeFileSync(file, png);
  console.log(`  saved ${path.relative(REPO_ROOT, file)} (${png.length} bytes)`);
}

const TAB = { notebook: 0, inventory: 1, calc: 2, timer: 3, wiki: 4 };

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const devices = adb(["devices"], true)
    .split("\n")
    .slice(1)
    .filter((l) => /\tdevice$/.test(l));
  if (devices.length === 0) {
    throw new Error("no adb device attached. Start the emulator first.");
  }

  const size = deviceSize();
  console.log(
    `device ${size.w}x${size.h}, output ${path.relative(REPO_ROOT, OUT_DIR)}`,
  );

  // Notebook tab. With the app in demo mode the capture options show and the
  // Today pull-down is expanded by default, so one navigation gives both shots.
  console.log("Notebook (home + today)...");
  tapTab(TAB.notebook, size);
  await sleep(1800);
  capture("home");
  capture("today");

  // Inventory tab.
  console.log("Inventory...");
  tapTab(TAB.inventory, size);
  await sleep(1800);
  capture("inventory");

  console.log("\nDone with the emulator-capturable screens.");
  console.log("Still needed on a real device / paired session (not automated):");
  console.log("  companion-scan        scanner is hidden on the emulator");
  console.log("  companion-method      needs the laptop to publish a method");
  console.log("  companion-pairing-qr  live camera view, shoot mid-pairing");
}

main().catch((e) => {
  console.error(`capture-companion-screenshots: ${e.message}`);
  process.exit(1);
});

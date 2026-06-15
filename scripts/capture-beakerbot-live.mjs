#!/usr/bin/env node
/**
 * Standalone LIVE-AI capture for two BeakerBot wiki screenshots that need a real
 * Fireworks turn (so they are NOT part of the reproducible
 * capture-wiki-screenshots.mjs harness):
 *
 *   1. beakerbot-crud-confirm.png — the red destructive delete-confirmation card
 *      (data-testid="beakerbot-approval" with request.destructive) BeakerBot
 *      shows before a delete. We type a delete prompt, wait for the AI to call
 *      delete_project, and capture the confirm card. We DO NOT approve it.
 *
 *   2. beakerbot-plan-card.png — the BeakerBotPlanCard
 *      (data-testid="beakerbot-plan-card") that renders when the AI calls
 *      propose_plan. We type a planning prompt and capture the plan with steps.
 *
 * Requirements (already satisfied on the running dev server per the task):
 *   - NEXT_PUBLIC_AI_ASSISTANT_ENABLED=1, real Fireworks AI_API_KEY,
 *     NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS=true.
 *
 * Loads /?wikiCapture=1 (signed in as alex, fixture seeded). The visible "Ask
 * BeakerBot AI" trigger is HIDDEN in wiki-capture mode, but the global Cmd/Ctrl+J
 * shortcut still opens BeakerBot in Ask mode, so we open it that way.
 *
 * Usage (from frontend/):  node ../scripts/capture-beakerbot-live.mjs [which]
 *   which = "confirm" | "plan" | "both" (default both)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const requireFromFrontend = createRequire(
  path.join(REPO_ROOT, "frontend", "package.json"),
);
const { chromium } = requireFromFrontend("playwright");

const OUT_DIR = path.join(REPO_ROOT, "frontend", "public", "wiki", "screenshots");
const BASE_URL = process.env.WIKI_CAPTURE_BASE_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

const which = process.argv[2] ?? "both";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open BeakerBot in Ask mode via the global Cmd/Ctrl+J shortcut + wait for the
 *  composer input to appear. The visible trigger is hidden in wiki-capture. */
async function openBeakerBot(page) {
  // Try the visible trigger first (in case it is present), else fall back to the
  // keyboard shortcut which is always wired by BeakerSearchProvider.
  const trigger = page.locator('[aria-label="Ask BeakerBot AI"]');
  if (await trigger.count().catch(() => 0)) {
    await trigger.first().click({ timeout: 2000 }).catch(() => {});
  }
  let input = page.locator('[data-testid="beakerbot-input"]');
  if (!(await input.count())) {
    // Cmd+J (mac) / Ctrl+J. Playwright key combos:
    await page.keyboard.press("Meta+j").catch(() => {});
    await sleep(400);
    if (!(await page.locator('[data-testid="beakerbot-input"]').count())) {
      await page.keyboard.press("Control+j").catch(() => {});
      await sleep(400);
    }
  }
  await page
    .locator('[data-testid="beakerbot-input"]')
    .first()
    .waitFor({ timeout: 8000 });
  return page.locator('[data-testid="beakerbot-input"]').first();
}

async function sendPrompt(page, input, text) {
  await input.click();
  await input.fill(text);
  await sleep(150);
  // Prefer the send button; fall back to Enter.
  const send = page.locator('[data-testid="beakerbot-send"]').first();
  if (await send.count()) {
    await send.click({ timeout: 3000 }).catch(async () => {
      await input.press("Enter");
    });
  } else {
    await input.press("Enter");
  }
}

/** Wait up to `timeoutMs` for any of `selectors` to appear; resolves the first. */
async function waitForAny(page, selectors, timeoutMs) {
  const races = selectors.map((sel) =>
    page
      .locator(sel)
      .first()
      .waitFor({ timeout: timeoutMs, state: "visible" })
      .then(() => sel)
      .catch(() => null),
  );
  return Promise.race(races);
}

async function clean(page) {
  // Hide dev/beta chrome so the shot is clean. Mirrors applyClean() in
  // capture-wiki-screenshots.mjs: the floating dock, the Next.js dev portal
  // badge, the "Dev: restart server" / "Dev: restart fresh session" FABs, and
  // fixed pointer-events:none decorative overlays.
  await page
    .addStyleTag({
      content: `
        [data-floating-dock], [data-testid="dev-dock"], nextjs-portal,
        [aria-label="Report a bug"], [aria-label="Test notification"],
        [aria-label="Test error"] { display: none !important; }
      `,
    })
    .catch(() => {});
  await page
    .evaluate(() => {
      for (const dock of document.querySelectorAll("[data-floating-dock]"))
        dock.style.display = "none";
      for (const el of document.querySelectorAll("nextjs-portal"))
        el.style.display = "none";
      // Dev-only FABs whose label starts with "Dev:" (restart server / fresh
      // session). Walk up to the fixed-position wrapper and hide it.
      for (const el of document.querySelectorAll("button, a")) {
        if (/^Dev:/i.test((el.textContent || "").trim())) {
          let n = el;
          for (let i = 0; i < 4 && n; i++) {
            if (getComputedStyle(n).position === "fixed") {
              n.style.display = "none";
              break;
            }
            n = n.parentElement;
          }
          el.style.display = "none";
        }
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" && cs.pointerEvents === "none") {
          const r = el.getBoundingClientRect();
          const fullScreen = r.width >= vw * 0.85 && r.height >= vh * 0.85;
          const cornerDecor =
            r.width >= 20 &&
            r.width <= vw * 0.5 &&
            r.height >= 20 &&
            r.height <= vh * 0.5;
          if (fullScreen || cornerDecor) el.style.display = "none";
        }
      }
    })
    .catch(() => {});
}

async function captureConfirm(page) {
  console.log("[confirm] opening BeakerBot...");
  const input = await openBeakerBot(page);
  // A prompt that should make the model call delete_project on a known fixture
  // project. Explicit + unambiguous so the model picks the delete tool.
  const prompt =
    'Delete the project named "DEMO: Lab admin & onboarding". Use the delete tool — I want to permanently remove that whole project.';
  console.log("[confirm] sending prompt...");
  await sendPrompt(page, input, prompt);
  console.log("[confirm] waiting for the destructive confirm card (up to 60s)...");
  const hit = await waitForAny(
    page,
    [
      '[data-testid="beakerbot-approval-allow"]',
      '[data-testid="beakerbot-approval"]',
    ],
    60000,
  );
  if (!hit) {
    console.warn("[confirm] confirm card did not appear");
    return false;
  }
  // Confirm it is the DESTRUCTIVE variant (red, "hard to undo").
  await sleep(800);
  await clean(page);
  await sleep(300);
  const out = path.join(OUT_DIR, "beakerbot-crud-confirm.png");
  await page.screenshot({ path: out });
  console.log(`[confirm] captured -> ${out}`);
  return true;
}

async function capturePlan(page) {
  console.log("[plan] opening BeakerBot...");
  const input = await openBeakerBot(page);
  const prompt =
    "Make a step-by-step plan to set up a new cloning experiment for FakeYeast. Propose the plan as numbered steps before doing anything.";
  console.log("[plan] sending prompt...");
  await sendPrompt(page, input, prompt);
  console.log("[plan] waiting for the plan card (up to 60s)...");
  const hit = await waitForAny(
    page,
    [
      '[data-testid="beakerbot-plan-card"]',
      '[data-testid="beakerbot-approval-approve"]', // whole-plan approval variant
    ],
    60000,
  );
  if (!hit) {
    console.warn("[plan] plan card did not appear");
    return false;
  }
  await sleep(1000);
  await clean(page);
  await sleep(300);
  const out = path.join(OUT_DIR, "beakerbot-plan-card.png");
  await page.screenshot({ path: out });
  console.log(`[plan] captured -> ${out}`);
  return true;
}

async function main() {
  const browser = await chromium.launch();
  let okConfirm = true;
  let okPlan = true;
  try {
    if (which === "confirm" || which === "both") {
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/?wikiCapture=1`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page
        .waitForSelector('[data-testid="staged-loading-screen"]', {
          state: "detached",
          timeout: 12000,
        })
        .catch(() => null);
      await sleep(2500);
      okConfirm = await captureConfirm(page).catch((e) => {
        console.error("[confirm] error:", e.message);
        return false;
      });
      await ctx.close();
    }
    if (which === "plan" || which === "both") {
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/?wikiCapture=1`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page
        .waitForSelector('[data-testid="staged-loading-screen"]', {
          state: "detached",
          timeout: 12000,
        })
        .catch(() => null);
      await sleep(2500);
      okPlan = await capturePlan(page).catch((e) => {
        console.error("[plan] error:", e.message);
        return false;
      });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    `\nDone. confirm=${okConfirm ? "OK" : "FAIL"} plan=${okPlan ? "OK" : "FAIL"}`,
  );
  if (!okConfirm || !okPlan) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

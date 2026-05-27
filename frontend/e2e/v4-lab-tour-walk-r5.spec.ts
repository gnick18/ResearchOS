import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v4 lab-tour live-test sub-bot R5 (HR dispatched 2026-05-22).
 *
 * R4 just landed two fix commits:
 *   - d94d71be: WikiPointerStep glide-only; LabSpawnBeakerBotStep +
 *     LabPermissionPracticeStep got expectedRoute: "/workbench".
 *   - 61148439: Phase 4 cleanup grid: L21 lab_ prefix exclusion;
 *     data-artifact-type attr; Start fresh CTA wired; Finish setup
 *     re-summon fix (controller.endTour + idempotency guard).
 *
 * R5 verifies:
 *   - Wiki pointer is glide-only (no nav out of v4 mount tree).
 *   - §6.13-§6.15 now actually run since wiki doesn't kill the tour.
 *   - §6.16 LAB TOUR: full path. Spawn auto-navs to /workbench.
 *     Permission practice spotlight resolves on /workbench.
 *   - §6.17 cleanup grid: L21 exclusion live; data-artifact-type on every
 *     row; Start fresh unchecks every row; Finish setup closes the modal
 *     and DOES NOT re-summon.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r5";
const BUGS_FILE = `${SHOT_DIR}/bugs.json`;
const CONSOLE_FILE = `${SHOT_DIR}/console.log`;
const URL_LOSS_FILE = `${SHOT_DIR}/url-loss-events.txt`;
const STICKY_FILE = `${SHOT_DIR}/sticky-flag-trace.txt`;

mkdirSync(SHOT_DIR, { recursive: true });

interface BugRow {
  step: string;
  severity: "wedge" | "wrong" | "polish" | "info";
  what_happened: string;
  what_should_happen: string;
  screenshot?: string;
  snippet?: string;
}

const bugs: BugRow[] = [];
const urlLossEvents: string[] = [];
const stickyTrace: string[] = [];

function pushBug(b: BugRow) {
  bugs.push(b);
  writeFileSync(BUGS_FILE, JSON.stringify(bugs, null, 2));
}

async function snapshot(page: Page, name: string): Promise<string> {
  const path = `${SHOT_DIR}/${name}.png`;
  try {
    await page.screenshot({ path, fullPage: false });
  } catch (e) {
    // ignore
  }
  return path;
}

async function currentStep(page: Page): Promise<string | null> {
  return await page.evaluate(
    () => (document.body.dataset.tourStep as string | undefined) ?? null,
  );
}

async function readStickyFlags(
  page: Page,
): Promise<{ v4Preview: string | null; wikiMode: string | null }> {
  return await page.evaluate(() => {
    try {
      return {
        v4Preview: sessionStorage.getItem("researchos:v4-preview-active"),
        wikiMode: sessionStorage.getItem("researchos:wiki-capture-mode"),
      };
    } catch {
      return { v4Preview: null, wikiMode: null };
    }
  });
}

async function isV4MountPresent(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return Boolean(
      document.body.dataset.tourStep ||
        document.querySelector('[data-tour-step], [data-testid="tour-cursor"]'),
    );
  });
}

async function waitForStep(
  page: Page,
  expected: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await currentStep(page);
    if (s === expected) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function waitForAnyStep(
  page: Page,
  timeoutMs = 8000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await currentStep(page);
    if (s) return s;
    await page.waitForTimeout(150);
  }
  return null;
}

async function skipThisStep(page: Page): Promise<boolean> {
  const btn = page.getByRole("button", { name: "Skip this step" }).first();
  if (await btn.count()) {
    try {
      await btn.click({ timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function clickManualAdvance(
  page: Page,
  label?: string,
): Promise<boolean> {
  const candidates = label
    ? [label]
    : ["Got it, next", "Next", "Let's go", "Continue"];
  for (const l of candidates) {
    const btn = page.getByRole("button", { name: l }).first();
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 1500 });
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

async function answerSetupRadio(
  page: Page,
  optionLabel: string,
  nextLabel = "Next",
): Promise<boolean> {
  // R5 robustness fix: click the actual <input type="radio"> via the
  // <p class="text-sm font-medium"> label-text element. The setup
  // RadioCard wraps a <label> around an <input>, and clicking the
  // outer <label> with playwright sometimes resolves to a child
  // descriptor that doesn't fire the radio's onChange. Click the
  // <p> with the visible label, then verify the radio is :checked
  // before pressing Next.
  let clicked = false;
  // Prefer the label's first <p> with the option text (the bold label)
  const labelP = page
    .locator(`label p.font-medium:text-is("${optionLabel}")`)
    .first();
  if (await labelP.count()) {
    try {
      await labelP.click({ timeout: 1500 });
      clicked = true;
    } catch {
      clicked = false;
    }
  }
  if (!clicked) {
    const labelLocator = page
      .locator("label", { hasText: optionLabel })
      .first();
    if (await labelLocator.count()) {
      try {
        await labelLocator.click({ timeout: 1500 });
        clicked = true;
      } catch {
        clicked = false;
      }
    }
  }
  if (!clicked) {
    const p = page.locator(`p:text-is("${optionLabel}")`).first();
    if (await p.count()) {
      try {
        await p.click({ timeout: 1500 });
        clicked = true;
      } catch {
        clicked = false;
      }
    }
  }
  if (!clicked) return false;
  await page.waitForTimeout(300);
  // Verify the radio is actually selected before pressing Next.
  // If not, the Next button is likely disabled and clickManualAdvance
  // would silently fail.
  const radioChecked = await page
    .locator('input[type="radio"]:checked')
    .count();
  if (radioChecked === 0) {
    // Fallback: click input directly via JS to dispatch the change
    try {
      await page.evaluate((labelText) => {
        const labels = Array.from(document.querySelectorAll("label"));
        for (const lbl of labels) {
          const p = lbl.querySelector("p.font-medium");
          if (p && p.textContent?.trim() === labelText) {
            const input = lbl.querySelector(
              'input[type="radio"]',
            ) as HTMLInputElement | null;
            if (input) {
              input.click();
              return;
            }
          }
        }
      }, optionLabel);
      await page.waitForTimeout(300);
    } catch {
      // ignore
    }
  }
  return await clickManualAdvance(page, nextLabel);
}

test.setTimeout(30 * 60 * 1000);

test("R5 full walk: setup -> walkthrough -> lab tour -> cleanup (R4 fix verification)", async ({
  page,
}) => {
  bugs.length = 0;
  urlLossEvents.length = 0;
  stickyTrace.length = 0;

  const consoleLines: string[] = [];
  let errCount = 0;
  let warnCount = 0;
  const spotlightWarnings: string[] = [];
  let resumePromptAppearances = 0;
  let lastUrl = "";
  let urlChangeEvents = 0;
  const wikiNavEvents: string[] = [];

  page.on("console", (m) => {
    const t = m.type();
    const txt = `[${t}] ${m.text()}`;
    consoleLines.push(txt);
    if (t === "error") errCount++;
    if (t === "warning") warnCount++;
    if (/TourSpotlight.*did not resolve/.test(m.text())) {
      spotlightWarnings.push(m.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
    errCount++;
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const u = frame.url();
      if (u !== lastUrl) {
        urlChangeEvents++;
        lastUrl = u;
        consoleLines.push(`[nav] ${u}`);
        if (/\/wiki/.test(u)) {
          wikiNavEvents.push(u);
        }
      }
    }
  });

  await page.goto("/?wikiCapture=1&wizard-preview=1");
  await page.waitForLoadState("domcontentloaded");

  // ---- Phase 0a: sticky-flag baseline ----
  await page.waitForTimeout(800);
  const initialSticky = await readStickyFlags(page);
  stickyTrace.push(
    `[entry] url=${page.url()} v4Preview=${initialSticky.v4Preview} wikiMode=${initialSticky.wikiMode}`,
  );
  if (initialSticky.v4Preview !== "1") {
    pushBug({
      step: "entry/sticky-flag",
      severity: "wedge",
      what_happened: `researchos:v4-preview-active was "${initialSticky.v4Preview}" after entry, expected "1".`,
      what_should_happen:
        "Sticky-flag should arm on first observation of ?wizard-preview=1.",
    });
  }

  // Resume modal auto-clicker
  const resumeInterval = setInterval(async () => {
    try {
      const resumeBtn = page.getByTestId("v4-resume-resume");
      if (await resumeBtn.count()) {
        const visible = await resumeBtn
          .first()
          .isVisible()
          .catch(() => false);
        if (visible) {
          await resumeBtn
            .first()
            .click({ timeout: 800 })
            .catch(() => undefined);
          resumePromptAppearances++;
          const step = await currentStep(page).catch(() => null);
          stickyTrace.push(
            `[resume-modal] APPEARED mid-tour at step=${step} url=${page.url()}`,
          );
        }
      }
    } catch {
      // ignore
    }
  }, 500) as unknown as NodeJS.Timeout;

  // -------- Phase 0: entry --------
  const firstStep = await waitForAnyStep(page, 15_000);
  await snapshot(page, "00-entry");
  if (!firstStep) {
    pushBug({
      step: "entry",
      severity: "wedge",
      what_happened:
        "document.body.dataset.tourStep never populated after entry URL.",
      what_should_happen:
        "Tour should mount + land on welcome step within 15s.",
      screenshot: "00-entry.png",
    });
    clearInterval(resumeInterval);
    writeFileSync(CONSOLE_FILE, consoleLines.join("\n"));
    return;
  }
  await snapshot(page, "01-welcome");
  await clickManualAdvance(page, "Let's go");

  // q1 — lab
  if (await waitForStep(page, "setup-q1", 5000)) {
    await snapshot(page, "02-q1");
    if (!(await answerSetupRadio(page, "Lab"))) {
      pushBug({
        step: "setup-q1",
        severity: "wedge",
        what_happened: "Could not click Lab option / Next.",
        what_should_happen: "Lab radio selectable; Next advances.",
        screenshot: "02-q1.png",
      });
      await skipThisStep(page);
    }
  }

  // q1a / q1b
  if (await waitForStep(page, "setup-q1a", 5000)) {
    await snapshot(page, "03-q1a");
    let ok = false;
    for (const opt of ["Local disk only", "Local", "OneDrive", "Google Drive"]) {
      if (await page.locator("label", { hasText: opt }).first().count()) {
        ok = await answerSetupRadio(page, opt);
        if (ok) break;
      }
    }
    if (!ok) await skipThisStep(page);
  }
  if (await waitForStep(page, "setup-q1b", 5000)) {
    await snapshot(page, "04-q1b");
    if (!(await clickManualAdvance(page))) {
      await skipThisStep(page);
    }
  }

  // q2..q5 — Yes
  for (const q of ["setup-q2", "setup-q3", "setup-q4", "setup-q5"]) {
    if (await waitForStep(page, q, 5000)) {
      await snapshot(page, `05-${q}`);
      if (!(await answerSetupRadio(page, "Yes"))) await skipThisStep(page);
    }
  }

  // q6 — AI helper
  if (await waitForStep(page, "setup-q6", 5000)) {
    await snapshot(page, "09-q6");
    let ok = false;
    for (const opt of ["Yes, Full prompt", "Yes, Medium prompt", "Yes, Minimal prompt"]) {
      if (await page.locator("label", { hasText: opt }).first().count()) {
        ok = await answerSetupRadio(page, opt);
        if (ok) break;
      }
    }
    if (!ok) await skipThisStep(page);
  }

  // Capture feature_picks from sidecar to verify setup picks persisted
  await page.waitForTimeout(800);
  const featurePicksAfterSetup = await page.evaluate(async () => {
    try {
      // Look for sidecar in window or fetch from API
      const resp = await fetch("/api/onboarding/sidecar").catch(() => null);
      if (resp && resp.ok) {
        const data = await resp.json();
        return data?.feature_picks ?? null;
      }
    } catch {
      // ignore
    }
    return null;
  });
  stickyTrace.push(
    `[post-setup/feature_picks] ${JSON.stringify(featurePicksAfterSetup)}`,
  );

  // -------- Phase 2: in-product walkthrough --------
  const walkthroughSteps = [
    "home-create-project",
    "home-create-project-fill",
    "project-overview-nav",
    "project-overview-prose",
    "project-overview-exit",
    "notifications-bell",
    "notifications-silence",
    "notifications-delete",
    "methods-category-prompt",
    "methods-category-open",
    "methods-category",
    "methods-open-picker",
    "methods-file-vs-markdown",
    "methods-type-tour",
    "methods-create",
    "workbench-create-experiment-open",
    "workbench-create-experiment",
    "experiment-attach-method-open",
    "experiment-attach-method-tab",
    "experiment-attach-method-attach",
    "experiment-attach-method-notes",
    "hybrid-editor",
    "hybrid-editor-paragraphs",
    "hybrid-editor-image-drop",
    "hybrid-editor-resize",
    "gantt-task-types",
    "gantt-drag-drop",
    "gantt-chained-deps",
    "gantt-goals-overview",
    "personalization-animations",
    "personalization-color",
    "settings-more",
    "ai-helper-deep-explain",
    "search-demo",
    "wiki-pointer",
    "telegram",
    "purchases",
    "calendar",
  ];

  const stepHelpers: Record<string, () => Promise<boolean>> = {
    "home-create-project": async () => {
      const btn = page.locator('[data-tour-target="home-new-project"]').first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 2000 });
          return true;
        } catch {
          return false;
        }
      }
      const fallback = page
        .getByRole("button", { name: /\+ New Project/ })
        .first();
      if (await fallback.count()) {
        try {
          await fallback.click({ timeout: 2000 });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    "home-create-project-fill": async () => {
      const nameInput = page
        .locator('[data-tour-target="home-project-name-input"]')
        .first();
      if (await nameInput.count()) {
        try {
          await nameInput.fill("R5 tour test project");
        } catch {
          // continue
        }
      } else {
        try {
          await page
            .getByPlaceholder(/CRISPR|gene editing/i)
            .first()
            .fill("R5 tour test project");
        } catch {
          // continue
        }
      }
      const create = page
        .getByRole("button", { name: /Create Project/ })
        .first();
      if (await create.count()) {
        try {
          await create.click({ timeout: 2000 });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
  };

  // Per-step URL + mount tracking + wiki-pointer specific watch.
  let stuckOn: string | null = null;
  let stuckCount = 0;
  let attempted = 0;
  let wikiPointerNavSeen = false;
  let wikiPointerUrl = "";
  const stepCheckLines: string[] = [
    "step\turl_has_wikiCapture\turl_has_wizardPreview\turl_path\tv4PreviewSticky\twikiModeSticky\tmountPresent",
  ];

  for (let i = 0; i < walkthroughSteps.length; i++) {
    const expected = walkthroughSteps[i];
    attempted++;
    const arrived = await waitForStep(page, expected, 6000);
    const cur = await currentStep(page);
    const shotName = `10-w-${String(i).padStart(2, "0")}-${expected}`;
    await snapshot(page, shotName);

    const url = page.url();
    const sticky = await readStickyFlags(page);
    const mountPresent = await isV4MountPresent(page);
    let urlPath = "";
    try {
      urlPath = new URL(url).pathname;
    } catch {
      urlPath = url;
    }
    stepCheckLines.push(
      `${expected}\t${url.includes("wikiCapture")}\t${url.includes("wizard-preview")}\t${urlPath}\t${sticky.v4Preview}\t${sticky.wikiMode}\t${mountPresent}`,
    );

    // Wiki pointer specific verification: must stay on whatever route
    // we were on, NOT navigate to /wiki/*.
    if (expected === "wiki-pointer") {
      wikiPointerUrl = url;
      // Capture URL right before and during the step
      stickyTrace.push(
        `[wiki-pointer/pre] url=${url} navsToWiki=${wikiNavEvents.length}`,
      );
      // Sleep through the auto-advance window to catch any nav attempt
      await page.waitForTimeout(3500);
      const postUrl = page.url();
      stickyTrace.push(
        `[wiki-pointer/post] url=${postUrl} navsToWiki=${wikiNavEvents.length}`,
      );
      if (/\/wiki\//.test(postUrl)) {
        wikiPointerNavSeen = true;
        pushBug({
          step: "wiki-pointer",
          severity: "wedge",
          what_happened: `WikiPointerStep navigated out to ${postUrl}. R4 fix should be glide-only, no nav.`,
          what_should_happen:
            "Cursor glides to wiki-nav-tab as visual anchor; no router.push, no nav.",
          screenshot: `${shotName}.png`,
        });
      }
    }

    if (arrived) {
      if (!url.includes("wikiCapture")) {
        urlLossEvents.push(
          `[${expected}] url=${url} v4Sticky=${sticky.v4Preview} wikiSticky=${sticky.wikiMode} mountPresent=${mountPresent}`,
        );
      }
      if (sticky.v4Preview !== "1") {
        pushBug({
          step: expected,
          severity: "wedge",
          what_happened: `Sticky v4Preview flag became "${sticky.v4Preview}" at step ${expected}.`,
          what_should_happen:
            "Sticky flag should persist for entire tour session.",
        });
      }
      if (!mountPresent) {
        pushBug({
          step: expected,
          severity: "wedge",
          what_happened: `V4MountForUser appears unmounted at step ${expected}.`,
          what_should_happen:
            "Mount stays present across all navigations during tour.",
        });
      }
    }

    if (!arrived) {
      pushBug({
        step: expected,
        severity: "wedge",
        what_happened: `Did not reach ${expected} within 6s. Current step: ${cur ?? "(none)"}. URL: ${url}. v4Sticky=${sticky.v4Preview}. mountPresent=${mountPresent}.`,
        what_should_happen: `Tour should advance through ${expected}.`,
        screenshot: `${shotName}.png`,
      });
      if (cur && cur !== expected) {
        const curIdx = walkthroughSteps.indexOf(cur);
        if (curIdx > i) {
          i = curIdx - 1;
          continue;
        }
      }
      if (cur === stuckOn) {
        stuckCount++;
      } else {
        stuckOn = cur;
        stuckCount = 1;
      }
      if (stuckCount > 3) {
        pushBug({
          step: cur ?? "(unknown)",
          severity: "wedge",
          what_happened:
            "Wedge persisted after multiple Skip-step attempts. Aborting walkthrough phase.",
          what_should_happen: "Skip step should advance tour.",
        });
        break;
      }
      await skipThisStep(page);
      await page.waitForTimeout(400);
      continue;
    }

    stuckOn = null;
    stuckCount = 0;

    let advanced = false;
    if (stepHelpers[expected]) {
      try {
        advanced = await stepHelpers[expected]();
      } catch {
        advanced = false;
      }
      if (advanced) await page.waitForTimeout(800);
    }
    if (!advanced) advanced = await clickManualAdvance(page);
    if (!advanced) {
      pushBug({
        step: expected,
        severity: "info",
        what_happened:
          "No manual-advance button visible. Real user-action step. Skipping for instrumentation.",
        what_should_happen: "n/a (this is observation, not a defect).",
        screenshot: `${shotName}.png`,
      });
      await skipThisStep(page);
    }
    await page.waitForTimeout(500);
  }

  writeFileSync(`${SHOT_DIR}/step-state.tsv`, stepCheckLines.join("\n"));

  // -------- Phase 2c: lab tour (§6.16) --------
  let labReached = false;
  for (let i = 0; i < 30; i++) {
    const s = await currentStep(page);
    if (s === "lab-prompt") {
      labReached = true;
      break;
    }
    if (s === "phase4-cleanup") break;
    await page.waitForTimeout(300);
    if (i % 5 === 4) await skipThisStep(page);
  }

  await snapshot(page, "20-lab-prompt");
  let labSpawnUrl = "";
  let labPermissionUrl = "";
  let labPermSpotlightResolved = false;

  if (!labReached) {
    pushBug({
      step: "lab-prompt",
      severity: "wedge",
      what_happened: `Never reached lab-prompt; current = ${await currentStep(page)}.`,
      what_should_happen:
        "After conditional walkthroughs, Q1=lab should land on lab-prompt.",
      screenshot: "20-lab-prompt.png",
    });
  } else {
    const nowBtn = page.locator('[data-lab-prompt-pick="now"]');
    if (await nowBtn.count()) {
      try {
        await nowBtn.click({ timeout: 2000 });
      } catch (e) {
        pushBug({
          step: "lab-prompt",
          severity: "wrong",
          what_happened: `Now button click failed: ${(e as Error).message}`,
          what_should_happen:
            "Now button should advance to lab-spawn-beakerbot.",
        });
      }
    } else {
      pushBug({
        step: "lab-prompt",
        severity: "wedge",
        what_happened: "data-lab-prompt-pick=now button not found.",
        what_should_happen: "Three branch buttons rendered in speech bubble.",
      });
    }

    if (await waitForStep(page, "lab-spawn-beakerbot", 8000)) {
      await snapshot(page, "21-lab-spawn-pre");
      await page.waitForTimeout(2500);
      labSpawnUrl = page.url();
      await snapshot(page, "22-lab-spawn-ready");
      stickyTrace.push(`[lab-spawn-beakerbot] url=${labSpawnUrl}`);
      // R4 fix #2 verification: lab-spawn-beakerbot has expectedRoute /workbench
      // After ~2.5s the controller's auto-nav should have landed us on /workbench
      let labSpawnPath = "";
      try {
        labSpawnPath = new URL(labSpawnUrl).pathname;
      } catch {
        labSpawnPath = labSpawnUrl;
      }
      if (labSpawnPath !== "/workbench") {
        pushBug({
          step: "lab-spawn-beakerbot",
          severity: "wrong",
          what_happened: `lab-spawn-beakerbot URL path is "${labSpawnPath}", expected "/workbench" (expectedRoute fix).`,
          what_should_happen:
            "Controller should auto-nav to /workbench so user sees BeakerBot's shared experiments.",
          screenshot: "22-lab-spawn-ready.png",
        });
      }
      const statusEl = page.getByTestId("lab-spawn-status");
      const statusText = (await statusEl.first().textContent()) ?? "";
      const isReady = /joined the lab/i.test(statusText);
      const isError = /Couldn|error/i.test(statusText);
      if (isError) {
        pushBug({
          step: "lab-spawn-beakerbot",
          severity: "wrong",
          what_happened: `Spawn surfaced an error pill: "${statusText.trim()}"`,
          what_should_happen:
            "BeakerBot fake user spawns; two shared experiments appear.",
          screenshot: "22-lab-spawn-ready.png",
          snippet: statusText.trim(),
        });
      } else if (!isReady) {
        pushBug({
          step: "lab-spawn-beakerbot",
          severity: "polish",
          what_happened: `Spawn status pill never showed ready text: "${statusText.trim()}"`,
          what_should_happen: 'Status text contains "joined the lab".',
          screenshot: "22-lab-spawn-ready.png",
          snippet: statusText.trim(),
        });
      }
      await clickManualAdvance(page, "Got it, next");
    } else {
      pushBug({
        step: "lab-spawn-beakerbot",
        severity: "wedge",
        what_happened: "Did not reach lab-spawn-beakerbot after Now click.",
        what_should_happen: "Tour advances to spawn step.",
      });
    }

    if (await waitForStep(page, "lab-permission-practice", 8000)) {
      await page.waitForTimeout(1500);
      labPermissionUrl = page.url();
      await snapshot(page, "23-lab-permission");
      stickyTrace.push(`[lab-permission-practice] url=${labPermissionUrl}`);
      // R4 fix #3 verification: lab-permission-practice has expectedRoute /workbench
      let labPermPath = "";
      try {
        labPermPath = new URL(labPermissionUrl).pathname;
      } catch {
        labPermPath = labPermissionUrl;
      }
      if (labPermPath !== "/workbench") {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `lab-permission-practice URL path is "${labPermPath}", expected "/workbench" (expectedRoute fix).`,
          what_should_happen:
            "Controller should auto-nav to /workbench so spotlight resolves.",
          screenshot: "23-lab-permission.png",
        });
      }

      // R4 fix #3 verification: spotlight should now resolve since we're on /workbench
      const spotlightInfo = await page.evaluate(() => {
        const spot = document.querySelector('[data-testid="tour-spotlight"]');
        const rect = spot?.getBoundingClientRect();
        return {
          spotlightPresent: Boolean(spot),
          spotlightLeft: rect?.left ?? null,
          spotlightTop: rect?.top ?? null,
          spotlightWidth: rect?.width ?? null,
          spotlightHeight: rect?.height ?? null,
          spotlightVisible: rect ? rect.width > 0 && rect.height > 0 : false,
          sharedExpAnchor: Boolean(
            document.querySelector(
              '[data-tour-target="workbench-shared-experiments"]',
            ),
          ),
        };
      });
      stickyTrace.push(
        `[lab-permission-spotlight] info=${JSON.stringify(spotlightInfo)}`,
      );
      labPermSpotlightResolved =
        spotlightInfo.spotlightPresent &&
        spotlightInfo.spotlightVisible === true;
      if (!spotlightInfo.sharedExpAnchor) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `workbench-shared-experiments anchor not present in DOM. URL: ${labPermissionUrl}`,
          what_should_happen:
            "After expectedRoute /workbench nav, the shared-experiments anchor should be in the DOM for spotlight to target.",
          screenshot: "23-lab-permission.png",
          snippet: JSON.stringify(spotlightInfo),
        });
      }

      const lockEl = page.getByTestId("lab-view-lock-indicator");
      const lockCount = await lockEl.count();
      if (lockCount === 0) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `lab-view-lock-indicator missing from DOM. URL: ${labPermissionUrl}`,
          what_should_happen:
            "Red lock indicator visible on view-only task row.",
          screenshot: "23-lab-permission.png",
        });
      } else {
        const deleteBtn = page
          .locator("button", { hasText: /Delete/i })
          .first();
        if (await deleteBtn.count()) {
          try {
            await deleteBtn.click({ timeout: 1500 });
            await page.waitForTimeout(400);
            await snapshot(page, "24-lab-permission-blocked");
            const blockedEl = page.getByTestId("lab-view-blocked");
            if (!(await blockedEl.count())) {
              pushBug({
                step: "lab-permission-practice",
                severity: "wrong",
                what_happened: "Delete click did not show blocked toast.",
                what_should_happen:
                  "Clicking view-only Delete shows lab-view-blocked toast.",
                screenshot: "24-lab-permission-blocked.png",
              });
            }
          } catch {
            // ignore
          }
        }
      }
      await clickManualAdvance(page, "Got it, next");
    } else {
      pushBug({
        step: "lab-permission-practice",
        severity: "wedge",
        what_happened: "Did not reach lab-permission-practice.",
        what_should_happen: "Tour advances to permission practice.",
      });
    }

    if (await waitForStep(page, "lab-cleanup", 8000)) {
      await snapshot(page, "25-lab-cleanup");
      await clickManualAdvance(page, "Got it, next");
    } else {
      // lab-cleanup may auto-advance very fast, that's fine
      stickyTrace.push(`[lab-cleanup] not seen (may have auto-advanced)`);
    }
  }

  // -------- Phase 4: cleanup grid --------
  const reachedCleanup = await waitForStep(page, "phase4-cleanup", 15_000);
  await snapshot(page, "30-phase4-cleanup");
  let l21ExclusionPassed = false;
  let dataArtifactTypeCovered = false;
  let startFreshUnchecks = false;
  let finishSetupClosesAndDoesNotResummon = false;
  let phase4RowCount = 0;
  let phase4RowsMissingType = 0;
  let phase4RowsMissingId = 0;
  let labArtifactsInGrid: Array<{ type: string | null; text: string }> = [];

  if (!reachedCleanup) {
    pushBug({
      step: "phase4-cleanup",
      severity: "wedge",
      what_happened: `Did not reach phase4-cleanup; current = ${await currentStep(page)}.`,
      what_should_happen: "Tour terminates on cleanup grid.",
      screenshot: "30-phase4-cleanup.png",
    });
  } else {
    // R4 fix #4 verification: Expand all Conditional add-ons collapsibles to see all rows
    // The Phase4CleanupStep renders collapsible sections; try to expand them all.
    const sectionHeaders = page.locator("button[aria-expanded]");
    const headerCount = await sectionHeaders.count();
    for (let i = 0; i < headerCount; i++) {
      const h = sectionHeaders.nth(i);
      const expanded = await h.getAttribute("aria-expanded");
      if (expanded === "false") {
        try {
          await h.click({ timeout: 1000 });
          await page.waitForTimeout(150);
        } catch {
          // skip
        }
      }
    }
    await page.waitForTimeout(400);
    await snapshot(page, "30b-phase4-cleanup-expanded");

    // Read out all artifact rows (the ArtifactRow renders <label data-artifact-id data-artifact-type ...>)
    const rowHandles = await page.locator("[data-artifact-id]").all();
    phase4RowCount = rowHandles.length;
    const rowDetails: Array<{
      id: string | null;
      type: string | null;
      text: string;
    }> = [];
    for (const r of rowHandles) {
      const id = await r.getAttribute("data-artifact-id");
      const type = await r.getAttribute("data-artifact-type");
      const text = ((await r.textContent()) ?? "").trim().slice(0, 200);
      rowDetails.push({ id, type, text });
      if (!type) phase4RowsMissingType++;
      if (!id) phase4RowsMissingId++;
      if (
        type === "lab_user" ||
        type === "lab_task" ||
        (type && type.startsWith("lab_")) ||
        /BeakerBot/i.test(text)
      ) {
        labArtifactsInGrid.push({ type, text });
      }
    }

    writeFileSync(
      `${SHOT_DIR}/phase4-rows.json`,
      JSON.stringify(
        {
          totalRows: phase4RowCount,
          rowsMissingType: phase4RowsMissingType,
          rowsMissingId: phase4RowsMissingId,
          labArtifactsInGrid,
          rows: rowDetails,
        },
        null,
        2,
      ),
    );

    // R4 fix #4: L21 exclusion verification
    if (labArtifactsInGrid.length === 0) {
      l21ExclusionPassed = true;
    } else {
      pushBug({
        step: "phase4-cleanup",
        severity: "wrong",
        what_happened: `L21 exclusion violation: ${labArtifactsInGrid.length} lab artifact rows in cleanup grid. Examples: ${JSON.stringify(labArtifactsInGrid.slice(0, 3))}`,
        what_should_happen:
          "Lab tour artifacts (lab_user, lab_task, BeakerBot) must NOT appear in the cleanup grid (L21).",
        screenshot: "30b-phase4-cleanup-expanded.png",
      });
    }

    // R4 fix #4: data-artifact-type attr verification
    if (phase4RowsMissingType === 0 && phase4RowCount > 0) {
      dataArtifactTypeCovered = true;
    } else if (phase4RowsMissingType > 0) {
      pushBug({
        step: "phase4-cleanup",
        severity: "wrong",
        what_happened: `${phase4RowsMissingType} of ${phase4RowCount} rows are missing the data-artifact-type attribute.`,
        what_should_happen:
          "Every ArtifactRow should render data-artifact-id AND data-artifact-type.",
      });
    } else if (phase4RowCount === 0) {
      pushBug({
        step: "phase4-cleanup",
        severity: "info",
        what_happened:
          "Cleanup grid has zero rows; nothing to assert about data-artifact-type.",
        what_should_happen: "n/a (depends on prior walkthrough success).",
      });
    }

    // R4 fix #5: Start fresh button — should uncheck every row
    const startFreshBtn = page
      .locator('[data-cleanup-action="start-fresh"]')
      .first();
    if (await startFreshBtn.count()) {
      // Read current state of all checkboxes
      const beforeStates = await page
        .locator("[data-cleanup-state]")
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).getAttribute("data-cleanup-state")),
        );
      const beforeKeepCount = beforeStates.filter((s) => s === "keep").length;
      try {
        await startFreshBtn.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        await snapshot(page, "31-after-start-fresh");
        const afterStates = await page
          .locator("[data-cleanup-state]")
          .evaluateAll((els) =>
            els.map((el) =>
              (el as HTMLElement).getAttribute("data-cleanup-state"),
            ),
          );
        const afterKeepCount = afterStates.filter((s) => s === "keep").length;
        if (afterKeepCount === 0 && beforeStates.length > 0) {
          startFreshUnchecks = true;
        } else {
          pushBug({
            step: "phase4-cleanup/start-fresh",
            severity: "wrong",
            what_happened: `Start fresh did not uncheck all rows. before=${beforeKeepCount} keep / ${beforeStates.length} total, after=${afterKeepCount} keep / ${afterStates.length} total.`,
            what_should_happen:
              "Clicking Start fresh should set every row's cleanup-state to discard (no rows kept).",
            screenshot: "31-after-start-fresh.png",
          });
        }
      } catch (e) {
        pushBug({
          step: "phase4-cleanup/start-fresh",
          severity: "wrong",
          what_happened: `Start fresh click threw: ${(e as Error).message}`,
          what_should_happen: "Start fresh should be clickable.",
        });
      }
    } else {
      pushBug({
        step: "phase4-cleanup/start-fresh",
        severity: "wrong",
        what_happened: "Start fresh button not found in DOM.",
        what_should_happen: "Master Start fresh button visible at top of grid.",
      });
    }

    // R4 fix #5: Finish setup — should close modal AND not re-summon
    const finishBtn = page
      .locator('[data-cleanup-action="finish"]')
      .first();
    if (await finishBtn.count()) {
      try {
        await finishBtn.click({ timeout: 2000 });
        // Wait a generous window for the cleanup sweep + endTour + idempotency guard
        await page.waitForTimeout(4000);
        await snapshot(page, "32-after-finish");
        // Modal should be gone
        const modalGone =
          (await page.locator('[data-tour-cleanup-grid]').count()) === 0;
        // And step should be null (tour ended)
        const stepAfter = await currentStep(page);
        // No re-summon: wait additional time and confirm modal does not come back
        await page.waitForTimeout(2000);
        const modalStillGone =
          (await page.locator('[data-tour-cleanup-grid]').count()) === 0;
        await snapshot(page, "33-after-finish-stable");

        if (modalGone && modalStillGone && stepAfter !== "phase4-cleanup") {
          finishSetupClosesAndDoesNotResummon = true;
        } else {
          pushBug({
            step: "phase4-cleanup/finish",
            severity: "wrong",
            what_happened: `Finish setup did not properly close/end tour. modalGone=${modalGone} modalStillGone=${modalStillGone} stepAfter=${stepAfter}.`,
            what_should_happen:
              "After Finish setup: modal unmounts, currentStep flips off phase4-cleanup, modal does NOT re-summon.",
            screenshot: "33-after-finish-stable.png",
          });
        }
      } catch (e) {
        pushBug({
          step: "phase4-cleanup/finish",
          severity: "wrong",
          what_happened: `Finish setup click threw: ${(e as Error).message}`,
          what_should_happen: "Finish setup should be clickable.",
        });
      }
    } else {
      pushBug({
        step: "phase4-cleanup/finish",
        severity: "wrong",
        what_happened: "Finish setup button not found in DOM.",
        what_should_happen: "Finish setup CTA visible in footer.",
      });
    }
  }

  clearInterval(resumeInterval);

  // ---- Final reports ----
  writeFileSync(URL_LOSS_FILE, urlLossEvents.join("\n"));
  writeFileSync(STICKY_FILE, stickyTrace.join("\n"));
  writeFileSync(CONSOLE_FILE, consoleLines.join("\n"));
  writeFileSync(
    `${SHOT_DIR}/spotlight-warnings.txt`,
    spotlightWarnings.join("\n"),
  );
  writeFileSync(
    `${SHOT_DIR}/summary.json`,
    JSON.stringify(
      {
        attempted_walkthrough_steps: attempted,
        wedge_count: bugs.filter((b) => b.severity === "wedge").length,
        wrong_count: bugs.filter((b) => b.severity === "wrong").length,
        polish_count: bugs.filter((b) => b.severity === "polish").length,
        info_count: bugs.filter((b) => b.severity === "info").length,
        console_error_count: errCount,
        console_warning_count: warnCount,
        spotlight_did_not_resolve_count: spotlightWarnings.length,
        url_loss_events: urlLossEvents.length,
        resume_modal_mid_tour_appearances: resumePromptAppearances,
        nav_events: urlChangeEvents,
        wiki_pointer_navigated_out: wikiPointerNavSeen,
        wiki_pointer_url: wikiPointerUrl,
        wiki_nav_events: wikiNavEvents,
        lab_reached: labReached,
        lab_spawn_url: labSpawnUrl,
        lab_permission_url: labPermissionUrl,
        lab_perm_spotlight_resolved: labPermSpotlightResolved,
        reached_cleanup: reachedCleanup,
        phase4_row_count: phase4RowCount,
        phase4_rows_missing_type: phase4RowsMissingType,
        phase4_rows_missing_id: phase4RowsMissingId,
        lab_artifacts_in_grid: labArtifactsInGrid,
        r4_fix_verification: {
          wiki_pointer_glide_only: !wikiPointerNavSeen,
          lab_spawn_expected_route_workbench: labSpawnUrl
            ? new URL(labSpawnUrl).pathname === "/workbench"
            : false,
          lab_permission_expected_route_workbench: labPermissionUrl
            ? new URL(labPermissionUrl).pathname === "/workbench"
            : false,
          l21_lab_exclusion: l21ExclusionPassed,
          data_artifact_type_present: dataArtifactTypeCovered,
          start_fresh_unchecks_all: startFreshUnchecks,
          finish_setup_closes_no_resummon: finishSetupClosesAndDoesNotResummon,
        },
        sticky_flag_armed_on_entry: initialSticky.v4Preview === "1",
        wiki_capture_armed_on_entry:
          initialSticky.wikiMode === "signed-in" ||
          initialSticky.wikiMode === "picker",
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

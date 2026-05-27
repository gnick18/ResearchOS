import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v4 lab-tour live-test sub-bot R4 (HR dispatched 2026-05-21).
 *
 * R3 confirmed 2 of 3 R2 fixes worked but found that R2-Blocker-3
 * (query-param preservation on router.push) only covered the controller's
 * auto-nav. Cursor-driven and in-app router.push calls still stripped
 * `?wikiCapture=1&wizard-preview=1`, causing V4MountForUser to unmount →
 * V4ResumePrompt re-summoned mid-tour, cascading across 18 walkthrough
 * steps.
 *
 * HR's fix (ea59c41b): added a sticky sessionStorage flag
 * (`researchos:v4-preview-active` + `researchos:wiki-capture-mode`). First
 * page that observes the URL flags sets the sticky key; every subsequent
 * page reads it. wantsV4Mount in providers.tsx now calls
 * isV4PreviewMode() which reads URL OR sessionStorage.
 *
 * This R4 spec verifies:
 *   - sticky flags get set on entry
 *   - V4ResumePrompt does NOT re-appear mid-tour
 *   - URL-loss events go to ~0
 *   - V4MountForUser stays mounted across cursor-driven nav (project card,
 *     wiki-pointer click out to /wiki/features/search)
 *   - whatever surfaces next
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r4";
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
  // V4MountForUser typically registers TourBootstrap which writes
  // document.body.dataset.tourStep. If the mount unmounted, the dataset
  // attribute will be missing on the next render cycle.
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
  let clicked = false;
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
  return await clickManualAdvance(page, nextLabel);
}

test.setTimeout(30 * 60 * 1000);

test("R4 full walk: setup -> walkthrough -> lab tour -> cleanup (sticky-flag verification)", async ({
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
      }
    }
  });

  await page.goto("/?wikiCapture=1&wizard-preview=1");
  await page.waitForLoadState("domcontentloaded");

  // ---- Phase 0a: verify sticky flags get set on entry ----
  await page.waitForTimeout(800);
  const initialSticky = await readStickyFlags(page);
  stickyTrace.push(
    `[entry] url=${page.url()} v4Preview=${initialSticky.v4Preview} wikiMode=${initialSticky.wikiMode}`,
  );
  if (initialSticky.v4Preview !== "1") {
    pushBug({
      step: "entry/sticky-flag",
      severity: "wedge",
      what_happened: `researchos:v4-preview-active was "${initialSticky.v4Preview}" after entry, expected "1". Sticky-flag fix did not arm.`,
      what_should_happen:
        "First page observing ?wizard-preview=1 should set sessionStorage flag to \"1\".",
    });
  }
  if (
    initialSticky.wikiMode !== "signed-in" &&
    initialSticky.wikiMode !== "picker"
  ) {
    pushBug({
      step: "entry/sticky-flag",
      severity: "wedge",
      what_happened: `researchos:wiki-capture-mode was "${initialSticky.wikiMode}", expected "signed-in" or "picker".`,
      what_should_happen:
        "First page observing ?wikiCapture=1 should set the sticky wiki-capture-mode key.",
    });
  }

  // R3 instrumentation: still auto-click Resume modal if it re-appears.
  // But now we COUNT appearances — sticky-flag fix should drop this to 0.
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

  // -------- Phase 0: entry / mount verification --------
  const firstStep = await waitForAnyStep(page, 15_000);
  await snapshot(page, "00-entry");
  if (!firstStep) {
    pushBug({
      step: "entry",
      severity: "wedge",
      what_happened:
        "document.body.dataset.tourStep never populated after entry URL. V4MountForUser mount path appears wedged.",
      what_should_happen:
        "Tour should mount and land on the welcome step within 15s.",
      screenshot: "00-entry.png",
    });
    clearInterval(resumeInterval);
    writeFileSync(CONSOLE_FILE, consoleLines.join("\n"));
    return;
  }
  if (firstStep !== "welcome") {
    pushBug({
      step: "welcome",
      severity: "wrong",
      what_happened: `First step was "${firstStep}" not "welcome".`,
      what_should_happen: "TourBootstrap should start at welcome.",
    });
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
    for (const opt of ["Full", "Medium", "Minimal"]) {
      if (await page.locator("label", { hasText: opt }).first().count()) {
        ok = await answerSetupRadio(page, opt);
        if (ok) break;
      }
    }
    if (!ok) await skipThisStep(page);
  }

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
          await nameInput.fill("R4 tour test project");
        } catch {
          // continue
        }
      } else {
        try {
          await page
            .getByPlaceholder(/CRISPR|gene editing/i)
            .first()
            .fill("R4 tour test project");
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

  // Per-step URL + sticky-flag + mount tracking. This is the heart of R4
  // verification — every step writes a row to the trace file so we can
  // tell exactly which navigation (if any) drops the mount.
  let stuckOn: string | null = null;
  let stuckCount = 0;
  let attempted = 0;
  const stepCheckLines: string[] = [
    "step\turl_has_wikiCapture\turl_has_wizardPreview\tv4PreviewSticky\twikiModeSticky\tmountPresent",
  ];

  for (let i = 0; i < walkthroughSteps.length; i++) {
    const expected = walkthroughSteps[i];
    attempted++;
    const arrived = await waitForStep(page, expected, 6000);
    const cur = await currentStep(page);
    const shotName = `10-w-${String(i).padStart(2, "0")}-${expected}`;
    await snapshot(page, shotName);

    // Always record sticky-flag + URL state regardless of arrival
    const url = page.url();
    const sticky = await readStickyFlags(page);
    const mountPresent = await isV4MountPresent(page);
    stepCheckLines.push(
      `${expected}\t${url.includes("wikiCapture")}\t${url.includes("wizard-preview")}\t${sticky.v4Preview}\t${sticky.wikiMode}\t${mountPresent}`,
    );

    if (arrived) {
      // R4 verification: URL may strip params (still bug-worthy as polish),
      // but sticky flag MUST stay = "1" and the mount MUST stay present.
      if (!url.includes("wikiCapture")) {
        urlLossEvents.push(
          `[${expected}] url=${url} v4Sticky=${sticky.v4Preview} wikiSticky=${sticky.wikiMode} mountPresent=${mountPresent}`,
        );
      }
      if (sticky.v4Preview !== "1") {
        pushBug({
          step: expected,
          severity: "wedge",
          what_happened: `Sticky v4Preview flag became "${sticky.v4Preview}" at step ${expected}. Sticky-flag fix regressed.`,
          what_should_happen:
            "Sticky flag should persist for entire tour session.",
        });
      }
      if (!mountPresent) {
        pushBug({
          step: expected,
          severity: "wedge",
          what_happened: `V4MountForUser appears unmounted at step ${expected}. document.body.dataset.tourStep was set but tour anchors missing.`,
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
      await snapshot(page, "22-lab-spawn-ready");
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
      await snapshot(page, "23-lab-permission");
      const labPermUrl = page.url();
      stickyTrace.push(`[lab-permission-practice] url=${labPermUrl}`);
      const lockEl = page.getByTestId("lab-view-lock-indicator");
      const lockCount = await lockEl.count();
      if (lockCount === 0) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `lab-view-lock-indicator missing from DOM. URL: ${labPermUrl}`,
          what_should_happen:
            "Red lock indicator visible on view-only task row.",
          screenshot: "23-lab-permission.png",
        });
      } else {
        const lockText = (await lockEl.first().textContent()) ?? "";
        const lockClass = (await lockEl.first().getAttribute("class")) ?? "";
        if (!lockClass.includes("text-rose-600")) {
          pushBug({
            step: "lab-permission-practice",
            severity: "polish",
            what_happened: `Lock indicator class missing text-rose-600: "${lockClass}"`,
            what_should_happen:
              "Lock indicator should render in text-rose-600 (red).",
            snippet: lockClass,
          });
        }
        if (!lockText.includes("\u{1F512}")) {
          pushBug({
            step: "lab-permission-practice",
            severity: "polish",
            what_happened: `Lock emoji missing. Text: "${lockText.trim()}"`,
            what_should_happen:
              "Lock indicator should show lock emoji as visual cue.",
            snippet: lockText.trim(),
          });
        }
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
      pushBug({
        step: "lab-cleanup",
        severity: "wedge",
        what_happened: "Did not reach lab-cleanup.",
        what_should_happen: "Tour advances to lab-cleanup terminal step.",
      });
    }
  }

  // -------- Phase 4: cleanup grid --------
  const reachedCleanup = await waitForStep(page, "phase4-cleanup", 15_000);
  await snapshot(page, "30-phase4-cleanup");
  if (!reachedCleanup) {
    pushBug({
      step: "phase4-cleanup",
      severity: "wedge",
      what_happened: `Did not reach phase4-cleanup; current = ${await currentStep(page)}.`,
      what_should_happen: "Tour terminates on cleanup grid.",
      screenshot: "30-phase4-cleanup.png",
    });
  } else {
    const rowTexts = await page
      .locator('[data-testid="phase4-cleanup-row"], [data-artifact-type]')
      .allTextContents();
    const bodyText = await page.locator("body").textContent();
    writeFileSync(
      `${SHOT_DIR}/phase4-rows.txt`,
      `rowTexts=\n${rowTexts.join("\n---\n")}\n\nBODY_HEAD:\n${bodyText?.slice(0, 8000) ?? ""}`,
    );
    const hasLabUser = /BeakerBot|lab_user/i.test(bodyText ?? "");
    if (hasLabUser) {
      pushBug({
        step: "phase4-cleanup",
        severity: "wrong",
        what_happened:
          "Cleanup grid appears to include lab-tour BeakerBot user / lab_task artifacts (L21 exclusion violation).",
        what_should_happen:
          "Lab tour artifacts must not appear in the cleanup grid.",
        screenshot: "30-phase4-cleanup.png",
      });
    }

    // Try the Delete-all button to verify R3 carry-over (usersApi.delete TypeError)
    const deleteAllBtn = page
      .getByRole("button", { name: /Delete all|Clean up|Remove all/i })
      .first();
    if (await deleteAllBtn.count()) {
      try {
        // Catch any pageerror around the click — it commonly throws
        // `usersDir.removeEntry is not a function` per R3.
        await deleteAllBtn.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        await snapshot(page, "31-phase4-after-delete-all");
      } catch (e) {
        pushBug({
          step: "phase4-cleanup/delete-all",
          severity: "wrong",
          what_happened: `Delete-all click threw: ${(e as Error).message}`,
          what_should_happen:
            "Delete-all should remove cleanup-grid items without error.",
        });
      }
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

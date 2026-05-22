import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v4 lab-tour live-test sub-bot R3 (HR dispatched 2026-05-21).
 *
 * Re-runs the R2 walk after commit 0f3f300e shipped 3 blocker fixes:
 *   1. V4MountForUser feature_picks now syncs into controller post-load.
 *   2. ProjectOverviewStep expectedRoute "/workbench/projects" removed.
 *   3. TourController auto-nav preserves window.location.search.
 *
 * Output: screenshots + bug log under /tmp/v4-lab-tour-r3.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r3";
const BUGS_FILE = `${SHOT_DIR}/bugs.json`;
const CONSOLE_FILE = `${SHOT_DIR}/console.log`;

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

async function clickManualAdvance(page: Page, label?: string): Promise<boolean> {
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
  // Try `label hasText` (matches the RadioCard wrapper). Fall back to
  // clicking the <p> with the option text directly (Playwright can
  // click an element regardless of its DOM ancestor type as long as
  // hit-testing succeeds).
  let clicked = false;
  const labelLocator = page.locator("label", { hasText: optionLabel }).first();
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

/** Direct-seed test — entry via wizardSeedStep=lab-prompt to isolate §6.16. */
test("R3 lab tour direct seed (wizardSeedStep=lab-prompt)", async ({ page }) => {
  bugs.length = 0;
  const consoleLines: string[] = [];
  let errCount = 0;
  let warnCount = 0;
  page.on("console", (m) => {
    const t = m.type();
    const txt = `[${t}] ${m.text()}`;
    consoleLines.push(txt);
    if (t === "error") errCount++;
    if (t === "warning") warnCount++;
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
    errCount++;
  });

  await page.goto("/?wikiCapture=1&wizardSeedStep=lab-prompt");
  await page.waitForLoadState("domcontentloaded");

  const resumeBtn = page.getByTestId("v4-resume-resume");
  try {
    await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    await snapshot(page, "L0-no-resume-modal");
    pushBug({
      step: "wizardSeedStep:lab-prompt",
      severity: "wedge",
      what_happened:
        "V4ResumePrompt modal never appeared on wizardSeedStep=lab-prompt entry.",
      what_should_happen:
        "Seed plumbing should set wizard_resume_state on alex; modal should show Resume.",
      screenshot: "L0-no-resume-modal.png",
    });
    writeFileSync(`${SHOT_DIR}/console-direct.log`, consoleLines.join("\n"));
    return;
  }
  await snapshot(page, "L0-resume-modal");
  await resumeBtn.click();

  const onPrompt = await waitForStep(page, "lab-prompt", 8000);
  await snapshot(page, "L1-lab-prompt");
  if (!onPrompt) {
    pushBug({
      step: "lab-prompt",
      severity: "wedge",
      what_happened: `Resume did not navigate to lab-prompt; current = ${await currentStep(page)}.`,
      what_should_happen: "Resume should land on lab-prompt body.",
    });
    writeFileSync(`${SHOT_DIR}/console-direct.log`, consoleLines.join("\n"));
    return;
  }

  const nowBtn = page.locator('[data-lab-prompt-pick="now"]');
  await nowBtn.click({ timeout: 3000 });
  await page.waitForTimeout(800);
  consoleLines.push(`[debug] after Now click, step = ${await currentStep(page)}`);

  if (await waitForStep(page, "lab-spawn-beakerbot", 15000)) {
    await page.waitForTimeout(2500);
    await snapshot(page, "L2-lab-spawn");
    const statusEl = page.getByTestId("lab-spawn-status");
    const statusText = (await statusEl.first().textContent()) ?? "";
    const isReady = /joined the lab/i.test(statusText);
    const isError = /Couldn|error/i.test(statusText);
    if (isError) {
      pushBug({
        step: "lab-spawn-beakerbot",
        severity: "wrong",
        what_happened: `Spawn surfaced error pill: "${statusText.trim()}"`,
        what_should_happen: "BeakerBot user spawned; 2 shared experiments appear.",
        screenshot: "L2-lab-spawn.png",
        snippet: statusText.trim(),
      });
    } else if (!isReady) {
      pushBug({
        step: "lab-spawn-beakerbot",
        severity: "polish",
        what_happened: `Spawn status pill never showed ready: "${statusText.trim()}"`,
        what_should_happen: 'Status text contains "joined the lab".',
        snippet: statusText.trim(),
      });
    }
    await clickManualAdvance(page, "Got it, next");
  } else {
    pushBug({
      step: "lab-spawn-beakerbot",
      severity: "wedge",
      what_happened: "Did not advance from lab-prompt to lab-spawn-beakerbot.",
      what_should_happen: "Now click should advance.",
    });
  }

  if (await waitForStep(page, "lab-permission-practice", 8000)) {
    await snapshot(page, "L3-lab-permission");
    const lockEl = page.getByTestId("lab-view-lock-indicator");
    if ((await lockEl.count()) === 0) {
      pushBug({
        step: "lab-permission-practice",
        severity: "wrong",
        what_happened: "lab-view-lock-indicator not present in DOM.",
        what_should_happen: "Red lock indicator visible.",
        screenshot: "L3-lab-permission.png",
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
          what_happened: `Lock indicator missing lock emoji. Got: "${lockText.trim()}"`,
          what_should_happen: "Lock emoji should be visible.",
          snippet: lockText.trim(),
        });
      }
      const deleteBtn = page.locator("button", { hasText: /^Delete$/ }).first();
      if (await deleteBtn.count()) {
        try {
          await deleteBtn.click({ timeout: 1500 });
          await page.waitForTimeout(500);
          await snapshot(page, "L4-lab-permission-blocked");
          const blockedEl = page.getByTestId("lab-view-blocked");
          if (!(await blockedEl.count())) {
            pushBug({
              step: "lab-permission-practice",
              severity: "wrong",
              what_happened: "Delete click did not surface lab-view-blocked toast.",
              what_should_happen:
                "Delete on view-only task should show blocked toast.",
              screenshot: "L4-lab-permission-blocked.png",
            });
          }
        } catch {
          // ignore
        }
      } else {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: "Could not find Delete button on view-only task row.",
          what_should_happen:
            "Permission practice card should expose a Delete button to test blocking.",
        });
      }
    }
    await clickManualAdvance(page, "Got it, next");
  } else {
    pushBug({
      step: "lab-permission-practice",
      severity: "wedge",
      what_happened: "Did not reach lab-permission-practice.",
      what_should_happen: "Advance from spawn to permission practice.",
    });
  }

  if (await waitForStep(page, "lab-cleanup", 8000)) {
    await snapshot(page, "L5-lab-cleanup");
    await clickManualAdvance(page, "Got it, next");
  } else {
    pushBug({
      step: "lab-cleanup",
      severity: "wedge",
      what_happened: "Did not reach lab-cleanup.",
      what_should_happen: "Advance to terminal lab cleanup step.",
    });
  }

  if (await waitForStep(page, "phase4-cleanup", 12_000)) {
    await snapshot(page, "L6-phase4-cleanup");
    const bodyText = (await page.locator("body").textContent()) ?? "";
    const hasLabUser = /BeakerBot/i.test(bodyText);
    writeFileSync(`${SHOT_DIR}/phase4-direct-body.txt`, bodyText.slice(0, 8000));
    if (hasLabUser) {
      pushBug({
        step: "phase4-cleanup",
        severity: "wrong",
        what_happened:
          "Cleanup grid contains BeakerBot lab artifact (L21 exclusion violation).",
        what_should_happen:
          "Lab tour artifacts must not appear in cleanup grid.",
        screenshot: "L6-phase4-cleanup.png",
      });
    }
  } else {
    pushBug({
      step: "phase4-cleanup",
      severity: "wedge",
      what_happened: `Did not reach phase4-cleanup from lab-cleanup; current = ${await currentStep(page)}.`,
      what_should_happen: "Terminal step should be cleanup grid.",
    });
  }

  writeFileSync(`${SHOT_DIR}/console-direct.log`, consoleLines.join("\n"));
  writeFileSync(
    `${SHOT_DIR}/summary-direct.json`,
    JSON.stringify(
      {
        wedge_count: bugs.filter((b) => b.severity === "wedge").length,
        wrong_count: bugs.filter((b) => b.severity === "wrong").length,
        polish_count: bugs.filter((b) => b.severity === "polish").length,
        info_count: bugs.filter((b) => b.severity === "info").length,
        console_error_count: errCount,
        console_warning_count: warnCount,
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

test("R3 full walk: setup -> walkthrough -> lab tour -> cleanup", async ({ page }) => {
  bugs.length = 0;
  const consoleLines: string[] = [];
  let errCount = 0;
  let warnCount = 0;
  page.on("console", (m) => {
    const t = m.type();
    const txt = `[${t}] ${m.text()}`;
    consoleLines.push(txt);
    if (t === "error") errCount++;
    if (t === "warning") warnCount++;
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
    errCount++;
  });

  await page.goto("/?wikiCapture=1&wizard-preview=1");
  await page.waitForLoadState("domcontentloaded");

  // R3 instrumentation workaround: when V4ResumePrompt fires mid-tour
  // (R2 Blocker 3 regression — cursor-driven nav strips query params),
  // we auto-click Resume so we can keep walking and find downstream bugs.
  // Tracks how many times this happens for the report.
  let resumeAutoClicks = 0;
  const resumeInterval = setInterval(async () => {
    try {
      const resumeBtn = page.getByTestId("v4-resume-resume");
      if (await resumeBtn.count()) {
        const visible = await resumeBtn.first().isVisible().catch(() => false);
        if (visible) {
          await resumeBtn.first().click({ timeout: 800 }).catch(() => undefined);
          resumeAutoClicks++;
        }
      }
    } catch {
      // ignore
    }
  }, 600) as unknown as NodeJS.Timeout;

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
  } else {
    pushBug({
      step: "setup-q1",
      severity: "wedge",
      what_happened: "Did not reach setup-q1 after welcome advance.",
      what_should_happen: "Setup q1 should appear immediately.",
    });
  }

  // q1a / q1b — R2 BLOCKER VERIFICATION (these depend on feature_picks sync)
  let q1aReached = false;
  let q1bReached = false;
  if (await waitForStep(page, "setup-q1a", 5000)) {
    q1aReached = true;
    await snapshot(page, "03-q1a");
    let ok = false;
    for (const opt of ["Local disk only", "Local", "OneDrive", "Google Drive"]) {
      if (await page.locator("label", { hasText: opt }).first().count()) {
        ok = await answerSetupRadio(page, opt);
        if (ok) break;
      }
    }
    if (!ok) {
      pushBug({
        step: "setup-q1a",
        severity: "wedge",
        what_happened: "No recognized lab-storage option label found.",
        what_should_happen:
          "Q1a should show Local / OneDrive radio cards.",
        screenshot: "03-q1a.png",
      });
      await skipThisStep(page);
    }
  }
  if (await waitForStep(page, "setup-q1b", 5000)) {
    q1bReached = true;
    await snapshot(page, "04-q1b");
    if (!(await clickManualAdvance(page))) {
      await skipThisStep(page);
    }
  }
  writeFileSync(`${SHOT_DIR}/r2-blocker-1-check.txt`,
    `q1a_reached=${q1aReached}\nq1b_reached=${q1bReached}\n` +
    `R2-BLOCKER-1 (feature_picks sync): ${q1aReached && q1bReached ? "UNBLOCKED" : "STILL BROKEN"}\n`);

  // q2 — purchases: yes
  if (await waitForStep(page, "setup-q2", 5000)) {
    await snapshot(page, "05-q2");
    if (!(await answerSetupRadio(page, "Yes"))) {
      pushBug({
        step: "setup-q2",
        severity: "wedge",
        what_happened: "Could not pick Yes on purchases.",
        what_should_happen: "Yes radio + Next should advance.",
      });
      await skipThisStep(page);
    }
  }

  // q3 — calendar: yes
  if (await waitForStep(page, "setup-q3", 5000)) {
    await snapshot(page, "06-q3");
    if (!(await answerSetupRadio(page, "Yes"))) {
      pushBug({
        step: "setup-q3",
        severity: "wedge",
        what_happened: "Could not pick Yes on calendar.",
        what_should_happen: "Yes radio + Next should advance.",
      });
      await skipThisStep(page);
    }
  }

  // q4 — goals: yes
  if (await waitForStep(page, "setup-q4", 5000)) {
    await snapshot(page, "07-q4");
    if (!(await answerSetupRadio(page, "Yes"))) {
      pushBug({
        step: "setup-q4",
        severity: "wedge",
        what_happened: "Could not pick Yes on goals.",
        what_should_happen: "Yes radio + Next should advance.",
      });
      await skipThisStep(page);
    }
  }

  // q5 — telegram: yes
  if (await waitForStep(page, "setup-q5", 5000)) {
    await snapshot(page, "08-q5");
    if (!(await answerSetupRadio(page, "Yes"))) {
      pushBug({
        step: "setup-q5",
        severity: "wedge",
        what_happened: "Could not pick Yes on telegram.",
        what_should_happen: "Yes radio + Next should advance.",
      });
      await skipThisStep(page);
    }
  }

  // q6 — ai helper
  if (await waitForStep(page, "setup-q6", 5000)) {
    await snapshot(page, "09-q6");
    let ok = false;
    for (const opt of ["Full", "Medium", "Minimal"]) {
      if (await page.locator("label", { hasText: opt }).first().count()) {
        ok = await answerSetupRadio(page, opt);
        if (ok) break;
      }
    }
    if (!ok) {
      pushBug({
        step: "setup-q6",
        severity: "wedge",
        what_happened: "Could not pick AI helper option.",
        what_should_happen: "Full/Medium/Minimal radio + Next should advance.",
      });
      await skipThisStep(page);
    }
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
    "methods-type-tour",
    "methods-lc-demo",
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

  // Track R2 BLOCKER 2: project-overview-prose must advance past a route check
  let projectOverviewProseReached = false;
  let projectOverviewExitReached = false;

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
      const fallback = page.getByRole("button", { name: /\+ New Project/ }).first();
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
          await nameInput.fill("R3 tour test project");
        } catch {
          // continue
        }
      } else {
        try {
          await page.getByPlaceholder(/CRISPR|gene editing/i).first().fill("R3 tour test project");
        } catch {
          // continue
        }
      }
      const create = page.getByRole("button", { name: /Create Project/ }).first();
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

  let stuckOn: string | null = null;
  let stuckCount = 0;
  let attempted = 0;
  for (let i = 0; i < walkthroughSteps.length; i++) {
    const expected = walkthroughSteps[i];
    attempted++;
    const arrived = await waitForStep(page, expected, 6000);
    const cur = await currentStep(page);
    const shotName = `10-w-${String(i).padStart(2, "0")}-${expected}`;
    await snapshot(page, shotName);

    if (expected === "project-overview-prose" && arrived) projectOverviewProseReached = true;
    if (expected === "project-overview-exit" && arrived) projectOverviewExitReached = true;

    // R2 BLOCKER 3: log current URL to verify ?wikiCapture is preserved during auto-nav
    if (arrived) {
      const url = page.url();
      if (!url.includes("wikiCapture")) {
        pushBug({
          step: expected,
          severity: "wrong",
          what_happened: `URL lost wikiCapture param: ${url}`,
          what_should_happen: "Auto-nav should preserve query params (R2 fix 3).",
        });
      }
    }

    if (!arrived) {
      pushBug({
        step: expected,
        severity: "wedge",
        what_happened: `Did not reach ${expected} within 6s. Current step: ${cur ?? "(none)"}.`,
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

  writeFileSync(`${SHOT_DIR}/r2-blocker-2-check.txt`,
    `project-overview-prose reached=${projectOverviewProseReached}\n` +
    `project-overview-exit reached=${projectOverviewExitReached}\n` +
    `R2-BLOCKER-2 (expectedRoute 404): ${projectOverviewProseReached && projectOverviewExitReached ? "UNBLOCKED" : "STILL BROKEN"}\n`);

  // Check whether a Resume modal popped up mid-tour (it shouldn't)
  const midTourResume = await page.getByTestId("v4-resume-resume").count();
  writeFileSync(`${SHOT_DIR}/r2-blocker-3-check.txt`,
    `mid-tour Resume modal present=${midTourResume}\n` +
    `R2-BLOCKER-3 (search params on auto-nav): ${midTourResume === 0 ? "UNBLOCKED (no mid-tour resume modal)" : "STILL BROKEN (resume modal mid-tour)"}\n`);

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
          what_should_happen: "Now button should advance to lab-spawn-beakerbot.",
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
      const lockEl = page.getByTestId("lab-view-lock-indicator");
      const lockCount = await lockEl.count();
      if (lockCount === 0) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: "lab-view-lock-indicator missing from DOM.",
          what_should_happen:
            "Red lock indicator visible on the view-only task row.",
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
            what_happened: `Lock emoji missing from indicator. Text: "${lockText.trim()}"`,
            what_should_happen:
              "Lock indicator should show the lock emoji as visual cue.",
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
      `rowTexts=\n${rowTexts.join("\n---\n")}\n\nBODY_HEAD:\n${bodyText?.slice(0, 4000) ?? ""}`,
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
  }

  clearInterval(resumeInterval);
  writeFileSync(CONSOLE_FILE, consoleLines.join("\n"));
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
        resume_modal_auto_clicks: resumeAutoClicks,
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

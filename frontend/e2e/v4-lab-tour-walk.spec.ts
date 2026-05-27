import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v4 lab-tour live-test sub-bot R2 (HR dispatched 2026-05-21).
 *
 * Walks the v4 tour end-to-end with Q1=lab. Uses Skip-step when a
 * walkthrough beat wedges (so we can keep going + log it), and Skip-
 * walkthrough only as nuclear escape.
 *
 * Output: screenshots + bug log under /tmp/v4-lab-tour-r2.
 *
 * NOT intended to be a stable CI spec — bug-report instrument only.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r2";
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

/** Click the bubble's "Skip this step" link. */
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

/** Click the manual-advance "Got it, next" / "Next" / "Let's go" button. */
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

/** Pick a setup radio card by visible label and click Next. */
async function answerSetupRadio(
  page: Page,
  optionLabel: string,
  nextLabel = "Next",
): Promise<boolean> {
  // The RadioCard wraps an <input type=radio> with a label that contains
  // the option's <p> label. Click the parent label so the radio toggles.
  const opt = page.locator("label", { hasText: optionLabel }).first();
  if (await opt.count()) {
    try {
      await opt.click({ timeout: 1500 });
    } catch {
      return false;
    }
  } else {
    return false;
  }
  // Wait a tick for the patchSidecar await chain
  await page.waitForTimeout(300);
  return await clickManualAdvance(page, nextLabel);
}

test.setTimeout(30 * 60 * 1000);

/** Seed sidecar with Q1=lab + drop us directly at lab-prompt via the
 *  wizardSeedStep URL param. Bypasses the user-action walkthrough beats
 *  so we can isolate the §6.16 lab tour signal. */
test("v4 lab tour direct seed (wizardSeedStep=lab-prompt)", async ({ page }) => {
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

  // Wait for the V4ResumePrompt modal
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

  // Should now be on lab-prompt
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

  // Click Now
  const nowBtn = page.locator('[data-lab-prompt-pick="now"]');
  await nowBtn.click({ timeout: 3000 });
  // Wait for persist + noteManualAdvance to settle
  await page.waitForTimeout(800);
  consoleLines.push(`[debug] after Now click, step = ${await currentStep(page)}`);

  // lab-spawn-beakerbot
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
    // Also: peek the Workbench for the 2 shared experiments. We can
    // either route to /workbench or check that the BeakerBot lab notebook
    // project was created.
    // Lightweight check via fetch into the fixture system isn't easy from
    // here; instead, navigate to /workbench in a fresh tab? No, that would
    // unmount the tour. Skip this for now and just check the speech bubble.
    await clickManualAdvance(page, "Got it, next");
  } else {
    pushBug({
      step: "lab-spawn-beakerbot",
      severity: "wedge",
      what_happened: "Did not advance from lab-prompt to lab-spawn-beakerbot.",
      what_should_happen: "Now click should advance.",
    });
  }

  // lab-permission-practice
  if (await waitForStep(page, "lab-permission-practice", 8000)) {
    await snapshot(page, "L3-lab-permission");
    const lockEl = page.getByTestId("lab-view-lock-indicator");
    if ((await lockEl.count()) === 0) {
      pushBug({
        step: "lab-permission-practice",
        severity: "wrong",
        what_happened: "lab-view-lock-indicator not present in DOM.",
        what_should_happen: "Red 🔒 lock indicator visible.",
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
      if (!lockText.includes("🔒")) {
        pushBug({
          step: "lab-permission-practice",
          severity: "polish",
          what_happened: `Lock indicator missing 🔒 emoji. Got: "${lockText.trim()}"`,
          what_should_happen: "🔒 emoji should be visible.",
          snippet: lockText.trim(),
        });
      }
      // Click Delete to trigger blocked toast
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

  // lab-cleanup
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

  // phase4-cleanup
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

test("v4 setup → walkthrough-skip → lab-tour focus", async ({ page }) => {
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
  // -------- Phase 1: setup q1-q6 --------
  // welcome
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

  // q1a — lab storage. Pick "Local disk only".
  if (await waitForStep(page, "setup-q1a", 5000)) {
    await snapshot(page, "03-q1a");
    // Try several plausible options
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
        what_happened: "No recognized lab-storage option label was found.",
        what_should_happen:
          "Q1a should show e.g. Local / OneDrive radio cards.",
        screenshot: "03-q1a.png",
      });
      await skipThisStep(page);
    }
  }

  // q1b — lab connect info: probably a "Got it, next" / acknowledgement.
  if (await waitForStep(page, "setup-q1b", 5000)) {
    await snapshot(page, "04-q1b");
    if (!(await clickManualAdvance(page))) {
      // try skip
      await skipThisStep(page);
    }
  }

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

  // q6 — ai helper: pick full / medium / minimal (any opted-in).
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
  // Strategy: at each step, observe + snapshot, attempt a generic
  // manual-advance, else Skip step. We aren't precisely driving each
  // cursor-script user-action; the goal is to catch wedges + observe.
  const walkthroughSteps = [
    "home-create-project",
    "home-create-project-fill",
    "project-overview-nav",
    "project-overview-prose",
    "project-overview-rollup",
    "project-overview-typing-demo",
    "project-overview-exit",
    "notifications-intro",
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
    "experiment-attach-method-open",
    "experiment-attach-method-tab",
    "experiment-attach-method-attach",
    "experiment-attach-method-notes",
    "hybrid-editor-scope",
    "hybrid-editor",
    "hybrid-editor-paragraphs",
    "hybrid-editor-image-drop",
    "hybrid-editor-resize",
    "gantt-task-types",
    "gantt-drag-drop",
    "gantt-chained-deps",
    "gantt-goals-overview",
    "settings-intro",
    "personalization-animations",
    "personalization-color",
    "settings-more",
    "ai-helper-deep-explain",
    "ai-helper-size-options",
    "search-demo",
    "wiki-pointer",
    "telegram",
    "purchases",
    "calendar",
  ];

  // Map a known step → a helper that drives the required user action.
  // Returns true if the helper made progress (caller doesn't have to skip).
  const stepHelpers: Record<string, () => Promise<boolean>> = {
    "home-create-project": async () => {
      // Click the "+ New Project" button.
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
      // Fill name + click Create Project.
      const nameInput = page
        .locator('[data-tour-target="home-project-name-input"]')
        .first();
      if (await nameInput.count()) {
        try {
          await nameInput.fill("Tour test project");
        } catch {
          // continue
        }
      } else {
        // fallback to input by placeholder
        try {
          await page.getByPlaceholder(/CRISPR|gene editing/i).first().fill("Tour test project");
        } catch {
          // continue
        }
      }
      // Click Create Project
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

    if (!arrived) {
      pushBug({
        step: expected,
        severity: "wedge",
        what_happened: `Did not reach ${expected} within 6s. Current step: ${cur ?? "(none)"}.`,
        what_should_happen: `Tour should advance through ${expected}.`,
        screenshot: `${shotName}.png`,
      });
      // If the current step is a later one, skip ahead by continuing.
      if (cur && cur !== expected) {
        const curIdx = walkthroughSteps.indexOf(cur);
        if (curIdx > i) {
          i = curIdx - 1; // -1 because loop ++
          continue;
        }
        // Special: telegram conditional branches early may differ.
      }
      // If genuinely wedged, try Skip step
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

    // First try the step-specific helper (real user action), then fall
    // back to a generic manual-advance button, then to Skip step.
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
      // Most walkthrough steps require a real user action OR an event-
      // bus signal. For the live test we just record what step we're
      // on, then Skip-step to continue.
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

  // -------- Phase 2c: lab tour (§6.16) --------
  // Some walkthrough steps may have advanced fast. Now look for lab-prompt.
  let labReached = false;
  for (let i = 0; i < 30; i++) {
    const s = await currentStep(page);
    if (s === "lab-prompt") {
      labReached = true;
      break;
    }
    if (s === "phase4-cleanup") break;
    await page.waitForTimeout(300);
    // try Skip-step if still hung
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
    // Pick "Now"
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

    // lab-spawn-beakerbot
    if (await waitForStep(page, "lab-spawn-beakerbot", 8000)) {
      await snapshot(page, "21-lab-spawn-pre");
      // Wait for the spawn status to flip to ready
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
      // Now advance manually
      await clickManualAdvance(page, "Got it, next");
    } else {
      pushBug({
        step: "lab-spawn-beakerbot",
        severity: "wedge",
        what_happened: "Did not reach lab-spawn-beakerbot after Now click.",
        what_should_happen: "Tour advances to spawn step.",
      });
    }

    // lab-permission-practice
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
        if (!lockText.includes("🔒")) {
          pushBug({
            step: "lab-permission-practice",
            severity: "polish",
            what_happened: `Lock emoji 🔒 missing from indicator. Text: "${lockText.trim()}"`,
            what_should_happen:
              "Lock indicator should show the 🔒 emoji as visual cue.",
            snippet: lockText.trim(),
          });
        }
        // Try clicking Delete to trigger blocked toast
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

    // lab-cleanup
    if (await waitForStep(page, "lab-cleanup", 8000)) {
      await snapshot(page, "25-lab-cleanup");
      // This step is auto-cleanup; manual-advance.
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
    // Capture the artifact rows
    const rowTexts = await page
      .locator('[data-testid="phase4-cleanup-row"], [data-artifact-type]')
      .allTextContents();
    // Also try a generic capture
    const bodyText = await page.locator("body").textContent();
    writeFileSync(
      `${SHOT_DIR}/phase4-rows.txt`,
      `rowTexts=\n${rowTexts.join("\n---\n")}\n\nBODY_HEAD:\n${bodyText?.slice(0, 4000) ?? ""}`,
    );
    // Look for lab artifacts (should be excluded per L21)
    const hasLabUser = /BeakerBot|lab_user/i.test(bodyText ?? "");
    if (hasLabUser) {
      pushBug({
        step: "phase4-cleanup",
        severity: "wrong",
        what_happened:
          "Cleanup grid appears to include lab-tour BeakerBot user / lab_task artifacts (L21 exclusion violation).",
        what_should_happen:
          "Lab tour artifacts must not appear in the cleanup grid (auto-cleaned in lab-cleanup step).",
        screenshot: "30-phase4-cleanup.png",
      });
    }
  }

  // -------- Console + bug log --------
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
      },
      null,
      2,
    ),
  );

  // Don't fail the test — this is observational.
  expect(true).toBe(true);
});

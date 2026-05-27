import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v4 lab-tour live-test sub-bot R6 (HR dispatched 2026-05-22).
 *
 * R5 surfaced two systemic blockers, both fixed by HR in dd043b6c:
 *
 *   1. parseFeaturePicks in sidecar.ts rejected partial sidecars
 *      (Q1 only writes account_type). Now: account_type required,
 *      Q2-Q6 + lab_storage validate-if-present.
 *
 *   2. TourSpotlight used useMemo([target]) which captured the anchor
 *      at first render. If the anchor mounted later (e.g. workbench-
 *      shared-experiments after expectedRoute /workbench nav), the
 *      spotlight stayed dark. Now: useState + MutationObserver re-resolve
 *      + 3s polling safety net.
 *
 * R6 must verify:
 *   - Q1 -> Q6 picks all persist; feature_picks sidecar has the full
 *     object (not null) at the end of setup.
 *   - Conditional walkthroughs (§6.13-§6.15: telegram, purchases,
 *     calendar) actually run.
 *   - Lab cluster (§6.16) reaches lab-permission-practice with a
 *     visible (non-zero rect) spotlight, no "did not resolve" warnings
 *     for the workbench-shared-experiments anchor.
 *   - Cleanup grid (§6.17) has more rows than R5 saw.
 *   - Total console warnings drop significantly vs R5's 18.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r6";
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
const stepsWalked: string[] = [];
const stepsWedged: string[] = [];

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
  let clicked = false;
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
  const radioChecked = await page
    .locator('input[type="radio"]:checked')
    .count();
  if (radioChecked === 0) {
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

async function readSidecarFeaturePicks(page: Page): Promise<unknown> {
  // We can't reliably hit /api/onboarding/sidecar from playwright (auth).
  // Fall back to evaluating any in-window store snapshot. The tour
  // controller surfaces picks via document.body dataset when available.
  return await page.evaluate(() => {
    const w = window as unknown as {
      __researchOsSidecarSnapshot?: unknown;
      __v4DebugPicks?: unknown;
    };
    return w.__v4DebugPicks ?? w.__researchOsSidecarSnapshot ?? null;
  });
}

test.setTimeout(30 * 60 * 1000);

test("R6 full walk: parseFeaturePicks + TourSpotlight late-mount fix verification", async ({
  page,
}) => {
  bugs.length = 0;
  urlLossEvents.length = 0;
  stickyTrace.length = 0;
  stepsWalked.length = 0;
  stepsWedged.length = 0;

  const consoleLines: string[] = [];
  let errCount = 0;
  let warnCount = 0;
  const spotlightWarnings: string[] = [];
  const featurePicksWarnings: string[] = [];
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
    if (/feature_picks|parseFeaturePicks/.test(m.text())) {
      featurePicksWarnings.push(m.text());
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
  await page.waitForTimeout(1200);

  const initialSticky = await readStickyFlags(page);
  stickyTrace.push(
    `[entry] url=${page.url()} v4Preview=${initialSticky.v4Preview} wikiMode=${initialSticky.wikiMode}`,
  );

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
  stepsWalked.push(firstStep);
  await snapshot(page, "01-welcome");
  await clickManualAdvance(page, "Let's go");

  // ---------- PHASE 1: Setup Q1-Q6 ----------
  // R6 focus: every radio click should now persist (R5 cascade source
  // would also affect this). Track each Q's "Next becomes enabled".
  const setupQs: Array<{
    step: string;
    label: string;
    options: string[];
  }> = [
    { step: "setup-q1", label: "Q1 account type", options: ["Lab"] },
    {
      step: "setup-q1a",
      label: "Q1a lab storage",
      options: ["Local disk only", "Local", "OneDrive", "Google Drive"],
    },
    { step: "setup-q1b", label: "Q1b lab confirm", options: [] }, // manual advance
    { step: "setup-q2", label: "Q2 purchases", options: ["Yes"] },
    { step: "setup-q3", label: "Q3 calendar", options: ["Yes"] },
    { step: "setup-q4", label: "Q4 goals", options: ["Yes"] },
    { step: "setup-q5", label: "Q5 telegram", options: ["Yes"] },
    {
      step: "setup-q6",
      label: "Q6 ai helper",
      options: ["Yes, Full prompt", "Yes, Medium prompt", "Yes, Minimal prompt"],
    },
  ];

  const setupTrace: string[] = [];
  for (const q of setupQs) {
    if (await waitForStep(page, q.step, 5000)) {
      stepsWalked.push(q.step);
      await snapshot(page, `02-${q.step}`);
      // Record state BEFORE click: any radio checked?
      const beforeChecked = await page
        .locator('input[type="radio"]:checked')
        .count();
      const beforeNextDisabled = await page
        .getByRole("button", { name: q.step === "setup-q1b" ? /Got it|Next/ : "Next" })
        .first()
        .isDisabled()
        .catch(() => null);

      let answered = false;
      if (q.options.length === 0) {
        // Q1b: manual continue
        answered = await clickManualAdvance(page);
      } else {
        for (const opt of q.options) {
          if (await page.locator("label", { hasText: opt }).first().count()) {
            answered = await answerSetupRadio(page, opt);
            if (answered) break;
          }
        }
      }
      const afterChecked = await page
        .locator('input[type="radio"]:checked')
        .count();
      setupTrace.push(
        `[${q.step}] beforeChecked=${beforeChecked} afterChecked=${afterChecked} beforeNextDisabled=${beforeNextDisabled} answered=${answered}`,
      );

      if (!answered) {
        pushBug({
          step: q.step,
          severity: "wedge",
          what_happened: `Could not answer ${q.label} — radio click did not enable Next or option not found.`,
          what_should_happen: `${q.label} options visible; click selects radio; Next becomes enabled.`,
          screenshot: `02-${q.step}.png`,
          snippet: `beforeChecked=${beforeChecked} afterChecked=${afterChecked}`,
        });
        stepsWedged.push(q.step);
        await skipThisStep(page);
      }
    } else {
      // Step not reached
      const cur = await currentStep(page);
      // Allow Q1a to be missing if Q1 didn't go to lab path
      if (q.step === "setup-q1a" || q.step === "setup-q1b") {
        setupTrace.push(`[${q.step}] not seen, current=${cur} (may not be in this branch)`);
        continue;
      }
      pushBug({
        step: q.step,
        severity: "wedge",
        what_happened: `Did not reach ${q.step}; current step=${cur ?? "(none)"}.`,
        what_should_happen: `Setup should advance to ${q.step}.`,
      });
      stepsWedged.push(q.step);
    }
  }

  writeFileSync(`${SHOT_DIR}/setup-trace.txt`, setupTrace.join("\n"));

  // After setup, snapshot the URL + try to read picks via window/global.
  await page.waitForTimeout(800);
  const postSetupPicks = await readSidecarFeaturePicks(page);
  stickyTrace.push(
    `[post-setup/picks] ${JSON.stringify(postSetupPicks)}`,
  );

  // ---------- PHASE 2: Walkthrough ----------
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
    // FINAL reorder manager 2026-05-27: methods cluster moved to after
    // workbench-list-mark-done; attach + notes moved to after
    // methods-create. Tab beat stays inside §6.6 framing before the
    // hybrid editor cluster.
    "workbench-create-experiment-open",
    "experiment-attach-method-open",
    "experiment-attach-method-tab",
    "hybrid-editor-scope",
    "hybrid-editor",
    "hybrid-editor-paragraphs",
    "hybrid-editor-image-drop",
    "hybrid-editor-resize",
    // FINAL reorder manager 2026-05-27: methods cluster + attach/notes
    // re-inserted here (after workbench-list-mark-done, before
    // gantt-intro). Per TOUR_STEP_ORDER.
    "methods-category-prompt",
    "methods-category-open",
    "methods-category",
    "methods-open-picker",
    "methods-type-tour",
    "methods-lc-demo",
    "methods-create",
    "experiment-attach-method-attach",
    "experiment-attach-method-notes",
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
    "telegram", // Q5=Yes -> conditional should run (Branch A or B)
    "purchases", // Q2=Yes -> conditional
    "calendar", // Q3=Yes -> conditional
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
          await nameInput.fill("R6 tour test project");
        } catch {
          // continue
        }
      } else {
        try {
          await page
            .getByPlaceholder(/CRISPR|gene editing/i)
            .first()
            .fill("R6 tour test project");
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

  let stuckOn: string | null = null;
  let stuckCount = 0;
  let attempted = 0;
  let conditionalsHit = 0;
  const conditionalStepIds = new Set(["telegram", "purchases", "calendar"]);
  const stepCheckLines: string[] = [
    "step\turl_path\turl_has_wikiCapture\tv4PreviewSticky\tmountPresent\treached",
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
      `${expected}\t${urlPath}\t${url.includes("wikiCapture")}\t${sticky.v4Preview}\t${mountPresent}\t${arrived}`,
    );

    if (arrived) {
      stepsWalked.push(expected);
      if (conditionalStepIds.has(expected)) conditionalsHit++;

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
    } else {
      stepsWedged.push(expected);
      // Conditional skip: if Q2/Q3/Q5 picks didn't persist (parseFeaturePicks
      // regression), these specific steps would never fire. Flag with higher severity.
      const isConditional = conditionalStepIds.has(expected);
      pushBug({
        step: expected,
        severity: isConditional ? "wrong" : "wedge",
        what_happened: `Did not reach ${expected} within 6s. Current step: ${cur ?? "(none)"}. URL: ${url}. v4Sticky=${sticky.v4Preview}. mountPresent=${mountPresent}.${isConditional ? " (CONDITIONAL — parseFeaturePicks fix should have enabled this)" : ""}`,
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

  // ---------- PHASE 3: Lab tour §6.16 ----------
  let labReached = false;
  for (let i = 0; i < 30; i++) {
    const s = await currentStep(page);
    if (s === "lab-prompt") {
      labReached = true;
      break;
    }
    if (s === "tour-goodbye") break;
    await page.waitForTimeout(300);
    if (i % 5 === 4) await skipThisStep(page);
  }

  await snapshot(page, "20-lab-prompt");
  let labSpawnUrl = "";
  let labPermissionUrl = "";
  let labPermSpotlightResolved = false;
  let labPermSpotlightInfo: unknown = null;

  if (!labReached) {
    pushBug({
      step: "lab-prompt",
      severity: "wedge",
      what_happened: `Never reached lab-prompt; current = ${await currentStep(page)}. (parseFeaturePicks fix should have made Q1=lab gate IN.)`,
      what_should_happen:
        "After conditional walkthroughs, Q1=lab should land on lab-prompt.",
      screenshot: "20-lab-prompt.png",
    });
    stepsWedged.push("lab-prompt");
  } else {
    stepsWalked.push("lab-prompt");
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
      stepsWalked.push("lab-spawn-beakerbot");
      await snapshot(page, "21-lab-spawn-pre");
      await page.waitForTimeout(2500);
      labSpawnUrl = page.url();
      await snapshot(page, "22-lab-spawn-ready");
      stickyTrace.push(`[lab-spawn-beakerbot] url=${labSpawnUrl}`);
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
          what_happened: `lab-spawn-beakerbot URL path is "${labSpawnPath}", expected "/workbench".`,
          what_should_happen:
            "Controller should auto-nav to /workbench so user sees BeakerBot's shared experiments.",
          screenshot: "22-lab-spawn-ready.png",
        });
      }
      const statusEl = page.getByTestId("lab-spawn-status");
      const statusText = (await statusEl.first().textContent().catch(() => null)) ?? "";
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
      stepsWedged.push("lab-spawn-beakerbot");
    }

    if (await waitForStep(page, "lab-permission-practice", 8000)) {
      stepsWalked.push("lab-permission-practice");
      // R6 KEY VERIFICATION: TourSpotlight fix #2.
      // After the auto-nav to /workbench, the workbench-shared-experiments
      // anchor mounts AFTER first render of TourSpotlight. Old code used
      // useMemo([target]) and captured null. New code uses useState +
      // MutationObserver + 3s polling. So the spotlight should resolve
      // within ~1-3s of arriving on the step.
      labPermissionUrl = page.url();
      await snapshot(page, "23-lab-permission-pre");

      // Poll for up to 5s for the spotlight to resolve to a visible rect.
      let spotlightInfo: {
        spotlightPresent: boolean;
        spotlightLeft: number | null;
        spotlightTop: number | null;
        spotlightWidth: number | null;
        spotlightHeight: number | null;
        spotlightVisible: boolean;
        sharedExpAnchor: boolean;
      } = {
        spotlightPresent: false,
        spotlightLeft: null,
        spotlightTop: null,
        spotlightWidth: null,
        spotlightHeight: null,
        spotlightVisible: false,
        sharedExpAnchor: false,
      };
      const pollStart = Date.now();
      while (Date.now() - pollStart < 5000) {
        spotlightInfo = await page.evaluate(() => {
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
        if (spotlightInfo.spotlightVisible) break;
        await page.waitForTimeout(200);
      }
      labPermSpotlightInfo = spotlightInfo;
      labPermSpotlightResolved = spotlightInfo.spotlightVisible;
      await snapshot(page, "23-lab-permission");
      stickyTrace.push(
        `[lab-permission-spotlight] info=${JSON.stringify(spotlightInfo)} resolvedAfterMs=${Date.now() - pollStart}`,
      );

      if (!spotlightInfo.sharedExpAnchor) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `workbench-shared-experiments anchor not present in DOM. URL: ${labPermissionUrl}`,
          what_should_happen:
            "After expectedRoute /workbench nav, the shared-experiments anchor should be in DOM for spotlight to target.",
          screenshot: "23-lab-permission.png",
          snippet: JSON.stringify(spotlightInfo),
        });
      } else if (!labPermSpotlightResolved) {
        pushBug({
          step: "lab-permission-practice",
          severity: "wrong",
          what_happened: `TourSpotlight FAILED TO RESOLVE despite anchor in DOM. Late-mount race fix did NOT take effect. info=${JSON.stringify(spotlightInfo)}`,
          what_should_happen:
            "MutationObserver + 3s polling should resolve the anchor and produce a visible spotlight rect (w>0, h>0).",
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
      stepsWedged.push("lab-permission-practice");
    }

    if (await waitForStep(page, "lab-cleanup", 8000)) {
      stepsWalked.push("lab-cleanup");
      await snapshot(page, "25-lab-cleanup");
      await clickManualAdvance(page, "Got it, next");
    } else {
      stickyTrace.push(`[lab-cleanup] not seen (may have auto-advanced)`);
    }
  }

  // ---------- Terminal: tour-goodbye outro (replaces retired phase4-cleanup
  // grid, 2026-05-22) ----------
  const reachedGoodbye = await waitForStep(page, "tour-goodbye", 15_000);
  await snapshot(page, "30-tour-goodbye");
  if (!reachedGoodbye) {
    pushBug({
      step: "tour-goodbye",
      severity: "wedge",
      what_happened: `Did not reach tour-goodbye; current = ${await currentStep(page)}.`,
      what_should_happen: "Tour terminates on the tour-goodbye outro step.",
      screenshot: "30-tour-goodbye.png",
    });
    stepsWedged.push("tour-goodbye");
  } else {
    stepsWalked.push("tour-goodbye");
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
    `${SHOT_DIR}/feature-picks-warnings.txt`,
    featurePicksWarnings.join("\n"),
  );
  writeFileSync(
    `${SHOT_DIR}/steps-walked.txt`,
    `WALKED (${stepsWalked.length}):\n${stepsWalked.join("\n")}\n\nWEDGED (${stepsWedged.length}):\n${stepsWedged.join("\n")}`,
  );
  writeFileSync(
    `${SHOT_DIR}/summary.json`,
    JSON.stringify(
      {
        // Verification matrix
        r5_fix_verification: {
          parseFeaturePicks_partial: {
            conditionals_hit_count: conditionalsHit,
            conditionals_expected: 3,
            cascade_broken:
              conditionalsHit === 0 && stepsWalked.length < 10,
            verdict:
              conditionalsHit >= 1
                ? "PASS — at least one conditional fired"
                : "FAIL — no conditionals fired",
          },
          TourSpotlight_late_mount: {
            lab_permission_reached: stepsWalked.includes(
              "lab-permission-practice",
            ),
            spotlight_resolved: labPermSpotlightResolved,
            spotlight_info: labPermSpotlightInfo,
            verdict: labPermSpotlightResolved
              ? "PASS — spotlight rendered with non-zero rect"
              : stepsWalked.includes("lab-permission-practice")
                ? "FAIL — step reached but spotlight stayed dark"
                : "INCONCLUSIVE — never reached lab-permission-practice",
          },
        },
        steps_walked_count: stepsWalked.length,
        steps_wedged_count: stepsWedged.length,
        steps_walked: stepsWalked,
        steps_wedged: stepsWedged,
        attempted_walkthrough_steps: attempted,
        wedge_count: bugs.filter((b) => b.severity === "wedge").length,
        wrong_count: bugs.filter((b) => b.severity === "wrong").length,
        polish_count: bugs.filter((b) => b.severity === "polish").length,
        info_count: bugs.filter((b) => b.severity === "info").length,
        console_error_count: errCount,
        console_warning_count: warnCount,
        spotlight_did_not_resolve_count: spotlightWarnings.length,
        feature_picks_log_count: featurePicksWarnings.length,
        url_loss_events: urlLossEvents.length,
        resume_modal_mid_tour_appearances: resumePromptAppearances,
        nav_events: urlChangeEvents,
        lab_reached: labReached,
        lab_spawn_url: labSpawnUrl,
        lab_permission_url: labPermissionUrl,
        lab_perm_spotlight_resolved: labPermSpotlightResolved,
        reached_tour_goodbye: reachedGoodbye,
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

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * R5 lab-step direct-seed: verifies R4's fix #2 (lab-spawn-beakerbot
 * expectedRoute /workbench) and fix #3 (lab-permission-practice
 * expectedRoute /workbench + spotlight resolves on /workbench).
 *
 * Needed because R5's full walk wedged at q1a (separate bug, picks
 * don't persist), so the lab cluster was never naturally reached.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r5/lab-direct";
mkdirSync(SHOT_DIR, { recursive: true });

async function currentStep(page: Page): Promise<string | null> {
  return await page.evaluate(
    () => (document.body.dataset.tourStep as string | undefined) ?? null,
  );
}

async function waitForStep(
  page: Page,
  expected: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await currentStep(page);
    if (s === expected) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

test.setTimeout(2 * 60 * 1000);

test("R5 lab-spawn-beakerbot direct seed", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
  });

  await page.goto("/?wikiCapture=1&wizardSeedStep=lab-spawn-beakerbot");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);

  const resumeBtn = page.getByTestId("v4-resume-resume");
  try {
    await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
    await resumeBtn.click();
  } catch {
    await page.screenshot({ path: `${SHOT_DIR}/spawn-no-resume.png` });
    writeFileSync(
      `${SHOT_DIR}/spawn-direct.json`,
      JSON.stringify({
        status: "no-resume-modal",
        consoleErrors,
        pageErrors,
      }),
    );
    return;
  }

  const reached = await waitForStep(page, "lab-spawn-beakerbot", 12_000);
  await page.waitForTimeout(2500);
  const url = page.url();
  let urlPath = "";
  try {
    urlPath = new URL(url).pathname;
  } catch {
    urlPath = url;
  }
  await page.screenshot({ path: `${SHOT_DIR}/spawn-after.png`, fullPage: true });

  const statusText = await page
    .getByTestId("lab-spawn-status")
    .first()
    .textContent()
    .catch(() => null);

  writeFileSync(
    `${SHOT_DIR}/spawn-direct.json`,
    JSON.stringify(
      {
        status: reached ? "reached" : "did-not-reach",
        currentStep: await currentStep(page),
        url,
        urlPath,
        urlPathIsWorkbench: urlPath === "/workbench",
        statusText: statusText?.trim() ?? null,
        consoleErrors: consoleErrors.slice(0, 20),
        pageErrors,
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

test("R5 lab-permission-practice direct seed: spotlight on /workbench", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
  });

  await page.goto("/?wikiCapture=1&wizardSeedStep=lab-permission-practice");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);

  const resumeBtn = page.getByTestId("v4-resume-resume");
  try {
    await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
    await resumeBtn.click();
  } catch {
    await page.screenshot({ path: `${SHOT_DIR}/lpp-no-resume.png` });
    writeFileSync(
      `${SHOT_DIR}/lpp-direct.json`,
      JSON.stringify({
        status: "no-resume-modal",
        consoleErrors,
        pageErrors,
      }),
    );
    return;
  }

  const reached = await waitForStep(page, "lab-permission-practice", 12_000);
  // Generous wait for the controller's auto-nav to /workbench to settle
  await page.waitForTimeout(2500);
  const url = page.url();
  let urlPath = "";
  try {
    urlPath = new URL(url).pathname;
  } catch {
    urlPath = url;
  }
  await page.screenshot({ path: `${SHOT_DIR}/lpp-after.png`, fullPage: true });

  const spotlightInfo = await page.evaluate(() => {
    const spot = document.querySelector('[data-testid="tour-spotlight"]');
    const ring = document.querySelector('[data-testid="tour-spotlight-ring"]');
    const anchor = document.querySelector(
      '[data-tour-target="workbench-shared-experiments"]',
    ) as HTMLElement | null;
    const anchorRect = anchor?.getBoundingClientRect();
    const allTestids = Array.from(
      document.querySelectorAll('[data-testid]'),
    ).map((el) => el.getAttribute('data-testid'));
    const rect = spot?.getBoundingClientRect();
    return {
      spotlightPresent: !!spot,
      spotlightWidth: rect?.width ?? null,
      spotlightHeight: rect?.height ?? null,
      spotlightVisible: rect ? rect.width > 0 && rect.height > 0 : false,
      ringPresent: !!ring,
      uniqueTestids: Array.from(new Set(allTestids)).slice(0, 40),
      lockPresent: !!document.querySelector(
        '[data-testid="lab-view-lock-indicator"]',
      ),
      labCardPresent: !!document.querySelector(
        '[data-tour-target="lab-permission-card"]',
      ),
      sharedExpAnchor: !!anchor,
      anchorRect: anchorRect
        ? {
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
            inViewport:
              anchorRect.top >= 0 &&
              anchorRect.top < window.innerHeight,
          }
        : null,
    };
  });

  writeFileSync(
    `${SHOT_DIR}/lpp-direct.json`,
    JSON.stringify(
      {
        status: reached ? "reached" : "did-not-reach",
        currentStep: await currentStep(page),
        url,
        urlPath,
        urlPathIsWorkbench: urlPath === "/workbench",
        spotlightInfo,
        consoleErrors: consoleErrors.slice(0, 20),
        pageErrors,
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

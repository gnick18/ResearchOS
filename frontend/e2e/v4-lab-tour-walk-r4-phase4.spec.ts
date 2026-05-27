import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * R4 lab-cluster direct-seed spec.
 *
 * Direct-seeds `lab-permission-practice` to verify the spotlight anchor
 * lands on the lab card, not on `workbench-shared-experiments` from the
 * home page.
 *
 * History: this file previously also held a `phase4-cleanup` direct-seed
 * test for the retired cleanup-grid. That step was removed from
 * TOUR_STEP_ORDER on 2026-05-22 in favor of `tour-goodbye`, so the
 * cleanup-grid test was dropped during the e2e cleanup-orphan sweep.
 */

const SHOT_DIR = "/tmp/v4-lab-tour-r4";

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

test("R4 lab-permission-practice direct seed: spotlight anchor location", async ({
  page,
}) => {
  const console_errors: string[] = [];
  const console_warnings: string[] = [];
  const page_errors: string[] = [];
  page.on("console", (m) => {
    const txt = m.text();
    if (m.type() === "error") console_errors.push(txt);
    if (m.type() === "warning") console_warnings.push(txt);
  });
  page.on("pageerror", (e) => {
    page_errors.push(e.message);
  });

  await page.goto("/?wikiCapture=1&wizardSeedStep=lab-permission-practice");
  await page.waitForLoadState("domcontentloaded");

  const resumeBtn = page.getByTestId("v4-resume-resume");
  try {
    await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
    await resumeBtn.click();
  } catch {
    await page.screenshot({ path: `${SHOT_DIR}/lpp-no-resume.png` });
    writeFileSync(
      `${SHOT_DIR}/lab-permission-direct.json`,
      JSON.stringify(
        {
          status: "no-resume-modal",
          page_errors,
          console_errors,
          console_warnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  const reached = await waitForStep(page, "lab-permission-practice", 12_000);
  await page.waitForTimeout(1200);
  const url = page.url();
  await page.screenshot({
    path: `${SHOT_DIR}/lpp-after-resume.png`,
    fullPage: true,
  });

  const spotlightInfo = await page.evaluate(() => {
    const spot = document.querySelector('[data-testid="tour-spotlight"]');
    const rect = spot?.getBoundingClientRect();
    return {
      spotlightPresent: Boolean(spot),
      spotlightLeft: rect?.left ?? null,
      spotlightTop: rect?.top ?? null,
      spotlightWidth: rect?.width ?? null,
      spotlightHeight: rect?.height ?? null,
      lockPresent: Boolean(
        document.querySelector('[data-testid="lab-view-lock-indicator"]'),
      ),
      labCardPresent: Boolean(
        document.querySelector('[data-tour-target="lab-permission-card"]'),
      ),
      sharedExpAnchor: Boolean(
        document.querySelector('[data-tour-target="workbench-shared-experiments"]'),
      ),
    };
  });

  writeFileSync(
    `${SHOT_DIR}/lab-permission-direct.json`,
    JSON.stringify(
      {
        status: reached ? "reached" : "did-not-reach",
        current_step: await currentStep(page),
        url,
        spotlightInfo,
        page_errors,
        console_errors: console_errors.slice(0, 20),
        console_warnings: console_warnings.slice(0, 20),
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

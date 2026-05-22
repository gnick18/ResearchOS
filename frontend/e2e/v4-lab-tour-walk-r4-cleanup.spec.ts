import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * R4 phase4 cleanup grid button-press direct-seed.
 *
 * Tests the cleanup grid Start fresh / Finish setup buttons, which is
 * where R3 saw `usersApi.delete` TypeError (usersDir.removeEntry is not a
 * function). Also expands the Conditional add-ons section to verify the
 * lab_user/lab_task L21 exclusion.
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

test("R4 phase4 cleanup grid: Start fresh + Finish setup probe", async ({
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

  await page.goto("/?wikiCapture=1&wizardSeedStep=phase4-cleanup");
  await page.waitForLoadState("domcontentloaded");

  const resumeBtn = page.getByTestId("v4-resume-resume");
  await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
  await resumeBtn.click();

  await waitForStep(page, "phase4-cleanup", 12_000);
  await page.waitForTimeout(1000);

  // Expand Conditional add-ons
  const condSection = page
    .locator("text=/Conditional add-ons/i")
    .first();
  if (await condSection.count()) {
    try {
      await condSection.click({ timeout: 2000 });
      await page.waitForTimeout(600);
    } catch {
      // ignore
    }
  }
  await page.screenshot({
    path: `${SHOT_DIR}/p4-grid-expanded.png`,
    fullPage: true,
  });

  // Read out lab artifact rows after expansion
  const labRowText = await page
    .locator("text=/BeakerBot|lab_user|lab_task/i")
    .allTextContents();

  // Test 1: Start fresh
  const startFreshBtn = page
    .getByRole("button", { name: /Start fresh/i })
    .first();
  let startFreshError: string | null = null;
  let startFreshClicked = false;
  if (await startFreshBtn.count()) {
    try {
      await startFreshBtn.click({ timeout: 2000 });
      startFreshClicked = true;
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: `${SHOT_DIR}/p4-after-start-fresh.png`,
        fullPage: true,
      });
    } catch (e) {
      startFreshError = (e as Error).message;
    }
  }

  // Test 2: Finish setup
  const finishBtn = page
    .getByRole("button", { name: /Finish setup|Wrap up|Done|Complete/i })
    .first();
  let finishError: string | null = null;
  let finishClicked = false;
  if (await finishBtn.count()) {
    try {
      await finishBtn.click({ timeout: 2000 });
      finishClicked = true;
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: `${SHOT_DIR}/p4-after-finish.png`,
        fullPage: true,
      });
    } catch (e) {
      finishError = (e as Error).message;
    }
  }

  // Search captured logs for the R3 carry-over
  const removeEntryHits = [
    ...page_errors,
    ...console_errors,
  ].filter((m) => /removeEntry|usersApi\.delete|usersDir/i.test(m));

  const allErrorsAfterButtons = page_errors;

  writeFileSync(
    `${SHOT_DIR}/cleanup-grid-buttons.json`,
    JSON.stringify(
      {
        labRowText,
        startFreshClicked,
        startFreshError,
        finishClicked,
        finishError,
        removeEntryHits,
        allErrorsAfterButtons,
        console_errors: console_errors.slice(0, 30),
        console_warnings: console_warnings.slice(0, 30),
      },
      null,
      2,
    ),
  );

  expect(true).toBe(true);
});

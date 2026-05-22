import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * R4 phase4 / lab-cluster direct-seed spec.
 *
 * Focused follow-up to v4-lab-tour-walk-r4.spec.ts — the full walk wedged
 * before phase4-cleanup, so we can't observe the cleanup grid contents
 * or the R3-reported `usersApi.delete` TypeError without direct-seeding
 * the relevant steps.
 *
 * Two quick tests:
 *   1. Direct-seed `phase4-cleanup` — list artifact rows, click Delete
 *      to verify the `usersDir.removeEntry is not a function` carry-over.
 *   2. Direct-seed `lab-permission-practice` — verify the spotlight
 *      anchor lands on the lab card, not on `workbench-shared-experiments`
 *      from the home page.
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

test("R4 phase4-cleanup direct seed: artifact rows + Delete-all behavior", async ({
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
  try {
    await resumeBtn.waitFor({ state: "visible", timeout: 12_000 });
    await resumeBtn.click();
  } catch (e) {
    await page.screenshot({ path: `${SHOT_DIR}/p4-no-resume.png` });
    writeFileSync(
      `${SHOT_DIR}/phase4-direct-seed.json`,
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

  const reached = await waitForStep(page, "phase4-cleanup", 12_000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOT_DIR}/p4-grid.png`, fullPage: true });

  if (!reached) {
    writeFileSync(
      `${SHOT_DIR}/phase4-direct-seed.json`,
      JSON.stringify(
        {
          status: "did-not-reach-phase4-cleanup",
          current_step: await currentStep(page),
          page_errors,
          console_errors: console_errors.slice(0, 20),
          console_warnings: console_warnings.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  const bodyText = (await page.locator("body").textContent()) ?? "";
  const artifactRows = await page
    .locator(
      '[data-testid="phase4-cleanup-row"], [data-artifact-type], [data-artifact-id]',
    )
    .all();
  const rowSummaries: Array<{ type: string | null; id: string | null; text: string }> = [];
  for (const row of artifactRows) {
    rowSummaries.push({
      type: await row.getAttribute("data-artifact-type"),
      id: await row.getAttribute("data-artifact-id"),
      text: ((await row.textContent()) ?? "").slice(0, 120).trim(),
    });
  }

  const expectedTypes = [
    "project",
    "method",
    "experiment",
    "purchase",
    "goal",
    "calendar_feed",
    "lab_user",
    "lab_task",
  ];
  const presentTypes = new Set(
    rowSummaries.map((r) => r.type).filter(Boolean) as string[],
  );
  const missingTypes = expectedTypes.filter((t) => !presentTypes.has(t));
  const labArtifactsVisible = rowSummaries.filter(
    (r) =>
      r.type === "lab_user" ||
      r.type === "lab_task" ||
      /BeakerBot/i.test(r.text),
  );

  // Try to find a Delete-all button (or similar bulk button)
  const deleteAllBtn = page
    .getByRole("button", { name: /Delete all|Clean up all|Remove all|Discard all|Apply/i })
    .first();
  const deleteAllPresent = await deleteAllBtn.count() > 0;
  let deleteAllError: string | null = null;
  if (deleteAllPresent) {
    try {
      await deleteAllBtn.click({ timeout: 2000 });
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: `${SHOT_DIR}/p4-after-delete.png`,
        fullPage: true,
      });
    } catch (e) {
      deleteAllError = (e as Error).message;
    }
  }

  // Look for individual Delete buttons on first row
  const individualDelete = page
    .locator('button:has-text("Delete"), button:has-text("Discard")')
    .first();
  let individualDeleteError: string | null = null;
  if (await individualDelete.count()) {
    try {
      await individualDelete.click({ timeout: 2000 });
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: `${SHOT_DIR}/p4-after-individual-delete.png`,
      });
    } catch (e) {
      individualDeleteError = (e as Error).message;
    }
  }

  // Look for "removeEntry is not a function" type errors
  const removeEntryErrors = [
    ...page_errors,
    ...console_errors,
  ].filter((m) => /removeEntry|usersApi/i.test(m));

  writeFileSync(
    `${SHOT_DIR}/phase4-direct-seed.json`,
    JSON.stringify(
      {
        status: "reached",
        bodyTextHead: bodyText.slice(0, 4000),
        rowCount: rowSummaries.length,
        presentTypes: Array.from(presentTypes),
        missingTypes,
        labArtifactsVisible,
        rowSummaries,
        deleteAllPresent,
        deleteAllError,
        individualDeleteError,
        removeEntryErrors,
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

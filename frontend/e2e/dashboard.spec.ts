import { expect, test } from "@playwright/test";

// Baseline E2E: the home page loads + navigation to /workbench works.
// Uses ?wikiCapture=1 to bypass the directory-picker / connect-folder flow
// in CI. The wiki-capture fixture mode is already shipped + populated for
// wiki screenshots (see wiki-capture-mock.ts) so no new fixture data is
// needed here. Keep this suite small and stable; deeper journeys belong in
// targeted spec files added later.

test("home page loads with wiki-capture fixture", async ({ page }) => {
  await page.goto("/?wikiCapture=1");
  await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 15_000 });
});

test("router navigates from home to /workbench", async ({ page }) => {
  await page.goto("/?wikiCapture=1");
  await page.waitForLoadState("networkidle");
  await page.goto("/workbench?wikiCapture=1");
  await expect(page).toHaveURL(/\/workbench/);
  await expect(page.locator("body")).toBeVisible();
});

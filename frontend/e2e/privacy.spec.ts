import { expect, test, type Page } from "@playwright/test";

/**
 * PRIVACY end-to-end spec — read-side sharing gate, asserted through the
 * REAL rendered UI (not unit-level helpers).
 *
 * Why this exists: ResearchOS is local-first and multi-user, and the
 * read-side privacy logic (what records a given user can SEE) is the
 * highest-stakes correctness surface in the app. A recent bug — a user
 * wrongly missing from the share dialog's candidate dropdown — slipped
 * past unit tests because nothing asserted the dropdown's CONTENTS through
 * a real browser. These tests close that gap.
 *
 * Fixture: the same `?wikiCapture=1` in-memory fixture used by
 * `dashboard.spec.ts` and the wiki-screenshot capture path. It seeds a
 * multi-user demo lab. The exact seeded sharing state these assertions
 * rely on (verified against `src/lib/file-system/wiki-capture-fixture.ts`):
 *
 *   Users (from `users/_user_metadata.json` + per-user dirs):
 *     - alex   — member, the DEFAULT fixture user (`?wikiCapture=1`)
 *     - morgan — member
 *     - mira   — lab_head (PI)
 *     - sam    — member, ARCHIVED (`_onboarding.json` archived:true)
 *
 *   Sharing facts (the read-side gate under test):
 *     - alex's `_shared_with_me.json` grants alex:
 *         * morgan's PROJECT 1 (view)  → surfaces morgan's project-1 tasks
 *         * morgan's TASK 3 (edit)     → individual share
 *         * morgan's TASK 9 (view)     → individual share
 *     - morgan's PROJECT 2 is NOT shared with alex. Its tasks (e.g.
 *       morgan task 4 "Draft Chapter 2 outline") must be INVISIBLE to alex.
 *     - morgan has NO `_shared_with_me.json` → morgan sees zero shared-in
 *       records, so none of alex's private tasks may appear in morgan's view.
 *
 *   Share-dialog candidate rules (`ShareDialog.tsx` → `eligibleUsers`):
 *     candidates = all lab users  minus owner  minus archived  minus
 *     already-shared. So for owner=alex the "Pick a user" dropdown must
 *     list @mira and @morgan but NEVER @sam (archived) and never @alex.
 *
 * Active-user switching: the fixture's install guard (`installed` flag in
 * wiki-capture-mock) is module-scoped and only seeds `currentUser` on the
 * FIRST install per browser context, so a mid-session user switch is not
 * drivable in fixture mode. Each Playwright test gets a fresh, isolated
 * context, so we instead drive each user as a SEPARATE test via the
 * `?fixtureUser=<name>` URL override and assert the per-user views directly
 * (which is the stronger guarantee anyway).
 *
 * House rule: a test failure here that reveals a real cross-user leak is a
 * FINDING to report, never something to relax. These assertions encode the
 * CORRECT behavior.
 */

// Seeded task names we key assertions on. Kept as constants so a fixture
// rename surfaces as one obvious edit instead of scattered string drift.
const ALEX_OWN_TASK = "Design pYES-GAL1::flbA construct"; // alex task 1
const MORGAN_SHARED_TASK = "Plate FY-Δgal80 transformants on 96-well"; // morgan task 1, project 1 (shared with alex via project share)
const MORGAN_SHARED_INDIVIDUAL = "qPCR setup — verify GFP transcripts"; // morgan task 3 (individually shared with alex)
const MORGAN_PRIVATE_TASK = "Draft Chapter 2 outline"; // morgan task 4, project 2 (NOT shared with alex)

// EXPERIMENT-type tasks each user OWNS. The Share button in TaskDetailPopup
// only renders for experiment-style popups (the list-task popup variant has no
// share button), so the share-dialog tests must open an experiment, not a list
// task. These are owned-by-the-current-user experiments so the Share button is
// present (it is hidden for shared-in tasks).
const ALEX_OWN_EXPERIMENT = "Yeast transformation: pYES-GAL1::flbA"; // alex task 2 (experiment, owner alex)
const MORGAN_OWN_EXPERIMENT = MORGAN_SHARED_TASK; // morgan task 1 (experiment, owner morgan)

/**
 * Wait for the fixture-mode app to finish booting. On a fresh navigation the
 * FileSystemProvider shows a "Loading ResearchOS" splash while it installs the
 * in-memory fixture (which does a few HTTP fetches for demo assets) and
 * hydrates the active user. We wait for that splash to detach before driving
 * any page chrome. Generous timeout absorbs a cold dev-server route compile.
 */
async function waitForAppReady(page: Page): Promise<void> {
  // NOTE: we deliberately do NOT wait for "networkidle" — a Next.js dev server
  // holds an open HMR channel, so the network never goes idle and that wait
  // would hang. Waiting for the boot splash to detach is the reliable signal
  // that the fixture is installed and the active user is hydrated.
  await expect(
    page.getByRole("heading", { name: "Loading ResearchOS" }),
  ).toHaveCount(0, { timeout: 60_000 });
}

/**
 * Run the Search page's empty-keyword query, which renders a card (with an
 * `<h4>` task name) for every task the current user can SEE via the canonical
 * `fetchAllTasksIncludingShared` merged-view loader. An empty keyword set
 * matches all visible tasks, making this the cleanest read-side privacy gate:
 * a leaked record would render a card; a correctly-hidden record renders none.
 *
 * Assumes the caller has already navigated to `/search?wikiCapture=1[...]`
 * (so the active fixture user is whatever that navigation pinned). This helper
 * does NOT re-navigate, to avoid dropping a `?fixtureUser=` override.
 */
async function runEmptySearch(page: Page): Promise<void> {
  await waitForAppReady(page);
  // The search input carries data-tour-target="search-input"; submit button
  // carries data-tour-target="search-submit". Leave keywords empty so the
  // result set is "everything this user can see."
  const submit = page.locator('[data-tour-target="search-submit"]');
  await submit.waitFor({ state: "visible", timeout: 30_000 });
  await submit.click();
  // Results header ("N results found") renders once a search has run.
  await expect(page.getByText(/result(s)? found/i)).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("read-side sharing gate (real UI)", () => {
  test.setTimeout(120_000);

  test("alex SEES records shared with her and does NOT see morgan's private project-2 task", async ({
    page,
  }) => {
    // Default fixture user is alex (`?wikiCapture=1`).
    await page.goto("/search?wikiCapture=1", { waitUntil: "domcontentloaded" });
    await runEmptySearch(page);

    // Positive: a record morgan shared WITH alex must be visible.
    //   - morgan project 1 is shared (view) → morgan's project-1 tasks surface
    //   - morgan task 3 is individually shared (edit)
    await expect(
      page.getByRole("heading", { name: MORGAN_SHARED_TASK }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: MORGAN_SHARED_INDIVIDUAL }),
    ).toBeVisible();

    // Sanity: alex's own task is obviously visible (rules out an
    // empty-result false-pass).
    await expect(
      page.getByRole("heading", { name: ALEX_OWN_TASK }),
    ).toBeVisible();

    // CROSS-USER LEAK GUARD: morgan's project-2 task is NOT shared with
    // alex in any form (no individual share, project 2 not shared). It must
    // be ABSENT from alex's view. A visible card here is a real privacy leak.
    await expect(
      page.getByRole("heading", { name: MORGAN_PRIVATE_TASK }),
    ).toHaveCount(0);
  });

  test("morgan does NOT see alex's private records (no _shared_with_me manifest)", async ({
    page,
  }) => {
    // morgan has no `_shared_with_me.json`, so morgan's visible set is
    // exactly morgan's own records. None of alex's private tasks may leak in.
    await page.goto("/search?wikiCapture=1&fixtureUser=morgan", {
      waitUntil: "domcontentloaded",
    });
    await runEmptySearch(page);

    // Positive: morgan sees her own task (rules out empty-result false-pass).
    await expect(
      page.getByRole("heading", { name: MORGAN_SHARED_TASK }),
    ).toBeVisible({ timeout: 10_000 });

    // CROSS-USER LEAK GUARD: alex's private task must be absent from
    // morgan's view.
    await expect(
      page.getByRole("heading", { name: ALEX_OWN_TASK }),
    ).toHaveCount(0);
  });
});

test.describe("share dialog candidate dropdown (the class of bug that shipped)", () => {
  test.setTimeout(120_000);

  /**
   * Open the unified Share dialog through the REAL UI: search → click an
   * EXPERIMENT card the current user OWNS → click the share button → return
   * the candidate `<select>` (data-tour-target="share-dialog-user-row").
   *
   * Notes on why this is shaped the way it is:
   *  - The Share button (`task-popup-share-button`) only renders for owned,
   *    experiment-style task popups: `!readOnly && !task.is_shared_with_me`.
   *    The LIST-task popup variant has no share button, so we must open an
   *    experiment, not a list task.
   *  - `ShareDialog` loads its candidate users asynchronously (`usersApi.list`
   *    fires in a useEffect on open), so we wait until the select has at least
   *    one real `@user` option before reading.
   */
  async function readShareCandidates(
    page: Page,
    ownExperimentName: string,
  ): Promise<string[]> {
    await runEmptySearch(page);
    const card = page
      .getByRole("heading", { name: ownExperimentName, level: 4 })
      .first();
    await card.waitFor({ state: "visible", timeout: 10_000 });
    await card.click();

    const shareBtn = page.locator(
      '[data-tour-target="task-popup-share-button"]',
    );
    await shareBtn.waitFor({ state: "visible", timeout: 10_000 });
    await shareBtn.click();

    const userSelect = page.locator(
      '[data-tour-target="share-dialog-user-row"]',
    );
    await userSelect.waitFor({ state: "visible", timeout: 10_000 });
    // Wait for the async user load to populate at least one real candidate
    // (option labels render as `@<username>`; the placeholder is "Pick a
    // user…").
    await expect
      .poll(
        async () =>
          (await userSelect.locator("option").allTextContents()).filter((t) =>
            t.trim().startsWith("@"),
          ).length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    return (await userSelect.locator("option").allTextContents())
      .map((t) => t.trim())
      .filter((t) => t.startsWith("@"));
  }

  // TODO(sharing): un-skip once the wikiCapture fixture seeds a sharing identity.
  // These two assert the Share dialog's candidate list, but the Share button is
  // gated on canShare (a "ready" sharing identity = a wrapped-keypair sidecar
  // users/<user>/_sharing_identity.json + the device's unlocked private key).
  // The fixture seeds users + shared records but NOT an identity, so on a fresh
  // environment (CI) the button never appears and readShareCandidates times out.
  // They only ever passed locally on a browser that already had a real identity
  // saved. Fix = seed a fake-but-valid identity for alex/morgan in the fixture
  // (sharing lane), then drop these .skip calls. The read-side gate test above
  // does NOT need an identity and stays active. Tracked separately.
  test.skip("alex's share dialog offers the live members and never the owner", async ({
    page,
  }) => {
    await page.goto("/search?wikiCapture=1", { waitUntil: "domcontentloaded" });
    const candidates = await readShareCandidates(page, ALEX_OWN_EXPERIMENT);

    // The bug that SHIPPED was a live member wrongly MISSING from this list.
    // These hard assertions guard against that regression: mira (PI) and
    // morgan are active members and must be offerable.
    expect(candidates).toContain("@mira");
    expect(candidates).toContain("@morgan");
    // The owner is never offered as a share target.
    expect(candidates).not.toContain("@alex");

    // sam is an ARCHIVED user (`users/sam/_onboarding.json` archived:true) and
    // ShareDialog's `eligibleUsers` filters archived members, so @sam must
    // NEVER be offered as a share candidate. This was previously a soft-
    // asserted KNOWN FIXTURE BUG: the demo `_user_metadata.json` ships as a
    // FLAT map `{alex:{…},…}` and `readMetadataFile()` returned `{}` for any
    // shape lacking the `{ users: {…} }` wrapper, so `readAllUserMetadata()` →
    // `useArchivedUsers()` resolved to an EMPTY set in demo/fixture mode and
    // the archived filter no-opped. `readMetadataFile()` is now tolerant of
    // the flat legacy map (treats it AS the users map), so the filter works
    // and this is a HARD assertion.
    expect(candidates).not.toContain("@sam");
  });

  // TODO(sharing): un-skip with the alex case above (same seeded-identity gap).
  test.skip("morgan's share dialog offers the live members and never the owner", async ({
    page,
  }) => {
    await page.goto("/search?wikiCapture=1&fixtureUser=morgan", {
      waitUntil: "domcontentloaded",
    });
    const candidates = await readShareCandidates(page, MORGAN_OWN_EXPERIMENT);

    // Live members must be offerable (the wrongly-missing-user guard).
    expect(candidates).toContain("@alex");
    expect(candidates).toContain("@mira");
    // The owner is never offered.
    expect(candidates).not.toContain("@morgan");

    // Archived @sam must never be offered (same archived-filter guarantee as
    // the alex case above; see that comment for the fixture-shape history).
    expect(candidates).not.toContain("@sam");
  });
});

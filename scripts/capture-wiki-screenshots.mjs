#!/usr/bin/env node
/**
 * Capture every wiki screenshot against a running dev server.
 *
 * Usage:
 *   # 1. Start the dev server in another terminal
 *   cd frontend && npm run dev
 *
 *   # 2. Run this script
 *   cd frontend && npm run wiki:screenshots
 *   # or directly: node scripts/capture-wiki-screenshots.mjs
 *
 * What it captures:
 *   - The folder-connect screen at / (no folder connected, fresh context)
 *   - Every /wiki/* page (renders without auth)
 *   - Every in-app feature page (loaded via ?wikiCapture=1 which seeds
 *     the FileService with the fixture in wiki-capture-fixture.ts)
 *   - The Telegram pairing modal and Manage Feeds modal (clicked into)
 *
 * Output: frontend/public/wiki/screenshots/<name>.png
 *
 * Requirements:
 *   - playwright (devDependency)
 *   - chromium browser: `npx playwright install chromium`
 *
 * Notes:
 *   - Captures at 1440x900 viewport, 2x deviceScaleFactor (Retina-crisp).
 *   - Hides dev/beta UI (Test Notification, Test Error, Report Bug, Beta
 *     donation widget) before each shot so docs look clean.
 *   - The fixture mode is dev-only — guarded by NODE_ENV inside the app.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Playwright is a devDep of `frontend/`, not of the repo root. Resolve it via
// a require anchored to frontend/package.json so the script works whether you
// run it from the repo root or from inside frontend/.
const requireFromFrontend = createRequire(
  path.join(REPO_ROOT, "frontend", "package.json"),
);
const { chromium } = requireFromFrontend("playwright");

const OUT_DIR = path.join(REPO_ROOT, "frontend", "public", "wiki", "screenshots");
const BASE_URL = process.env.WIKI_CAPTURE_BASE_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

/** Public, no-auth routes (fresh browser context). */
const PUBLIC_ROUTES = [
  // The folder-connect screen at / (the only public-route screenshot referenced
  // by the wiki). The wiki pages themselves are validated by `next build` and
  // don't need screenshot snapshots in /public.
  {
    path: "/",
    file: "folder-connect.png",
    waitFor: "text=Connect Folder",
    highlight: { text: "Link Folder" },
  },
];

/** Picker-mode route: fixture is installed but no currentUser is set, so
 *  ResearchFolderSetupNew renders the user-picker list. Uses its own fresh
 *  browser context so IndexedDB state doesn't carry over from signed-in
 *  captures. */
const PICKER_ROUTES = [
  {
    path: "/",
    file: "user-login.png",
    captureVariant: "picker",
    waitFor:
      "text=Select Account, text=Create New Account, text=Pick a user, text=Continue",
    highlight: { selector: "input[placeholder*='username' i]" },
  },
];

/** Action helpers shared by experiment-popup screenshots. */

// Tasks marked complete are collapsed under a "Show N completed
// experiments" disclosure by default. Expand it (if present) and click
// the matching tile to open the task popup. Returns true if the popup
// likely opened.
async function revealCompletedAndOpenTask(page, taskNameRegex) {
  try {
    // Toggle on completed experiments. Idempotent — clicking twice toggles
    // it back off, so only click when the label still says "Show".
    const disclosure = page
      .locator("button")
      .filter({ hasText: /^Show \d+ completed experiment/i })
      .first();
    if (await disclosure.count()) {
      await disclosure.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
  } catch {}
  try {
    const tile = page.getByText(taskNameRegex).first();
    if (!(await tile.count())) return false;
    await tile.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await tile.click({ timeout: 3000 });
    await page.waitForTimeout(1000);
    return true;
  } catch (err) {
    console.warn(`  ⚠ open-task action: ${err.message}`);
    return false;
  }
}

// Click the Lab Notes tab inside an open TaskDetailPopup.
async function openLabNotesTab(page) {
  try {
    const tab = page
      .locator("button")
      .filter({ hasText: /^Lab Notes$/ })
      .first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 });
      await page.waitForTimeout(700);
    }
  } catch {}
}

// Click one of the Lab Mode top-level tabs ("Activity", "GANTT",
// "Experiments", etc.). The buttons live in a tab strip inside the lab
// header and contain the label as visible text. Match by exact text so
// we don't accidentally hit a sidebar item with a similar word.
async function switchLabTab(page, label) {
  try {
    const tab = page
      .locator("button")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 });
      await page.waitForTimeout(900);
    }
  } catch (err) {
    console.warn(`  ⚠ switchLabTab(${label}): ${err.message}`);
  }
}

// Switch the markdown editor's three-way mode toggle to "Edit", "Hybrid",
// or "Preview". The buttons are <button>Edit</button> etc inside a small
// segmented control; match the exact text so we don't catch the page's
// main "Edit" button or similar.
async function switchEditorMode(page, label) {
  try {
    const btn = page
      .locator("button")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .last();
    if (await btn.count()) {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
  } catch {}
}

/** Routes that need the fixture mode (?wikiCapture=1) so realistic data
 *  renders. Each can specify a post-load action (e.g. click a button to
 *  open a modal). */
const FIXTURE_ROUTES = [
  {
    path: "/",
    file: "home-projects.png",
    waitFor: "text=Research Project Overview",
    highlight: { text: "New Project" },
  },
  {
    path: "/",
    file: "home-project-popup.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      // The same project name appears in the left sidebar too — scope the
      // click to the project card's <h3> so we open the project popup
      // rather than a sidebar task entry.
      const heading = page
        .locator("h3")
        .filter({ hasText: /^DEMO:\s*Engineer FakeYeast for biofuel$/ })
        .first();
      if (await heading.count()) {
        try {
          await heading.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        } catch {}
      }
    },
  },
  {
    path: "/gantt",
    file: "gantt-overview.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    highlight: { text: "+ Task" },
  },
  {
    path: "/gantt",
    file: "gantt-zoom-controls.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    crop: { x: 0, y: 0, width: 1440, height: 220 },
    highlight: { text: "3M" },
  },
  {
    path: "/gantt",
    file: "gantt-task-popup.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    action: async (page) => {
      // Task 2 (start 2026-05-08) sits 5 days before the fixture's
      // "today" (2026-05-13). The default 2-week window anchors at the
      // current Monday so the bar is off-screen to the left. Push the
      // anchor date back to the prior Monday (2026-05-04) so the bar
      // renders inside the viewport, then click the task label.
      try {
        const dateInput = page.locator('input[type="date"]').first();
        if (await dateInput.count()) {
          await dateInput.fill("2026-05-04", { timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch {}
      try {
        const allBtn = page
          .locator("button")
          .filter({ hasText: /^1M$/ })
          .first();
        if (await allBtn.count()) {
          await allBtn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch {}
      const target = page
        .getByText(/Yeast transformation:\s*pYES-GAL1::flbA/i)
        .first();
      if (await target.count()) {
        try {
          await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await target.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        } catch {}
      }
    },
  },
  {
    path: "/experiments",
    file: "experiments-list.png",
    waitFor: "h1, h2, text=Lab Notes",
    highlight: { text: "New Experiment" },
  },
  {
    path: "/experiments",
    file: "experiments-editor.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      );
    },
  },
  {
    path: "/experiments",
    file: "editor-language-picker.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      try {
        await openLabNotesTab(page);
        await switchEditorMode(page, "Edit");
        const ta = page.locator("textarea").first();
        if (!(await ta.count())) return;
        await ta.click({ timeout: 3000 });
        // Jump to the bottom of the body and create a fresh empty line.
        await page.keyboard.press("Control+End").catch(() => {});
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.keyboard.type("```", { delay: 80 });
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`  ⚠ editor-language-picker action: ${err.message}`);
      }
    },
    highlight: { selector: "input[placeholder*='Search language' i]" },
  },
  {
    path: "/experiments",
    file: "editor-hybrid-selected.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      try {
        await openLabNotesTab(page);
        // Hybrid is the default mode. Click a paragraph block from the
        // seeded body so the blue ring + inline Edit/Delete buttons appear.
        const block = page.getByText(/Plated on SD-Ura/i).first();
        if (await block.count()) {
          await block.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await block.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(`  ⚠ editor-hybrid-selected action: ${err.message}`);
      }
    },
  },
  {
    path: "/experiments",
    file: "editor-image-resize.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      try {
        await openLabNotesTab(page);
        await switchEditorMode(page, "Preview");
        await page.waitForTimeout(800);
        // Body images render through a custom <img> renderer that
        // resolves Images/* to blob: URLs, so target by alt-text and
        // fall back to "any img with cursor-pointer" (the renderer marks
        // every clickable body image that way).
        const img = page
          .locator(
            "img[alt*='Transformation plate' i], img.cursor-pointer",
          )
          .first();
        if (await img.count()) {
          await img.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await img.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ editor-image-resize action: ${err.message}`);
      }
    },
  },
  {
    path: "/methods",
    file: "methods-library.png",
    waitFor: "text=Methods",
    highlight: { text: "New Method" },
  },
  {
    path: "/pcr",
    file: "pcr-editor.png",
    waitFor: "text=PCR",
    highlight: { text: "New Protocol" },
  },
  {
    path: "/pcr",
    file: "pcr-step-edit.png",
    waitFor: "text=PCR",
    settleMs: 800,
    action: async (page) => {
      // Open the protocol detail modal by clicking the first protocol card.
      try {
        const card = page
          .locator("h3")
          .filter({ hasText: /Demo protocol/i })
          .first();
        if (!(await card.count())) return;
        await card.click({ timeout: 3000 });
        await page.waitForTimeout(800);
      } catch (err) {
        console.warn(`  ⚠ pcr-step-edit open card: ${err.message}`);
        return;
      }
      // Click the "Edit" button in the modal header to switch into edit mode.
      try {
        const editBtn = page
          .locator("button")
          .filter({ hasText: /^Edit$/ })
          .first();
        if (await editBtn.count()) {
          await editBtn.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ pcr-step-edit click Edit: ${err.message}`);
      }
      // Click "Edit Cycle" on the gradient editor toolbar to enter
      // the interactive (jiggling) mode where blocks are editable.
      try {
        const editCycleBtn = page
          .locator("button")
          .filter({ hasText: /^Edit Cycle$/ })
          .first();
        if (await editCycleBtn.count()) {
          await editCycleBtn.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ pcr-step-edit click Edit Cycle: ${err.message}`);
      }
      // Double-click any temperature block to open the Edit Step popup.
      // The temperature label is a <span class="font-semibold">95°C</span>
      // inside each block; the dblclick handler lives two parents up but
      // the event bubbles, so dblclick on the span fires the right handler.
      try {
        const tempLabel = page
          .locator("span.font-semibold")
          .filter({ hasText: /^\d+°C$/ })
          .first();
        if (await tempLabel.count()) {
          await tempLabel.dblclick({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch (err) {
        console.warn(`  ⚠ pcr-step-edit dblclick block: ${err.message}`);
      }
    },
  },
  {
    path: "/pcr",
    file: "pcr-reagent-totals.png",
    waitFor: "text=PCR",
    settleMs: 800,
    action: async (page) => {
      try {
        const card = page
          .locator("h3")
          .filter({ hasText: /Demo protocol/i })
          .first();
        if (!(await card.count())) return;
        await card.click({ timeout: 3000 });
        await page.waitForTimeout(800);
      } catch (err) {
        console.warn(`  ⚠ pcr-reagent-totals open card: ${err.message}`);
        return;
      }
      // Scroll the modal's inner overflow container so the Reaction
      // Recipe section sits at the top of the visible area, then compute
      // a tight clip rectangle around the recipe section (label + table).
      // Returning {clip} lets the caller use these coordinates for the
      // screenshot instead of a static crop.
      try {
        const clip = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("label"));
          const recipeLabel = labels.find(
            (el) => (el.textContent || "").trim() === "Reaction Recipe",
          );
          if (!recipeLabel) return null;
          const section = recipeLabel.parentElement;
          if (!section) return null;
          // Walk up to the nearest scrollable ancestor (the modal's
          // overflow-y-auto wrapper) and scroll the section to the top.
          let scroller = section.parentElement;
          while (scroller && scroller !== document.body) {
            const cs = getComputedStyle(scroller);
            if (
              cs.overflowY === "auto" ||
              cs.overflowY === "scroll" ||
              scroller.scrollHeight > scroller.clientHeight + 4
            ) {
              break;
            }
            scroller = scroller.parentElement;
          }
          if (scroller && scroller !== document.body) {
            const sRect = scroller.getBoundingClientRect();
            const lRect = section.getBoundingClientRect();
            scroller.scrollTop += lRect.top - sRect.top - 16;
          }
          // Re-measure after the scroll.
          const r = section.getBoundingClientRect();
          const pad = 12;
          const x = Math.max(0, Math.floor(r.left - pad));
          const y = Math.max(0, Math.floor(r.top - pad));
          const width = Math.min(
            Math.max(0, window.innerWidth - x),
            Math.ceil(r.width + pad * 2),
          );
          const height = Math.min(
            Math.max(0, window.innerHeight - y),
            Math.ceil(r.height + pad * 2),
          );
          return { x, y, width, height };
        });
        await page.waitForTimeout(300); // let the scroll settle
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ pcr-reagent-totals clip calc: ${err.message}`);
      }
    },
  },
  {
    path: "/purchases",
    file: "purchases-list.png",
    waitFor: "text=Purchases",
    highlight: { text: "New Purchase" },
  },
  {
    path: "/purchases",
    file: "purchases-funding-panel.png",
    waitFor: "text=Purchases",
    settleMs: 600,
    action: async (page) => {
      const btn = page
        .getByText(/Manage Funding Accounts|Funding Accounts/i)
        .first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        } catch {}
      }
    },
  },
  {
    path: "/calendar",
    file: "calendar-month.png",
    waitFor: "text=Calendar, text=May",
    highlight: { text: "New Event" },
  },
  { path: "/lab", file: "lab-mode.png", waitFor: "text=Activity, text=Lab" },
  {
    path: "/lab",
    file: "lab-mode-activity.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
  },
  {
    path: "/lab",
    file: "lab-mode-gantt.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      await switchLabTab(page, "GANTT");
    },
  },
  {
    path: "/lab",
    file: "lab-mode-purchases.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      await switchLabTab(page, "Purchases");
    },
  },
  {
    path: "/lab",
    file: "lab-mode-cross-user-lists.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      await switchLabTab(page, "Experiments");
    },
  },
  {
    path: "/lab",
    file: "lab-mode-user-filter.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      // The floating chip lives in the bottom-right corner. Match by the
      // tooltip set on the inner clickable div.
      try {
        const chip = page.locator("[title='Filter users to display']").first();
        if (await chip.count()) {
          await chip.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ lab-mode-user-filter open chip: ${err.message}`);
      }
    },
  },
  {
    path: "/lab",
    file: "purchases-lab-funding-cards.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      await switchLabTab(page, "Purchases");
      // Compute a tight clip around the Funding Accounts Overview panel.
      try {
        const clip = await page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll("h2, h3, h4"));
          const heading = headings.find(
            (el) => (el.textContent || "").trim() === "Funding Accounts Overview",
          );
          if (!heading) return null;
          // Walk up to find the panel wrapper that contains both heading
          // and cards (a div with rounded border / background).
          let panel = heading.parentElement;
          for (let i = 0; i < 5 && panel; i++) {
            const cs = getComputedStyle(panel);
            if (cs.borderRadius && cs.borderRadius !== "0px") break;
            panel = panel.parentElement;
          }
          if (!panel) return null;
          const r = panel.getBoundingClientRect();
          const pad = 24;
          const x = Math.max(0, Math.floor(r.left - pad));
          const y = Math.max(0, Math.floor(r.top - pad));
          const width = Math.min(
            Math.max(0, window.innerWidth - x),
            Math.ceil(r.width + pad * 2),
          );
          const height = Math.min(
            Math.max(0, window.innerHeight - y),
            Math.ceil(r.height + pad * 2),
          );
          return { x, y, width, height };
        });
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-lab-funding-cards clip: ${err.message}`);
      }
    },
  },
  {
    path: "/lab",
    file: "purchases-lab-list.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    action: async (page) => {
      await switchLabTab(page, "Purchases");
      // Scroll the page so the "Purchase Orders" list dominates the
      // viewport (funding cards and summary tiles move off the top).
      try {
        await page.evaluate(() => {
          // Try the most likely scroll containers in turn.
          const headings = Array.from(document.querySelectorAll("h2, h3, h4"));
          const heading = headings.find(
            (el) => (el.textContent || "").trim() === "Purchase Orders",
          );
          if (heading) {
            heading.scrollIntoView({ block: "start", behavior: "instant" });
            // Nudge a bit further so we get more rows in view.
            window.scrollBy(0, -16);
          } else {
            window.scrollTo(0, 600);
          }
        });
        await page.waitForTimeout(400);
      } catch {}
    },
  },
  {
    path: "/search?q=DEMO",
    file: "search-results.png",
    waitFor: "text=Search, text=DEMO",
    highlight: { selector: "input[type='search'], input[placeholder*='earch' i]" },
  },
  {
    path: "/links",
    file: "links.png",
    waitFor: "text=Lab Links, text=Links",
    highlight: { text: "New Link" },
  },
  // NOTE: results-list.png and results-tab.png were retired when chip 4
  // killed the /results route (commit 5b237d92). Completed-experiments
  // captures now happen on the Workbench page via workbench-earlier.png
  // below.
  {
    path: "/workbench",
    file: "workbench-earlier.png",
    waitFor: "text=Workbench, text=Lab Notes, text=Experiments",
    settleMs: 1000,
    action: async (page) => {
      // Scroll to the Earlier archive at the bottom of the page so the
      // section header + grouped cards are in frame. The Workbench
      // fixture (added via chip 3) ensures alex's completed experiments
      // and chain stacks populate the archive in ?wikiCapture=1.
      try {
        const earlier = page.getByText(/^Earlier\b/i).first();
        if (await earlier.count()) {
          await earlier.scrollIntoViewIfNeeded({ timeout: 3000 });
          await page.waitForTimeout(400);
        }
      } catch {}
    },
  },
  {
    path: "/workbench",
    file: "workbench-lists.png",
    waitFor: "text=Workbench, text=Lists",
    settleMs: 800,
    action: async (page) => {
      // Click the Lists tab in the Workbench tab bar.
      try {
        const tab = page.getByRole("button", { name: /^Lists$/ }).first();
        if (await tab.count()) {
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch {}
    },
  },
  {
    path: "/settings",
    file: "settings.png",
    waitFor: "text=Settings, text=Profile",
    highlight: { text: "Connect Telegram" },
  },
  {
    path: "/",
    file: "notifications.png",
    waitFor: "text=Research Project Overview",
    crop: { x: 0, y: 0, width: 1440, height: 100 },
    highlight: { selector: "button[title='Notifications'], [title*='otification' i]" },
  },
  {
    path: "/",
    file: "telegram-inbox.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      // The Inbox header button is a <button> with visible text "Inbox".
      const btn = page
        .locator("button")
        .filter({ hasText: /^Inbox(\s*\d+)?$/ })
        .first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        } catch {}
      }
    },
  },
  // Modals — navigate, click a button, then capture.
  {
    path: "/settings",
    file: "telegram-pairing.png",
    waitFor: "text=Settings",
    action: async (page) => {
      const tg = page.getByText(/Connect Telegram|Telegram/i).first();
      if (await tg.count()) {
        try {
          await tg.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        } catch {}
      }
    },
    highlight: { selector: "input[placeholder*='token' i], input[placeholder*='123456' i]" },
  },
  {
    path: "/calendar",
    file: "calendar-feeds-modal.png",
    waitFor: "text=Calendar",
    action: async (page) => {
      const btn = page.getByText(/Manage Feeds|External Feeds|Linked Calendars/i).first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        } catch {}
      }
    },
    highlight: { selector: "input[placeholder*='ICS' i], input[placeholder*='url' i], input[placeholder*='https' i]" },
  },
];

/** Hide dev/beta UI that distracts from docs. Re-applied per page. */
const HIDE_SCRIPT = `
  (function hideDevUI() {
    const HIDE_TEXTS = [
      "Test Notification",
      "Test Error",
      "Report Bug",
    ];
    const all = document.querySelectorAll("button, a");
    for (const el of all) {
      const text = (el.textContent || "").trim();
      if (HIDE_TEXTS.some(t => text === t || text.startsWith(t))) {
        el.style.display = "none";
      }
    }
    // Hide the bottom-left "Support" pill (Beta donation widget). Walk up
    // to its fixed-position container.
    const supportLeaves = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = (el.textContent || "").trim();
      return t === "Support" && el.children.length === 0;
    });
    for (const leaf of supportLeaves) {
      let cur = leaf;
      for (let i = 0; i < 6 && cur; i++) {
        const cs = getComputedStyle(cur);
        if (cs.position === "fixed") { cur.style.display = "none"; break; }
        cur = cur.parentElement;
      }
    }
    // Hide Telegram status pill (contains the bot username, which is personal data).
    const tgPills = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = (el.textContent || "").trim();
      return t.startsWith("Telegram:") && el.children.length <= 2;
    });
    for (const el of tgPills) {
      el.style.visibility = "hidden";
    }
  })();
`;

async function applyClean(page) {
  try {
    await page.evaluate(HIDE_SCRIPT);
  } catch {}
}

/** Draws a red ring + glow around the element matching the given spec.
 *  Used to point readers at the click target on each docs screenshot.
 *  Tolerant of missing elements (logs a warning, skips). */
async function applyHighlight(page, highlight) {
  if (!highlight) return;
  try {
    await page.evaluate((spec) => {
      let el = null;
      if (spec.selector) {
        el = document.querySelector(spec.selector);
      }
      if (!el && spec.text) {
        const needle = String(spec.text).toLowerCase();
        const candidates = Array.from(
          document.querySelectorAll("button, a, [role='button']"),
        );
        // Prefer exact text matches; fall back to a substring match.
        el =
          candidates.find(
            (e) => (e.textContent || "").trim().toLowerCase() === needle,
          ) ||
          candidates.find((e) =>
            (e.textContent || "").trim().toLowerCase().includes(needle),
          );
      }
      if (!el) {
        console.warn("[wiki-highlight] No element matched", spec);
        return false;
      }
      // Apply a high-contrast red ring + soft glow. Pin position so the
      // outline doesn't push neighboring layout around.
      el.setAttribute("data-wiki-highlight", "1");
      const cs = getComputedStyle(el);
      if (cs.position === "static") el.style.position = "relative";
      el.style.outline = "3px solid #ef4444";
      el.style.outlineOffset = "4px";
      el.style.borderRadius = el.style.borderRadius || "10px";
      el.style.boxShadow =
        "0 0 0 6px rgba(239, 68, 68, 0.18), 0 0 24px 4px rgba(239, 68, 68, 0.45)";
      el.style.zIndex = "9999";
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return true;
    }, highlight);
  } catch (err) {
    console.warn(`  ⚠ highlight failed: ${err.message}`);
  }
}

async function capturePage(page, route, baseUrl) {
  const variant = route.captureVariant ?? "1";
  const url = `${baseUrl}${route.path}${route.path.includes("?") ? "&" : "?"}wikiCapture=${variant}`;
  return _capturePageAt(page, route, url);
}

async function capturePublicPage(page, route, baseUrl) {
  return _capturePageAt(page, route, `${baseUrl}${route.path}`);
}

async function _capturePageAt(page, route, url) {
  const out = path.join(OUT_DIR, route.file);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch (err) {
    console.error(`  ✗ ${route.file} — goto failed: ${err.message}`);
    return false;
  }
  if (route.waitFor) {
    // Accept comma-separated alternatives; succeed if any one resolves first.
    const candidates = route.waitFor.split(",").map((s) => s.trim()).filter(Boolean);
    const races = candidates.map((sel) =>
      page.waitForSelector(sel, { timeout: 8000 }).catch(() => null),
    );
    await Promise.race(races);
  }
  await page.waitForTimeout(route.settleMs ?? 600);
  let dynamicClip = null;
  if (route.action) {
    try {
      const result = await route.action(page);
      if (result && typeof result === "object" && result.clip) {
        dynamicClip = result.clip;
      }
    } catch (err) {
      console.warn(`  ⚠ ${route.file} — action threw: ${err.message}`);
    }
  }
  await applyClean(page);
  await applyHighlight(page, route.highlight);
  await page.waitForTimeout(200); // let style changes commit
  try {
    const clip = dynamicClip ?? route.crop ?? null;
    if (clip) {
      await page.screenshot({ path: out, clip });
    } else {
      await page.screenshot({ path: out, fullPage: false });
    }
    console.log(`  ✓ ${route.file}`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${route.file} — screenshot failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Capturing wiki screenshots → ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}\n`);

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  let ok = 0;
  let fail = 0;

  // 1. Public / pre-auth pages (fresh context, no IndexedDB)
  console.log("Public pages:");
  {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of PUBLIC_ROUTES) {
      const success = await capturePublicPage(page, route, BASE_URL);
      success ? ok++ : fail++;
    }
    await ctx.close();
  }

  // 2. Picker-mode pages (fresh context — fixture installed without
  //    signing in, so the user-picker screen renders)
  console.log("\nPicker-mode pages:");
  {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of PICKER_ROUTES) {
      const success = await capturePage(page, route, BASE_URL);
      success ? ok++ : fail++;
    }
    await ctx.close();
  }

  // 3. Fixture-mode pages (fresh context, signed in as "alex")
  console.log("\nFixture-mode pages:");
  {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of FIXTURE_ROUTES) {
      const success = await capturePage(page, route, BASE_URL);
      success ? ok++ : fail++;
    }
    await ctx.close();
  }

  await browser.close();

  console.log(`\n${ok} succeeded, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

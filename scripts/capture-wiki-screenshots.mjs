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
    // Crop to the top zoom-control band only. No highlight: the wiki body
    // describes all eight zoom buttons (D/W/M/3M/6M/Y/All + Today), so a
    // red ring around just "3M" would be a misleading annotation.
    path: "/gantt",
    file: "gantt-zoom-controls.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    crop: { x: 0, y: 0, width: 1440, height: 220 },
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
    // The wiki page describes the *protocol editor popup* — thermal gradient on top,
    // reagent table below — not the library list view at /pcr. Open the first
    // "Demo protocol" card so the popup is what gets captured, matching the
    // pcr-step-edit / pcr-reagent-totals shots which both open the same popup.
    //
    // The popup body is taller than 900px, so a plain viewport screenshot
    // only catches the thermal gradient (the wiki claims both panels are
    // visible). Compute a tight clip that spans from the Thermal Gradient
    // label down to the bottom of the Reaction Recipe section so the shot
    // matches the wiki's promise. Adapted from pcr-reagent-totals's
    // clip-calculation logic.
    path: "/pcr",
    file: "pcr-editor.png",
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
        await page.waitForTimeout(900);
      } catch (err) {
        console.warn(`  ⚠ pcr-editor open card: ${err.message}`);
        return;
      }
      try {
        const clip = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("label"));
          const gradientLabel = labels.find(
            (el) => (el.textContent || "").trim() === "Thermal Gradient",
          );
          const recipeLabel = labels.find(
            (el) => (el.textContent || "").trim() === "Reaction Recipe",
          );
          if (!gradientLabel || !recipeLabel) return null;
          const gradientSection = gradientLabel.parentElement;
          const recipeSection = recipeLabel.parentElement;
          if (!gradientSection || !recipeSection) return null;
          // The popup body is `flex-1 overflow-y-auto p-6 space-y-6` and
          // its modal wrapper is `max-h-[90vh]`. Both clip the recipe
          // section out of the viewport. Expand them so the entire body
          // renders inline and the clip can extend below the modal's
          // normal bottom edge.
          let scroller = gradientSection.parentElement;
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
            scroller.style.overflow = "visible";
            scroller.style.maxHeight = "none";
            // Walk up one more level to find the max-h-[90vh] wrapper.
            let modal = scroller.parentElement;
            for (let i = 0; i < 4 && modal && modal !== document.body; i++) {
              modal.style.maxHeight = "none";
              modal.style.overflow = "visible";
              modal = modal.parentElement;
            }
          }
          // Re-measure after the layout reflows.
          const gRect = gradientSection.getBoundingClientRect();
          const rRect = recipeSection.getBoundingClientRect();
          const pad = 16;
          const x = Math.max(0, Math.floor(gRect.left - pad));
          const y = Math.max(0, Math.floor(gRect.top - pad));
          const right = Math.max(gRect.right, rRect.right);
          const bottom = rRect.bottom;
          const width = Math.ceil(right - gRect.left + pad * 2);
          const height = Math.ceil(bottom - gRect.top + pad * 2);
          return { x, y, width, height };
        });
        // The recipe table extends below the original viewport. Return a
        // viewport override so the screenshot caller resizes the page
        // tall enough to fit the whole clip before snapping, then
        // restores the original size for subsequent routes.
        if (clip && clip.width > 100 && clip.height > 100) {
          const newHeight = Math.min(clip.y + clip.height + 40, 3200);
          return {
            clip,
            viewport: { width: 1440, height: newHeight },
          };
        }
      } catch (err) {
        console.warn(`  ⚠ pcr-editor clip calc: ${err.message}`);
      }
    },
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
    // Top of /purchases — the unified scroll. Page header "Purchases · N
    // purchase orders · $X.XX total" plus the first batch of cards mixing
    // active (gray dot) and completed (green dot + " · Complete" suffix)
    // states. No row tints, no active/earlier split — the post-redesign
    // page is a single reverse-chronological list. Replaces purchases-list.png
    // which was retired with the Chip A-E unified-scroll rework.
    path: "/purchases",
    file: "purchases-unified-scroll.png",
    waitFor: "text=Purchases",
    settleMs: 600,
  },
  {
    // One purchase order card expanded inline, with the PurchaseEditor's
    // line-item table visible and the new Vendor + Category columns
    // populated. Bonus: focus the Vendor input and type one letter so the
    // autocomplete datalist surfaces suggestions (NEB, etc.).
    path: "/purchases",
    file: "purchases-expanded-order.png",
    waitFor: "text=Purchases",
    settleMs: 800,
    action: async (page) => {
      try {
        // Click the first purchase order card to expand its editor. The
        // card header lives inside a <div className="...cursor-pointer">
        // with the task name in an <h3>. Click the first such heading.
        const card = page.locator("h3").filter({ hasText: /^Order\s+/i }).first();
        if (await card.count()) {
          await card.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-expanded-order open card: ${err.message}`);
      }
      try {
        // Focus the Vendor input on the first item row and type one
        // letter to surface the autocomplete datalist. The Vendor input
        // uses VENDOR_DATALIST_ID via the list= attribute.
        const vendorInput = page
          .locator("input[list]")
          .filter({ has: page.locator("xpath=.") })
          .first();
        // Fall back to a placeholder/aria match if list-attribute query
        // misses.
        let input = vendorInput;
        if (!(await input.count())) {
          input = page
            .locator("input[placeholder*='vendor' i], input[aria-label*='vendor' i]")
            .first();
        }
        if (await input.count()) {
          await input.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await input.click({ timeout: 3000 });
          await input.type("N", { delay: 100, timeout: 3000 });
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-expanded-order vendor input: ${err.message}`);
      }
    },
  },
  {
    // FIXTURE NOTE: the amber yellow "This task is not typed as a
    // purchase order..." warning in PurchaseEditor.tsx lines 409-415 is
    // conditional on a `taskType` prop !== "purchase". The /purchases
    // page passes taskType but filters out non-purchase tasks, so the
    // banner never renders there. TaskDetailPopup renders PurchaseEditor
    // without passing taskType, so the banner is also suppressed in the
    // task-popup Purchases tab. The warning is therefore not currently
    // surfaced through normal UI navigation against this fixture.
    //
    // Open alex's task 11 ("Heat-shock survival assay" — task_type:
    // experiment, has linked purchase item id=20) from the Workbench
    // page, then switch to the Purchases tab inside the TaskDetailPopup.
    // Since chip a713f899 threaded task.task_type through TaskDetailPopup
    // → PurchaseEditor, the amber non-purchase warning banner now renders
    // here. Earlier rounds captured the wrong shot because:
    //   (a) tile.getByText matched the sidebar entry, not the card; and
    //   (b) the popup-mount wasn't waited for.
    // Fix: target h3 specifically (the TaskCard heading), then poll for
    // the popup's stable text marker before clicking the Purchases tab.
    path: "/experiments",
    file: "purchases-non-purchase-warning.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 1000,
    action: async (page) => {
      try {
        // h3 with exactly the task name is the card title in the
        // Workbench grid; the sidebar entry uses a different element.
        const card = page
          .locator("h3")
          .filter({ hasText: /^Heat-shock survival assay$/ })
          .first();
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await card.click({ timeout: 3000 });
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-non-purchase-warning open card: ${err.message}`);
        return;
      }
      // Wait for the popup to mount before reaching for the Purchases
      // tab. TaskDetailPopup renders "Details" / "Lab Notes" / "Method"
      // / "Results" / "Purchases" tabs in a horizontal strip; the
      // "Lab Notes" label is stable for both experiment and purchase
      // task types so it's a safe popup-mounted indicator.
      try {
        await page.waitForSelector(
          'button:has-text("Lab Notes"), [role="dialog"] :text("Lab Notes")',
          { timeout: 5000 },
        );
      } catch {
        console.warn("  ⚠ purchases-non-purchase-warning popup never mounted");
        return;
      }
      try {
        // The tab id is "purchases" but the button label is "Items"
        // (TaskDetailPopup.tsx:726). The tab only renders on experiment
        // popups when the task has orphan purchase items (chip
        // c6597cd7) — task 11 has purchase item id=20 attached, which
        // satisfies the orphan filter.
        const tab = page
          .locator("button")
          .filter({ hasText: /^Items$/ })
          .first();
        if (await tab.count()) {
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-non-purchase-warning open tab: ${err.message}`);
      }
    },
  },
  {
    // Tight clip around the dashboard's "Funding accounts" card grid
    // (3 cards: DEMO-NIH / DEMO-DOE / DEMO-Internal-Bridge, possibly an
    // Uncategorized tile if items lack a funding_string). Section
    // heading "Funding accounts" is rendered as an <h4> inside
    // SpendingDashboard.
    path: "/purchases",
    file: "purchases-dashboard-funding-cards.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          const headings = Array.from(
            document.querySelectorAll("h2, h3, h4"),
          );
          const heading = headings.find(
            (el) => (el.textContent || "").trim() === "Funding accounts",
          );
          if (!heading) return null;
          // The <section> wrapper holds both the heading and the card
          // grid. Walk up until we hit a SECTION (the dashboard groups
          // each block in its own <section className="mb-8">).
          let section = heading.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(300);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-dashboard-funding-cards clip: ${err.message}`);
      }
    },
  },
  {
    // Tight clip around the recharts BarChart that shows monthly spend.
    // The chart sits inside a <section> headed by "Spend over time".
    path: "/purchases",
    file: "purchases-dashboard-spend-over-time.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          const headings = Array.from(
            document.querySelectorAll("h2, h3, h4"),
          );
          const heading = headings.find(
            (el) => (el.textContent || "").trim() === "Spend over time",
          );
          if (!heading) return null;
          let section = heading.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(400);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-dashboard-spend-over-time clip: ${err.message}`);
      }
    },
  },
  {
    // Dashboard breakdown section, segmented control on the default
    // "Project" lens. The section heading is "Breakdown by {lens}" so
    // we anchor the lookup off the segmented-control buttons (the three
    // exact-text pills "Project" / "Vendor" / "Category" sit inside a
    // shared container).
    path: "/purchases",
    file: "purchases-dashboard-breakdown-project.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          // Find the segmented-control button labeled "Project" and walk
          // up to its enclosing <section>.
          const buttons = Array.from(document.querySelectorAll("button"));
          const pill = buttons.find(
            (el) => (el.textContent || "").trim() === "Project",
          );
          if (!pill) return null;
          let section = pill.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(400);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-dashboard-breakdown-project clip: ${err.message}`,
        );
      }
    },
  },
  {
    // Same area, "Vendor" pill clicked first.
    path: "/purchases",
    file: "purchases-dashboard-breakdown-vendor.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const pill = page
          .locator("button")
          .filter({ hasText: /^Vendor$/ })
          .first();
        if (await pill.count()) {
          await pill.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await pill.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-dashboard-breakdown-vendor click: ${err.message}`,
        );
      }
      try {
        const clip = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const pill = buttons.find(
            (el) => (el.textContent || "").trim() === "Vendor",
          );
          if (!pill) return null;
          let section = pill.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(400);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-dashboard-breakdown-vendor clip: ${err.message}`,
        );
      }
    },
  },
  {
    // Same area, "Category" pill clicked first.
    path: "/purchases",
    file: "purchases-dashboard-breakdown-category.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const pill = page
          .locator("button")
          .filter({ hasText: /^Category$/ })
          .first();
        if (await pill.count()) {
          await pill.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await pill.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-dashboard-breakdown-category click: ${err.message}`,
        );
      }
      try {
        const clip = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const pill = buttons.find(
            (el) => (el.textContent || "").trim() === "Category",
          );
          if (!pill) return null;
          let section = pill.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(400);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-dashboard-breakdown-category clip: ${err.message}`,
        );
      }
    },
  },
  {
    // Dashboard's "Items on non-purchase tasks" amber strip, clicked to
    // expand the inline table. Pattern: find the strip's <button> by its
    // "Items on non-purchase tasks:" text, click it, then tight-clip the
    // enclosing <section>.
    path: "/purchases",
    file: "purchases-non-purchase-panel-expanded.png",
    waitFor: "text=Purchases",
    settleMs: 900,
    action: async (page) => {
      try {
        const strip = page
          .getByText(/Items on non-purchase tasks:/i)
          .first();
        if (await strip.count()) {
          await strip.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await strip.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-non-purchase-panel-expanded click: ${err.message}`,
        );
      }
      try {
        const clip = await page.evaluate(() => {
          // The strip's text lives inside a <button>; the enclosing
          // <section className="mb-2"> wraps the whole amber block.
          const all = Array.from(document.querySelectorAll("p, span"));
          const label = all.find((el) =>
            /Items on non-purchase tasks:/i.test(el.textContent || ""),
          );
          if (!label) return null;
          let section = label.parentElement;
          while (section && section.tagName !== "SECTION") {
            section = section.parentElement;
          }
          if (!section) return null;
          section.scrollIntoView({ block: "start", behavior: "instant" });
          const r = section.getBoundingClientRect();
          const pad = 16;
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
        await page.waitForTimeout(300);
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ purchases-non-purchase-panel-expanded clip: ${err.message}`,
        );
      }
    },
  },
  {
    // Highlight the "Export CSV" button on the dashboard. The button
    // sits in the dashboard header above the Funding accounts grid.
    path: "/purchases",
    file: "purchases-csv-export.png",
    waitFor: "text=Purchases",
    settleMs: 800,
    highlight: { text: "Export CSV" },
  },
  {
    path: "/calendar",
    file: "calendar-month.png",
    waitFor: "text=Calendar, text=May",
    highlight: { text: "New Event" },
  },
  { path: "/lab", file: "lab-mode.png", waitFor: "text=Activity, text=Lab" },
  {
    // Activity tab stacks 3 sections: Running now, Recently completed, and
    // Recent shared notes. The last section sits below the viewport fold at
    // 900px, so use fullPage to capture all three.
    path: "/lab",
    file: "lab-mode-activity.png",
    waitFor: "text=Activity, text=Lab",
    settleMs: 1200,
    fullPage: true,
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
    // The Lists tab renders 5 stages stacked top-to-bottom (Overdue /
    // Doing / Upcoming / Recently done / Earlier). The viewport-clipped
    // screenshot only catches the first 3; chip 529b4d0d populated the
    // bottom two but they sit below 900px, so fullPage is required to
    // show all five sections in one shot.
    path: "/workbench",
    file: "workbench-lists.png",
    waitFor: "text=Workbench, text=Lists",
    settleMs: 800,
    fullPage: true,
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
    // The Settings page stacks 10 panels (Profile, Tabs, LabArchives, Sidebar,
    // View defaults, Animation, Notifications & behavior, Data maintenance,
    // Tips, Security). A viewport-clipped screenshot only captures the top
    // ~900px, missing most panels — use fullPage so the whole stack lands in
    // the wiki shot.
    path: "/settings",
    file: "settings.png",
    waitFor: "text=Settings, text=Profile",
    fullPage: true,
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
    // After opening the Manage Feeds modal, expand the native Provider
    // <select> so all 4 options (iCloud / Google / Outlook / Other) render
    // as a static list. Playwright's selectOption / click can't reliably
    // *visually* open a native dropdown across platforms, but bumping
    // size= forces the options to render inline — captured in the shot.
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
      try {
        await page.evaluate(() => {
          // Find the Provider <select> inside the Manage Feeds modal.
          const labels = Array.from(document.querySelectorAll("label"));
          const providerLabel = labels.find(
            (el) => (el.textContent || "").trim() === "Provider",
          );
          if (!providerLabel) return;
          const wrap = providerLabel.parentElement;
          const sel = wrap?.querySelector("select");
          if (sel) {
            sel.setAttribute("size", String(sel.options.length || 4));
          }
        });
        await page.waitForTimeout(300);
      } catch (err) {
        console.warn(`  ⚠ calendar-feeds-modal expand select: ${err.message}`);
      }
    },
    highlight: { selector: "input[placeholder*='ICS' i], input[placeholder*='url' i], input[placeholder*='https' i]" },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Demo-mode banner + LeaveDemoModal.
  //
  // ?wikiCapture=1 alone seeds the fixture but doesn't set the sticky
  // sessionStorage demo flag, so DemoLabBanner stays hidden. Route through
  // `/demo` (the public in-browser demo entry) which flips
  // `getDemoMode() === true` via URL match, rendering the amber banner +
  // floating Leave Demo button.
  {
    path: "/demo",
    file: "demo-mode-banner.png",
    waitFor: "text=Demo Lab, text=Research Project Overview",
    settleMs: 1000,
    // The banner sits at the very top of the layout — a 0..200 crop keeps
    // the focus on it instead of the project grid below.
    crop: { x: 0, y: 0, width: 1440, height: 200 },
  },
  {
    path: "/demo",
    file: "demo-mode-leave.png",
    waitFor: "text=Demo Lab, text=Research Project Overview",
    settleMs: 1000,
    action: async (page) => {
      // Click the in-banner "Leave Demo" button (preferred) or fall back
      // to the always-visible floating button at the bottom-right.
      try {
        const banner = page
          .locator("button")
          .filter({ hasText: /^Leave Demo$/ })
          .first();
        if (await banner.count()) {
          await banner.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          return;
        }
      } catch {}
      try {
        const floating = page
          .locator('[aria-label*="Leave the demo" i], [aria-label*="Leave Demo" i]')
          .first();
        if (await floating.count()) {
          await floating.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch (err) {
        console.warn(`  ⚠ demo-mode-leave click: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Experiments Export dialog.
  //
  // /experiments redirects to /workbench. Open a completed experiment so
  // the TaskDetailPopup mounts, then click the "Export experiment"
  // tooltip-wrapped icon to open the Export dialog.
  {
    path: "/experiments",
    file: "experiments-export-dialog.png",
    waitFor: "text=Workbench, text=Lab Notes, text=Experiments",
    settleMs: 1000,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      // The Export button is an SVG-only icon wrapped in
      // <Tooltip label="Export experiment">. The Tooltip sets
      // aria-label on the trigger; click by that.
      try {
        const exportBtn = page
          .locator('button[aria-label="Export experiment"], [aria-label="Export experiment"]')
          .first();
        if (await exportBtn.count()) {
          await exportBtn.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch (err) {
        console.warn(`  ⚠ experiments-export-dialog click: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Notifications bell — shift_alert row.
  //
  // FIXTURE NOTE: wiki-capture-fixture.ts does NOT currently seed any
  // notifications (no shift_alert, no sharing-notification rows). Capturing
  // here will produce an "empty bell" dropdown unless a future bot adds
  // a shift_alert seed entry. The capture is still wired so the wiki link
  // doesn't 404; replace with a real shot once the fixture grows a
  // notification.
  {
    path: "/",
    file: "notifications-shift-alert.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      // The bell button is wrapped in <Tooltip label="Notifications">,
      // which sets aria-label on the trigger.
      try {
        const bell = page
          .locator('button[aria-label="Notifications"]')
          .first();
        if (await bell.count()) {
          await bell.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch (err) {
        console.warn(`  ⚠ notifications-shift-alert open bell: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Search results — multi-select state with Export selected pill.
  //
  // /search?q=DEMO has fixture-seeded matches. Fill the keyword input + run
  // the search, click "Select" to enter select mode, then click 3 result
  // cards to tick them. The shot stops here — the wiki copy describes
  // "selected rows + the Export selected button visible", not the dialog
  // itself (the dialog has its own /experiments/-side screenshot).
  {
    path: "/search?q=DEMO",
    file: "search-export-selected.png",
    waitFor: "text=Search, text=DEMO",
    settleMs: 800,
    action: async (page) => {
      // The /search page does not auto-run when ?q= is present; the user
      // has to type into the Keywords input + click Search (or press
      // Enter). Fill the keywords field with "DEMO" and submit so the
      // fixture-seeded results render before we try to select rows.
      try {
        const kw = page
          .locator('input[placeholder*="Search by name" i]')
          .first();
        if (await kw.count()) {
          await kw.fill("DEMO", { timeout: 3000 });
          await kw.press("Enter");
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ search-export-selected run search: ${err.message}`);
      }
      // Enter select mode. The Search-form submit button also says
      // "Search" but lives in the form above; the Select button only
      // renders inside the results header after a search has run, so
      // scoping by exact text is safe here.
      try {
        const selectBtn = page
          .locator("button")
          .filter({ hasText: /^Select$/ })
          .first();
        if (await selectBtn.count()) {
          await selectBtn.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(`  ⚠ search-export-selected enter select: ${err.message}`);
      }
      // In select mode each card is itself the click target — clicking
      // the card toggles selection (no per-row checkbox input exists).
      // Click the first 3 result cards directly.
      try {
        // Cards live inside the results grid; match the outer card div by
        // its rounded border + cursor-pointer shape via the project pill
        // selector. Simpler: target by the result-card heading <h4> and
        // walk up to the card root via locator chaining.
        const cards = page.locator('h4.text-sm.font-medium');
        const cardCount = await cards.count();
        for (let i = 0; i < Math.min(3, cardCount); i++) {
          try {
            await cards.nth(i).click({ timeout: 2000 });
          } catch {}
        }
        await page.waitForTimeout(300);
      } catch (err) {
        console.warn(`  ⚠ search-export-selected check rows: ${err.message}`);
      }
      // Stop here. The wiki page wants the "selected rows + Export selected
      // pill" state, not the dialog that opens when Export selected is
      // clicked.
    },
    highlight: { text: "Export selected" },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Telegram Inbox — multi-select with context menu.
  //
  // The fixture seeds 4 inbox rows. The handler in InboxPanel.tsx opens
  // the single-file edit popup on a *plain* click, so we must start the
  // selection with a modifier (Meta/Ctrl) click — that path adds to the
  // selection AND sets anchorId without firing the popup. Subsequent
  // shift-clicks then range-select from the anchor to the target.
  {
    path: "/",
    file: "telegram-inbox-multiselect.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      // Open the Inbox panel via the header pill.
      try {
        const inboxBtn = page
          .locator("button")
          .filter({ hasText: /^Inbox(\s*\d+)?$/ })
          .first();
        if (await inboxBtn.count()) {
          await inboxBtn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      } catch (err) {
        console.warn(`  ⚠ telegram-inbox-multiselect open panel: ${err.message}`);
        return;
      }
      // Inbox rows are <li> elements inside a <ul>. Scope to the inbox
      // panel by looking inside the body's overflow-y-auto wrapper — the
      // generic li selector would also catch sidebar list items. Match
      // the panel's li by its imagery class fingerprint (`group flex
      // items-center gap-3 ...`).
      try {
        const rows = page.locator("li.group.flex.items-center.gap-3");
        const rowCount = await rows.count();
        if (rowCount === 0) {
          console.warn(`  ⚠ telegram-inbox-multiselect: 0 rows visible`);
          return;
        }
        // First row: modifier-click so we DON'T trigger the edit popup
        // (a plain click on an unselected row sets popupFilename in
        // handleRowClick). The modifier path only sets selection+anchor.
        await rows
          .nth(0)
          .click({ modifiers: ["Meta"], timeout: 3000 })
          .catch(() => {});
        await page.waitForTimeout(150);
        // Shift-click the 3rd row (or last if fewer) for a range select
        // from anchor → target.
        const targetIdx = Math.min(2, rowCount - 1);
        if (targetIdx > 0) {
          await rows
            .nth(targetIdx)
            .click({ modifiers: ["Shift"], timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(300);
        }
        // Right-click the middle row to open the context menu. The
        // handler keeps the existing selection if the row is part of it.
        const ctxIdx = Math.min(1, rowCount - 1);
        await rows
          .nth(ctxIdx)
          .click({ button: "right", timeout: 3000 })
          .catch(() => {});
        await page.waitForTimeout(700);
      } catch (err) {
        console.warn(`  ⚠ telegram-inbox-multiselect select+menu: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // ELN import wizard.
  //
  // The wizard mounts as <ImportELNDialog> from two entry points: the
  // first-run setup screen and Settings → LabArchives. Settings is the
  // stable choice for wiki capture (no folder-setup state required, the
  // ?wikiCapture=1 fixture brings the page up already signed in).
  //
  // Reach paths:
  //   - Step 1 "Choose format" is reachable by clicking the "Open import…"
  //     button. The format-picker renders with no upstream state, so the
  //     capture is reliable.
  //   - Steps 2-6 (Upload / Preview / Project mapping / Fetch images /
  //     Apply / Done) all require an actual notebook .zip parsed through
  //     JSZip + linkedom. The wiki-capture fixture does NOT seed a
  //     pre-parsed wizard state, and Playwright can't reliably hand a
  //     File object to the wizard's <input type="file">. Those steps are
  //     documented in prose on /wiki/features/import-from-eln with a
  //     "screenshots pending" callout; rerun this script against a
  //     future fixture that seeds parsed wizard state to fill them in.
  //   - BulkSortScreen requires a completed import to mount. Same
  //     fixture gap — deferred.
  {
    path: "/settings",
    file: "import-eln-format-pick.png",
    waitFor: "text=Settings, text=LabArchives",
    settleMs: 1000,
    action: async (page) => {
      // The "Open import…" button is the action slot inside the
      // LabArchivesOptionCard. data-onboarding-target="labarchives-import"
      // is the most stable selector since the button text could be
      // tweaked by future copy edits.
      try {
        const btn = page
          .locator('[data-onboarding-target="labarchives-import"]')
          .first();
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          // Wait for the wizard's Step 1 header ("1 · Choose format") so
          // the format-picker cards have laid out before we capture.
          await page
            .waitForSelector("text=Choose format", { timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ import-eln-format-pick open wizard: ${err.message}`);
      }
    },
    highlight: { text: "LabArchives Offline Notebook ZIP" },
  },
  {
    // The Report-an-Issue modal, embedded by /wiki/security to make the
    // "you see the body before anything leaves the browser" claim
    // concrete. The trigger lives in AppShell.tsx's bottom-right floating
    // cluster as <FeedbackButton onClick={openBugReport} />, exposed with
    // aria-label="Send feedback". HIDE_SCRIPT runs AFTER this action, so
    // clicking the now-hidden button isn't a problem: by the time HIDE_SCRIPT
    // fires the modal is already open and the trigger sits behind it.
    path: "/",
    file: "feedback-modal.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      try {
        const btn = page.locator('[aria-label="Send feedback"]').first();
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          // FeedbackModal renders an <h2> "Report an Issue" once "Bug"
          // (the default) is the selected type. Wait for it so the rest
          // of the modal body has mounted before we capture.
          await page
            .waitForSelector("text=Report an Issue", { timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(`  ⚠ feedback-modal open: ${err.message}`);
      }
    },
  },
  // ── Onboarding v2 welcome-wizard captures ─────────────────────────
  //
  // Wiki target: /wiki/getting-started/welcome-wizard
  //
  // FIXTURE NOTE (2026-05-20): the brief asked for the combo
  // ?wikiCapture=1 + ?wizard-preview=1 to force-mount the wizard in
  // fixture mode. The current orchestrator wiring blocks this: in
  // frontend/src/lib/onboarding/orchestrator.tsx the OnboardingProvider
  // short-circuits to `<>{children}</>` whenever `isDemoOrWikiCapture()`
  // returns true (line ~740), so `OnboardingOrchestrator` (which owns
  // the `wizardPreviewMode` URL-param read at line ~146) never mounts
  // under wikiCapture. That means a Playwright visit to
  // /?wikiCapture=1&wizard-preview=1 lands on the home page with no
  // wizard rendered, and the seven step-body captures below cannot
  // be produced from this script as-is.
  //
  // Options for a future fix (out of scope for the wiki-page chip):
  //   a. Loosen the OnboardingProvider gate so `wizardPreviewMode`
  //      overrides the `isDemoOrWikiCapture()` short-circuit (one-line
  //      change, but should be vetted by master — it threads
  //      preview-mode through demo-tab carve-outs).
  //   b. Add a dedicated capture-only fixture variant (e.g.
  //      ?wikiCapture=wizard) that seeds an empty `_onboarding.json`
  //      and lets the orchestrator mount the wizard naturally as a
  //      fresh user.
  //   c. Capture against a real fresh data folder outside fixture
  //      mode (slow, manual, not repeatable in CI).
  //
  // Until one of those lands, entries 1-9 below are intentionally NOT
  // wired into the FIXTURE_ROUTES array. The <Screenshot> tags in the
  // wiki page will render the "Screenshot pending" placeholder until
  // the orchestrator gate is updated and we rerun this script.
  //
  // Capture intent (for future hand-off, in the same order the wiki
  // page references them):
  //
  //   1. onboarding-wizard-step-1-welcome.png
  //      path: "/?wizard-preview=1", waitFor: "text=Welcome to ResearchOS"
  //      settleMs: 600, no action (the wizard mounts on step 1).
  //
  //   2. onboarding-wizard-step-2-use-cases.png
  //      Click Continue once to reach step 2, then click two chips
  //      ("PhD running experiments" and "Postdoc") so the screenshot
  //      shows the chip-selected state. Other remains collapsed.
  //
  //   3. onboarding-wizard-step-2-other-open.png
  //      Same as #2 reach-path, then click the "Other" row at the
  //      bottom of the chip grid so the free-form input field renders.
  //
  //   4. onboarding-wizard-step-3-tabs.png
  //      From step 2, pick a postdoc-style multi-chip (Postdoc +
  //      Workbench/Gantt-friendly) then click Continue once more to
  //      land on step 3. The grid shows the seeded toggles.
  //
  //   5. onboarding-wizard-step-4-telegram-cta.png
  //      Reach step 4 with any non-computational-only chip set (e.g.
  //      PhD running experiments). Two-CTA view renders.
  //
  //   6. onboarding-wizard-step-4-telegram-autoskip.png
  //      Reach step 2, click ONLY "Computational researcher", then
  //      Continue twice (step-2 → step-3 → step-4). The amber notice
  //      card renders. (Single-chip multi-select state is the tricky
  //      bit — Playwright needs to assert no other chip is highlighted
  //      before advancing.)
  //
  //   7. onboarding-wizard-step-5-calendar-form.png
  //      Reach step 5 via any chip set, then click "Add one now" to
  //      reveal the Name + ICS URL form. Optionally pre-fill the
  //      Name field with "My Google calendar" for a realistic shot.
  //
  //   8. onboarding-wizard-step-6-aihelper.png
  //      Reach step 6 (Continue through 5 with "Maybe later" so we
  //      don't actually subscribe a feed). Two-CTA initial state.
  //
  //   9. onboarding-wizard-step-7-wrapup.png
  //      Reach step 7. For a populated decision-echo block, the
  //      ideal walk is: step 2 Other-toggle on with text "running a
  //      clinical research coordinator role", step 4 "Maybe later",
  //      step 5 "Maybe later", step 6 "Copy prompt now" then Continue.
  //      Captures decision rows for all three integrations.
  //
  // Entry 10 below IS reachable via the fixture (the settings page
  // is already captured in non-wizard mode at settings.png, so the
  // Tips section renders identically here).
  {
    path: "/settings",
    file: "onboarding-settings-rerun-button.png",
    waitFor: "text=Settings, text=Tips",
    settleMs: 800,
    action: async (page) => {
      // The Tips section sits near the bottom of the long Settings
      // panel stack. Scroll the "Re-run welcome wizard" row into view
      // and capture a tight clip around the Tips card so the wiki shot
      // matches the section the prose describes.
      try {
        const label = page
          .getByText(/Re-run welcome wizard/i)
          .first();
        if (await label.count()) {
          await label
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-settings-rerun-button scroll: ${err.message}`,
        );
      }
      // Compute a clip that spans the entire Tips section (its
      // SectionShell header through the Re-run row's button). This
      // keeps the surrounding settings panels out of the shot so the
      // reader's eye lands on the right control.
      try {
        const clip = await page.evaluate(() => {
          const headings = Array.from(
            document.querySelectorAll("h2, h3"),
          );
          const tipsHeading = headings.find(
            (el) => (el.textContent || "").trim() === "Tips",
          );
          if (!tipsHeading) return null;
          // Walk up to the SectionShell wrapper so the clip catches
          // the title + the radio set + both action rows.
          let shell = tipsHeading.parentElement;
          for (let i = 0; i < 4 && shell; i++) {
            const cs = getComputedStyle(shell);
            if (
              cs.borderRadius !== "0px" ||
              shell.className.includes("rounded")
            ) {
              break;
            }
            shell = shell.parentElement;
          }
          if (!shell) return null;
          const rect = shell.getBoundingClientRect();
          const pad = 12;
          return {
            x: Math.max(0, Math.floor(rect.left - pad)),
            y: Math.max(0, Math.floor(rect.top - pad)),
            width: Math.ceil(rect.width + pad * 2),
            height: Math.ceil(rect.height + pad * 2),
          };
        });
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-settings-rerun-button clip calc: ${err.message}`,
        );
      }
    },
    highlight: { text: "Re-run wizard" },
  },
];

/** Hide dev/beta UI that distracts from docs. Re-applied per page.
 *
 *  IMPORTANT: screenshots are taken against `npm run dev`, so NODE_ENV is
 *  "development". That means every IS_DEV-gated dev tool — Send test
 *  notification, Force onboarding tip, Report bug, etc. — renders in the
 *  bottom-right floating cluster and needs hiding here. The user-facing
 *  cluster siblings (Data folder + Switch user) get hidden too because
 *  they're personal-data leaks (current username) and decorative noise
 *  for wiki docs. The cluster lives in `frontend/src/components/AppShell.tsx`. */
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
    // Floating bottom-right cluster (mix of dev + user-facing buttons).
    // Most are pure-SVG (no textContent) so we match by aria-label.
    // NODE_ENV=development during capture, so all three dev-only entries
    // ("Send test notification", "Force an onboarding tip", "Report a
    // bug") evaluate IS_DEV=true and would otherwise show in shots.
    // The "Open data folder settings" and "Switch user" buttons live in
    // the same cluster — they're user-facing but leak the current
    // username (via Switch-user's tooltip) and distract from wiki docs.
    const HIDE_ARIA_LABELS = [
      "Send test notification (dev only)",
      "Force an onboarding tip to fire (dev only)",
      // ReportBugButton was renamed to FeedbackButton at commit 3183950d
      // when chip-feedback-modal-types added a type-selector. The live
      // aria-label is now "Send feedback"; the old "Report a bug" string
      // matches nothing in the running DOM. Keep both so future renames
      // don't silently regress.
      "Send feedback",
      "Report a bug",
      "Open data folder settings",
      "Switch user",
      // Beta donation widget: in the floating cluster it's an icon-only
      // heart, so the textContent === "Support" rule below doesn't catch
      // it. Match by aria-label here. The expanded modal trigger ("Support
      // this project" text-button) keeps the textContent rule.
      "Support this project",
    ];
    for (const label of HIDE_ARIA_LABELS) {
      for (const el of document.querySelectorAll(
        '[aria-label="' + label + '"]',
      )) {
        el.style.display = "none";
      }
    }
    // Strip the "(now: <username>)" leak from the Switch-user tooltip's
    // title attribute. Tooltips don't fire without hover, but any future
    // hover-trigger would expose the personal username.
    for (const el of document.querySelectorAll('[aria-label="Switch user"]')) {
      el.removeAttribute("title");
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
    // Hide Telegram status pill (contains the bot username, which is
    // personal data). display:none instead of visibility:hidden so it
    // doesn't leave a blank gap in the header row.
    const tgPills = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = (el.textContent || "").trim();
      return t.startsWith("Telegram:") && el.children.length <= 2;
    });
    for (const el of tgPills) {
      el.style.display = "none";
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
  // Clear the sticky demo-mode sessionStorage flag before every route
  // EXCEPT the demo-mode-* shots which need it. Without this, captures
  // that run after demo-mode-banner.png / demo-mode-leave.png inherit
  // the flag (Playwright preserves sessionStorage across page.goto in a
  // single context) and getDemoMode() returns true on non-/demo URLs.
  // The chip 9de214fe fix gates FloatingLeaveDemoButton + OpenDocsButton
  // on `!isWikiCaptureMode()`, but DemoLabBanner's inline "Leave Demo"
  // pill renders on `getDemoMode()` alone, so the sticky flag leaks the
  // pill into later shots. Clearing it here is the surgical fix.
  if (!route.path.startsWith("/demo")) {
    try {
      await page.evaluate(() => {
        try {
          window.sessionStorage.removeItem("researchos:demo-mode");
        } catch {}
      });
    } catch {}
  }
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
  let dynamicViewport = null;
  if (route.action) {
    try {
      const result = await route.action(page);
      if (result && typeof result === "object" && result.clip) {
        dynamicClip = result.clip;
      }
      if (result && typeof result === "object" && result.viewport) {
        dynamicViewport = result.viewport;
      }
    } catch (err) {
      console.warn(`  ⚠ ${route.file} — action threw: ${err.message}`);
    }
  }
  await applyClean(page);
  await applyHighlight(page, route.highlight);
  await page.waitForTimeout(200); // let style changes commit
  // Actions that need to capture a clip taller than the default viewport
  // (e.g. pcr-editor's stacked gradient + recipe panels) return
  // `{ clip, viewport }` so the screenshot caller can grow the viewport
  // and restore it afterwards. Restoration is handled in the finally
  // block below so subsequent routes don't inherit the override.
  let restoreViewport = null;
  if (dynamicViewport) {
    restoreViewport = page.viewportSize();
    await page.setViewportSize(dynamicViewport);
    await page.waitForTimeout(400);
  }
  try {
    const clip = dynamicClip ?? route.crop ?? null;
    if (clip) {
      // clip wins over fullPage if both are set — clip is more specific.
      await page.screenshot({ path: out, clip });
    } else if (route.fullPage) {
      // Pages that stack many panels below the fold (Settings, lab-mode
      // Activity) opt into a full-document capture. AppShell wraps the
      // route content in overflow-hidden so Playwright's native fullPage
      // can't see beyond the viewport — we expand the inner scroll
      // containers and grow the viewport instead, then screenshot.
      const contentHeight = await page.evaluate(() => {
        // Pop the AppShell overflow:hidden + flex-1 height clamps so the
        // main scrollable region renders at its natural document height.
        const flips = [];
        const walk = (el) => {
          if (!el || el === document.body) return;
          const cs = getComputedStyle(el);
          if (
            cs.overflowY === "hidden" ||
            cs.overflowY === "auto" ||
            cs.overflowY === "scroll"
          ) {
            flips.push({ el, ov: el.style.overflow, h: el.style.height });
            el.style.overflow = "visible";
            el.style.height = "auto";
          }
        };
        // Walk every descendant of <main>, plus its ancestors up to body.
        document.querySelectorAll("main, main *").forEach(walk);
        let cur = document.querySelector("main");
        while (cur && cur !== document.body) {
          walk(cur);
          cur = cur.parentElement;
        }
        // Measure the now-uncollapsed body.
        const h = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          1000,
        );
        // Stash the flips array on window so we can restore after capture.
        window.__wikiCaptureFlips = flips;
        return Math.min(h + 100, 8000); // cap at 8000px for sanity
      });
      const originalViewport = page.viewportSize();
      await page.setViewportSize({
        width: originalViewport?.width ?? 1440,
        height: contentHeight,
      });
      await page.waitForTimeout(300); // let the layout reflow
      await page.screenshot({ path: out, fullPage: false });
      // Restore viewport + un-flip the overflow overrides so subsequent
      // routes don't inherit a broken layout.
      if (originalViewport) {
        await page.setViewportSize(originalViewport);
      }
      await page.evaluate(() => {
        const flips = window.__wikiCaptureFlips || [];
        for (const { el, ov, h } of flips) {
          el.style.overflow = ov;
          el.style.height = h;
        }
        delete window.__wikiCaptureFlips;
      });
    } else {
      await page.screenshot({ path: out, fullPage: false });
    }
    console.log(`  ✓ ${route.file}`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${route.file} — screenshot failed: ${err.message}`);
    return false;
  } finally {
    if (restoreViewport) {
      try {
        await page.setViewportSize(restoreViewport);
      } catch {}
    }
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

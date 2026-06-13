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

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { annotateBuffer } from "./lib/wiki-annotate.mjs";

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
const SCALE = 2; // deviceScaleFactor, screenshots are 2x the CSS viewport
// When on, a `highlight` target is rendered as the adaptive "click here" mark
// (ring + click-pulse + cursor, composited after capture) instead of the old
// in-page red ring. Set WIKI_NO_ANNOTATE=1 to fall back to the red ring.
const ANNOTATE = process.env.WIKI_NO_ANNOTATE !== "1";

/** Public, no-auth routes (fresh browser context). */
const PUBLIC_ROUTES = [
  // The folder-connect screen. A fresh context is "truly-new", which now
  // renders the first-time-visitor landing page instead of the connect
  // screen. `?connect=1` is the landing-gate bypass (see
  // lib/landing/landing-gate.ts) so this shot still captures the connect
  // screen. The wiki pages themselves are validated by `next build` and
  // don't need screenshot snapshots in /public.
  // The start screen is now the account chooser (Sign in / Open a folder /
  // Create a new account). For the local-first "connect your folder" docs we
  // point at "Open a folder", the path that opens a folder on your own disk.
  {
    // The start screen is the account chooser (Sign in / Open a folder /
    // Create account). The folder-connect docs want the ResearchFolderSetupNew
    // picker, which renders AFTER clicking "Open a folder", so click it and
    // wait for the drop zone to mount. fullPage so the "Link a folder" card,
    // the "Starting fresh?" box, the demo/starter links, and the RISE stamp all
    // land in the shot.
    path: "/?connect=1",
    file: "folder-connect.png",
    waitFor: "text=Open a folder",
    fullPage: true,
    action: async (page) => {
      try {
        const openBtn = page.getByText(/Open a folder/i).first();
        if (await openBtn.count()) {
          await openBtn.click({ timeout: 3000 });
          await page
            .waitForSelector('[data-testid="link-folder-drop-zone"]', {
              timeout: 4000,
            })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ folder-connect open picker: ${err.message}`);
      }
    },
    highlight: { selector: '[data-testid="link-folder-drop-zone"]' },
  },
  // The first-time-visitor landing ("sell") page. Captured from the
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
    // The picker subtitle is "Select your account to continue". The old
    // waitFor text ("Pick a user", "Continue") never existed in
    // UserLoginScreen, so it timed out and the shot missed the hover-action
    // icons (star = set main, pencil = rename, trash = delete) that only
    // surface on hover. Force the first tile's hover state so those icons are
    // visible in the capture.
    waitFor: "text=Select your account to continue",
    settleMs: 600,
    action: async (page) => {
      try {
        const tile = page
          .locator('div[role="button"][aria-label*="Sign in as" i]')
          .first();
        if (await tile.count()) {
          await tile.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await tile.hover({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch (err) {
        console.warn(`  ⚠ user-login hover tile: ${err.message}`);
      }
    },
    highlight: { selector: 'div[role="button"][aria-label*="Sign in as" i]' },
  },
];

/** Action helpers shared by experiment-popup screenshots. */

// Tasks marked complete are collapsed under a "Show N completed
// experiments" disclosure by default. Expand it (if present) and click
// the matching tile to open the task popup. Returns true if the popup
// likely opened.
async function revealCompletedAndOpenTask(page, taskNameRegex) {
  await ensureExperimentsTab(page);
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

// The Workbench default tab is now "Projects" (P3, 2026-06). Experiment
// captures must click into the Experiments tab first or they shoot Projects.
async function ensureExperimentsTab(page) {
  try {
    const tab = page
      .locator('[data-tour-target="workbench-experiments-tab"]')
      .first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
  } catch {}
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

// ── Version-history helpers (wiki-vc-screenshots sub-bot of HR, 2026-05-31) ──
//
// The Notes pilot version-history sidebar + restore/undo affordances are
// captured off the seeded note 5 ("qPCR optimization log") on /workbench.
// installWikiCaptureFixture pre-seeds a real multi-commit Loro document
// (wiki-capture-loro-vc-seed.ts) for this note, giving a multi-version /
// multi-editor / multi-day history, plus
// a live 24h revert_undo_window, so the sidebar, the per-editor-tinted diff, the
// compare toggle, the restore footer, and the "Undo restore" header all render.

/** Switch the Workbench to the Notes sub-tab and open note 5's popup. Returns
 *  true once the NoteDetailPopup is mounted. */
async function openSeededNote(page) {
  // Switch to the Notes tab via a DOM click. Do NOT re-navigate (e.g. goto
  // ?tab=notes): a second navigation re-triggers the onboarding "Welcome"
  // overlay that is only suppressed on the INITIAL route load, and it then
  // covers the shot. The tab is a button, but Playwright's actionability
  // click is flaky on the still-hydrating tab bar, so dispatch a DOM click.
  try {
    await page
      .locator('[data-tour-target="workbench-notes-tab"]')
      .first()
      .waitFor({ state: "visible", timeout: 12000 });
    await page.evaluate(() => {
      document
        .querySelector('[data-tour-target="workbench-notes-tab"]')
        ?.click();
    });
    await page.waitForTimeout(1000);
  } catch (err) {
    console.warn(`  ⚠ openSeededNote notes tab: ${err.message}`);
  }
  // The NoteCard root carries the onClick; match the card whose <h3> is the
  // qPCR optimization log title and click it. Wait for the Notes grid to
  // load its data and render the card.
  try {
    const card = page
      .locator("h3")
      .filter({ hasText: /^qPCR optimization log \(fakeGFP vs ACT1\)$/ })
      .first();
    await card.waitFor({ state: "visible", timeout: 10000 });
    await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // The note card is a clickable DIV (not a button) with a hover
    // transition; Playwright's actionability click times out on it, but a
    // DOM-level .click() reliably fires the React onClick (verified: opens
    // the note popup). Dispatch it directly.
    await page.evaluate(() => {
      const h3 = [...document.querySelectorAll("h3")].find((e) =>
        /qPCR optimization log \(fakeGFP vs ACT1\)/.test(e.textContent || ""),
      );
      if (h3) h3.click();
    });
    await page.waitForTimeout(1000);
  } catch (err) {
    console.warn(`  ⚠ openSeededNote open card: ${err.message}`);
  }
  // Confirm the popup mounted (history button is popup-scoped).
  try {
    await page.waitForSelector('[data-testid="note-history-button"]', {
      timeout: 5000,
    });
    return true;
  } catch {
    console.warn("  ⚠ openSeededNote: note popup never mounted");
    return false;
  }
}

/** Open the version-history sidebar inside an already-open note popup. Returns
 *  true once the sidebar is mounted and the timeline has rendered (either a
 *  selectable version row OR a collapsed editing-session group — runs of
 *  same-editor saves start collapsed, so a freshly-opened sidebar may show only
 *  session summaries until expanded). */
async function openHistorySidebar(page) {
  try {
    const btn = page.locator('[data-testid="note-history-button"]').first();
    await btn.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
    if (await btn.count()) {
      // DOM-level click: the note popup is still mid-transition here, so
      // Playwright's actionability click times out; the raw click fires.
      await page.evaluate(() => {
        document.querySelector('[data-testid="note-history-button"]')?.click();
      });
      await page.waitForSelector(
        '[data-testid="note-version-history-sidebar"]',
        { timeout: 5000 },
      );
      // Either a version row or a collapsed session means the list is built.
      await Promise.race([
        page
          .waitForSelector('[data-testid="version-row"]', { timeout: 6000 })
          .catch(() => null),
        page
          .waitForSelector('[data-testid="session-collapsed"]', { timeout: 6000 })
          .catch(() => null),
      ]);
      await page.waitForTimeout(700); // let reconstruction + the diff settle
      return true;
    }
  } catch (err) {
    console.warn(`  ⚠ openHistorySidebar: ${err.message}`);
  }
  return false;
}

/** Expand every collapsed editing-session group so the individual version rows
 *  (avatar + summary + relative time, with the Current pin on HEAD) are all
 *  visible. Clicking a collapsed group toggles it, so we snapshot the set of
 *  collapsed elements ONCE and click each exactly once (a re-query loop would
 *  re-toggle the same group). */
async function expandSessions(page) {
  try {
    // Click every collapsed group in ONE synchronous pass over a static
    // snapshot. Each collapsed group is a distinct element, and toggling is a
    // React state set per group, so a single synchronous forEach expands them
    // all without the re-toggle a re-resolving async loop hits (where the list
    // shrinks between awaits and the same group gets clicked twice).
    await page.evaluate(() => {
      document
        .querySelectorAll('[data-testid="session-collapsed"]')
        .forEach((el) => el.click());
    });
    await page.waitForTimeout(400);
  } catch {}
}

/** Select a non-head version row by its zero-based version index so the
 *  diff + (when restore is on) the restore footer render. The seeded history
 *  has 9 rows (0=genesis); the newest delta is the HEAD row. Passing an index
 *  of an earlier delta selects a restorable, diffable version. Expands any
 *  collapsed sessions first so the target row exists. */
async function selectVersionByIndex(page, versionIndex) {
  await expandSessions(page);
  try {
    const row = page
      .locator(`[data-testid="version-row"][data-version-index="${versionIndex}"]`)
      .first();
    if (await row.count()) {
      await row.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      // DOM-level click (rows are divs inside the animating sidebar).
      await page.evaluate((idx) => {
        document
          .querySelector(
            `[data-testid="version-row"][data-version-index="${idx}"]`,
          )
          ?.click();
      }, versionIndex);
      await page.waitForTimeout(700);
      return true;
    }
    console.warn(`  ⚠ selectVersionByIndex(${versionIndex}): row not found`);
  } catch (err) {
    console.warn(`  ⚠ selectVersionByIndex(${versionIndex}): ${err.message}`);
  }
  return false;
}

/** Hide the note popup's comments thread (the "Lab comments" block that docks
 *  below the document/sidebar row) for the duration of a capture. It eats ~230px
 *  of popup height, which squeezes the document column so only a sliver of the
 *  in-place diff shows. It is the body-row's next sibling inside the card. */
async function hideNoteComments(page) {
  try {
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll("div")).find(
        (d) =>
          /flex-1/.test(d.className || "") &&
          /overflow-hidden/.test(d.className || "") &&
          /flex-row/.test(d.className || ""),
      );
      const comments = row?.nextElementSibling;
      if (comments && /Lab comments/.test(comments.textContent || "")) {
        comments.style.display = "none";
      }
    });
    await page.waitForTimeout(200);
  } catch {}
}

/** Scroll the note's document column so the in-place diff for the selected
 *  version is in frame. The changed runs carry border-l-2 + an inline
 *  borderLeftColor (the editor tint); we bring the FIRST changed run to near the
 *  top of its scroll parent, leaving a little unchanged context above it, so the
 *  green-added + red-removed blocks read in context rather than below the fold.
 *  Returns the scrolled run count for logging. */
async function scrollDiffIntoView(page) {
  try {
    await page.evaluate(() => {
      const runs = Array.from(
        document.querySelectorAll("div.border-l-2"),
      ).filter((e) => e.style && e.style.borderLeftColor);
      if (!runs.length) return;
      const first = runs[0];
      const scroller =
        first.closest(".overflow-y-auto") ||
        first.closest('[class*="overflow"]');
      if (scroller) {
        const sRect = scroller.getBoundingClientRect();
        const rRect = first.getBoundingClientRect();
        scroller.scrollTop += rRect.top - sRect.top - 56;
      } else {
        first.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
    await page.waitForTimeout(350);
  } catch {}
}

/** Cap the version-history sidebar's height to fit inside the popup card so its
 *  internal version list scrolls and the sticky restore footer pins at the
 *  card's bottom edge. The note popup body row lacks a min-h-0 clamp, so a long
 *  sidebar (expanded list + footer) renders taller than the max-h-[90vh] card
 *  and the footer overflows below the visible card. Capping the sidebar height
 *  restores the intended "list scrolls, footer pinned" layout for capture. */
async function capSidebarToCard(page) {
  try {
    await page.evaluate(() => {
      const sidebar = document.querySelector(
        '[data-testid="note-version-history-sidebar"]',
      );
      const occluder = document.querySelector(
        '[data-tour-popup-occluding="note-detail"]',
      );
      const card =
        occluder?.querySelector('div[class*="rounded-2xl"]') ??
        occluder?.firstElementChild;
      if (!sidebar || !card) return;
      const cardR = card.getBoundingClientRect();
      const sR = sidebar.getBoundingClientRect();
      const capH = cardR.bottom - 16 - sR.top;
      if (capH > 200) {
        sidebar.style.maxHeight = capH + "px";
        sidebar.style.height = capH + "px";
      }
    });
    await page.waitForTimeout(250);
  } catch {}
}

/** Tight clip around the note popup card (the rounded-2xl modal), excluding the
 *  dimmed page behind it. */
async function notePopupClip(page) {
  try {
    return await page.evaluate(() => {
      const occluder = document.querySelector(
        '[data-tour-popup-occluding="note-detail"]',
      );
      if (!occluder) return null;
      // The white card is the occluder's child with rounded-2xl + shadow.
      const card =
        occluder.querySelector('div[class*="rounded-2xl"]') ?? occluder.firstElementChild;
      if (!card) return null;
      const r = card.getBoundingClientRect();
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
  } catch {
    return null;
  }
}

/** Routes that need the fixture mode (?wikiCapture=1) so realistic data
 *  renders. Each can specify a post-load action (e.g. click a button to
 *  open a modal). */
const FIXTURE_ROUTES = [
  {
    // Project Surface — the ProjectDetailPopup home view (PROJECT_POPUP_REDESIGN,
    // 2026-06-09). The full-page ProjectRoute was retired; loading
    // /workbench/projects/1 renders the browse grid and auto-opens the popup for
    // project 1 (FakeYeast). The home view shows the Status glance section
    // (progress bar + experiment/task counts + last active), the About overview
    // (empty-state placeholder, the fixture seeds no prose), the Go to doorways,
    // and the Actions row. Viewport capture of the centered popup.
    path: "/workbench/projects/1",
    file: "projects-route-overview.png",
    waitFor:
      '[data-testid="project-status-glance"], [data-testid="project-overview"]',
    settleMs: 800,
  },
  {
    // Project Surface route — Results section. Scroll to the #results
    // anchor, then tight-clip around the section's grouped galleries.
    // FIXTURE NOTE: the fixture seeds task images under
    // users/alex/tasks/2-Lab-Notes/Images/ but not under task Results tabs,
    // so the ResultsGallery will show its empty state ("No results yet…")
    // rather than thumbnail groups. The screenshot still demonstrates the
    // section header + caption shape, just without thumbnails.
    path: "/workbench/projects/1",
    file: "projects-route-results.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
    settleMs: 1000,
    action: async (page) => {
      try {
        await page.evaluate(() => {
          const el = document.getElementById("results");
          if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        });
        await page.waitForTimeout(500);
        const clip = await page.evaluate(() => {
          const section = document.getElementById("results");
          if (!section) return null;
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
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ projects-route-results clip: ${err.message}`);
      }
    },
  },
  {
    // Project Surface route — Methods inventory. Tasks 2 + 7 + 8 + 11 on
    // alex's project 1 carry method_attachments to methods 1/2/3, so the
    // MethodsInventory section will populate with usage badges.
    path: "/workbench/projects/1",
    file: "projects-route-methods.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
    settleMs: 1000,
    action: async (page) => {
      try {
        await page.evaluate(() => {
          const el = document.getElementById("methods");
          if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        });
        await page.waitForTimeout(500);
        const clip = await page.evaluate(() => {
          const section = document.getElementById("methods");
          if (!section) return null;
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
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ projects-route-methods clip: ${err.message}`);
      }
    },
  },
  {
    // Project Surface route — Activity feed.
    // FIXTURE NOTE: the fixture does not seed a
    // users/alex/projects/1-activity.json sidecar, so ActivityFeed will
    // render its "No activity yet." empty state. The screenshot captures
    // the section header + empty state shape. To get a populated feed
    // post-fixture-update, seed several events into that sidecar mirroring
    // the ProjectActivityEvent shape from
    // frontend/src/lib/project-activity/event-log.ts (task_completed,
    // image_added, method_added, prose_edited, project_shared).
    path: "/workbench/projects/1",
    file: "projects-route-activity.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
    settleMs: 1000,
    action: async (page) => {
      try {
        await page.evaluate(() => {
          const el = document.getElementById("activity");
          if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        });
        await page.waitForTimeout(500);
        const clip = await page.evaluate(() => {
          const section = document.getElementById("activity");
          if (!section) return null;
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
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ projects-route-activity clip: ${err.message}`);
      }
    },
  },
  {
    path: "/gantt",
    file: "gantt-overview.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    action: async (page) => {
      // The Projects dropdown can carry over an open/filtered state from prior
      // store state, which either hides every bar (empty Gantt) or covers the
      // timeline with the open listbox. Close it if it's open so the shot shows
      // the full timeline with all project bars.
      try {
        const trigger = page
          .locator('button[aria-haspopup="listbox"][aria-expanded="true"]')
          .first();
        if (await trigger.count()) {
          await trigger.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch {}
    },
    highlight: { text: "+ Task" },
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
    // The lab-head (PI) Gantt view: signed in as mira (the fixture's lab_head),
    // the project dropdown spans every member's projects so the timeline shows
    // task bars from both alex and morgan. Referenced by the gantt wiki page's
    // lab-head section. Highlight the "All" project filter to show the
    // cross-member scope.
    path: "/gantt?fixtureUser=mira",
    file: "gantt-overview-lab-head.png",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    action: async (page) => {
      // Ensure all projects are shown (close the dropdown if it carried over an
      // open/filtered state).
      try {
        const trigger = page
          .locator('button[aria-haspopup="listbox"][aria-expanded="true"]')
          .first();
        if (await trigger.count()) {
          await trigger.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch {}
    },
    highlight: { text: "All" },
  },
  {
    // The Workbench Experiments tab: the pipeline kanban board (Ready /
    // Blocked / Running / Awaiting columns) with the results grids below.
    // Projects is the default tab now, so click into Experiments first.
    path: "/workbench",
    file: "workbench-experiments.png",
    waitFor: "text=Workbench",
    settleMs: 600,
    action: ensureExperimentsTab,
    highlight: { text: "New Experiment" },
  },
  {
    // The Experiments pipeline board with all four stage columns (Ready /
    // Blocked / Running / Awaiting) in frame, plus the results grids below.
    // fullPage so readers see the whole board + the section vocabulary.
    path: "/workbench",
    file: "workbench-experiments-sections.png",
    waitFor: "text=Workbench",
    settleMs: 600,
    action: ensureExperimentsTab,
    fullPage: true,
  },
  {
    // The public /transparency ("Method validation") page for the Trust wiki.
    // Captured in fixture mode because the app's folder gate redirects
    // /transparency to the landing page in a fresh, no-folder context. The
    // fixture installs a connected folder so the page renders. Viewport capture
    // shows the header, the exact/within/larger counts, and the differences
    // spotlight (the trust-defining content above the fold).
    path: "/transparency",
    file: "transparency-method-validation.png",
    waitFor: "text=Method validation, text=peer-reviewed",
    settleMs: 1400,
    // fullPage so the whole page is captured top-to-bottom: the header, the
    // exact/within/larger count badges, the complete "Where ResearchOS differs"
    // list, the TransparencyTabs comparison tables, and the AppFooter. A
    // viewport shot truncates mid-"Where ResearchOS differs".
    fullPage: true,
  },
  {
    // Lab calculators modal: the floating beaker button (global) opens the
    // tabbed modal. For the new features/lab-calculators wiki page.
    path: "/workbench",
    file: "lab-calculators-modal.png",
    waitFor: "text=Workbench",
    settleMs: 900,
    // The modal renders inside [data-floating-dock]; keep the dock visible at
    // screenshot time (default cleanup hides it). The modal backdrop covers
    // the sibling FABs, so nothing else leaks into the shot.
    keepDock: true,
    action: async (page) => {
      try {
        let btn = page.locator('button[aria-label="Open lab calculators"]').first();
        if (!(await btn.count())) {
          btn = page.getByRole("button", { name: /Open lab calculators/i }).first();
        }
        if (await btn.count()) {
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await btn.click({ timeout: 3000, force: true });
          // Wait for the modal's tab row (aria-label "Calculator type") to mount.
          await page
            .locator('[aria-label="Calculator type"]')
            .first()
            .waitFor({ timeout: 4000 })
            .catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
    },
  },
  // ── Custom Calculator Builder (HELD captures) ───────────────────────────────
  // These three shots cover the build-your-own section of the lab-calculators
  // wiki page. They are HELD until the builder UI is locked (Grant's review).
  // CAPTURE REQUIREMENT: the prod build for the capture run must set
  // NEXT_PUBLIC_CALC_BUILDER=1, or the builder rail / Build your own button does
  // not render and these shots fall back to the "coming soon" placeholder. The
  // builder-specific click selectors below are best-effort and must be confirmed
  // against the live builder when the capture is actually run.
  {
    // The template library gallery inside the calculators modal.
    path: "/workbench",
    file: "calc-template-library.png",
    waitFor: "text=Workbench",
    settleMs: 900,
    keepDock: true,
    action: async (page) => {
      try {
        let btn = page.locator('button[aria-label="Open lab calculators"]').first();
        if (!(await btn.count())) {
          btn = page.getByRole("button", { name: /Open lab calculators/i }).first();
        }
        if (await btn.count()) {
          await btn.click({ timeout: 3000, force: true });
          // Open the template library from the modal rail.
          const lib = page.getByRole("button", { name: /Template library|Browse all/i }).first();
          await lib.waitFor({ timeout: 4000 }).catch(() => {});
          await lib.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
    },
  },
  {
    // The build-your-own wizard (a fresh fixture user with no saved calculators
    // routes to the wizard).
    path: "/workbench",
    file: "calc-builder-wizard.png",
    waitFor: "text=Workbench",
    settleMs: 900,
    keepDock: true,
    action: async (page) => {
      try {
        let btn = page.locator('button[aria-label="Open lab calculators"]').first();
        if (!(await btn.count())) {
          btn = page.getByRole("button", { name: /Open lab calculators/i }).first();
        }
        if (await btn.count()) {
          await btn.click({ timeout: 3000, force: true });
          const build = page.getByRole("button", { name: /Build your own/i }).first();
          await build.waitFor({ timeout: 4000 }).catch(() => {});
          await build.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
    },
  },
  {
    // The simplified form (reached from the wizard via "Switch to the full form").
    path: "/workbench",
    file: "calc-builder-form.png",
    waitFor: "text=Workbench",
    settleMs: 900,
    keepDock: true,
    action: async (page) => {
      try {
        let btn = page.locator('button[aria-label="Open lab calculators"]').first();
        if (!(await btn.count())) {
          btn = page.getByRole("button", { name: /Open lab calculators/i }).first();
        }
        if (await btn.count()) {
          await btn.click({ timeout: 3000, force: true });
          const build = page.getByRole("button", { name: /Build your own/i }).first();
          await build.waitFor({ timeout: 4000 }).catch(() => {});
          await build.click({ timeout: 3000 }).catch(() => {});
          const toForm = page.getByRole("button", { name: /full form/i }).first();
          await toForm.waitFor({ timeout: 3000 }).catch(() => {});
          await toForm.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
    },
  },
  {
    // Lab comments docked right rail on an experiment popup, for the
    // features/lab-inbox/comments page. Open the seeded experiment that carries
    // a threaded comment, then click the header comment button to open the rail.
    path: "/workbench",
    file: "lab-inbox-comments-rail.png",
    waitFor: "text=Workbench",
    settleMs: 600,
    action: async (page) => {
      await revealCompletedAndOpenTask(page, /PCR-screen integrants/);
      try {
        const cbtn = page.locator('[data-testid="task-comments-button"]').first();
        if (await cbtn.count()) {
          await cbtn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        }
      } catch {}
    },
  },
  {
    // Notes tab: flat search-driven list. Click the Notes tab button in
    // the Workbench tab bar to switch views before capturing. The
    // project pill strip currently hides on Notes (a separate chip
    // restores it); when that lands, this capture should rerun.
    path: "/workbench",
    file: "workbench-notes.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      try {
        const tab = page.getByRole("button", { name: /^Notes$/ }).first();
        if (await tab.count()) {
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch {}
    },
  },
  {
    // The 1:1 (Mentoring / Check-ins) surface for the features/one-on-ones wiki
    // page. The fixture's PI is mira (alex is a member), so sign in via
    // ?fixtureUser=mira to surface the role-gated Mentoring tab. Click into the
    // tab, then capture the left mentee list plus the four-area pane. Needs the
    // 1:1 demo seed (mira's one_on_ones / weekly_goals / action items) to render
    // populated; an unseeded fixture falls back to the "No 1:1s yet" empty state.
    path: "/workbench?fixtureUser=mira",
    file: "one-on-ones-surface.png",
    waitFor: "text=Workbench",
    settleMs: 800,
    action: async (page) => {
      try {
        const tab = page
          .locator('[data-tour-target="workbench-oneonone-tab"]')
          .first();
        if (await tab.count()) {
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch {}
    },
  },
  {
    // The markdown editor inside an experiment's Lab Notes tab. The
    // TaskDetailPopup defaults to the Details tab, so open the task THEN
    // click into Lab Notes or the shot lands on the empty Details pane.
    path: "/workbench",
    file: "experiments-editor.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      await openLabNotesTab(page);
    },
  },
  // NOTE: editor-language-picker.png was retired 2026-05-28. It was never
  // referenced by a wiki page, and its action (type ``` to open the
  // code-block language picker) no longer surfaces the picker after the
  // editor's code-fence handling changed, so the capture just re-shot the
  // plain Lab Notes view. Re-add with a verified action if a wiki page
  // ever needs the language-picker illustration.
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
    // editor-inline-mode.png — the markdown editor in its default "inline"
    // mode mid-edit. Open the seeded experiment's Lab Notes, then place the
    // caret on a non-heading paragraph so the markdown markers reveal only on
    // the cursor line (the "caret-aware marker hiding" mechanic the wiki page
    // describes). Referenced by /wiki/features/markdown-editor.
    path: "/experiments",
    file: "editor-inline-mode.png",
    waitFor: "h1, h2, text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      try {
        await openLabNotesTab(page);
        // Click mid-document on a body paragraph to place the caret there so
        // the markers reveal on that line only.
        const block = page.getByText(/Plated on SD-Ura/i).first();
        if (await block.count()) {
          await block.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await block.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(`  ⚠ editor-inline-mode action: ${err.message}`);
      }
    },
  },
  {
    // editor-save-checkpoint.png — the right end of the editor toolbar with
    // the Version history (clock) button and the blue "Save checkpoint"
    // button enabled. Open Lab Notes, focus the editor body so the editor goes
    // dirty and the Save checkpoint button enables. Referenced by
    // /wiki/features/markdown-editor.
    path: "/experiments",
    file: "editor-save-checkpoint.png",
    waitFor: "text=Lab Notes",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      ))) return;
      try {
        await openLabNotesTab(page);
        // Focus a body paragraph so the editor registers a change and the
        // "Save checkpoint" button switches to its blue enabled state.
        const block = page.getByText(/Plated on SD-Ura/i).first();
        if (await block.count()) {
          await block.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await block.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(`  ⚠ editor-save-checkpoint action: ${err.message}`);
      }
    },
    highlight: { text: "Save checkpoint" },
  },
  {
    // fullPage so the whole library lands in one shot: the header (search,
    // New Category, Template library, New Method), the My Methods section, and
    // crucially the Shared with Lab section with its diverse method-type pills
    // (Markdown, PCR, LC Gradient, Plate Layout, Cell culture, Mass spec, qPCR
    // analysis, Coding workflow). A viewport shot only catches ~3 types.
    path: "/methods",
    file: "methods-library.png",
    waitFor: "text=Method Library",
    fullPage: true,
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
    //
    // ENV REQUIREMENT: NEXT_PUBLIC_INVENTORY_ENABLED must be unset or =0 for
    // this capture. When it is =1 the /purchases route redirects to /supplies
    // (the inventory list), which is the wrong page — the shot then shows the
    // Supplies header + supply items instead of the Purchases order list.
    path: "/purchases",
    file: "purchases-unified-scroll.png",
    waitFor: "text=Purchases",
    settleMs: 600,
  },
  {
    // The NewPurchaseModal, opened from the amber "+ New Purchase" button in
    // the page header. Referenced by /wiki/features/purchases. Same env
    // requirement as the other /purchases shots (INVENTORY_ENABLED off).
    path: "/purchases",
    file: "purchases-new-purchase-modal.png",
    waitFor: "text=Purchases",
    settleMs: 700,
    action: async (page) => {
      try {
        let btn = page
          .locator('[data-tour-target="purchases-new-button"]')
          .first();
        if (!(await btn.count())) {
          btn = page
            .locator("button")
            .filter({ hasText: /New Purchase/i })
            .first();
        }
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          await page
            .waitForSelector("text=New Purchase", { timeout: 4000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-new-purchase-modal open: ${err.message}`);
      }
    },
    highlight: { text: "New Purchase" },
  },
  {
    // One purchase order card expanded inline, with the PurchaseEditor's
    // line-item table visible and the new Vendor + Category columns
    // populated. Bonus: focus the Vendor input and type one letter so the
    // autocomplete datalist surfaces suggestions (NEB, etc.).
    //
    // ENV REQUIREMENT: NEXT_PUBLIC_INVENTORY_ENABLED must be unset or =0, else
    // /purchases redirects to /supplies (inventory list) and the
    // PurchaseEditor line-item table never renders, so the shot lands on the
    // wrong page.
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
      // "Heat-shock survival assay" is an EXPERIMENT card; Projects is the
      // default Workbench tab now, so switch into Experiments first or the
      // card is never on screen.
      await ensureExperimentsTab(page);
      try {
        // h3 with exactly the task name is the card title in the
        // Workbench grid; the sidebar entry uses a different element.
        const card = page
          .locator("h3")
          .filter({ hasText: /^Heat-shock survival assay$/ })
          .first();
        await card.waitFor({ state: "visible", timeout: 8000 });
        await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await card.click({ timeout: 5000 });
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
        // The tab id is "purchases"; the button label is now "Order items"
        // (renamed from "Items" in the TaskDetailPopup density pass). The
        // tab only renders on experiment popups when the task has orphan
        // purchase items (chip c6597cd7) — task 11 has purchase item id=20
        // attached, which satisfies the orphan filter.
        const tab = page
          .locator("button")
          .filter({ hasText: /^Order items$/ })
          .first();
        await tab.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
        if (await tab.count()) {
          await tab.click({ timeout: 4000 });
          await page.waitForTimeout(900);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-non-purchase-warning open tab: ${err.message}`);
      }
      // Confirm the amber non-purchase warning banner actually rendered before
      // the shot — the previous spec waited only for "Lab Notes", which is
      // present before the Order items tab is clicked.
      try {
        await page.waitForSelector(
          'text=This task is not typed as a purchase order',
          { timeout: 5000 },
        );
      } catch {
        console.warn(
          "  ⚠ purchases-non-purchase-warning: warning banner never rendered",
        );
      }
    },
    highlight: { selector: "div.bg-yellow-50.border.border-yellow-200" },
  },
  {
    // Tight clip around the dashboard's "Funding accounts" card grid
    // (3 cards: DEMO-NIH / DEMO-DOE / DEMO-Internal-Bridge, possibly an
    // Uncategorized tile if items lack a funding_string). Section
    // heading "Funding accounts" is rendered as an <h4> inside
    // SpendingDashboard.
    // ENV REQUIREMENT: NEXT_PUBLIC_INVENTORY_ENABLED must be off, else
    // /purchases redirects to /supplies and the dashboard's "Funding accounts"
    // <h4> never exists. Wait on the dashboard heading (not the generic
    // "Purchases" page text, which also matches the Supplies header).
    path: "/purchases",
    file: "purchases-dashboard-funding-cards.png",
    waitFor: "text=Spending dashboard",
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
    // The chart sits inside a <section> headed by "Spend over time". On
    // /supplies (INVENTORY_ENABLED), the dashboard lives in a lab-head-only
    // drawer, so sign in as mira and open "View spending" first, then hover a
    // bar to surface the "$X.XX (N items)" tooltip.
    path: "/supplies?wikiCapture=1&fixtureUser=mira",
    file: "purchases-dashboard-spend-over-time.png",
    waitFor: "text=View spending",
    settleMs: 900,
    action: async (page) => {
      try {
        const view = page
          .locator(
            '[data-testid="supplies-view-spending"], button:has-text("View spending")',
          )
          .first();
        if (await view.count()) {
          await view.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Spend over time", { timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ spend-over-time open drawer: ${err.message}`);
      }
      // Hover the first chart bar so the "$X.XX (N items)" tooltip renders.
      try {
        const bar = page.locator(".recharts-bar-rectangle").first();
        if (await bar.count()) {
          await bar.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await bar.hover({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch {}
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
    // /supplies hides the dashboard in a lab-head-only drawer, so sign in as
    // mira and open "View spending" first. Project is the default lens.
    path: "/supplies?wikiCapture=1&fixtureUser=mira",
    file: "purchases-dashboard-breakdown-project.png",
    waitFor: "text=View spending",
    settleMs: 900,
    action: async (page) => {
      try {
        const view = page
          .locator(
            '[data-testid="supplies-view-spending"], button:has-text("View spending")',
          )
          .first();
        if (await view.count()) {
          await view.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Spending dashboard", { timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ breakdown-project open drawer: ${err.message}`);
      }
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
    // Same area, "Vendor" pill clicked first. /supplies drawer (lab-head).
    path: "/supplies?wikiCapture=1&fixtureUser=mira",
    file: "purchases-dashboard-breakdown-vendor.png",
    waitFor: "text=View spending",
    settleMs: 900,
    action: async (page) => {
      try {
        const view = page
          .locator(
            '[data-testid="supplies-view-spending"], button:has-text("View spending")',
          )
          .first();
        if (await view.count()) {
          await view.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Spending dashboard", { timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ breakdown-vendor open drawer: ${err.message}`);
      }
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
    // Same area, "Category" pill clicked first. /supplies drawer (lab-head).
    path: "/supplies?wikiCapture=1&fixtureUser=mira",
    file: "purchases-dashboard-breakdown-category.png",
    waitFor: "text=View spending",
    settleMs: 900,
    action: async (page) => {
      try {
        const view = page
          .locator(
            '[data-testid="supplies-view-spending"], button:has-text("View spending")',
          )
          .first();
        if (await view.count()) {
          await view.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Spending dashboard", { timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ breakdown-category open drawer: ${err.message}`);
      }
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
    // Highlight the "Export CSV" button on the dashboard. On /supplies the
    // dashboard (with the Export CSV control) lives in the lab-head-only
    // "View spending" drawer, so sign in as mira and open it first.
    path: "/supplies?wikiCapture=1&fixtureUser=mira",
    file: "purchases-csv-export.png",
    waitFor: "text=View spending",
    settleMs: 800,
    action: async (page) => {
      try {
        const view = page
          .locator(
            '[data-testid="supplies-view-spending"], button:has-text("View spending")',
          )
          .first();
        if (await view.count()) {
          await view.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Export CSV", { timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ purchases-csv-export open drawer: ${err.message}`);
      }
    },
    highlight: { text: "Export CSV" },
  },
  {
    path: "/calendar",
    file: "calendar-month.png",
    waitFor: "text=Calendar, text=May",
    highlight: { text: "New Event" },
  },
  // NOTE: the lab-mode-*.png and purchases-lab-*.png captures were retired
  // 2026-05-28. They all navigated to "/lab", which no longer exists (the
  // lab features live at /lab-overview now), so every shot was a Next.js
  // 404 page. None were referenced by any wiki page. If a future wiki page
  // needs lab-overview illustrations, add fresh entries pointed at
  // /lab-overview with verified `action`s and re-capture.
  {
    // The keywords URL param (not q) auto-populates the Keywords input and runs
    // the search on mount, so the shot shows actual result cards (not just the
    // empty form). Annotate the Search button to match the "then click Search"
    // wiki caption.
    path: "/search?keywords=DEMO",
    file: "search-results.png",
    waitFor: "text=Search results",
    settleMs: 600,
    highlight: { text: "Search" },
  },
  {
    // The nav tab label was changed from "Lab Links" to the account-type-
    // agnostic "Links" (2026-05-26), so the waitFor must match the current
    // UI. Viewport shot of the Links page header ("N links saved") + the
    // Add Link button + the first category group of link cards.
    path: "/links",
    file: "links.png",
    waitFor: "text=Links, text=links saved",
    highlight: { text: "New Link" },
  },
  // NOTE: results-list.png and results-tab.png were retired when chip 4
  // killed the /results route (commit 5b237d92). Completed-experiments
  // captures now happen on the Workbench page via workbench-earlier.png
  // below.
  {
    // The "Earlier results" archive lives on the Experiments tab (Projects
    // is the default tab now), so click into Experiments first. fullPage so
    // the EARLIER RESULTS header + the Flat / By project layout toggle + the
    // grouped result cards all read in one shot. The Workbench fixture
    // populates alex's completed experiments in ?wikiCapture=1.
    path: "/workbench",
    file: "workbench-earlier.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 1000,
    fullPage: true,
    action: async (page) => {
      await ensureExperimentsTab(page);
      // Scroll to the Earlier results archive so the section header + the
      // grouped cards are in frame before the fullPage capture settles.
      try {
        const earlier = page
          .getByText(/^(Earlier results|EARLIER RESULTS|Earlier)\b/i)
          .first();
        if (await earlier.count()) {
          await earlier.scrollIntoViewIfNeeded({ timeout: 3000 });
          await page.waitForTimeout(400);
        }
      } catch {}
    },
    highlight: { text: "EARLIER RESULTS" },
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
      // Expand the first list-task card inline so the accordion panel (violet
      // border, sub-task checklist, Add item input, Mark list complete button)
      // is visible — that interactive panel is what the wiki text describes.
      try {
        const card = page.locator("h3, h4").first();
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await card.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ workbench-lists expand card: ${err.message}`);
      }
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
    // settings-ai-helper.png — the AI Helper section in Settings (the prompt
    // export feature: size options + open-in-Claude/ChatGPT/Gemini/Copilot).
    // Referenced by /wiki/features/ai-helper and /wiki/features/settings. The
    // section carries id="ai-helper" in app/settings/page.tsx, so the #ai-helper
    // anchor scrolls to it. BEST-EFFORT: confirm the selector/scroll against the
    // live redesigned settings (SettingsShell uses a ?section= query) when the
    // capture is actually run; if the AI Helper lives under a ?section= id now,
    // switch path to /settings?section=<id>.
    path: "/settings#ai-helper",
    file: "settings-ai-helper.png",
    waitFor: "text=AI Helper",
    settleMs: 900,
  },
  {
    // user-archiving-roster.png — the Lab Roster in Settings with a member
    // row's Archive button revealed on hover. Referenced by
    // /wiki/getting-started/user-archiving. The PI edit-session unlock gate was
    // removed, so there must be NO "Editing as Lab Head" banner / "End session"
    // button. Sign in as mira (the fixture's lab_head) so the roster + Archive
    // affordance render.
    path: "/settings?fixtureUser=mira",
    file: "user-archiving-roster.png",
    waitFor: "text=Lab Roster",
    settleMs: 800,
    action: async (page) => {
      // Scroll the Lab Roster into view, then hover a non-self member row to
      // reveal its Archive button.
      try {
        const roster = page.getByText(/Lab Roster/i).first();
        if (await roster.count()) {
          await roster.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        // Roster rows carry a data-testid like lab-roster-row-<member>; hover
        // the second one (the first is usually the lab-head's own row).
        let row = page.locator('[data-testid^="lab-roster-row-"]').nth(1);
        if (!(await row.count())) {
          row = page.locator('[data-testid^="lab-roster-row-"]').first();
        }
        if (await row.count()) {
          await row.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await row.hover({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch (err) {
        console.warn(`  ⚠ user-archiving-roster hover row: ${err.message}`);
      }
    },
    highlight: { text: "Archive" },
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
    file: "photo-inbox.png",
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
    // After opening the Manage Feeds modal, expand the native Provider
    // <select> so all 4 options (iCloud / Google / Outlook / Other) render
    // as a static list. Playwright's selectOption / click can't reliably
    // *visually* open a native dropdown across platforms, but bumping
    // size= forces the options to render inline — captured in the shot.
    // Deep-link /calendar?addFeed=1 auto-opens the Linked Calendars modal on
    // mount, which is more reliable than a button click (LivingPopup animates
    // in and the old 800ms timeout fired before it was visible). waitFor on the
    // form text "Add a calendar subscription" confirms the modal is mounted.
    path: "/calendar?addFeed=1",
    file: "calendar-feeds-modal.png",
    waitFor: "text=Add a calendar subscription",
    action: async (page) => {
      // Fallback: if the deep-link didn't auto-open the modal, click the
      // Linked Calendars trigger.
      try {
        const present = await page
          .getByText(/Add a calendar subscription/i)
          .first()
          .count();
        if (!present) {
          const btn = page
            .getByText(/Manage Feeds|External Feeds|Linked Calendars/i)
            .first();
          if (await btn.count()) {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(800);
          }
        }
      } catch {}
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
  // Demo-mode LeaveDemoModal.
  //
  // The legacy `<DemoLabBanner>` was removed; the demo's only chrome is
  // the always-visible `<FloatingLeaveDemoButton>` (amber pill in the
  // bottom-right) plus `<OpenDocsButton>`. ?wikiCapture=1 alone seeds
  // the fixture but doesn't set the sticky sessionStorage demo flag, so
  // route through `/demo` (the public in-browser demo entry) which
  // flips `getDemoMode() === true` via URL match, rendering the floating
  // Leave Demo button. Click it to open `LeaveDemoModal`.
  {
    // Wait for the app to load (the old "Demo Lab" header text no longer
    // matches /demo), click the floating "Leave Demo" pill, then wait for the
    // LeaveDemoModal ("Leave the demo?" title) to mount before capture.
    path: "/demo",
    file: "demo-mode-leave.png",
    waitFor: "text=Research Project Overview",
    settleMs: 1000,
    action: async (page) => {
      try {
        const floating = page
          .locator('[aria-label*="Leave the demo" i], [aria-label*="Leave Demo" i], [aria-label*="Leave demo" i]')
          .first();
        if (await floating.count()) {
          await floating.click({ timeout: 3000 });
          await page
            .waitForSelector("text=Leave the demo?", { timeout: 4000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ demo-mode-leave click: ${err.message}`);
      }
    },
    highlight: { text: "Leave demo" },
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
  // Seeded into users/morgan/_notifications.json (a shift_alert from alex
  // pushing a shared experiment +3 days), so we view as morgan via
  // ?fixtureUser=morgan and the row reads "alex shifted PCR optimization by
  // +3d" with the date shift below it. (Was previously an empty-bell stub.)
  {
    path: "/?fixtureUser=morgan",
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
  // Trash — bulk-action bar. The fixture seeds 3 mixed-type entries in alex's
  // _trash (note / task / purchase item). Ticking the first two row checkboxes
  // reveals the sticky bar (Restore N / Permanent delete N / Clear selection).
  {
    path: "/trash",
    file: "trash-bulk-action-bar.png",
    waitFor: "text=Trash",
    settleMs: 700,
    action: async (page) => {
      try {
        // Row checkboxes live inside the section <ul><li> rows; the section
        // header's "Select all" checkbox sits outside the <ul>, so this
        // locator only matches per-row boxes. Tick the first two.
        const rowBoxes = page.locator('ul li input[type="checkbox"]');
        await rowBoxes
          .first()
          .waitFor({ state: "visible", timeout: 6000 })
          .catch(() => {});
        const n = await rowBoxes.count();
        for (let i = 0; i < Math.min(2, n); i++) {
          await rowBoxes.nth(i).click({ timeout: 3000 }).catch(() => {});
        }
        await page.waitForTimeout(500);
      } catch (err) {
        console.warn(`  ⚠ trash-bulk-action-bar select rows: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Deposit dialog — metadata-review step. Needs the fixture's project 1
  // funding_account_id (DEMO-NIH-GM999999) + alex's ORCID/displayName so the
  // Funding + Creator fields populate. Open task 2's Deposit dialog and advance
  // from Curate to Metadata.
  {
    path: "/workbench",
    file: "deposit-metadata-review.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      if (
        !(await revealCompletedAndOpenTask(
          page,
          /Yeast transformation:\s*pYES-GAL1::flbA/i,
        ))
      )
        return;
      try {
        const depositBtn = page
          .locator('[data-testid="task-deposit-button"]')
          .first();
        await depositBtn
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {});
        if (await depositBtn.count()) {
          await depositBtn.click({ timeout: 3000 });
          await page
            .waitForSelector('[data-testid="deposit-dialog"]', {
              timeout: 6000,
            })
            .catch(() => {});
        }
        // Advance Curate -> Metadata.
        const next = page
          .locator("button")
          .filter({ hasText: /^Next: metadata$/ })
          .first();
        await next.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
        if (await next.count()) {
          await next.click({ timeout: 3000 });
        }
        await page
          .waitForSelector('[data-testid="deposit-abstract"]', {
            timeout: 6000,
          })
          .catch(() => {});
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`  ⚠ deposit-metadata-review open dialog: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Markdown editor — the unified bottom attachment strip (Images / Files
  // tabs). task 2's Lab Notes carries an inline image (Images tab) AND a
  // [colony-counts.csv](Files/...) link (Files tab), so both tabs populate.
  // Caption shows the Images tab (the plate thumbnail) with the tab bar above.
  {
    path: "/workbench",
    file: "editor-attachment-strip.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      if (
        !(await revealCompletedAndOpenTask(
          page,
          /Yeast transformation:\s*pYES-GAL1::flbA/i,
        ))
      )
        return;
      await openLabNotesTab(page);
      try {
        // The attachment strip sits below the editor body; bring its Images /
        // Files tab bar into view so it lands in the viewport capture.
        const tab = page
          .locator("button")
          .filter({ hasText: /^Images$/ })
          .last();
        await tab.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
      } catch (err) {
        console.warn(`  ⚠ editor-attachment-strip scroll: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Image annotation — the saved overlay rendered INLINE in a note (not the
  // editor modal). task 5's gel (gel-pcr-screen.png) has a seeded .annot.json
  // sidecar, so previewing its Lab Notes shows the gel with the ellipse +
  // arrow + lane labels drawn on top.
  {
    path: "/workbench",
    file: "image-annotation-in-note.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(page, /PCR-screen integrants/i)))
        return;
      await openLabNotesTab(page);
      await switchEditorMode(page, "Preview");
      await page.waitForTimeout(800);
      try {
        const img = page
          .locator("img[alt*='DemoCheck' i], img.cursor-pointer")
          .first();
        await img.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`  ⚠ image-annotation-in-note scroll: ${err.message}`);
      }
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Image annotation — the full-screen ImageAnnotatorModal on the seeded gel.
  // Opening the annotator loads the saved .annot.json shapes (no live drawing
  // needed). Preview the note, click the gel to open the resize popover, then
  // click "Annotate".
  {
    path: "/workbench",
    file: "image-annotation-gel.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      if (!(await revealCompletedAndOpenTask(page, /PCR-screen integrants/i)))
        return;
      await openLabNotesTab(page);
      await switchEditorMode(page, "Preview");
      await page.waitForTimeout(800);
      try {
        const img = page
          .locator("img[alt*='DemoCheck' i], img.cursor-pointer")
          .first();
        await img.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await img.click({ timeout: 3000 });
        await page.waitForTimeout(400);
        // The resize popover exposes an "Annotate" action that opens the
        // full-screen modal (which loads the seeded shapes on mount).
        const annotate = page
          .locator("button")
          .filter({ hasText: /^Annotate$/ })
          .first();
        await annotate
          .waitFor({ state: "visible", timeout: 4000 })
          .catch(() => {});
        if (await annotate.count()) {
          await annotate.click({ timeout: 3000 });
        }
        await page
          .waitForSelector("text=Annotate image", { timeout: 6000 })
          .catch(() => {});
        await page.waitForTimeout(900);
      } catch (err) {
        console.warn(`  ⚠ image-annotation-gel open modal: ${err.message}`);
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
    file: "photo-inbox-multiselect.png",
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
        console.warn(`  ⚠ photo-inbox-multiselect open panel: ${err.message}`);
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
          console.warn(`  ⚠ photo-inbox-multiselect: 0 rows visible`);
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
        console.warn(`  ⚠ photo-inbox-multiselect select+menu: ${err.message}`);
      }
    },
    // Annotate the Shift-click target (the second inbox row) so the how-to
    // shot shows which action produced the range selection + context menu.
    highlight: {
      selector: "li.group.flex.items-center.gap-3:nth-of-type(2)",
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
  //     capture is reliable (wired below).
  //   - Steps 2-6 (Upload / Preview / Project mapping / Fetch images /
  //     Apply / Done) all require an actual LabArchives Offline Notebook
  //     ZIP that survives `parseELNZip` (JSZip + linkedom). Playwright
  //     can hand a File to the wizard's <input type="file"> via
  //     setInputFiles, but the script does NOT currently carry a
  //     fixture ZIP for the parser to consume. The wiki page references
  //     three of these (import-eln-preview.png at Step 3,
  //     import-eln-project-mapping.png at Step 4, import-eln-bulk-sort.png
  //     on the post-import BulkSortScreen). Wiring them up requires
  //     either: (a) committing a synthetic .zip fixture under
  //     scripts/fixtures/ that mirrors the LabArchives export schema
  //     parseELNZip expects (folder/page/entry XML + attachments), or
  //     (b) seeding the wizard's React state via a wikiCapture-only
  //     forceStep prop on ImportELNDialog. Both are tractable but out
  //     of scope for this chip; deferred to a dedicated fixture chip.
  //   - BulkSortScreen requires a completed import to mount. Same
  //     fixture gap — deferred.
  {
    path: "/settings",
    file: "import-eln-format-pick.png",
    waitFor: "text=Settings, text=LabArchives",
    settleMs: 1000,
    action: async (page) => {
      // The "Open import…" button is the action slot inside the
      // LabArchivesOptionCard. The data-onboarding-target attribute does NOT
      // exist on it (the old selector matched nothing and the click silently
      // no-op'd), so match by the button's visible text instead.
      try {
        const btn = page
          .locator("button")
          .filter({ hasText: /Open import/i })
          .first();
        if (await btn.count()) {
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await btn.click({ timeout: 3000 });
          // Wait for the wizard's Step 1 header ("1 · Choose format") so
          // the format-picker cards have laid out before we capture.
          await page
            .waitForSelector("text=Choose format", { timeout: 4000 })
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
          // The feedback pill sits in the bottom-right floating cluster and
          // may be below the fold; bring it into view before clicking.
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await btn.click({ timeout: 3000, force: true });
          // FeedbackModal renders an <h2> "Report an Issue" once "Bug"
          // (the default) is the selected type. Wait for it so the rest
          // of the modal body has mounted before we capture.
          await page
            .waitForSelector("text=Report an Issue", { timeout: 4000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ feedback-modal open: ${err.message}`);
      }
    },
  },
  {
    // This shot is referenced by /wiki/features/feedback (the FeedbackModal
    // with the Bug type selected, showing the editable Title, description,
    // and the auto-attached error-details section). Keep the same
    // open-the-modal action: the existing entry already opens the
    // Bug-default modal and waits for "Report an Issue".
    path: "/",
    file: "feedback-modal-bug.png",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      try {
        const btn = page.locator('[aria-label="Send feedback"]').first();
        if (await btn.count()) {
          // The feedback pill sits in the bottom-right floating cluster and
          // may be below the fold; bring it into view before clicking.
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await btn.click({ timeout: 3000, force: true });
          // FeedbackModal renders an <h2> "Report an Issue" once "Bug"
          // (the default) is the selected type. Wait for it so the rest
          // of the modal body has mounted before we capture.
          await page
            .waitForSelector("text=Report an Issue", { timeout: 4000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ feedback-modal-bug open: ${err.message}`);
      }
    },
  },
  // ── Onboarding welcome-tour (v4) captures ─────────────────────────
  //
  // Wiki target: /wiki/getting-started/welcome-wizard
  //
  // Ported 2026-05-27 (screenshot script v4 port manager) from the v3
  // selectors. v3 is fully retired. The v4 tour is a multi-phase
  // BeakerBot experience driven by TourController.tsx with the step
  // graph defined in v4/step-machine.ts (TOUR_STEP_ORDER).
  //
  // Two surfaces are captured here:
  //
  //   1. Phase 1 setup modal (welcome, setup-q1, ..., setup-wrapup).
  //      Renders as a centered card on a dim backdrop via
  //      ModalSetupShell. Carries `data-tour-modal="v4-setup"` on the
  //      outer fixed inset-0 container and `data-tour-step="<id>"` on
  //      the same node so the per-step body is identifiable.
  //
  //   2. V4ResumePrompt — the Restart / Resume / Discard modal that
  //      surfaces when a non-welcome `wizard_resume_state` is present
  //      on first mount. Carries `data-testid="v4-resume-prompt"`.
  //
  // Gate precedence: V4MountForUser only renders when isV4PreviewMode()
  // returns true (URL has `?wizard-preview=1` or `?wizardSeedStep=…`,
  // or the sticky sessionStorage flag is set). capturePage's URL
  // builder always appends `wikiCapture=1`, so a route with
  // `path: "/?wizard-preview=1"` resolves to
  // `/?wizard-preview=1&wikiCapture=1` (combined case) and v4 mounts
  // at the welcome step.
  //
  // The shipped entries below cover:
  //   - onboarding-welcome-step       (default mount at welcome)
  //   - onboarding-q1-account-type    (one Let's go click past welcome)
  //   - onboarding-hybrid-bold        (HE-5a, seeded resume_state)
  //   - onboarding-resume-modal       (V4ResumePrompt, surfaced by a
  //                                     seeded resume_state without an
  //                                     in-URL `wizardSeedStep` so
  //                                     TourBootstrap's auto-bypass
  //                                     doesn't fire)
  //
  // The seeded entries use one of:
  //   - `?wizardSeedStep=<v4-id>`        TourBootstrap reads this and
  //                                       auto-starts at the step;
  //                                       V4ResumePrompt is bypassed.
  //   - `?wizardSeedResumeStep=<v4-id>`  Mock-only alias; plants the
  //                                       same `wizard_resume_state`
  //                                       but TourBootstrap does NOT
  //                                       read it, so the resume-state
  //                                       branch fires and surfaces
  //                                       V4ResumePrompt.
  //
  // Both aliases are handled by installWikiCaptureFixture in
  // wiki-capture-mock.ts, which plants `_onboarding.json` on alex with
  // `wizard_force_show: true` plus a `wizard_resume_state` pointing at
  // the requested step. Lab-account feature_picks are seeded so any
  // lab-conditional step body mounts.
  //
  // The settings-rerun entry below IS reachable via the fixture (the
  // settings page is already captured in non-wizard mode at
  // settings.png; the Tips section renders identically here).
  {
    path: "/?wizard-preview=1",
    file: "onboarding-welcome-step.png",
    // The setup modal renders data-tour-modal="v4-setup" on the portal
    // root, and the welcome step body sets data-tour-step="welcome" on
    // the same node. Both selectors are stable across step transitions.
    waitFor: '[data-tour-modal="v4-setup"][data-tour-step="welcome"]',
    settleMs: 900,
    action: async (page) => {
      // Clip the modal card so the dimmed page behind it stays out of
      // the shot. The card is the first descendant of the modal root
      // with the bg-white + rounded-2xl classes.
      try {
        const clip = await page.evaluate(() => {
          const root = document.querySelector('[data-tour-modal="v4-setup"]');
          if (!root) return null;
          const card = root.querySelector('div[class*="rounded-2xl"]');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          const pad = 24;
          return {
            x: Math.max(0, Math.floor(r.left - pad)),
            y: Math.max(0, Math.floor(r.top - pad)),
            width: Math.min(
              Math.max(0, window.innerWidth - Math.floor(r.left - pad)),
              Math.ceil(r.width + pad * 2),
            ),
            height: Math.min(
              Math.max(0, window.innerHeight - Math.floor(r.top - pad)),
              Math.ceil(r.height + pad * 2),
            ),
          };
        });
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-welcome-step clip calc: ${err.message}`,
        );
      }
    },
  },
  {
    path: "/?wizard-preview=1",
    file: "onboarding-q1-account-type.png",
    waitFor: '[data-tour-modal="v4-setup"][data-tour-step="welcome"]',
    settleMs: 700,
    action: async (page) => {
      // Click Let's go to advance from welcome to setup-q1. The shell's
      // Next button label is "Let's go" on the welcome step (see
      // nextLabel in TourController.tsx ModalSetupShell). After the
      // click we wait for the setup-q1 step body to mount.
      try {
        const letsGo = page.getByRole("button", { name: /Let's go/i }).first();
        if (await letsGo.count()) {
          await letsGo.click({ timeout: 3000 });
          await page
            .waitForSelector(
              '[data-tour-modal="v4-setup"][data-tour-step="setup-q1"]',
              { timeout: 4000 },
            )
            .catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-q1-account-type advance: ${err.message}`,
        );
      }
      // Clip the modal card.
      try {
        const clip = await page.evaluate(() => {
          const root = document.querySelector('[data-tour-modal="v4-setup"]');
          if (!root) return null;
          const card = root.querySelector('div[class*="rounded-2xl"]');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          const pad = 24;
          return {
            x: Math.max(0, Math.floor(r.left - pad)),
            y: Math.max(0, Math.floor(r.top - pad)),
            width: Math.min(
              Math.max(0, window.innerWidth - Math.floor(r.left - pad)),
              Math.ceil(r.width + pad * 2),
            ),
            height: Math.min(
              Math.max(0, window.innerHeight - Math.floor(r.top - pad)),
              Math.ceil(r.height + pad * 2),
            ),
          };
        });
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-q1-account-type clip calc: ${err.message}`,
        );
      }
    },
  },
  // Wizard-step-seeded captures (v4 port 2026-05-27).
  //
  // `?wizardSeedStep=<id>` is read by installWikiCaptureFixture in
  // wiki-capture-mock.ts AND by TourBootstrap. The mock plants an
  // `alex/_onboarding.json` with `wizard_force_show: true` plus a
  // `wizard_resume_state` pointing at the requested step. Under v4,
  // TourBootstrap also reads the URL param and calls
  // `controller.start(seedStep)` directly, so the V4ResumePrompt is
  // BYPASSED and the controller lands on the requested step body
  // immediately. (The v3 flow surfaced WizardResumeModal first and
  // required a Resume click; v4 does not.)
  //
  // The seed bakes lab-account feature_picks (account_type=lab + every
  // optional Q=yes) so any lab-conditional step body mounts.
  //
  // For the in-product walkthrough (post-setup phases), the surface is
  // a free-floating speech bubble + spotlight (NOT a modal), so the
  // clip calc anchors on `[data-testid="tour-beakerbot-overlay"]` and
  // expands to include the spotlight target rather than just the
  // bubble.
  {
    // V4ResumePrompt — the Restart / Resume / Discard modal that
    // surfaces when v4 boots with a non-welcome `wizard_resume_state`.
    //
    // Critical v4 detail: TourBootstrap reads `wizardSeedStep` from the
    // URL and auto-starts at that step (bypassing V4ResumePrompt). To
    // capture the prompt itself, we use the mock-only alias
    // `wizardSeedResumeStep=<id>`. The mock plants the same sidecar
    // (resume_state.current_step = the requested step) but
    // TourBootstrap does NOT read this param, so its preview-mode
    // branch falls through to the resume_state path and the prompt
    // renders. See wiki-capture-mock.ts for the alias handling.
    //
    // Seed step: hybrid-bold (a mid-walkthrough beat so the "continue
    // your welcome tour" copy reads naturally; the prompt body does
    // not actually echo the step id but a mid-tour step is the only
    // gate to surface the prompt).
    path: "/?wizard-preview=1&wizardSeedResumeStep=hybrid-bold",
    file: "onboarding-resume-modal.png",
    waitFor: '[data-testid="v4-resume-prompt"]',
    settleMs: 700,
    highlight: { text: "Resume" },
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          const modal = document.querySelector(
            '[data-testid="v4-resume-prompt"]',
          );
          if (!modal) return null;
          const card = modal.querySelector('div[class*="rounded-2xl"]');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          const pad = 24;
          return {
            x: Math.max(0, Math.floor(r.left - pad)),
            y: Math.max(0, Math.floor(r.top - pad)),
            width: Math.min(
              Math.max(0, window.innerWidth - Math.floor(r.left - pad)),
              Math.ceil(r.width + pad * 2),
            ),
            height: Math.min(
              Math.max(0, window.innerHeight - Math.floor(r.top - pad)),
              Math.ceil(r.height + pad * 2),
            ),
          };
        });
        if (clip && clip.width > 100 && clip.height > 100) {
          return { clip };
        }
      } catch (err) {
        console.warn(
          `  ⚠ onboarding-resume-modal clip calc: ${err.message}`,
        );
      }
    },
  },
  // ── Version history (Notes pilot) — wiki/features/version-history ──────────
  // All five shots open the seeded note 5 ("qPCR optimization log") on
  // /workbench and drive the version-history sidebar. The history is pre-seeded
  // (real-engine jsonl) in installWikiCaptureFixture, so the sidebar populates
  // with a multi-day, multi-editor (alex + morgan) timeline plus a live restore
  // window.
  {
    // version-history-sidebar.png — the populated sidebar beside the note body.
    // HEAD is auto-selected; expand the editing-session groups so the day
    // headers + per-session rows + Current pin all read. Clip to the popup card.
    path: "/workbench",
    file: "version-history-sidebar.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      if (!(await openSeededNote(page))) return;
      if (!(await openHistorySidebar(page))) return;
      await hideNoteComments(page);
      // Expand the editing-session groups so the individual rows (avatar +
      // one-line summary + relative time) show. HEAD stays auto-selected so the
      // list stays scrolled to the top with the Current-version pin in frame and
      // Today / Yesterday / dated day headers reading down the timeline.
      await expandSessions(page);
      // Scroll the version list back to the top (expanding can shift it).
      try {
        await page.evaluate(() => {
          const list = document.querySelector('[data-testid="version-list"]');
          if (list) list.scrollTop = 0;
        });
        await page.waitForTimeout(200);
      } catch {}
      const clip = await notePopupClip(page);
      if (clip && clip.width > 100 && clip.height > 100) return { clip };
    },
  },
  {
    // version-history-diff.png — the in-place diff. Select morgan's draft-entry
    // save (row 4) so the added run carries morgan's per-editor tint + avatar,
    // visibly distinct from the alex-authored context around it.
    path: "/workbench",
    file: "version-history-diff.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      if (!(await openSeededNote(page))) return;
      if (!(await openHistorySidebar(page))) return;
      // Hide the comments thread so the document column gets the full popup
      // height and the diff block is not squeezed to a sliver.
      await hideNoteComments(page);
      // Select morgan's "edited entry 1 numbers" save (row 3): the change lands
      // in the first running-log entry, so the in-place diff (green added + red
      // strike-through removed, morgan's left-border tint + M avatar on each run)
      // fills the document column. Scroll the changed block into frame so both
      // the green-added and red-removed runs are visible together, with the full
      // timeline on the right showing the alex + morgan editors.
      await selectVersionByIndex(page, 3);
      await scrollDiffIntoView(page);
      const clip = await notePopupClip(page);
      if (clip && clip.width > 100 && clip.height > 100) return { clip };
    },
  },
  {
    // version-history-compare-toggle.png — the Previous/Current segmented
    // control with Previous selected (the default). Tight-clip the compare-base
    // row at the top of the sidebar.
    path: "/workbench",
    file: "version-history-compare-toggle.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      if (!(await openSeededNote(page))) return;
      if (!(await openHistorySidebar(page))) return;
      await selectVersionByIndex(page, 4);
      // Ensure Previous is the active base (it is by default; click to be sure).
      try {
        const prev = page.locator('[data-testid="compare-previous"]').first();
        if (await prev.count()) {
          await prev.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      } catch {}
      // Clip a band around the compare toggle: from the sidebar's left edge
      // (which is the toggle row) across the toggle and a little below.
      const clip = await page.evaluate(() => {
        const prev = document.querySelector('[data-testid="compare-previous"]');
        if (!prev) return null;
        // Walk up to the toggle row (the flex container holding the label +
        // the segmented control).
        let row = prev.parentElement;
        while (row && !/Compare against/i.test(row.textContent || "")) {
          row = row.parentElement;
        }
        if (!row) row = prev.closest("div");
        const r = (row || prev).getBoundingClientRect();
        const padX = 14;
        const padY = 12;
        const x = Math.max(0, Math.floor(r.left - padX));
        const y = Math.max(0, Math.floor(r.top - padY));
        const width = Math.min(
          Math.max(0, window.innerWidth - x),
          Math.ceil(r.width + padX * 2),
        );
        const height = Math.min(
          Math.max(0, window.innerHeight - y),
          Math.ceil(r.height + padY * 2),
        );
        return { x, y, width, height };
      });
      if (clip && clip.width > 80 && clip.height > 40) return { clip };
    },
  },
  {
    // version-history-restore.png — an earlier (non-current) version selected,
    // the green "Restore this version" sticky footer shown WITH its inline
    // confirm prompt. Select row 2 (an early alex save), then click the
    // restore button so the inline confirm/cancel pair renders.
    path: "/workbench",
    file: "version-history-restore.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      if (!(await openSeededNote(page))) return;
      if (!(await openHistorySidebar(page))) return;
      await hideNoteComments(page);
      // Expand ONLY the oldest editing-session group (the MAY 29 "alex, 2
      // versions" run) and select its "added entry" save (row 2). Keeping the
      // other groups collapsed keeps the version list short so the sticky footer
      // stays inside the popup card (a fully-expanded list overflows the card
      // and pushes the footer below the fold). With a NON-HEAD version selected
      // and restore enabled, the green "Restore this version" button renders in
      // the footer. We leave it in its default (pre-confirm) state since the
      // wiki caption foregrounds the Restore affordance; the inline
      // confirm/cancel pair is its next step.
      try {
        const lastCollapsed = await page.evaluate(() => {
          const groups = document.querySelectorAll(
            '[data-testid="session-collapsed"]',
          );
          if (!groups.length) return false;
          groups[groups.length - 1].click(); // oldest group = MAY 29
          return true;
        });
        if (lastCollapsed) await page.waitForTimeout(400);
      } catch {}
      try {
        const row = page
          .locator('[data-testid="version-row"][data-version-index="2"]')
          .first();
        if (await row.count()) {
          // DOM-level click (row is a div in the animating sidebar).
          await page.evaluate(() => {
            document
              .querySelector(
                '[data-testid="version-row"][data-version-index="2"]',
              )
              ?.click();
          });
          await page.waitForTimeout(600);
        }
      } catch (err) {
        console.warn(`  ⚠ version-history-restore select row: ${err.message}`);
      }
      try {
        await page.waitForSelector('[data-testid="restore-button"]', {
          timeout: 4000,
        });
      } catch {
        console.warn("  ⚠ version-history-restore: restore button never rendered");
      }
      // Cap the sidebar so the sticky footer (green Restore button) pins inside
      // the card instead of overflowing below the fold.
      await capSidebarToCard(page);
      const clip = await notePopupClip(page);
      if (clip && clip.width > 100 && clip.height > 100) return { clip };
    },
  },
  {
    // version-history-undo.png — the popup header "Undo restore" affordance,
    // live because note 5 carries a fresh 24h revert_undo_window. Open the note
    // (the button is header-scoped, no sidebar needed) and tight-clip the
    // popup header band so the Undo restore button is the focus.
    path: "/workbench",
    file: "version-history-undo.png",
    waitFor: "text=Workbench, text=Notes",
    settleMs: 700,
    action: async (page) => {
      if (!(await openSeededNote(page))) return;
      // Confirm the undo button is present before clipping.
      try {
        await page.waitForSelector('[data-testid="note-undo-restore-button"]', {
          timeout: 4000,
        });
      } catch {
        console.warn("  ⚠ version-history-undo: undo button never rendered");
      }
      // Clip the popup header region (title row through the action buttons) so
      // the Undo restore button reads clearly without the whole note body.
      const clip = await page.evaluate(() => {
        const undo = document.querySelector(
          '[data-testid="note-undo-restore-button"]',
        );
        const occluder = document.querySelector(
          '[data-tour-popup-occluding="note-detail"]',
        );
        const card =
          occluder?.querySelector('div[class*="rounded-2xl"]') ??
          occluder?.firstElementChild;
        if (!card) return null;
        const cardR = card.getBoundingClientRect();
        const pad = 16;
        const x = Math.max(0, Math.floor(cardR.left - pad));
        const y = Math.max(0, Math.floor(cardR.top - pad));
        const width = Math.min(
          Math.max(0, window.innerWidth - x),
          Math.ceil(cardR.width + pad * 2),
        );
        // Height: from the card top down to a bit below the undo button (or a
        // sensible default header band if the button query missed).
        let bottom = cardR.top + 150;
        if (undo) {
          const uR = undo.getBoundingClientRect();
          bottom = Math.max(bottom, uR.bottom + 24);
        }
        const height = Math.min(
          Math.max(0, window.innerHeight - y),
          Math.ceil(bottom - cardR.top + pad),
        );
        return { x, y, width, height };
      });
      if (clip && clip.width > 100 && clip.height > 60) return { clip };
    },
  },
  // ── Template library money shot — landing hero band 2 ──────────────────────
  // method-catalog-source-pdf.png (landing-hero-cards sub-bot of HR,
  // 2026-06-01). Opens the Template library modal on /methods, narrows to the
  // Kits category, and selects the bundled-PDF "Qubit dsDNA HS assay" template
  // so the detail pane shows the structured, vendor-grounded preview PLUS the
  // "Includes a bundled source PDF (Qubit_dsDNA_HS_Assay_UG.pdf)" line — the
  // differentiator that the original source insert travels with the template.
  // Clips to the modal's white card so the dimmed page + floating dev cluster
  // stay out of frame.
  {
    path: "/methods",
    file: "method-catalog-source-pdf.png",
    waitFor: "text=Methods",
    settleMs: 1000,
    action: async (page) => {
      // Open the Template library modal.
      try {
        const btn = page
          .locator('[data-tour-target="methods-template-library-button"]')
          .first();
        // Wait for the button + let the Methods page finish hydrating (the
        // catalog loads async; the button can be visible but not yet wired,
        // so a plain click times out). Settle, then force-click past any
        // transient stability check.
        await btn.waitFor({ state: "visible", timeout: 12000 });
        await page.waitForTimeout(1500);
        await btn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  ⚠ method-catalog-source-pdf open modal: ${err.message}`);
        return;
      }
      // Ensure the Templates segment is active (it is by default in some builds;
      // click to be sure so the catalog cards render).
      try {
        const tplSeg = page
          .locator("button")
          .filter({ hasText: /^Templates$/ })
          .first();
        if (await tplSeg.count()) {
          await tplSeg.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
      // Narrow to the Kits category so the bundled-PDF Qubit assay is in the
      // first column of cards (it lives under Kits, below the fold otherwise).
      try {
        const kits = page
          .locator("button")
          .filter({ hasText: /^Kits\b/ })
          .first();
        await kits.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
        if (await kits.count()) {
          await kits.click({ timeout: 4000, force: true }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
      // Select the Qubit dsDNA HS assay template so the detail pane renders the
      // structured preview + the bundled-source-PDF line.
      try {
        const qubit = page.getByText(/Qubit dsDNA HS/i).first();
        await qubit.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        if (!(await qubit.count())) {
          console.warn("  ⚠ method-catalog-source-pdf: qubit card not found");
          return;
        }
        await qubit.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        await qubit.click({ timeout: 4000, force: true });
        await page.waitForTimeout(1500);
      } catch (err) {
        console.warn(`  ⚠ method-catalog-source-pdf select card: ${err.message}`);
        return;
      }
      // Confirm the bundled-PDF line rendered (the differentiator we are after)
      // before clipping; warn but still capture if the text query misses.
      try {
        await page.waitForFunction(
          () => /bundled source PDF/i.test(document.body.innerText),
          { timeout: 4000 },
        );
      } catch {
        console.warn(
          "  ⚠ method-catalog-source-pdf: bundled-PDF line never rendered",
        );
      }
      // Clip to the modal's white card (the rounded-xl shadow-2xl wrapper inside
      // the fixed-inset-0 z-50 backdrop), excluding the dimmed page behind it.
      const clip = await page.evaluate(() => {
        const backdrop = document.querySelector(".fixed.inset-0.z-50");
        if (!backdrop) return null;
        const card =
          backdrop.querySelector('div[class*="rounded-xl"][class*="shadow-2xl"]') ??
          backdrop.firstElementChild;
        if (!card) return null;
        const r = card.getBoundingClientRect();
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
      if (clip && clip.width > 200 && clip.height > 200) return { clip };
    },
  },
  {
    // method-catalog-library.png — the Template Library picker (full view): the
    // category rail on the left + the grid of template cards. Referenced by
    // /wiki/features/method-catalog. Open the modal, activate the Templates
    // segment, and capture the grid WITHOUT selecting a specific template.
    path: "/methods",
    file: "method-catalog-library.png",
    waitFor: "text=Methods",
    settleMs: 1000,
    action: async (page) => {
      try {
        const btn = page
          .locator('[data-tour-target="methods-template-library-button"]')
          .first();
        await btn.waitFor({ state: "visible", timeout: 12000 });
        await page.waitForTimeout(1500);
        await btn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  ⚠ method-catalog-library open modal: ${err.message}`);
        return;
      }
      try {
        const tplSeg = page
          .locator("button")
          .filter({ hasText: /^Templates$/ })
          .first();
        if (await tplSeg.count()) {
          await tplSeg.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1000);
        }
      } catch {}
      // Clip to the modal's white card.
      const clip = await page.evaluate(() => {
        const backdrop = document.querySelector(".fixed.inset-0.z-50");
        if (!backdrop) return null;
        const card =
          backdrop.querySelector('div[class*="rounded-xl"][class*="shadow-2xl"]') ??
          backdrop.firstElementChild;
        if (!card) return null;
        const r = card.getBoundingClientRect();
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
      if (clip && clip.width > 200 && clip.height > 200) return { clip };
    },
  },
  {
    // method-catalog-template-detail.png — the detail pane for a simple PCR
    // template (title + method-type pill, description, structured preview, the
    // "Will be added to: Uncategorized" line, and the blue "Use template"
    // button). Referenced by /wiki/features/method-catalog. The catalog ships
    // in the fixture, so no seeded methods are needed.
    path: "/methods",
    file: "method-catalog-template-detail.png",
    waitFor: "text=Methods",
    settleMs: 1000,
    action: async (page) => {
      try {
        const btn = page
          .locator('[data-tour-target="methods-template-library-button"]')
          .first();
        await btn.waitFor({ state: "visible", timeout: 12000 });
        await page.waitForTimeout(1500);
        await btn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  ⚠ method-catalog-template-detail open modal: ${err.message}`);
        return;
      }
      try {
        const tplSeg = page
          .locator("button")
          .filter({ hasText: /^Templates$/ })
          .first();
        if (await tplSeg.count()) {
          await tplSeg.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
      // Select a simple PCR template so the detail pane shows a clear structured
      // preview + the "Use template" button (not a gated "Enable <type>" state).
      try {
        const card = page
          .getByText(/Taq|Q5|Phusion|Colony PCR|PCR/i)
          .first();
        await card.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await card.click({ timeout: 4000, force: true });
          await page.waitForTimeout(1200);
        }
      } catch (err) {
        console.warn(`  ⚠ method-catalog-template-detail select card: ${err.message}`);
      }
      const clip = await page.evaluate(() => {
        const backdrop = document.querySelector(".fixed.inset-0.z-50");
        if (!backdrop) return null;
        const card =
          backdrop.querySelector('div[class*="rounded-xl"][class*="shadow-2xl"]') ??
          backdrop.firstElementChild;
        if (!card) return null;
        const r = card.getBoundingClientRect();
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
      if (clip && clip.width > 200 && clip.height > 200) return { clip };
    },
    highlight: { text: "Use template" },
  },
  {
    // method-catalog-384-plate.png — the detail pane for the MTT / CellTiter
    // 384-well plate-layout template, showing the rendered 384-well grid with
    // control columns + the dose-response series. Referenced by
    // /wiki/features/method-catalog. Catalog ships in the fixture.
    path: "/methods",
    file: "method-catalog-384-plate.png",
    waitFor: "text=Methods",
    settleMs: 1000,
    action: async (page) => {
      try {
        const btn = page
          .locator('[data-tour-target="methods-template-library-button"]')
          .first();
        await btn.waitFor({ state: "visible", timeout: 12000 });
        await page.waitForTimeout(1500);
        await btn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  ⚠ method-catalog-384-plate open modal: ${err.message}`);
        return;
      }
      try {
        const tplSeg = page
          .locator("button")
          .filter({ hasText: /^Templates$/ })
          .first();
        if (await tplSeg.count()) {
          await tplSeg.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch {}
      // Optionally narrow to Plate layouts, then select the 384-well MTT card.
      try {
        const plates = page
          .locator("button")
          .filter({ hasText: /^Plate layouts/i })
          .first();
        if (await plates.count()) {
          await plates.click({ timeout: 3000, force: true }).catch(() => {});
          await page.waitForTimeout(700);
        }
      } catch {}
      try {
        const card = page
          .getByText(/MTT.*cell-viability.*384-well|384-well/i)
          .first();
        await card.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await card.click({ timeout: 4000, force: true });
          await page.waitForTimeout(1500);
        }
      } catch (err) {
        console.warn(`  ⚠ method-catalog-384-plate select card: ${err.message}`);
      }
      const clip = await page.evaluate(() => {
        const backdrop = document.querySelector(".fixed.inset-0.z-50");
        if (!backdrop) return null;
        const card =
          backdrop.querySelector('div[class*="rounded-xl"][class*="shadow-2xl"]') ??
          backdrop.firstElementChild;
        if (!card) return null;
        const r = card.getBoundingClientRect();
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
      if (clip && clip.width > 200 && clip.height > 200) return { clip };
    },
  },
  // ── Welcome / landing-page showcase shots ───────────────────────────────
  // Referenced by LandingPage.tsx. These were hand-captured back in May, so
  // they went stale (lab-overview showed the deleted widget canvas) and leaked
  // the dev FAB dock. Captured by the pipeline now so they stay current +
  // dev-button-free (applyClean hides the dock on all of these too).
  {
    // The unified Share dialog, opened on a user method. The fixture seeds
    // "Growth-curve QC analysis" under My Methods; open it to show the detail
    // pane, then click its "Share method" header button (aria-label).
    path: "/methods",
    file: "sharing-method-share-dialog.png",
    waitFor: "text=Method Library",
    settleMs: 1000,
    action: async (page) => {
      try {
        const method = page.getByText(/Growth-curve QC analysis/i).first();
        await method.waitFor({ state: "visible", timeout: 12000 });
        // DOM-click the clickable method card (cards are divs).
        await page.evaluate(() => {
          const leaf = [...document.querySelectorAll("*")].find(
            (e) =>
              e.children.length === 0 &&
              /Growth-curve QC analysis/i.test(e.textContent || ""),
          );
          let c = leaf;
          for (let i = 0; i < 8 && c; i++) {
            const cs = getComputedStyle(c);
            if (
              cs.cursor === "pointer" ||
              c.getAttribute("role") === "button" ||
              c.tagName === "BUTTON"
            ) {
              c.click();
              return;
            }
            c = c.parentElement;
          }
          leaf?.click();
        });
        await page.waitForTimeout(1000);
      } catch (err) {
        console.warn(`  ⚠ sharing-method open method: ${err.message}`);
      }
      try {
        // The share trigger is the "Private"/"Public" toggle in the method-
        // detail header. It has no stable aria-label, so match by exact text.
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some((b) =>
              /^(Private|Public)$/.test((b.textContent || "").trim()),
            ),
          { timeout: 8000 },
        );
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find((b) =>
            /^(Private|Public)$/.test((b.textContent || "").trim()),
          );
          btn?.click();
        });
        await page
          .waitForFunction(
            () => /Currently shared with/.test(document.body.innerText),
            { timeout: 6000 },
          )
          .catch(() => {});
        await page.waitForTimeout(700);
      } catch (err) {
        console.warn(`  ⚠ sharing-method open dialog: ${err.message}`);
      }
    },
  },

  // ── Sequence editor shots ─────────────────────────────────────────────────

  {
    // 1. Whole workbench: library panel + open plasmid in Map view.
    //    pEGFP-N1 is the first fixture sequence; it auto-selects on load.
    path: "/sequences",
    file: "sequences-workbench-overview.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1200,
    action: async (page) => {
      try {
        const mapTab = page.getByRole("tab", { name: /^Map$/i }).first();
        if (await mapTab.count()) {
          await mapTab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch {}
    },
  },
  {
    // 2. Library panel: collection selector visible, crop to the left panel.
    //    The selector is a native <select> so we capture its closed state.
    path: "/sequences",
    file: "sequences-library-filter.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 900,
    action: async (page) => {
      // Crop to the left library panel (roughly 380 px wide).
      const clip = await page.evaluate(() => {
        const panel = document.querySelector("[data-library-panel], aside, .library-panel");
        if (panel) {
          const r = panel.getBoundingClientRect();
          return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
        }
        // Fallback: crop to left 380 px, full height.
        return { x: 0, y: 0, width: 380, height: 900 };
      });
      return { clip };
    },
  },
  {
    // 3. Circular plasmid map with labeled feature arcs.
    path: "/sequences",
    file: "sequences-circular-map.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1200,
    action: async (page) => {
      try {
        const mapTab = page.getByRole("tab", { name: /^Map$/i }).first();
        if (await mapTab.count()) {
          await mapTab.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        }
      } catch {}
      // Crop to the editor panel (right of the library).
      const clip = await page.evaluate(() => {
        const lib = document.querySelector("select");
        if (lib) {
          const libRect = lib.closest("aside, [class*='library'], [class*='panel']")?.getBoundingClientRect();
          const libRight = libRect ? Math.ceil(libRect.right) : 380;
          return { x: libRight, y: 0, width: window.innerWidth - libRight, height: window.innerHeight };
        }
        return { x: 375, y: 0, width: 1065, height: 900 };
      });
      return { clip };
    },
  },
  {
    // 3b. Restriction-digest view: pEGFP-N1 with Cut sites enabled, so the
    // circular map carries enzyme labels (NcoI, KpnI, SphI, NruI...) with
    // leader lines to each cut position. For the features/restriction-digest
    // wiki page. Captured in the split Sequence view (map + bases) because
    // that is where the enzyme labels render on the ring.
    path: "/sequences",
    file: "restriction-digest-map.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1200,
    action: async (page) => {
      try {
        const item = page.getByText(/pEGFP-N1 \(U55762\)/).first();
        if (await item.count()) {
          await item.click({ timeout: 4000 });
          await page.waitForTimeout(1200);
        }
        // The enzyme-picker dialog was retired (commit 4f62434e9). Enzyme
        // site display is now toggled via the "Enzyme sites" switch in the
        // bottom SequenceDisplayStrip toolbar, which renders the restriction
        // map with the default COMMON_ENZYMES labels (NcoI, KpnI, SphI...).
        await page
          .getByRole("switch", { name: "Enzyme sites" })
          .first()
          .click({ timeout: 4000 })
          .catch(() => {});
        await page.waitForTimeout(1000);
        const seqTab = page.getByRole("tab", { name: /^Sequence$/i }).first();
        if (await seqTab.count()) {
          await seqTab.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
        }
      } catch {}
      // Crop to the editor panel (right of the library), matching the
      // circular-map route's clip logic.
      const clip = await page.evaluate(() => {
        const lib = document.querySelector("select");
        if (lib) {
          const libRect = lib
            .closest("aside, [class*='library'], [class*='panel']")
            ?.getBoundingClientRect();
          const libRight = libRect ? Math.ceil(libRect.right) : 380;
          return {
            x: libRight,
            y: 0,
            width: window.innerWidth - libRight,
            height: window.innerHeight,
          };
        }
        return { x: 375, y: 0, width: 1065, height: 900 };
      });
      return { clip };
    },
  },
  {
    // 4. Base-level sequence view: complement strand, ruler, feature tracks.
    // Extend the settle after switching to the Sequence tab so any dev-only
    // debug overlay (e.g. the "base-level readout row" label) has disappeared
    // before capture — those artifacts must not leak into the wiki shot.
    path: "/sequences",
    file: "sequences-base-view.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1600,
    action: async (page) => {
      try {
        const seqTab = page.getByRole("tab", { name: /^Sequence$/i }).first();
        if (await seqTab.count()) {
          await seqTab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch {}
    },
  },
  {
    // 5. Operations rail: the narrow icon-button rail (~60px) on the RIGHT
    //    edge of the editor (data-testid="sequence-operations"), with the
    //    Design / Analyze / Export / More groups stacked vertically. The old
    //    crop targeted a band after the library on the LEFT, which is the
    //    canvas, not the rail — clip to the rail element itself instead.
    path: "/sequences",
    file: "sequences-view-rail.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1200,
    action: async (page) => {
      try {
        const mapTab = page.getByRole("tab", { name: /^Map$/i }).first();
        if (await mapTab.count()) {
          await mapTab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
      } catch {}
      // Clip to the right-edge operations rail.
      const clip = await page.evaluate(() => {
        const rail = document.querySelector('[data-testid="sequence-operations"]');
        if (rail) {
          const r = rail.getBoundingClientRect();
          const pad = 8;
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
        }
        // Fallback: a thin band along the right edge.
        return { x: window.innerWidth - 72, y: 60, width: 72, height: 780 };
      });
      return { clip };
    },
  },
  {
    // 6. Feature-edit dialog open on a feature.
    path: "/sequences",
    file: "sequences-feature-dialog.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        const featTab = page.getByRole("tab", { name: /Features/i }).first();
        if (await featTab.count()) {
          await featTab.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
        // Click the first edit (pencil) button in the features panel.
        const editBtn = page
          .locator('button[aria-label*="Edit"], button[title*="Edit"], button[aria-label*="edit"]')
          .first();
        if (await editBtn.count()) {
          await editBtn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        } else {
          // Fallback: double-click first feature row.
          const firstRow = page.locator('[role="row"], [data-feature-row]').first();
          if (await firstRow.count()) {
            await firstRow.dblclick({ timeout: 3000 });
            await page.waitForTimeout(800);
          }
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-feature-dialog action: ${err.message}`);
      }
    },
  },
  {
    // 7. Live selection readout: coords, bp count, GC% at the bottom.
    path: "/sequences",
    file: "sequences-selection-readout.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        const seqTab = page.getByRole("tab", { name: /^Sequence$/i }).first();
        if (await seqTab.count()) {
          await seqTab.click({ timeout: 3000 });
          await page.waitForTimeout(900);
        }
        // Click somewhere in the sequence view to trigger a selection readout.
        // The editor panel sits right of the library (x ~400, y ~400).
        await page.mouse.click(900, 350);
        await page.waitForTimeout(500);
        // Drag to select ~30 bp.
        await page.mouse.move(780, 320);
        await page.mouse.down();
        await page.mouse.move(980, 320);
        await page.mouse.up();
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`  ⚠ sequences-selection-readout action: ${err.message}`);
      }
    },
  },
  {
    // 8. Primer design dialog: Add primer flow with live stats. The Feature/
    // Primer/Enzyme toolbar dropdowns were removed (SequenceEditView.tsx) and
    // replaced with right-click context menus, so select a region, right-click
    // it, and choose "Design primers here…" to open the Add primer dialog.
    path: "/sequences",
    file: "sequences-primer-design.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        // Select a region of the sequence by clicking + shift-clicking across
        // the base track, then right-click to open the context menu.
        const seq = page.locator(".la-vz-seq").first();
        if (await seq.count()) {
          await seq.click({ position: { x: 100, y: 20 }, timeout: 3000 }).catch(() => {});
          await seq
            .click({ position: { x: 200, y: 20 }, modifiers: ["Shift"], timeout: 3000 })
            .catch(() => {});
          await seq
            .click({ position: { x: 200, y: 20 }, button: "right", timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(500);
        }
        // Click "Design primers here…" in the context menu.
        const item = page
          .getByRole("menuitem", { name: /Design primers here/i })
          .first();
        if (await item.count()) {
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
        // Fill the primer sequence textarea so the live stats (N-mer, GC%, Tm)
        // populate.
        const input = page
          .locator('textarea, input[placeholder*="bases" i], input[placeholder*="sequence" i]')
          .first();
        if (await input.count()) {
          await input.fill("ATGGTGAGCAAGGGCGAGGAG");
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-primer-design action: ${err.message}`);
      }
    },
    highlight: {
      selector: 'textarea, input[placeholder*="bases" i], input[placeholder*="sequence" i]',
    },
  },
  {
    // 9. NCBI specificity handoff: the Primers Check tab with the
    // "Check genome-wide on NCBI" / "Open Primer-BLAST" handoff button visible.
    // The Feature/Primer/Enzyme toolbar dropdowns were removed and replaced
    // with right-click context menus, so reach the Add primer dialog via the
    // "Design primers here…" context-menu item (same flow as primer-design).
    path: "/sequences",
    file: "sequences-ncbi-specificity.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        // Select a region and open the context menu → Design primers here…
        const seq = page.locator(".la-vz-seq").first();
        if (await seq.count()) {
          await seq.click({ position: { x: 100, y: 20 }, timeout: 3000 }).catch(() => {});
          await seq
            .click({ position: { x: 200, y: 20 }, modifiers: ["Shift"], timeout: 3000 })
            .catch(() => {});
          await seq
            .click({ position: { x: 200, y: 20 }, button: "right", timeout: 3000 })
            .catch(() => {});
          await page.waitForTimeout(500);
        }
        const item = page
          .getByRole("menuitem", { name: /Design primers here/i })
          .first();
        if (await item.count()) {
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(600);
        }
        // Fill a primer sequence.
        const input = page
          .locator('textarea, input[placeholder*="bases" i], input[placeholder*="sequence" i]')
          .first();
        if (await input.count()) {
          await input.fill("ATGGTGAGCAAGGGCGAGGAG");
          await page.waitForTimeout(500);
        }
        // Click the "Check" tab if it exists.
        const checkTab = page.getByRole("tab", { name: /Check/i }).first();
        if (await checkTab.count()) {
          await checkTab.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
        // Click "Check specificity" to reveal the NCBI handoff button.
        const checkBtn = page.getByRole("button", { name: /Check specificity/i }).first();
        if (await checkBtn.count()) {
          await checkBtn.click({ timeout: 3000 });
          await page.waitForTimeout(700);
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-ncbi-specificity action: ${err.message}`);
      }
    },
  },
  {
    // 10. Cloning workspace: the four-method picker (Overlap / Restriction /
    //     Golden Gate / Gateway).
    path: "/sequences",
    file: "sequences-cloning-methods.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        const assembleBtn = page.getByRole("button", { name: /Assemble/i }).first();
        if (await assembleBtn.count()) {
          await assembleBtn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-cloning-methods action: ${err.message}`);
      }
    },
  },
  {
    // 11. Cloning workspace review step: assembled product with junctions.
    //     Add two fragments from the library then click Review junctions.
    path: "/sequences",
    file: "sequences-cloning-review.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        // Open the cloning workspace.
        const assembleBtn = page.getByRole("button", { name: /Assemble/i }).first();
        if (await assembleBtn.count()) {
          await assembleBtn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
        // The library panel is an <aside> with heading "Your DNA library".
        // Each sequence row is a <li><button> inside that panel's <ul>.
        const libButtons = page.locator('aside:has-text("Your DNA library") ul li button');
        const count = await libButtons.count();
        if (count >= 1) {
          await libButtons.nth(0).click({ timeout: 3000, force: true });
          await page.waitForTimeout(400);
        }
        if (count >= 2) {
          // Click a second distinct library row (index 1).
          await libButtons.nth(1).click({ timeout: 3000, force: true });
          await page.waitForTimeout(400);
        } else if (count >= 1) {
          // Only one sequence — click same one again (Review requires 2+).
          await libButtons.nth(0).click({ timeout: 3000, force: true });
          await page.waitForTimeout(400);
        }
        // Hide the floating dock again (React may have re-rendered it after
        // the dialog opened, re-enabling its pointer events).
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("[data-floating-dock]")) {
            el.style.display = "none";
          }
        });
        // Click "Review junctions" (now enabled with 2+ fragments).
        const reviewBtn = page
          .getByRole("button", { name: /Review junctions|Review the product|Review recombination/i })
          .first();
        if (await reviewBtn.count()) {
          await reviewBtn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await reviewBtn.click({ timeout: 5000 });
          await page.waitForTimeout(2500);
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-cloning-review action: ${err.message}`);
      }
    },
  },
  {
    // 12. Compare / align dialog: pairwise alignment result with dotplot.
    path: "/sequences",
    file: "sequences-compare.png",
    waitFor: "text=pEGFP-N1",
    settleMs: 1000,
    action: async (page) => {
      try {
        // Click the Align button in the library header.
        const alignBtn = page.getByRole("button", { name: /^Align$/i }).first();
        if (await alignBtn.count()) {
          await alignBtn.click({ timeout: 3000 });
          await page.waitForTimeout(600);
        }
        // The dialog has two sequence <select> pickers (Sequence A, Sequence B).
        // Scope to inside the dialog to avoid the collection selector.
        const dialog = page.locator('[data-testid="compare-sequences-dialog"]');
        const dialogOrPage = (await dialog.count()) ? dialog : page;
        const pickerA = dialogOrPage.locator('select').nth(0);
        if (await pickerA.count()) {
          await pickerA.selectOption({ index: 1 });
          await page.waitForTimeout(300);
        }
        const pickerB = dialogOrPage.locator('select').nth(1);
        if (await pickerB.count()) {
          await pickerB.selectOption({ index: 2 });
          await page.waitForTimeout(300);
        }
        // Click the Align button inside the dialog (force past the backdrop).
        const runBtn = dialogOrPage
          .getByRole("button", { name: /^(Align|Run|Compare|Compute)$/i })
          .first();
        if (await runBtn.count()) {
          await runBtn.click({ timeout: 3000, force: true });
          await page.waitForTimeout(2000);
        }
      } catch (err) {
        console.warn(`  ⚠ sequences-compare action: ${err.message}`);
      }
    },
  },

  // ── Chemistry workbench shots ─────────────────────────────────────────────
  // ENV REQUIREMENT: the captured server must be BUILT with
  // NEXT_PUBLIC_CHEMISTRY_ENABLED=1, or /chemistry renders the "not enabled" gate
  // and a re-capture overwrites these 8 shots with broken ones. The flag bakes at
  // build time and this script only connects to a pre-built server, so set it on
  // the build, not here. See the feature-flagged section of WIKI_SCREENSHOTS.md.
  // The ?wikiCapture=1 fixture seeds 4 molecules for alex under project 1
  // (Ethanol, Acetic acid, Glycerol, Resveratrol), each with a real Molfile +
  // SMILES/InChIKey/formula/weight, so the library, the detail view, and the
  // structure thumbnails all populate offline. Resveratrol is molecule id 4 and
  // makes the best detail/editor subject (a non-trivial stilbene). The deep link
  // /chemistry?molecule=<id> auto-selects a molecule in the rail and opens its
  // detail view, and it composes with the appended &wikiCapture=1.
  {
    // 1. Whole workbench: library rail on the left, Resveratrol selected so its
    //    detail view fills the right pane. Viewport capture of the split-pane.
    path: "/chemistry?molecule=4",
    file: "chemistry-workbench-overview.png",
    waitFor: "text=Resveratrol",
    settleMs: 1400,
  },
  {
    // 2. The molecule library rail. Crop to the left panel (header, the New/
    //    PubChem/Import/Literature actions, the collection selector, the list).
    //    Clip from x=0 to the resize divider's left edge.
    path: "/chemistry",
    file: "chemistry-library-rail.png",
    waitFor: "text=Resveratrol",
    settleMs: 1200,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          const sep = document.querySelector('[role="separator"]');
          const right = sep
            ? Math.ceil(sep.getBoundingClientRect().left)
            : 360;
          return { x: 0, y: 0, width: Math.max(280, right), height: 900 };
        });
        if (clip && clip.width > 100) return { clip };
      } catch (err) {
        console.warn(`  ⚠ chemistry-library-rail clip: ${err.message}`);
      }
    },
  },
  {
    // 3. The molecule detail view for Resveratrol: depiction, the identity table
    //    (formula, avg MW, canonical SMILES, InChIKey), the copy actions, and the
    //    linked-projects section. Crop to the detail pane (right of the divider).
    path: "/chemistry?molecule=4",
    file: "chemistry-molecule-detail.png",
    waitFor: "text=InChIKey",
    settleMs: 1400,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          const sep = document.querySelector('[role="separator"]');
          const left = sep ? Math.floor(sep.getBoundingClientRect().right) : 360;
          return {
            x: left,
            y: 0,
            width: Math.max(200, window.innerWidth - left),
            height: 900,
          };
        });
        if (clip && clip.width > 100) return { clip };
      } catch (err) {
        console.warn(`  ⚠ chemistry-molecule-detail clip: ${err.message}`);
      }
    },
  },
  {
    // 4. The structure editor (Ketcher) open over the workbench with Resveratrol
    //    loaded on the canvas. Opened via the detail view's Edit structure button.
    //    FIXTURE NOTE: Ketcher is a heavy mount (loads a full drawing engine +
    //    the Indigo wasm worker). The long settle below covers a cold first mount;
    //    bump it if the canvas is still blank in the capture.
    path: "/chemistry?molecule=4",
    file: "chemistry-editor.png",
    waitFor: "text=Edit structure",
    settleMs: 1200,
    action: async (page) => {
      try {
        const edit = page
          .getByRole("button", { name: /Edit structure/i })
          .first();
        if (await edit.count()) {
          await edit.click({ timeout: 4000 });
          // Wait for the Ketcher canvas to mount and render the loaded structure.
          await page
            .waitForSelector(
              '.Ketcher-root, [class*="Ketcher"], canvas, svg [class*="ketcher"]',
              { timeout: 12000 },
            )
            .catch(() => {});
          await page.waitForTimeout(3500);
        }
      } catch (err) {
        console.warn(`  ⚠ chemistry-editor action: ${err.message}`);
      }
    },
  },
  {
    // 5. PubChem import: the candidate grid after a name search.
    //    FIXTURE NOTE: this needs LIVE NETWORK at capture time. The search hits
    //    PubChem's public autocomplete + property API (CORS-open, no key). With no
    //    network the dialog shows its empty/search state instead of the grid.
    path: "/chemistry",
    file: "chemistry-pubchem-import.png",
    waitFor: "text=Resveratrol",
    settleMs: 800,
    action: async (page) => {
      try {
        const pubchem = page
          .getByRole("button", { name: /^PubChem$/i })
          .first();
        if (await pubchem.count()) {
          await pubchem.click({ timeout: 4000 });
          await page.waitForTimeout(500);
        }
        const input = page
          .locator('input[placeholder*="caffeine" i], input[placeholder*="compound" i]')
          .first();
        if (await input.count()) {
          await input.fill("caffeine");
          await input.press("Enter");
          // Give PubChem time to return candidates.
          await page.waitForTimeout(4000);
        }
      } catch (err) {
        console.warn(`  ⚠ chemistry-pubchem-import action: ${err.message}`);
      }
    },
  },
  {
    // 6. The per-molecule literature panel: papers + patents for Resveratrol.
    //    FIXTURE NOTE: needs LIVE NETWORK. Europe PMC (by name) populates the
    //    Papers list; the fixture molecules carry no PubChem cid, so the
    //    PubChem-linked papers/patents counts stay empty. To exercise the full
    //    panel, import Resveratrol from PubChem first so it carries a cid.
    path: "/chemistry?molecule=4",
    file: "chemistry-literature.png",
    waitFor: "text=Find papers and patents",
    settleMs: 800,
    action: async (page) => {
      try {
        const show = page
          .getByRole("button", { name: /Find papers and patents/i })
          .first();
        if (await show.count()) {
          await show.click({ timeout: 4000 });
          await page.waitForTimeout(5000);
        }
      } catch (err) {
        console.warn(`  ⚠ chemistry-literature action: ${err.message}`);
      }
    },
  },
  {
    // 7. The substructure patent search (SureChEMBL) on the standalone Literature
    //    surface. Opened via the rail's Literature action.
    //    FIXTURE NOTE: a populated hit list needs (a) a fragment drawn in the
    //    embedded Ketcher and (b) a live, async SureChEMBL search (submit + poll).
    //    Automating the draw is brittle, so this entry captures the search UI in
    //    its prompt state. Draw a fragment by hand and re-run for a populated shot.
    path: "/chemistry",
    file: "chemistry-substructure-patents.png",
    waitFor: "text=Resveratrol",
    settleMs: 800,
    action: async (page) => {
      try {
        const lit = page.getByRole("button", { name: /^Literature$/i }).first();
        if (await lit.count()) {
          await lit.click({ timeout: 4000 });
          await page.waitForTimeout(1200);
        }
        // Scroll the substructure section into view (below the name search).
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll("h2, h3, h4")).find(
            (h) => /substructure|patent/i.test(h.textContent || ""),
          );
          if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
        });
        await page.waitForTimeout(800);
      } catch (err) {
        console.warn(`  ⚠ chemistry-substructure-patents action: ${err.message}`);
      }
    },
  },
  {
    // 8. The Molecules section on a project surface. The ProjectDetailPopup for
    //    project 1 lists its sections as click-through "Go to" doorways, so we
    //    click the Molecules doorway to open the inventory (the 4 fixture
    //    molecules are linked to project 1), then clip to the popup.
    path: "/workbench/projects/1",
    file: "chemistry-project-molecules.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
    settleMs: 1000,
    action: async (page) => {
      try {
        const doorway = page
          .getByRole("button", { name: /^Molecules$/i })
          .first();
        if (await doorway.count()) {
          await doorway.click({ timeout: 4000 });
          await page.waitForTimeout(1100);
        }
        const dlg = page.locator('[role="dialog"]').first();
        if (await dlg.count()) {
          const box = await dlg.boundingBox();
          if (box && box.width > 100) {
            const pad = 16;
            return {
              clip: {
                x: Math.max(0, Math.floor(box.x - pad)),
                y: Math.max(0, Math.floor(box.y - pad)),
                width: Math.min(1440, Math.ceil(box.width + pad * 2)),
                height: Math.min(900, Math.ceil(box.height + pad * 2)),
              },
            };
          }
        }
      } catch (err) {
        console.warn(`  ⚠ chemistry-project-molecules action: ${err.message}`);
      }
    },
  },
  // ── Data Hub stats explainers (/wiki/stats/*) ──────────────────────────────
  // Each shot lands directly on a saved analysis result via the Data Hub
  // `?doc=<tableId>&analysis=<analysisId>` deep link (page.tsx reads both on
  // first load), so no rail clicking is needed. The result recomputes live
  // from the fixture table (ResultsSheet runAnalysis), so these render the real
  // BeakerBot interpretation box + the result table for the explainer page.
  // The seven fixture tables + their analyses live in wiki-capture-fixture.ts.
  // waitFor keys on the BeakerBot box header, which every result type shares.
  // NEEDS NEXT_PUBLIC_DATAHUB_ENABLED=1 in the build/dev server, or /datahub
  // renders the disabled gate. House style: no highlight (illustrative result
  // shots, not click-here shots).
  {
    // Effect sizes + CIs: a two-group t-test shows the mean difference, its
    // 95% CI, and Cohen's d, the trio the effect-sizes page teaches to read.
    path: "/datahub?doc=3&analysis=analysis-survival-ttest",
    file: "datahub-stats-effect-sizes.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // One-way ANOVA across the four fakeGFP groups, with the Tukey comparisons.
    path: "/datahub?doc=1&analysis=analysis-gfp-anova",
    file: "datahub-stats-anova.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Correlation and regression, the simple-linear case: growth vs time.
    path: "/datahub?doc=2&analysis=analysis-growth-reg",
    file: "datahub-stats-linear-regression.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Correlation and regression, the multiple-predictor case: the coefficient
    // table with standardized betas + VIF that the page's MLR section explains.
    path: "/datahub?doc=6&analysis=analysis-yield-mlr",
    file: "datahub-stats-multiple-regression.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Dose-response: the 4PL fit with EC50/IC50 for the dose-response page.
    path: "/datahub?doc=4&analysis=analysis-dose-4pl",
    file: "datahub-stats-dose-response.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // ROC + AUC on the binary-resistance table (the same XY score/outcome shape
    // logistic regression uses), for the roc-auc page.
    path: "/datahub?doc=5&analysis=analysis-resist-roc",
    file: "datahub-stats-roc-auc.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Grubbs outlier screen on a single column with one planted out-of-family
    // replicate, for the outliers page.
    path: "/datahub?doc=8&analysis=analysis-od-grubbs",
    file: "datahub-stats-outliers.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Kaplan-Meier survival with two arms + the log-rank test, for the survival page.
    path: "/datahub?doc=9&analysis=analysis-km",
    file: "datahub-stats-survival.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // A 2x2 contingency table with chi-square, Fisher, odds ratio + relative
    // risk, for the contingency page.
    path: "/datahub?doc=10&analysis=analysis-chisq",
    file: "datahub-stats-contingency.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
  },
  {
    // Repeated-measures ANOVA across three within-subject timepoints, with the
    // Greenhouse-Geisser / Huynh-Feldt corrections, for the repeated-measures page.
    path: "/datahub?doc=11&analysis=analysis-rm",
    file: "datahub-stats-repeated-measures.png",
    waitFor: "text=read on this result",
    settleMs: 1200,
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

async function applyClean(page, opts = {}) {
  try {
    await page.evaluate(HIDE_SCRIPT);
    // Robust primary hide: nuke the entire bottom-right floating dock
    // (Calculators, Feedback, Donate, and ALL dev-only FABs) so new/renamed
    // dev FABs can never leak into wiki shots. Routes that are SHOWCASING a
    // dock surface (e.g. the lab-calculators modal, which renders inside the
    // dock container) opt out with keepDock:true — the modal backdrop already
    // covers the sibling FABs, so nothing leaks.
    if (!opts.keepDock) {
      await page.evaluate(() => {
        for (const dock of document.querySelectorAll("[data-floating-dock]")) {
          dock.style.display = "none";
        }
      });
    }
    // Kill decorative animation overlays and dev-only FABs that are NOT in the
    // floating dock, so they can never leak into a docs shot. Covers the
    // celebration overlays (fixed inset-0 pointer-events-none z-[100]) and the
    // BeakerBot scene easter eggs like the late-night coffee refill (inline
    // position:fixed inset:0 pointer-events:none), plus the Dev restart-server
    // and ephemeral-session buttons (fixed bottom-left, text starts with "Dev:").
    await page.evaluate(() => {
      // Persistent style so a celebration that mounts after this sweep, during
      // the pre-screenshot settle, still stays hidden.
      if (!document.getElementById("wiki-hide-style")) {
        const s = document.createElement("style");
        s.id = "wiki-hide-style";
        s.textContent = ".pointer-events-none.inset-0.z-\\[100\\]{display:none !important}";
        document.head.appendChild(s);
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        // Decorative overlays and easter-egg scenes (full-screen celebration
        // layers AND small corner BeakerBot avatars) are all fixed and
        // pointer-events:none. Real content is interactive, so hiding fixed
        // pointer-events-none overlays of any meaningful size is safe for docs.
        if (cs.position === "fixed" && cs.pointerEvents === "none") {
          const r = el.getBoundingClientRect();
          const fullScreen = r.width >= vw * 0.85 && r.height >= vh * 0.85;
          const cornerDecor = r.width >= 20 && r.width <= vw * 0.5 && r.height >= 20 && r.height <= vh * 0.5;
          if (fullScreen || cornerDecor) el.style.display = "none";
        }
      }
      // The Next.js dev indicator (the "N" badge bottom-left) lives in a
      // <nextjs-portal> web component and only exists in dev. Hide it so it
      // never lands in a docs shot.
      for (const el of document.querySelectorAll("nextjs-portal")) {
        el.style.display = "none";
      }
      for (const el of document.querySelectorAll("button, a")) {
        if (/^Dev:/i.test((el.textContent || "").trim())) {
          let n = el;
          for (let i = 0; i < 4 && n; i++) {
            if (getComputedStyle(n).position === "fixed") { n.style.display = "none"; break; }
            n = n.parentElement;
          }
          el.style.display = "none";
        }
      }
    });
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

// Find the highlight target and return its bounding box in DEVICE pixels
// (CSS rect * SCALE), matching the captured PNG's pixel space. Does not style
// the element. Returns null if no match or the element is off-screen.
async function measureTarget(page, highlight) {
  if (!highlight) return null;
  try {
    const rect = await page.evaluate((spec) => {
      let el = null;
      if (spec.selector) el = document.querySelector(spec.selector);
      if (!el && spec.text) {
        const needle = String(spec.text).toLowerCase();
        const cands = Array.from(
          document.querySelectorAll("button, a, [role='button']"),
        );
        el =
          cands.find((e) => (e.textContent || "").trim().toLowerCase() === needle) ||
          cands.find((e) => (e.textContent || "").trim().toLowerCase().includes(needle));
      }
      if (!el) return null;
      // Only scroll if the target is not already fully in view. An unnecessary
      // scrollIntoView on an in-view element can drag below-the-fold footer
      // content up into the captured frame.
      const r0 = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r0.top < 0 || r0.bottom > vh) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
      }
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, highlight);
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.x * SCALE,
      y: rect.y * SCALE,
      width: rect.width * SCALE,
      height: rect.height * SCALE,
    };
  } catch (err) {
    console.warn(`  ⚠ measure failed: ${err.message}`);
    return null;
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
  // that run after demo-mode-leave.png inherit the flag (Playwright
  // preserves sessionStorage across page.goto in a single context) and
  // getDemoMode() returns true on non-/demo URLs. FloatingLeaveDemoButton
  // and OpenDocsButton are already gated on `!isWikiCaptureMode()` so
  // they don't leak into screenshots, but clearing the sticky flag here
  // keeps any future demo-only chrome out of unrelated shots too.
  if (!route.path.startsWith("/demo")) {
    try {
      await page.evaluate(() => {
        try {
          window.sessionStorage.removeItem("researchos:demo-mode");
        } catch {}
      });
    } catch {}
  }
  // Clear the sticky v4-onboarding-preview flag before every route EXCEPT the
  // onboarding-* shots (which intentionally drive the walkthrough). The
  // onboarding routes set `researchos:v4-preview-active` in sessionStorage,
  // which persists across page.goto in the same browser context; without
  // clearing it, the routes that run AFTER them (the version-history shots)
  // inherit an active walkthrough and the "Welcome to ResearchOS" overlay
  // covers the screenshot.
  if (!route.file.startsWith("onboarding-")) {
    try {
      await page.evaluate(() => {
        try {
          window.sessionStorage.removeItem("researchos:v4-preview-active");
        } catch {}
      });
    } catch {}
  }
  try {
    // `networkidle` is unreliable against Next.js 16 dev mode (Turbopack +
    // RSC streaming keeps the network active indefinitely, so the wait
    // never resolves and every capture times out at 30s). `domcontentloaded`
    // returns as soon as the initial HTML is parsed; the per-route
    // `waitForSelector` + `settleMs` below handle "page is ready for
    // capture" in a way the wait-until contract cannot. v4 port,
    // 2026-05-27.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    console.error(`  ✗ ${route.file} — goto failed: ${err.message}`);
    return false;
  }
  // Never capture the full-screen "Loading ResearchOS" splash. The fixture
  // installs synchronously, but React hydration + the provider's
  // isLoading→false flip can still lag the fixed `settleMs` on slower
  // routes, so a fixed sleep alone races the splash. Wait for
  // StagedLoadingScreen to leave the DOM first; `detached` resolves
  // immediately when the splash was never mounted, so this is free for
  // already-loaded routes. A timeout here is non-fatal — fall through to
  // the content selector + settle below. v4, 2026-05-28.
  await page
    .waitForSelector('[data-testid="staged-loading-screen"]', {
      state: "detached",
      timeout: 10000,
    })
    .catch(() => null);
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
  await applyClean(page, { keepDock: route.keepDock });
  // In annotate mode we measure the target and composite the adaptive mark
  // after capture, so we skip the in-page red ring. Legacy mode keeps the ring.
  let annotateBox = null;
  if (route.highlight) {
    if (ANNOTATE) annotateBox = await measureTarget(page, route.highlight);
    else await applyHighlight(page, route.highlight);
  }
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
    if (clip || route.fullPage) {
      if (annotateBox) {
        console.warn(
          `  ⚠ ${route.file} — annotation skipped (clip/fullPage layout, handle in audit)`,
        );
      }
    }
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
    } else if (annotateBox) {
      // Simple viewport shot with a click target, capture clean then
      // composite the adaptive ring + click-pulse + cursor at the target.
      const raw = await page.screenshot({ fullPage: false });
      const { buffer, color } = await annotateBuffer(raw, annotateBox);
      await writeFile(out, buffer);
      console.log(`  ✓ ${route.file} (annotated ${color})`);
      return true;
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
  // Optional subset filter: any non-flag positional args, OR the WIKI_ONLY
  // env var (comma-separated list of `file` names or substrings), are treated
  // as file-name substrings, and only routes whose `file` matches one of them
  // are captured (across all phases). Lets you re-shoot a single broken image
  // without regenerating all ~87 (which risks regressing currently-good shots
  // if an unrelated `action` has drifted). Examples:
  //   node scripts/capture-wiki-screenshots.mjs search-results editor-image
  //   WIKI_ONLY=calc-builder-wizard,calc-builder-form npm run wiki:screenshots
  const onlyArgs = [
    ...process.argv.slice(2).filter((a) => !a.startsWith("-")),
    ...(process.env.WIKI_ONLY ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const matchOnly = (route) =>
    onlyArgs.length === 0 ||
    onlyArgs.some((a) => route.file.includes(a));

  console.log(`Capturing wiki screenshots → ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);
  if (onlyArgs.length) {
    console.log(`Filter: only files matching [${onlyArgs.join(", ")}]`);
  }
  console.log("");

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  let ok = 0;
  let fail = 0;

  // 1. Public / pre-auth pages (fresh context, no IndexedDB)
  const publicRoutes = PUBLIC_ROUTES.filter(matchOnly);
  if (publicRoutes.length) {
    console.log("Public pages:");
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of publicRoutes) {
      const success = await capturePublicPage(page, route, BASE_URL);
      success ? ok++ : fail++;
    }
    await ctx.close();
  }

  // 2. Picker-mode pages (fresh context — fixture installed without
  //    signing in, so the user-picker screen renders)
  const pickerRoutes = PICKER_ROUTES.filter(matchOnly);
  if (pickerRoutes.length) {
    console.log("\nPicker-mode pages:");
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of pickerRoutes) {
      const success = await capturePage(page, route, BASE_URL);
      success ? ok++ : fail++;
    }
    await ctx.close();
  }

  // 3. Fixture-mode pages (fresh context, signed in as "alex")
  const fixtureRoutes = FIXTURE_ROUTES.filter(matchOnly);
  if (fixtureRoutes.length) {
    console.log("\nFixture-mode pages:");
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of fixtureRoutes) {
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

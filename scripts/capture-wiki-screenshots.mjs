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
  // The folder-connect screen. A fresh context is "truly-new", which now
  // renders the first-time-visitor landing page instead of the connect
  // screen. `?connect=1` is the landing-gate bypass (see
  // lib/landing/landing-gate.ts) so this shot still captures the connect
  // screen. The wiki pages themselves are validated by `next build` and
  // don't need screenshot snapshots in /public.
  // The picker consolidated to a single "Link a folder" card (the old
  // two-card Link Existing / Create New layout is gone: Chrome's File
  // System Access API cannot create a folder from the picker dialog).
  // waitFor matches the current card heading; highlight rings the
  // "Link Folder" button text.
  {
    path: "/?connect=1",
    file: "folder-connect.png",
    waitFor: "text=Link a folder",
    highlight: { text: "Link Folder" },
  },
  // The first-time-visitor landing ("sell") page. Captured from the
  // standalone /welcome route (renders for everyone, no fixture needed).
  // settleMs lets the hi-wave BeakerBot greeting finish and unmount (~2s)
  // so the corner is clear in the hero shot. Viewport capture (the hero),
  // not fullPage.
  {
    path: "/welcome",
    file: "landing.png",
    waitFor: '[data-testid="landing-page"]',
    settleMs: 2300,
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
// installWikiCaptureFixture pre-seeds a real-engine-produced multi-version /
// multi-editor / multi-day history (wiki-capture-vc-seed.ts) for this note plus
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
    // Project Surface route — Overview section + the sticky anchor strip.
    // FakeYeast project (alex/1) is the demo project. The fixture seeds no
    // overview prose, so the editor's empty-state placeholder is what
    // shows up. fullPage so the section spacing reads cleanly below the
    // sticky top bar.
    path: "/workbench/projects/1",
    file: "projects-route-overview.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
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
    // Project Surface — the left sidebar Projects rail. Land on any
    // project route so SidebarProjectsNav renders with an active highlight,
    // then tight-clip the left rail. The rail is the 48-wide aside
    // (className "w-48 border-r border-gray-200 bg-white …") immediately
    // inside AppShell's flex row.
    path: "/workbench/projects/1",
    file: "projects-sidebar-nav.png",
    waitFor: '[data-testid="project-route-topbar"], text=Overview',
    settleMs: 800,
    action: async (page) => {
      try {
        const clip = await page.evaluate(() => {
          // The rail's Link to "/" with label "Projects" is the stable
          // marker. Walk up to the enclosing <aside>.
          const links = Array.from(document.querySelectorAll("aside a"));
          const projectsLink = links.find(
            (a) =>
              (a.getAttribute("href") || "") === "/" &&
              (a.textContent || "").trim() === "Projects",
          );
          if (!projectsLink) return null;
          let aside = projectsLink.closest("aside");
          if (!aside) return null;
          const r = aside.getBoundingClientRect();
          const pad = 8;
          const x = Math.max(0, Math.floor(r.left - pad));
          const y = Math.max(0, Math.floor(r.top - pad));
          const width = Math.min(
            Math.max(0, window.innerWidth - x),
            Math.ceil(r.width + pad * 2),
          );
          // Cap the rail height so a tall sub-list doesn't drag the
          // capture down past the visible region.
          const maxHeight = Math.min(
            Math.max(0, window.innerHeight - y),
            Math.ceil(r.height + pad * 2),
          );
          return { x, y, width, height: maxHeight };
        });
        if (clip && clip.width > 50 && clip.height > 80) {
          return { clip };
        }
      } catch (err) {
        console.warn(`  ⚠ projects-sidebar-nav clip: ${err.message}`);
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
    path: "/workbench",
    file: "experiments-editor.png",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 800,
    action: async (page) => {
      await revealCompletedAndOpenTask(
        page,
        /Yeast transformation:\s*pYES-GAL1::flbA/i,
      );
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
  // NOTE: the lab-mode-*.png and purchases-lab-*.png captures were retired
  // 2026-05-28. They all navigated to "/lab", which no longer exists (the
  // lab features live at /lab-overview now), so every shot was a Next.js
  // 404 page. None were referenced by any wiki page. If a future wiki page
  // needs lab-overview illustrations, add fresh entries pointed at
  // /lab-overview with verified `action`s and re-capture.
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
    path: "/demo",
    file: "demo-mode-leave.png",
    waitFor: "text=Demo Lab, text=Research Project Overview",
    settleMs: 1000,
    action: async (page) => {
      try {
        const floating = page
          .locator('[aria-label*="Leave the demo" i], [aria-label*="Leave Demo" i], [aria-label*="Leave demo" i]')
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
  {
    path: "/settings",
    file: "onboarding-settings-rerun-button.png",
    waitFor: "text=Settings, text=Tips",
    settleMs: 800,
    action: async (page) => {
      // The Tips section sits near the bottom of the long Settings
      // panel stack. Scroll the "Re-run welcome tour" row into view
      // and capture a tight clip around the Tips card so the wiki shot
      // matches the section the prose describes. Label updated 2026-05-20
      // when the v3 wizard cutover renamed the affordance from
      // "Re-run welcome wizard" to "Re-run welcome tour".
      try {
        const label = page
          .getByText(/Re-run welcome tour/i)
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
    highlight: { text: "Re-run welcome tour" },
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
    // HE-5a hybrid editor BOLD demo. Cursor types "Bold!" with markdown
    // `**` syntax in the hybrid editor, demonstrating the inline-render
    // mechanic. Captures the live-typing moment with the speech bubble
    // narrating from the fixed bottom-right anchor.
    //
    // File rename: v3 used `W5` step nomenclature and the file was
    // `onboarding-w5-hybrid-editor-typing.png`. Renamed to
    // `onboarding-hybrid-bold.png` to match the v4 step id.
    path: "/?wizard-preview=1&wizardSeedStep=hybrid-bold",
    file: "onboarding-hybrid-bold.png",
    // Wait for the in-product speech bubble to mount (the in-product
    // walkthrough overlay has no per-step data-tour-step attribute on
    // the body; the bubble's testid is the most stable anchor).
    waitFor: '[data-testid="tour-beakerbot-bubble"]',
    settleMs: 1500,
    action: async () => {
      // No clip — capture the full viewport so the spotlight target
      // (hybrid editor body), the cursor mid-demo, and the speech
      // bubble in the bottom-right all sit together in the frame. The
      // speech bubble is a fixed-position overlay anchored at
      // bottom: 96px, so a tight clip on the bubble alone would lose
      // the editor context this screenshot is meant to teach.
    },
  },
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
  // ── Welcome / landing-page showcase shots ───────────────────────────────
  // Referenced by LandingPage.tsx. These were hand-captured back in May, so
  // they went stale (lab-overview showed the deleted widget canvas) and leaked
  // the dev FAB dock. Captured by the pipeline now so they stay current +
  // dev-button-free (applyClean hides the dock on all of these too).
  {
    // The curated PI Lab Overview page (post widget-framework teardown). The
    // fixture's PI is mira (alex is a member now), so sign in as mira via the
    // ?fixtureUser override; /lab-overview then renders the curated ~7-section
    // PI page, NOT the removed customizable widget canvas.
    path: "/lab-overview?fixtureUser=mira",
    file: "lab-overview-pi-default.png",
    waitFor: "text=Lab Overview",
    settleMs: 1400,
  },
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
  {
    // The per-task Lab comments thread (seeded on task 5, "PCR-screen
    // integrants": a mira/alex/morgan thread). Open the completed experiment
    // popup and scroll the comments into frame.
    path: "/workbench",
    file: "lab-inbox-comments-thread.png",
    waitFor: "text=Workbench",
    settleMs: 700,
    action: async (page) => {
      await ensureExperimentsTab(page);
      try {
        const card = page.getByText(/^PCR-screen integrants$/).first();
        await card.waitFor({ state: "visible", timeout: 12000 });
        // DOM-click the card (experiment cards are clickable divs).
        await page.evaluate(() => {
          const leaf = [...document.querySelectorAll("*")].find(
            (e) =>
              e.children.length === 0 &&
              /^PCR-screen integrants$/.test((e.textContent || "").trim()),
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
        await page.waitForTimeout(1200);
      } catch (err) {
        console.warn(`  ⚠ lab-comments open task: ${err.message}`);
      }
      // Scroll the Lab comments section into frame.
      try {
        await page.evaluate(() => {
          const node = [...document.querySelectorAll("*")].find(
            (e) =>
              /^Lab comments/.test((e.textContent || "").trim()) &&
              e.children.length <= 4,
          );
          node?.scrollIntoView({ block: "center", behavior: "instant" });
        });
        await page.waitForTimeout(700);
      } catch {}
    },
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
    // Robust primary hide: nuke the entire bottom-right floating dock
    // (Calculators, Feedback, Donate, and ALL dev-only FABs). Replaces the
    // fragile per-button list below so new/renamed/relocated dev FABs
    // (BeakerBot gallery, Demo toggle, etc.) can never leak into wiki shots.
    for (const dock of document.querySelectorAll("[data-floating-dock]")) {
      dock.style.display = "none";
    }
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
  // Optional positional filter: any non-flag args are treated as
  // file-name substrings, and only routes whose `file` matches one of
  // them are captured. Lets you re-shoot a single broken image without
  // regenerating all ~87 (which risks regressing currently-good shots if
  // an unrelated `action` has drifted). Example:
  //   node scripts/capture-wiki-screenshots.mjs search-results editor-image
  const onlyArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
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

#!/usr/bin/env node
/**
 * Wiki + README screenshot recapture sweep (Batch B agent).
 *
 * Captures the 22 TODO-marked screenshots left by the mega-wiki chip
 * (2ceb181a) and README chip (7e1e32ab). Each route below mirrors the
 * spec inside the source TODO comment (route + fixture + viewport +
 * state).
 *
 * Usage:
 *   # 1. Start the dev server in another terminal
 *   cd frontend && npm run dev
 *
 *   # 2. Run this script
 *   node scripts/capture-wiki-screenshots-batch-b.mjs
 *
 * Output: frontend/public/wiki/screenshots/<name>.png
 *
 * For each lab_head-role capture we open the user-switch popup and
 * click the "mira" tile (the only lab_head fixture user) before going
 * to the target route. The user-switch button lives in AppShell's
 * bottom-right floating cluster (aria-label="Switch user"). After the
 * switch we re-attach `?wikiCapture=1` so the fixture-mode sticky flag
 * carries us through every in-app navigation.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const requireFromFrontend = createRequire(
  path.join(REPO_ROOT, "frontend", "package.json"),
);
const { chromium } = requireFromFrontend("playwright");

const OUT_DIR = path.join(REPO_ROOT, "frontend", "public", "wiki", "screenshots");
const BASE_URL = process.env.WIKI_CAPTURE_BASE_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

// ── Helper: switch fixture user via the UserLoginScreen modal ─────────
//
// Default `?wikiCapture=1` signs in as `alex` (member). For lab_head
// captures we click the floating "Switch user" button, then click the
// target user's tile in the user-picker modal. Idempotent: if we're
// already signed in as the target, the function is a no-op.
async function switchFixtureUser(page, targetUser) {
  // Read the avatar letter from the Switch user button — the aria-label
  // is just "Switch user" (the live-user info is in the Tooltip's hover
  // text, not the aria-label). We use the avatar's first-letter as a
  // proxy for currentUser (mira → "M", alex → "A").
  const currentLetter = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label^="Switch user"]');
    if (!btn) return null;
    return (btn.textContent || "").trim().toLowerCase();
  });
  if (currentLetter === targetUser.charAt(0).toLowerCase()) return true;

  // Use a direct DOM .click() via evaluate — Playwright's auto-wait
  // checks visibility, and the floating cluster may have been hidden by
  // a prior HIDE_SCRIPT pass (sticky across in-tab navigation). The
  // React onClick handler doesn't care about CSS visibility.
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label^="Switch user"]');
    if (!btn) return false;
    // Un-hide so the modal can mount cleanly.
    btn.style.display = "";
    btn.click();
    return true;
  });
  if (!opened) {
    console.warn(`  ⚠ switchFixtureUser: Switch user button not in DOM`);
    return false;
  }
  await page.waitForTimeout(1500);
  // Verify the modal opened (the UserLoginScreen subtitle).
  const modalOpen = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("p"))
      .some((el) => /select your profile to continue/i.test((el.textContent || "").trim()));
  });
  if (!modalOpen) {
    console.warn(`  ⚠ switchFixtureUser: modal did not open after click`);
    return false;
  }
  // The picker shows user tiles with each username as text. Match by
  // role=button + aria-label or by text within the modal portal.
  try {
    const ok = await page.evaluate((target) => {
      // Scope the search to the UserLoginScreen modal so we don't pick
      // up a same-named span elsewhere on the page (e.g. a lab-activity
      // widget showing "mira" in the background). The modal is the
      // fixed-inset div with class containing "z-[100]".
      const allDivs = Array.from(document.querySelectorAll("div"));
      const modal = allDivs.find((d) =>
        /(\sz-\[100\]\s|^z-\[100\]\s|\sz-\[100\]$)/.test(" " + (d.className || "") + " ")
        && (d.className || "").includes("fixed"),
      );
      if (!modal) return false;
      const spans = Array.from(modal.querySelectorAll("span"));
      // The tile's username span has class "text-white font-medium".
      const labelSpan = spans.find(
        (s) =>
          (s.textContent || "").trim() === target &&
          (s.className || "").includes("text-white"),
      );
      if (!labelSpan) return false;
      let cur = labelSpan;
      for (let i = 0; i < 8 && cur; i++) {
        if (
          cur.tagName === "DIV" &&
          (cur.className || "").includes("cursor-pointer")
        ) {
          cur.scrollIntoView({ block: "center", behavior: "instant" });
          cur.click();
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    }, targetUser);
    if (!ok) {
      console.warn(`  ⚠ switchFixtureUser: tile for "${targetUser}" not found`);
      return false;
    }
  } catch (err) {
    console.warn(`  ⚠ switchFixtureUser: click tile failed: ${err.message}`);
    return false;
  }
  // Wait for the modal to dismiss + the new user to hydrate.
  await page.waitForTimeout(2500);
  // Verify the switch landed by reading the avatar letter (first
  // character of currentUser) inside the Switch user button.
  const afterLetter = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label^="Switch user"]');
    if (!btn) return null;
    return (btn.textContent || "").trim().toLowerCase();
  });
  const expected = targetUser.charAt(0).toLowerCase();
  if (afterLetter !== expected) {
    console.warn(
      `  ⚠ switchFixtureUser: avatar letter "${afterLetter}" doesn't match ${targetUser[0].toUpperCase()} for ${targetUser}`,
    );
    return false;
  }
  return true;
}

// ── Helper: open a Tool from the lab-overview Tools launcher ──────────
async function openTool(page, toolTitle) {
  // Use direct DOM clicks (sidesteps Playwright visibility checks on
  // any element a prior HIDE_SCRIPT may have hidden).
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="Open tool"]');
    if (!btn) return false;
    btn.style.display = "";
    btn.click();
    return true;
  });
  if (!opened) {
    console.warn(`  ⚠ openTool: launcher button missing (not a lab_head?)`);
    return false;
  }
  await page.waitForTimeout(600);
  const ok = await page.evaluate((title) => {
    const btn = Array.from(document.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "") === `Open ${title}`);
    if (!btn) return false;
    btn.click();
    return true;
  }, toolTitle);
  if (!ok) {
    console.warn(`  ⚠ openTool: ${toolTitle} not found in launcher`);
    return false;
  }
  await page.waitForTimeout(900);
  return true;
}

// ── Helper: restore hidden-by-HIDE_SCRIPT elements before per-route
//          interactions (the inline display:none persists across React
//          re-renders within the same page context). Reverts the
//          floating cluster + dev buttons so the user-switch + tool
//          launcher are clickable, then HIDE_SCRIPT re-applies before
//          the screenshot itself.
async function restoreClusterButtons(page) {
  try {
    await page.evaluate(() => {
      const labels = [
        "Switch user",
        "Open data folder settings",
        "Send feedback",
        "Open tool",
      ];
      for (const lbl of labels) {
        for (const el of document.querySelectorAll(`[aria-label="${lbl}"]`)) {
          el.style.display = "";
        }
      }
    });
  } catch {}
}

// ── Helper: switch tab inside a PiActions / LabPurchases popup ────────
async function switchPopupTab(page, tabLabel) {
  try {
    const ok = await page.evaluate((label) => {
      // role="tab" buttons inside the open popup. Match by inner text
      // (e.g. "Pending approvals", "Audit log").
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const target = tabs.find(
        (t) => (t.textContent || "").trim().toLowerCase().includes(label.toLowerCase()),
      );
      if (!target) return false;
      target.click();
      return true;
    }, tabLabel);
    if (!ok) {
      console.warn(`  ⚠ switchPopupTab: "${tabLabel}" not found`);
      return false;
    }
    await page.waitForTimeout(600);
    return true;
  } catch (err) {
    console.warn(`  ⚠ switchPopupTab(${tabLabel}): ${err.message}`);
    return false;
  }
}

// ── HIDE_SCRIPT mirrors the main script's clean-pass ──────────────────
const HIDE_SCRIPT = `
  (function hideDevUI() {
    const HIDE_TEXTS = ["Test Notification", "Test Error", "Report Bug"];
    for (const el of document.querySelectorAll("button, a")) {
      const t = (el.textContent || "").trim();
      if (HIDE_TEXTS.some(x => t === x || t.startsWith(x))) {
        el.style.display = "none";
      }
    }
    const HIDE_ARIA = [
      "Send test notification (dev only)",
      "Force an onboarding tip to fire (dev only)",
      "Send feedback",
      "Report a bug",
      "Open data folder settings",
      "Switch user",
      "Support this project",
    ];
    for (const label of HIDE_ARIA) {
      for (const el of document.querySelectorAll('[aria-label="' + label + '"]')) {
        el.style.display = "none";
      }
    }
    for (const el of document.querySelectorAll('[aria-label="Switch user"]')) {
      el.removeAttribute("title");
    }
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
    const tgPills = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = (el.textContent || "").trim();
      return t.startsWith("Telegram:") && el.children.length <= 2;
    });
    for (const el of tgPills) el.style.display = "none";
  })();
`;

async function applyClean(page) {
  try { await page.evaluate(HIDE_SCRIPT); } catch {}
}

// ── Route table ───────────────────────────────────────────────────────
//
// Each route declares:
//   file        — basename under frontend/public/wiki/screenshots/
//   path        — pathname (we append ?wikiCapture=1 automatically)
//   asUser      — fixture user to sign in as ("alex" | "mira" | "any")
//   waitFor     — comma-separated selector list to race before settling
//   settleMs    — extra ms after waitFor (default 800)
//   action      — async (page) => optional setup before screenshot
//   fullPage    — boolean (grow viewport and capture document height)
//   pickerMode  — boolean (use ?wikiCapture=picker instead of =1)
//
// The user-switch step runs BEFORE the navigation, then we navigate to
// the target route. AppShell preserves login state across in-tab nav.
const ROUTES = [
  // ─── 1. Wiki page TODOs ───────────────────────────────────────────
  {
    file: "home-widget-canvas.png",
    path: "/",
    asUser: "alex",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    fullPage: true,
  },
  {
    file: "lab-head-login-picker.png",
    path: "/",
    pickerMode: true,
    waitFor: "text=Select your profile, text=Continue, text=ResearchOS",
    settleMs: 1000,
  },
  {
    file: "lab-head-audit-log-tab.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      if (!(await openTool(page, "Pending lab head actions"))) return;
      await switchPopupTab(page, "Audit log");
    },
  },
  {
    file: "lab-head-edit-session-prompt.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      // Open the Announcements tool which has the Request Edit button
      // when the session is locked.
      if (!(await openTool(page, "Announcements"))) return;
      // Click the "Request edit" affordance (aria-label="Request edit mode").
      try {
        const ok = await page.evaluate(() => {
          const btn = document.querySelector('[aria-label="Request edit mode"]');
          if (!btn) return false;
          btn.click();
          return true;
        });
        if (!ok) {
          console.warn("  ⚠ lab-head-edit-session-prompt: Request edit button not found");
          return;
        }
        await page.waitForTimeout(800);
      } catch (err) {
        console.warn(`  ⚠ lab-head-edit-session-prompt: ${err.message}`);
      }
    },
  },
  {
    file: "lab-head-pi-actions-pending.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      if (!(await openTool(page, "Pending lab head actions"))) return;
      await switchPopupTab(page, "Pending approvals");
    },
  },
  {
    file: "lab-inbox-overview.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      await openTool(page, "Lab comments");
    },
  },
  {
    // TODO says lab_head fixture but mira owns no tasks (the demo PI
    // archetype). PCR-screen integrants (task 5) is alex's; its
    // comments thread already includes mira's top-level comment, an
    // alex reply, and a morgan reply — exactly what the TODO asks for.
    // Sign in as alex so the task is visible in Workbench.
    file: "lab-inbox-comments-thread.png",
    path: "/workbench",
    asUser: "alex",
    waitFor: "text=Workbench, text=Experiments",
    settleMs: 1000,
    action: async (page) => {
      // Open task 5 (Yeast transformation PCR screen) which has a
      // top-level comment from mira, a reply from alex, and a second
      // reply from morgan — see fixture line ~41.
      try {
        // Reveal completed experiments if collapsed.
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const disclosure = btns.find((b) => /^Show \d+ completed/.test((b.textContent || "").trim()));
          if (disclosure) disclosure.click();
        });
        await page.waitForTimeout(600);
      } catch {}
      try {
        const ok = await page.evaluate(() => {
          // Prefer task-card buttons (they're the clickable tile). Each
          // card is a button whose textContent starts with the task name.
          const buttons = Array.from(document.querySelectorAll("button"));
          const target = buttons.find((el) => {
            const t = (el.textContent || "").trim();
            return t.startsWith("PCR-screen integrants");
          });
          if (!target) return false;
          target.scrollIntoView({ block: "center", behavior: "instant" });
          target.click();
          return true;
        });
        if (!ok) {
          console.warn("  ⚠ lab-inbox-comments-thread: task tile not found");
          return;
        }
        await page.waitForTimeout(1200);
        // Click the Comments tab inside the popup if needed.
        await page.evaluate(() => {
          const tabs = Array.from(document.querySelectorAll('[role="tab"], button'));
          const c = tabs.find((t) => (t.textContent || "").trim().toLowerCase() === "comments");
          if (c) c.click();
        });
        await page.waitForTimeout(700);
      } catch (err) {
        console.warn(`  ⚠ lab-inbox-comments-thread: ${err.message}`);
      }
    },
  },
  {
    file: "lab-inbox-announcements-compose.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      if (!(await openTool(page, "Announcements"))) return;
      // Compose form is gated by edit session; click Request edit and
      // dismiss (we just want to show the composer UI).
      try {
        const composer = await page.$('textarea, input[type="text"]');
        if (composer) {
          await composer.fill("Lab meeting moved to Thursday at 3pm — bringing pizza.").catch(() => {});
        }
      } catch {}
      await page.waitForTimeout(400);
    },
  },
  // gantt-overview.png — the wiki TODO requests a lab_head capture while
  // the README TODO requests a member capture. Both write to the same
  // filename. The existing main-script capture is the member version
  // (alex), so we leave gantt-overview.png alone here and emit a
  // gantt-overview-lab-head.png variant. The wiki page won't pick this
  // up automatically until someone updates the <Screenshot src=> ref,
  // but the file lands so a future cleanup chip can switch.
  {
    file: "gantt-overview-lab-head.png",
    path: "/gantt",
    asUser: "mira",
    waitFor: ".gantt, [role='grid'], text=GANTT",
    settleMs: 1500,
    action: async (page) => {
      try {
        const ok = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const btn = btns.find((b) => {
            const t = (b.textContent || "").trim().toLowerCase();
            return t.includes("project") && (t.includes("select") || t.includes("filter") || t.includes("all"));
          });
          if (!btn) return false;
          btn.click();
          return true;
        });
        if (ok) await page.waitForTimeout(500);
      } catch {}
    },
  },
  {
    file: "feedback-modal-bug.png",
    path: "/",
    asUser: "alex",
    waitFor: "text=Research Project Overview",
    settleMs: 800,
    action: async (page) => {
      // Click the floating Feedback button (aria-label="Send feedback").
      // openBugReport plays a "bugstomp" splat scene first; modal mounts
      // ~5s later. Wait for the radiogroup before continuing.
      try {
        const ok = await page.evaluate(() => {
          const btn = document.querySelector('[aria-label="Send feedback"]');
          if (!btn) return false;
          btn.style.display = "";
          btn.click();
          return true;
        });
        if (!ok) return;
        // Wait up to 8s for the modal to mount past the splat scene.
        await page.waitForSelector('[aria-label="Feedback type"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        // Select the "Bug" radio in the type group.
        await page.evaluate(() => {
          const radios = Array.from(document.querySelectorAll('[role="radio"]'));
          const bug = radios.find((r) => (r.textContent || "").trim().toLowerCase() === "bug");
          if (bug) bug.click();
        });
        await page.waitForTimeout(400);
      } catch (err) {
        console.warn(`  ⚠ feedback-modal-bug: ${err.message}`);
      }
    },
  },
  {
    file: "sharing-method-share-dialog.png",
    path: "/methods",
    asUser: "alex",
    waitFor: "text=Methods, text=Library",
    settleMs: 1200,
    action: async (page) => {
      // Click the first DEMO method card to open its viewer popup.
      try {
        const opened = await page.evaluate(() => {
          const h4 = Array.from(document.querySelectorAll("h4")).find((h) =>
            /demo protocol/i.test(h.textContent || ""),
          );
          if (!h4) return false;
          const card = h4.closest("div.cursor-pointer, div[class*='hover\\:shadow-sm']") || h4.parentElement?.parentElement;
          if (!card) return false;
          card.scrollIntoView({ block: "center", behavior: "instant" });
          card.click();
          return true;
        });
        if (!opened) {
          console.warn("  ⚠ sharing-method-share-dialog: method card click failed");
          return;
        }
        await page.waitForTimeout(1500);
        // Per-viewer privacy chip ("Private" / "Public" / "Shared with
        // lab") is the entry point to the share dialog. SharingChips's
        // "Share…" button appears on records that already have shares.
        const sharedOpen = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          // Try Share…, then Private/Public/Shared with lab in that order.
          const find = (re) => btns.find((b) => re.test((b.textContent || "").trim()));
          const share =
            find(/^share[…\.\s]*$/i) ||
            find(/^private$/i) ||
            find(/^public$/i) ||
            find(/shared with lab/i);
          if (!share) return false;
          share.click();
          return true;
        });
        if (!sharedOpen) {
          console.warn("  ⚠ sharing-method-share-dialog: Share/Private button not found");
          return;
        }
        await page.waitForTimeout(900);
      } catch (err) {
        console.warn(`  ⚠ sharing-method-share-dialog: ${err.message}`);
      }
    },
  },
  {
    file: "lab-overview-canvas.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1500,
    fullPage: true,
  },
  {
    file: "lab-overview-tile-vs-popup.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1500,
    action: async (page) => {
      // Click the Lab purchases tile on the canvas. The tile renders
      // burn-rate; clicking opens the expanded LabPurchases popup.
      try {
        const ok = await page.evaluate(() => {
          // Match a tile by its title text.
          const tiles = Array.from(document.querySelectorAll("h2, h3, [role='button'], button"));
          const target = tiles.find((el) => {
            const t = (el.textContent || "").trim();
            return /lab purchases|burn[- ]rate|purchases/i.test(t) && el.tagName !== "BUTTON";
          });
          // Walk up to a clickable parent.
          if (!target) return false;
          let cur = target;
          for (let i = 0; i < 6 && cur; i++) {
            if (cur.tagName === "BUTTON" || cur.getAttribute("role") === "button") break;
            cur = cur.parentElement;
          }
          if (!cur) return false;
          cur.click();
          return true;
        });
        if (!ok) {
          // Fallback: open via launcher.
          await openTool(page, "Lab purchases");
        }
        await page.waitForTimeout(900);
      } catch (err) {
        console.warn(`  ⚠ lab-overview-tile-vs-popup: ${err.message}`);
      }
    },
  },
  {
    file: "lab-overview-widget-palette.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      // Enter edit mode then open the + Add widget palette.
      try {
        const ok = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const edit = btns.find((b) => {
            const t = (b.textContent || "").trim().toLowerCase();
            return t === "edit" || t === "customize" || t.startsWith("edit layout") || t.includes("customize layout");
          });
          if (!edit) return false;
          edit.click();
          return true;
        });
        if (ok) await page.waitForTimeout(600);
        // Click "+ Add widget" (text or aria-label).
        const ok2 = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const add = btns.find((b) => {
            const t = (b.textContent || "").trim().toLowerCase();
            return t.includes("add widget") || t === "+ add widget";
          });
          if (!add) return false;
          add.click();
          return true;
        });
        if (ok2) await page.waitForTimeout(700);
      } catch (err) {
        console.warn(`  ⚠ lab-overview-widget-palette: ${err.message}`);
      }
    },
  },
  {
    file: "lab-overview-sidebar-rail.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      // Enter edit mode so the sidebar's tile-drop hints are visible.
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const edit = btns.find((b) => {
            const t = (b.textContent || "").trim().toLowerCase();
            return t === "edit" || t === "customize" || t.startsWith("edit layout") || t.includes("customize layout");
          });
          if (edit) edit.click();
        });
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`  ⚠ lab-overview-sidebar-rail: ${err.message}`);
      }
    },
  },
  {
    file: "user-archiving-roster.png",
    path: "/settings",
    asUser: "mira",
    waitFor: "text=Settings, text=Lab Mode, text=Personal",
    settleMs: 1000,
    action: async (page) => {
      // Click the Lab Mode tab.
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a"));
          const tab = btns.find((b) => (b.textContent || "").trim() === "Lab Mode");
          if (tab) tab.click();
        });
        await page.waitForTimeout(700);
        // Scroll to LabRoster section.
        await page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll("h2, h3, h4"));
          const h = headings.find((el) => (el.textContent || "").trim() === "Lab Roster");
          if (h) h.scrollIntoView({ block: "start", behavior: "instant" });
        });
        await page.waitForTimeout(500);
      } catch (err) {
        console.warn(`  ⚠ user-archiving-roster: ${err.message}`);
      }
    },
  },

  // ─── 2. README TODOs ──────────────────────────────────────────────
  // home-projects.png already exists from the main script. Skipping.
  // gantt-overview.png already exists. Skipping. (README's TODO points
  // to the same filename — keep the existing one.)
  // experiments-editor.png already exists. Skipping.
  // settings-ai-helper.png already exists. Skipping.
  // gantt-task-popup.png + purchases-csv-export.png already exist.
  {
    file: "lab-overview.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1500,
    fullPage: true,
  },
  {
    file: "lab-purchases-popup.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      if (!(await openTool(page, "Lab purchases"))) return;
      await switchPopupTab(page, "Pending approvals");
    },
  },
  {
    file: "pi-actions-audit.png",
    path: "/lab-overview",
    asUser: "mira",
    waitFor: "text=Lab Overview, text=Lab Activity, text=Announcements",
    settleMs: 1200,
    action: async (page) => {
      if (!(await openTool(page, "Pending lab head actions"))) return;
      await switchPopupTab(page, "Audit log");
    },
  },
  {
    // The README TODO says "wrap-up after Q1c lab-head follow-up was
    // added". v4 has no explicit wrap-up beat after the setup phase —
    // setup-q7 (the last setup question, "Lab Links") is the closest
    // thing to a wrap-up surface. Use setup-q7 as the seed so the
    // screenshot shows the post-Q1c setup flow. The Q1c lab-head step
    // itself is now in the lineage so the user has already seen it.
    file: "onboarding-wizard-step-7-wrapup.png",
    path: "/?wizard-preview=1&wizardSeedStep=setup-q7",
    asUser: "alex",
    waitFor: "text=Lab Links, text=Next, text=Continue, text=Resume",
    settleMs: 2000,
    action: async (page) => {
      // Click Resume on the WizardResumeModal to land on the seeded step.
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const resume = btns.find((b) => /^resume$/i.test((b.textContent || "").trim()));
          if (resume) resume.click();
        });
        await page.waitForTimeout(1500);
      } catch {}
    },
  },
];

// ── Capture loop ──────────────────────────────────────────────────────
async function captureRoute(page, route) {
  const out = path.join(OUT_DIR, route.file);
  const variant = route.pickerMode ? "picker" : "1";
  // The fixture's initialize() ALWAYS signs in as alex when ?wikiCapture=1
  // is on the URL. So we navigate first (lands as alex), then switch
  // user in-page via the floating UserLoginScreen modal. The next goto
  // for a different route resets to alex again — that's fine, we
  // re-switch per route.
  const url = `${BASE_URL}${route.path}${route.path.includes("?") ? "&" : "?"}wikiCapture=${variant}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    console.error(`  ✗ ${route.file} — goto failed: ${err.message}`);
    return false;
  }
  // Allow the initial alex-as-default fixture install to settle before
  // attempting any user switch. Without this wait the Switch user
  // button may not be in the DOM yet (AppShell mounts after the
  // FileSystemProvider's initialize() runs).
  await page.waitForTimeout(2000);
  // Switch user AFTER the goto so the fixture-mode install doesn't
  // clobber our switch.
  if (!route.pickerMode && route.asUser && route.asUser !== "any" && route.asUser !== "alex") {
    await restoreClusterButtons(page);
    const switched = await switchFixtureUser(page, route.asUser);
    if (!switched) {
      console.warn(`  ⚠ ${route.file}: failed to switch to ${route.asUser}, capturing as current user`);
    } else {
      // After switching, redirect logic in the page may bounce us elsewhere
      // (e.g. /lab-overview redirects member users to /). The user-switch
      // doesn't trigger a route change. If we landed on the wrong path,
      // use IN-APP navigation (anchor-link click) so Next.js does
      // client-side routing — a full page reload would re-run the
      // FileSystemProvider and reset currentUser to alex.
      const currentPath = await page.evaluate(() => window.location.pathname);
      const targetPath = route.path.split("?")[0];
      if (currentPath !== targetPath) {
        await page.evaluate((target) => {
          // Match by href (Next.js <Link> renders as <a href="...">).
          // Strip query params from the href for comparison.
          const links = Array.from(document.querySelectorAll("a"));
          const link = links.find((a) => {
            const h = a.getAttribute("href") || "";
            return h.split("?")[0] === target;
          });
          if (link) link.click();
        }, targetPath);
        await page.waitForTimeout(2500);
        // Verify we landed on the target.
        const after = await page.evaluate(() => window.location.pathname);
        if (after !== targetPath) {
          console.warn(`  ⚠ ${route.file}: in-app nav failed (path="${after}" expected "${targetPath}")`);
        }
      }
    }
  }
  if (route.waitFor) {
    const candidates = route.waitFor.split(",").map((s) => s.trim()).filter(Boolean);
    const races = candidates.map((sel) =>
      page.waitForSelector(sel, { timeout: 8000 }).catch(() => null),
    );
    await Promise.race(races);
  }
  await page.waitForTimeout(route.settleMs ?? 800);
  if (route.action) {
    // Restore cluster button visibility so the action can find launcher /
    // feedback buttons hidden by previous HIDE_SCRIPT pass.
    await restoreClusterButtons(page);
    try { await route.action(page); } catch (err) {
      console.warn(`  ⚠ ${route.file} — action threw: ${err.message}`);
    }
  }
  await applyClean(page);
  await page.waitForTimeout(250);
  try {
    if (route.fullPage) {
      const contentHeight = await page.evaluate(() => {
        const flips = [];
        const walk = (el) => {
          if (!el || el === document.body) return;
          const cs = getComputedStyle(el);
          if (cs.overflowY === "hidden" || cs.overflowY === "auto" || cs.overflowY === "scroll") {
            flips.push({ el, ov: el.style.overflow, h: el.style.height });
            el.style.overflow = "visible";
            el.style.height = "auto";
          }
        };
        document.querySelectorAll("main, main *").forEach(walk);
        let cur = document.querySelector("main");
        while (cur && cur !== document.body) {
          walk(cur);
          cur = cur.parentElement;
        }
        const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1000);
        window.__wikiCaptureFlips = flips;
        return Math.min(h + 100, 8000);
      });
      const originalViewport = page.viewportSize();
      await page.setViewportSize({
        width: originalViewport?.width ?? 1440,
        height: contentHeight,
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: out, fullPage: false });
      if (originalViewport) await page.setViewportSize(originalViewport);
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
    console.log(`  OK ${route.file}`);
    return true;
  } catch (err) {
    console.error(`  XX ${route.file} — screenshot failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Recapture sweep -> ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}\n`);
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  let ok = 0;
  let fail = 0;
  const failures = [];

  // Picker-mode routes use a fresh browser context (no signed-in user).
  const pickerRoutes = ROUTES.filter((r) => r.pickerMode);
  const fixtureRoutes = ROUTES.filter((r) => !r.pickerMode);

  if (pickerRoutes.length > 0) {
    console.log("Picker-mode routes:");
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const r of pickerRoutes) {
      const success = await captureRoute(page, r);
      if (success) ok++;
      else { fail++; failures.push(r.file); }
    }
    await ctx.close();
  }

  if (fixtureRoutes.length > 0) {
    console.log("\nFixture-mode routes (signed in as alex by default; mira switch via picker):");
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // Seed by navigating once to install the fixture as alex.
    await page.goto(`${BASE_URL}/?wikiCapture=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    for (const r of fixtureRoutes) {
      const success = await captureRoute(page, r);
      if (success) ok++;
      else { fail++; failures.push(r.file); }
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${ok} succeeded, ${fail} failed.`);
  if (failures.length > 0) console.log("Failed:\n  " + failures.join("\n  "));
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

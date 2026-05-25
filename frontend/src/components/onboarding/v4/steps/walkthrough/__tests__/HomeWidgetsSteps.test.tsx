/**
 * §6.2b Home widgets walkthrough step-body tests (home widgets §6.2b
 * step bodies manager, 2026-05-25).
 *
 * Five step bodies in one file because each individual step body is
 * small (narration + cursor demo) and the assertions follow the same
 * shape across all five. Mirrors the batched test convention used by
 * `WorkbenchNotesListsSteps.test.tsx` and `GanttShareClusterSteps.test.tsx`.
 *
 * Coverage per step:
 *   - canonical id assertion (catches accidental rename)
 *   - speech bubble carries no em-dashes (voice rule per
 *     feedback_no_em_dashes.md)
 *   - targetSelector resolves to a real `data-tour-target` value (or
 *     a documented prefix selector / aria-label selector)
 *   - completion contract shape (manual advance)
 *   - expectedRoute is "/" so refresh-mid-tour lands on home
 *   - cursorScript presence matches the step's class (narration steps
 *     have no script; demo steps do)
 *
 * No DOM/JSDOM mount: each body is a plain object, no React render
 * needed. The harder assertions (cursor playback against a real
 * canvas) belong in browser-driven E2E, not vitest.
 */
import { describe, expect, it, vi } from "vitest";

import { homeWidgetsCanvasIntroStep } from "../HomeWidgetsCanvasIntroStep";
import {
  HOME_WIDGETS_TILE_ANATOMY_CLOSE_SELECTOR,
  HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR,
  homeWidgetsTileAnatomyStep,
} from "../HomeWidgetsTileAnatomyStep";
import {
  HOME_WIDGETS_ADD_CATALOG_ITEM_SELECTOR,
  HOME_WIDGETS_ADD_DEMO_DONE_EVENT,
  HOME_WIDGETS_ADD_DEMO_PICK_ID,
  homeWidgetsAddStep,
} from "../HomeWidgetsAddStep";
import {
  HOME_WIDGETS_REORDER_DEST_SELECTOR,
  HOME_WIDGETS_REORDER_SOURCE_SELECTOR,
  homeWidgetsReorderStep,
} from "../HomeWidgetsReorderStep";
import { homeWidgetsExitStep } from "../HomeWidgetsExitStep";

/** Helper: pull the literal speech string off a step body. The §6.2b
 *  bodies all author `speech` as a plain string (no ReactNode JSX);
 *  this keeps the no-em-dash assertion straightforward. */
function speechOf(step: { speech: unknown }): string {
  return typeof step.speech === "string" ? step.speech : "";
}

describe("§6.2b home-widgets-canvas-intro (Step 1: canvas intro)", () => {
  it("declares the canonical id", () => {
    expect(homeWidgetsCanvasIntroStep.id).toBe("home-widgets-canvas-intro");
  });

  it("spotlights the whole home widget canvas", () => {
    expect(homeWidgetsCanvasIntroStep.targetSelector).toBe(
      "[data-tour-target=\"home-widget-canvas\"]",
    );
  });

  it("has no cursorScript (narration step, no cursor demo)", () => {
    expect(homeWidgetsCanvasIntroStep.cursorScript).toBeUndefined();
  });

  it("uses manual completion with the standard 'Got it, next' label", () => {
    expect(homeWidgetsCanvasIntroStep.completion).toEqual({
      type: "manual",
      buttonLabel: "Got it, next",
      disabledUntilEvent: undefined,
      disabledAriaLabel: undefined,
    });
  });

  it("expectedRoute is '/' (the cluster lives on the home surface)", () => {
    expect(homeWidgetsCanvasIntroStep.expectedRoute).toBe("/");
  });

  it("speech contains no em-dashes (voice rule)", () => {
    expect(speechOf(homeWidgetsCanvasIntroStep)).not.toContain("—");
  });

  it("speech is multi-sentence pedagogical prose (§6.2 voice match)", () => {
    // Heuristic: at least two sentence-ending periods. The §6.2 voice
    // anchor is multi-sentence reads; a single-sentence body would
    // drift toward the prior staccato style the redesign retired.
    const sentences = speechOf(homeWidgetsCanvasIntroStep)
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });

  it("declares an onEnter that scrolls the canvas into view (R1 fix)", async () => {
    // §6.2b R1 fresh-eyes fix (2026-05-25): at 1440x900 the canvas
    // sits below the fold (top=781, bottom=1003), so the spotlight
    // rings an element the user cannot see. The onEnter hook calls
    // scrollIntoView({ behavior: 'smooth', block: 'center' }) on the
    // canvas element so the spotlight measures a visible rect.
    expect(typeof homeWidgetsCanvasIntroStep.onEnter).toBe("function");

    // Mount a fixture canvas with a scroll spy. The onEnter should
    // resolve the selector and call scrollIntoView with the brief's
    // exact options.
    const el = document.createElement("div");
    el.setAttribute("data-tour-target", "home-widget-canvas");
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy as unknown as typeof el.scrollIntoView;
    document.body.appendChild(el);
    try {
      await homeWidgetsCanvasIntroStep.onEnter?.({ username: null });
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    } finally {
      el.remove();
    }
  });

  it("onEnter is a no-op when the canvas selector misses (best-effort)", async () => {
    // A defensive no-op path: if the canvas isn't mounted yet (the
    // user re-entered the tour mid-resume), onEnter must not throw.
    // Should resolve quickly without firing any side effect.
    await expect(
      homeWidgetsCanvasIntroStep.onEnter?.({ username: null }),
    ).resolves.toBeUndefined();
  });
});

describe("§6.2b home-widgets-tile-anatomy (Step 2: click to expand)", () => {
  it("declares the canonical id", () => {
    expect(homeWidgetsTileAnatomyStep.id).toBe("home-widgets-tile-anatomy");
  });

  it("spotlights the calendar-events-today tile (second Chip A pre-seed default)", () => {
    // §6.2b R3 fix (2026-05-25): switched from `sidebar-upcoming` to
    // `calendar-events-today`. R1 had pinned this step to
    // `sidebar-upcoming` to fix a prefix-match issue, but R2
    // fresh-eyes surfaced a deeper title mismatch: the Upcoming-tasks
    // tile opens the shared daily-tasks popup titled "Today's tasks"
    // (with overdue / today / upcoming sections), breaking the "click
    // the tile to expand it" teaching contract. The Today's-events
    // tile opens the calendar day view scoped to today, which matches
    // the tile content far more closely (the popup header still reads
    // "Calendar" rather than "Today's events", but the body content
    // matches). See the file-header comment for the full trade-off.
    expect(homeWidgetsTileAnatomyStep.targetSelector).toBe(
      HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR,
    );
    expect(HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR).toBe(
      "[data-tour-target='home-widget-tile-calendar-events-today']",
    );
  });

  it("close selector targets the SnapshotTilePopup dismiss button", () => {
    expect(HOME_WIDGETS_TILE_ANATOMY_CLOSE_SELECTOR).toBe(
      '[role="dialog"] button[aria-label="Close"]',
    );
  });

  it("has a cursorScript (BeakerBot demo: click + close)", () => {
    expect(typeof homeWidgetsTileAnatomyStep.cursorScript).toBe("function");
  });

  it("uses manual completion (universal pacing rule)", () => {
    expect(homeWidgetsTileAnatomyStep.completion.type).toBe("manual");
  });

  it("expectedRoute is '/' (the cluster lives on the home surface)", () => {
    expect(homeWidgetsTileAnatomyStep.expectedRoute).toBe("/");
  });

  it("speech contains no em-dashes (voice rule)", () => {
    expect(speechOf(homeWidgetsTileAnatomyStep)).not.toContain("—");
  });
});

describe("§6.2b home-widgets-add (Step 3: add a widget)", () => {
  it("declares the canonical id", () => {
    expect(homeWidgetsAddStep.id).toBe("home-widgets-add");
  });

  it("spotlights the +Add widget button", () => {
    expect(homeWidgetsAddStep.targetSelector).toBe(
      "[data-tour-target=\"home-widget-add-button\"]",
    );
  });

  it("the demo pick id is a stable widget id (not in the Chip A pre-seed default)", () => {
    // `lab-activity-by-type` is home-visible, member-visible, and NOT
    // in the seed defaults (sidebar-upcoming + calendar-events-today),
    // so the toggle ADDS the tile rather than removing it. If a future
    // widget rename moves this id, the test fails and the registry
    // walkthrough author can re-pick a safe demo widget.
    expect(HOME_WIDGETS_ADD_DEMO_PICK_ID).toBe("lab-activity-by-type");
    expect(HOME_WIDGETS_ADD_CATALOG_ITEM_SELECTOR).toBe(
      `[data-tour-target="home-widget-catalog-item-${HOME_WIDGETS_ADD_DEMO_PICK_ID}"]`,
    );
  });

  it("has a cursorScript (BeakerBot demo: click + pick)", () => {
    expect(typeof homeWidgetsAddStep.cursorScript).toBe("function");
  });

  it("uses manual completion gated on the demo-done event (R1 fresh-eyes fix)", () => {
    // §6.2b R1 fix (2026-05-25): the "Got it, next" button is gated on
    // a window CustomEvent fired by the trailing callback in the
    // cursor script. Without the gate, the button is clickable while
    // BeakerBot is mid-demo and the user cannot tell whether to wait
    // or advance. Mirrors the gantt-share-profile-switch pattern.
    expect(homeWidgetsAddStep.completion).toEqual({
      type: "manual",
      buttonLabel: "Got it, next",
      disabledUntilEvent: HOME_WIDGETS_ADD_DEMO_DONE_EVENT,
      disabledAriaLabel: "BeakerBot is demonstrating, hold on a moment...",
    });
    expect(HOME_WIDGETS_ADD_DEMO_DONE_EVENT).toBe(
      "tour:home-widgets-add-demo-done",
    );
  });

  it("expectedRoute is '/' (the cluster lives on the home surface)", () => {
    expect(homeWidgetsAddStep.expectedRoute).toBe("/");
  });

  it("speech contains no em-dashes (voice rule)", () => {
    expect(speechOf(homeWidgetsAddStep)).not.toContain("—");
  });

  it("cursor script ends with a callback that dispatches the demo-done event", async () => {
    // Without the trailing callback, the gated "Got it, next" button
    // would never enable. Assert the script ends with a callback
    // action and that calling its fn dispatches the named event.
    const script = await homeWidgetsAddStep.cursorScript?.();
    expect(script).toBeDefined();
    expect(script?.length).toBeGreaterThan(0);
    const last = script?.[script.length - 1];
    expect(last?.type).toBe("callback");
    if (last?.type !== "callback") return;
    const seen: string[] = [];
    const listener = (e: Event) => {
      seen.push(e.type);
    };
    window.addEventListener(HOME_WIDGETS_ADD_DEMO_DONE_EVENT, listener);
    try {
      await last.fn();
      expect(seen).toContain(HOME_WIDGETS_ADD_DEMO_DONE_EVENT);
    } finally {
      window.removeEventListener(HOME_WIDGETS_ADD_DEMO_DONE_EVENT, listener);
    }
  });

  it("cursor script closes the catalog before firing demo-done (R2 catalog-close fix)", async () => {
    // §6.2b R2 catalog-close fix (2026-05-25): the R2 mechanics verifier
    // caught that the catalog overlay stayed mounted into Step 4
    // (home-widgets-reorder), occluding the canvas so the synthetic
    // drag events landed on the overlay instead of the tiles. The
    // fix re-clicks the +Add widget button (which toggles
    // `showPalette` off in SnapshotCanvas) after the pick lands and
    // BEFORE the demo-done callback fires. We need to assert the
    // shape so a future refactor that drops the close step gets
    // caught by the test rather than by another fresh-eyes pass.
    //
    // Expected tail shape: [..., pick (callback), settle (callback),
    // closeCatalog (callback), fireDone (callback)]. All four are
    // callbacks at the runScript level (deferredClickAction wraps
    // its work in a callback, pause is a callback). The penultimate
    // callback is the close-catalog deferred click; we assert it by
    // mounting a fixture +Add button and verifying the fn clicks it.
    // Expected tail shape after compactScript filters nulls:
    //   - clickAdd (safeClickAction) resolves to a real `click` action
    //     only if the +Add button is in the DOM at build time. In
    //     JSDOM with no fixture, it's null and compactScript drops it.
    //   - beat (pause): callback
    //   - clickPick (deferredClickAction): callback
    //   - settle (pause): callback
    //   - closeCatalog (deferredClickAction): callback   <-- penultimate
    //   - fireDone (callbackAction): callback            <-- last
    //
    // Mount a fixture +Add button BEFORE building so the first click
    // survives compactScript. That gives us a deterministic 6-item
    // script regardless of test ordering, and lets us assert the
    // close-catalog deferred click actually fires a click on the
    // mounted +Add button.
    const addBtn = document.createElement("button");
    addBtn.setAttribute("data-tour-target", "home-widget-add-button");
    let clicks = 0;
    addBtn.addEventListener("click", () => {
      clicks += 1;
    });
    document.body.appendChild(addBtn);
    try {
      const script = await homeWidgetsAddStep.cursorScript?.();
      expect(script).toBeDefined();
      // 6 total actions: clickAdd, beat, clickPick, settle,
      // closeCatalog, fireDone. If the count drifts, the test forces
      // an explicit review of the script shape.
      expect(script?.length).toBe(6);
      const closeCatalog = script?.[script.length - 2];
      expect(closeCatalog?.type).toBe("callback");
      if (closeCatalog?.type !== "callback") return;
      // Awaiting the close-catalog callback should resolve the
      // selector (the mounted +Add button), then click it. We track
      // total clicks via the listener; the close fn is the second
      // click overall (the first is the script's own `clickAdd`
      // action, which is a `click` not a callback, so it doesn't run
      // here, we only invoke the close-catalog callback directly).
      // We expect exactly 1 click from this callback.
      await closeCatalog.fn();
      expect(clicks).toBe(1);
    } finally {
      addBtn.remove();
    }
  });
});

describe("§6.2b home-widgets-reorder (Step 4: drag to reorder)", () => {
  it("declares the canonical id", () => {
    expect(homeWidgetsReorderStep.id).toBe("home-widgets-reorder");
  });

  it("spotlights a drag handle (only stamped under edit-mode + home surface)", () => {
    expect(homeWidgetsReorderStep.targetSelector).toBe(
      "[data-tour-target='home-widget-drag-handle']",
    );
  });

  it("drag endpoints target nth-of-type tiles inside the canvas", () => {
    expect(HOME_WIDGETS_REORDER_SOURCE_SELECTOR).toBe(
      "[data-tour-target^='home-widget-tile-']:nth-of-type(1)",
    );
    expect(HOME_WIDGETS_REORDER_DEST_SELECTOR).toBe(
      "[data-tour-target^='home-widget-tile-']:nth-of-type(3)",
    );
  });

  it("has a cursorScript (BeakerBot demo: drag tile 1 to tile 3 slot)", () => {
    expect(typeof homeWidgetsReorderStep.cursorScript).toBe("function");
  });

  it("uses manual completion (universal pacing rule)", () => {
    expect(homeWidgetsReorderStep.completion.type).toBe("manual");
  });

  it("expectedRoute is '/' (the cluster lives on the home surface)", () => {
    expect(homeWidgetsReorderStep.expectedRoute).toBe("/");
  });

  it("speech contains no em-dashes (voice rule)", () => {
    expect(speechOf(homeWidgetsReorderStep)).not.toContain("—");
  });

  it("declares a recoveryHint naming the +Add widget re-entry button (R1 fix)", () => {
    // §6.2b R1 fix (2026-05-25): the previous version had no
    // `recoveryHint`, so the target-detach watcher's copy fell back to
    // the generic "the button you clicked before". Naming +Add widget
    // (the actual re-entry affordance for edit mode) points the user
    // at the right control if the drag handle unmounts mid-step.
    expect(homeWidgetsReorderStep.recoveryHint).toEqual({
      buttonLabel: "+ Add widget in the canvas toolbar",
    });
  });
});

describe("§6.2b home-widgets-exit (Step 5: exit beat + telegraph notifications)", () => {
  it("declares the canonical id", () => {
    expect(homeWidgetsExitStep.id).toBe("home-widgets-exit");
  });

  it("spotlights the notifications bell anchor (telegraphs §6.3)", () => {
    expect(homeWidgetsExitStep.targetSelector).toBe(
      "[data-tour-target=\"notifications-bell\"]",
    );
  });

  it("has a cursorScript (BeakerBot demo: glide-only to the bell)", () => {
    expect(typeof homeWidgetsExitStep.cursorScript).toBe("function");
  });

  it("uses manual completion (universal pacing rule)", () => {
    expect(homeWidgetsExitStep.completion.type).toBe("manual");
  });

  it("expectedRoute is '/' (no route change; §6.3 fires from home)", () => {
    expect(homeWidgetsExitStep.expectedRoute).toBe("/");
  });

  it("speech contains no em-dashes (voice rule)", () => {
    expect(speechOf(homeWidgetsExitStep)).not.toContain("—");
  });

  it("speech telegraphs the next section (notifications) without firing it", () => {
    // The exit beat hands off to §6.3a (notifications-bell), which
    // owns the actual test-notification spawn via its onEnter. This
    // step's speech should mention notifications as the next surface
    // so the user isn't surprised when the bell pulses on the next
    // step. Assert the literal "notifications" word appears so a
    // future copy edit that drops the handoff surfaces here.
    expect(speechOf(homeWidgetsExitStep).toLowerCase()).toContain("notifications");
  });

  it("onEnter clicks the canvas Done button only when edit mode is on (R3 fix)", async () => {
    // §6.2b R3 fix (2026-05-25): the reorder step leaves the canvas
    // in edit mode (the +Add toggle in Step 3 auto-enabled it). The
    // exit step's onEnter must turn edit mode off before the user
    // reads the wrap-up, otherwise the Done / Reset / +Add controls
    // bleed visually into §6.3's notifications-bell beat.
    //
    // Behavior: find `home-widget-edit-toggle`; if its text reads
    // "Done", click it. If text reads "Edit layout" (somehow already
    // exited), do nothing. If the button isn't mounted, do nothing.
    expect(typeof homeWidgetsExitStep.onEnter).toBe("function");

    // Case 1: button reads "Done" → click fires.
    const doneBtn = document.createElement("button");
    doneBtn.setAttribute("data-tour-target", "home-widget-edit-toggle");
    doneBtn.textContent = "Done";
    let doneClicks = 0;
    doneBtn.addEventListener("click", () => {
      doneClicks += 1;
    });
    document.body.appendChild(doneBtn);
    try {
      await homeWidgetsExitStep.onEnter?.({ username: null });
      expect(doneClicks).toBe(1);
    } finally {
      doneBtn.remove();
    }

    // Case 2: button reads "Edit layout" → no click (already locked).
    const lockBtn = document.createElement("button");
    lockBtn.setAttribute("data-tour-target", "home-widget-edit-toggle");
    lockBtn.textContent = "Edit layout";
    let lockClicks = 0;
    lockBtn.addEventListener("click", () => {
      lockClicks += 1;
    });
    document.body.appendChild(lockBtn);
    try {
      await homeWidgetsExitStep.onEnter?.({ username: null });
      expect(lockClicks).toBe(0);
    } finally {
      lockBtn.remove();
    }

    // Case 3: button not mounted → silent no-op (resolves without
    // throwing, no side effects).
    await expect(
      homeWidgetsExitStep.onEnter?.({ username: null }),
    ).resolves.toBeUndefined();
  });
});

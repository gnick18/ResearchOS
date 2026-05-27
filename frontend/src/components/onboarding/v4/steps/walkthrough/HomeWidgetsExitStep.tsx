/**
 * §6.2b Home widgets walkthrough, STEP 5: exit beat.
 *
 * Fifth and final §6.2b sub-step. Wraps up the home canvas teaching
 * and telegraphs the next section (§6.3 notifications) by gliding the
 * cursor toward the notifications bell in the top nav. Manual advance
 * hands off to `notifications-bell` (§6.3a), which then fires the
 * test notification onEnter.
 *
 * Cursor + spotlight:
 *   - spotlight on the notifications bell (`notifications-bell` target,
 *     the same anchor §6.3a will spotlight). Pulling the spotlight
 *     toward the next surface gives the user a visual hint about
 *     what's coming without firing the notification yet (§6.3a's
 *     onEnter handles the spawn).
 *   - cursor glides from wherever it last sat (over the canvas reorder
 *     handle) up to the bell area, telegraphing §6.3.
 *
 * Classification: BEAKERBOT DEMO + transition beat. Speech says "I'll
 * move us over to the bell next", an explicit BeakerBot-led promise;
 * the cursor glides as advertised. No click: the bell click belongs
 * to §6.3a (the user clicks it themselves after the test notification
 * fires).
 *
 * No expectedRoute change: the user stays on `/`. §6.3 fires from the
 * same home surface; the next route push is much later in the tour.
 *
 * Voice match: §6.2 wrap-up cadence. The "up next, notifications"
 * cap echoes the §6.2-exit handoff style without promising specific
 * mechanics (the user finds out what notifications do in §6.3).
 *
 * Edit-mode exit (§6.2b R3 fix manager, 2026-05-25): Step 3 (add
 * widget) and Step 4 (reorder) leave the canvas in edit mode (the
 * +Add toggle auto-enters edit mode in SnapshotCanvas's onClick).
 * Without an explicit exit, Step 5's spotlight on the bell renders
 * over a canvas that still shows the blue Done button, Reset, and
 * +Add widget controls, so the user wonders whether they need to
 * Save before moving on. The R3 fix adds an `onEnter` hook that
 * finds the home canvas edit toggle (`home-widget-edit-toggle`) and
 * clicks it ONLY if its text reads "Done" (i.e. the canvas is in
 * edit mode). Clicking "Done" toggles `isEditing` to false in
 * SnapshotCanvas, the toolbar returns to its lock state, and the
 * user reads Step 5 against a calm canvas. If the toggle isn't
 * mounted yet (the user re-entered the tour mid-resume and the
 * canvas hasn't rendered) the hook is a silent no-op. If the toggle
 * already reads "Edit layout" (edit mode was somehow exited earlier),
 * the hook also no-ops to avoid the opposite mistake of re-entering
 * edit mode.
 *
 * R4 fix (§6.2b R4 fix manager, 2026-05-25): the raw `el.click()`
 * the R3 fix used was being swallowed by the InputLockOverlay's
 * capture-phase blocker because by the time `onEnter` fires the
 * controller has already armed the input lock for this step's
 * cursor script. Without the `__beakerBotCursorClicking` flag, the
 * overlay stopPropagation'd the click before SnapshotCanvas's
 * onClick fired and edit mode stayed on through §6.3 (fresh-eyes
 * sequential walk caught this; the R3 mechanics verifier missed it
 * because it seed-jumped directly into Step 5 without the lock
 * being armed). The R4 fix routes the click through the new
 * `tourClickWithLockBypass` helper which sets the flag around the
 * click and resets it in a finally block, mirroring the path
 * `BeakerBotCursor.clickAt` and `deferredClickAction` use.
 */
import {
  compactScript,
  cursorScript,
  safeGlideToElementAction,
  tourClickWithLockBypass,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { pushTourWidgetDemoPreview } from "../../TourWidgetDemoPreview";

// §6.2b Home widgets demo-preview lease (tour-fixtures sub-bot R2,
// 2026-05-26). See HomeWidgetsCanvasIntroStep for the design
// rationale. The exit step holds the lease through the "That's the
// canvas... up next, notifications" wrap-up so the tiles stay
// populated while the user reads the cap; once they click "Got it,
// next" and the controller advances to §6.3a notifications-bell, the
// onExit release fires and the tiles return to their real (empty)
// state for the rest of the tour.
let releaseDemoPreview: (() => void) | null = null;

export const homeWidgetsExitStep = buildWalkthroughStep({
  id: "home-widgets-exit",
  speech:
    "That covers the canvas. You can come back anytime to swap widgets in and out. If you want to try out different widgets with real data, the demo account is a great place to do that. Next, let's look at how ResearchOS keeps you updated.",
  pose: "pointing",
  // Spotlight + cursor target both anchor on the bell so the user's eye
  // is drawn toward §6.3's surface before the bell click owns it.
  targetSelector: targetSelector(TOUR_TARGETS.notificationsBell),
  // §6.2b R3 fix (2026-05-25): exit edit mode before the user reads
  // the wrap-up. The reorder step (Step 4) leaves the canvas with the
  // +Add widget / Done / Reset controls visible because the +Add click
  // in Step 3 auto-enabled edit mode and nothing has turned it back
  // off. Find the home canvas edit toggle by `data-tour-target`, read
  // its text content, and click only if it currently reads "Done" (the
  // edit-mode label). Best-effort: a missing button or an unreadable
  // text node both silent-no-op rather than throwing. Mirrors the
  // canvas-intro step's onEnter scroll pattern (best-effort lifecycle
  // hook that never wedges the tour).
  onEnter: async () => {
    // §6.2b demo-preview push (tour-fixtures sub-bot R2, 2026-05-26).
    // The exit step holds the lease through the wrap-up so the tiles
    // stay populated while the user reads "That's the canvas... up
    // next, notifications". onExit (below) releases the lease so the
    // tiles return to their real (empty) state for the rest of the
    // tour. Push BEFORE the existing Done-button check so even if that
    // path throws (it doesn't, but defensively) the lease is in place.
    // The TourController contract guarantees onExit fires before a
    // re-entry, so we don't defensively release here (release is
    // microtask-deferred and would race the push).
    releaseDemoPreview = pushTourWidgetDemoPreview();

    if (typeof document === "undefined") return;
    const el = document.querySelector(
      targetSelector(TOUR_TARGETS.homeWidgetEditToggle),
    );
    if (!(el instanceof HTMLElement)) return;
    // Read text content. The SnapshotCanvas toolbar renders the label
    // as a literal string ("Done" in edit mode, "Edit layout"
    // otherwise) with no nested chrome, so a trimmed textContent
    // compare is enough. Click only when the toggle is showing "Done"
    // so we never accidentally re-enter edit mode if the user (or a
    // future step) already exited it.
    const label = (el.textContent ?? "").trim();
    if (label === "Done") {
      // §6.2b R4 fix (2026-05-25): use tourClickWithLockBypass so the
      // click rides past the InputLockOverlay's capture-phase blocker.
      // The helper sets `__beakerBotCursorClicking` around the click
      // (mirroring BeakerBotCursor.clickAt and deferredClickAction)
      // and resets it in a finally block so a throwing click can't
      // leave the lock free-riding.
      tourClickWithLockBypass(el);
    }
  },
  onExit: async () => {
    // Drop the demo-preview lease. This is the LAST §6.2b lease in the
    // cluster (canvas-intro → tile-anatomy → exit); once it releases,
    // the refcount returns to zero and the snapshot tiles re-render
    // with the user's real (empty) data for the §6.3+ notifications
    // beats and the rest of the tour.
    if (releaseDemoPreview) {
      const release = releaseDemoPreview;
      releaseDemoPreview = null;
      try {
        release();
      } catch (err) {
        console.error(
          "[home-widgets-exit] demo-preview release threw:",
          err,
        );
      }
    }
  },
  cursorScript: cursorScript(async () => {
    // Glide-only (no click): the bell click belongs to §6.3a after the
    // test notification fires. This beat is purely the visual handoff.
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.notificationsBell),
      3000,
    );
    return compactScript([glide]);
  }),
  // Manual advance per universal pacing (Grant 2026-05-22). The user
  // reads the wrap-up sentence, then clicks Got it, next to hand off
  // to §6.3a (notifications-bell) which fires the test notification
  // via its onEnter hook.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});

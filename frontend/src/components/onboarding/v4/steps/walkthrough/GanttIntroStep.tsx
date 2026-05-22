/**
 * §6.8 Gantt — task types intro + alt-creation peek (combined).
 *
 * First Gantt sub-step. Speech introduces the three task types
 * (experiments / lists / projects), and the cursor demos that there
 * are TWO ways to create tasks on the Gantt page:
 *
 *   1. Double-click a day on the timeline → new-task affordance.
 *   2. Click the blue "+ Task" button.
 *
 * The cursor does the first (double-click) then cancels, then clicks
 * the "+ Task" button. The button click sequence opens the modal but
 * the cursor immediately closes it (we already created an experiment
 * on the Workbench in §6.5). The point is to show both affordances
 * exist.
 *
 * BeakerBotCursor's primitive set doesn't include double-click; we
 * click twice in quick succession against the timeline target as a
 * stand-in. Real handlers that distinguish click vs double-click
 * (e.g., Gantt's day-cell hit-zones) will read the second click as
 * the double-click event due to the rapid timing.
 *
 * Manual advance — there's no clean API event to wait for; the cursor
 * narrative is the whole demo.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech closes with "You already made yours on the
 * Workbench", i.e. the cursor's double-click + Task-button click
 * sequence is purely demonstrative, NOT a directive for the user to
 * follow. The point is to show the two affordances exist. Cursor
 * keeps the click sequence as a demo.
 *
 * Modal-close follow-up (HR-dispatched: v4 §6.8 Gantt modal+goal
 * sub-bot 2026-05-21): the + Task click opens the TaskModal, and the
 * subsequent gantt-drag-drop / gantt-chained-deps / gantt-goals steps
 * would otherwise fire against a timeline covered by that modal. We
 * schedule an Escape keydown on `document` after the cursor's three
 * actions are expected to settle (~3.5s for three click primitives at
 * 1000ms glide + 30ms order delay + 150ms ripple each) plus ~600ms of
 * dwell so the user sees the modal open AND close. TaskModal listens
 * for Escape via a keydown handler (TaskModal.tsx ~line 184).
 *
 * Why setTimeout from inside the build callback (not a new cursor
 * primitive): the cursor's CursorAction union has no `sleep` or
 * `keydown` primitive (BeakerBotCursor.tsx ~line 78). Extending the
 * primitive set just for this single use-case is heavier than a
 * scheduled keydown; the cursor finishes its scripted glide+click
 * sequence on a known timeline, so a fixed-delay keydown lands
 * deterministically AFTER the +Task click has opened the modal. The
 * keydown is best-effort and idempotent (extra Escapes are no-ops
 * once the modal is already closed).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** Delay (ms) between the cursor script kicking off and the Escape
 *  keydown that dismisses the TaskModal opened by the + Task click.
 *  Three click primitives at ~1180ms each (1000ms glide + 30ms order
 *  delay + 150ms ripple) ≈ 3540ms; +600ms dwell so the user sees the
 *  modal mount before it closes. */
const MODAL_DISMISS_DELAY_MS = 4200;

export const ganttIntroStep = buildWalkthroughStep({
  id: "gantt-task-types",
  speech: (
    <>
      <p className="mb-2">
        Gantt time. Three task types: experiments, lists, and projects.
        You just made an experiment; let me show you the timeline.
      </p>
      <p>
        Two ways to make tasks here: double-click a day on the
        timeline, or click the blue + Task button. You already made
        yours on the Workbench.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  cursorScript: cursorScript(async () => {
    // Double-click stand-in: click the timeline twice. Real double-
    // click detectors fire on consecutive clicks within ~500ms; the
    // cursor's click-then-glide-then-click sequence is fast enough.
    const dblA = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    const dblB = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    const buttonClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttNewTaskButton),
    );
    // Schedule the modal dismiss BEFORE returning the script. The
    // controller will call cursor.runScript(actions) right after this
    // callback resolves, so the timeout starts ticking ~immediately
    // before the cursor begins its glide. By the time
    // MODAL_DISMISS_DELAY_MS elapses, the + Task click has fired and
    // the TaskModal has mounted; the Escape keydown then closes it so
    // the next step's timeline is unobstructed.
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      window.setTimeout(() => {
        try {
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } catch {
          // No-op: in environments where KeyboardEvent construction
          // is unavailable (very old jsdom), we just leave the modal
          // alone — the user can click the modal's own Cancel button.
        }
      }, MODAL_DISMISS_DELAY_MS);
    }
    return compactScript([dblA, dblB, buttonClick]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});

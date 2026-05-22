"use client";

/**
 * Shared builder for the 8 per-tab lab-mode-* tour beats.
 *
 * Every tab step (lab-mode-activity through lab-mode-search) shares
 * the same shape:
 *   - Inside the DemoLabModeViewer overlay (no route change).
 *   - Pose `pointing`, manual completion `Got it, next`.
 *   - Spotlight + click on the matching tab button so the panel
 *     mounts as the user reads the speech.
 *   - Gated on `picks.account_type === "lab"`.
 *   - Resume-guards via `useLabModeResumeGuard` so a stale resume
 *     into a step the user actually skipped routes to lab-cleanup.
 *
 * Centralizing the boilerplate keeps each step file focused on its
 * speech copy + tab-target name.
 *
 * Lab Mode fix manager R1 (2026-05-22): added optional
 * `additionalActions` so per-step files can extend the cursor demo
 * beyond the tab click (e.g. lab-mode-activity opens + closes a
 * popup, lab-mode-methods walks a three-click chain). The base
 * builder still owns the tab-click + the safety short-circuit when
 * the overlay isn't mounted; the additional actions array is
 * concatenated after the tab click and runs only if the tab anchor
 * resolved (otherwise the script's already empty).
 */
import type { ReactNode } from "react";
import { useLabModeResumeGuard } from "../LabModeIntroStep";
import {
  callbackAction,
  cursorScript,
  deferredClickAction,
  safeClickAction,
  safeGlideToElementAction,
  safeTypeAction,
  compactScript,
} from "../../walkthrough/lib/cursor-script";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../../walkthrough/lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "../../walkthrough/lib/targets";
import type {
  CursorAction,
  TourStep,
  TourStepId,
} from "../../../step-types";

interface LabModeTabStepInput {
  /** Step id matching the entry in TOUR_STEP_ORDER. */
  id: TourStepId;
  /** TOUR_TARGETS constant value for the tab button this step
   *  spotlights. The cursor clicks it on entry so the demo panel
   *  swaps in. */
  tabTarget: (typeof TOUR_TARGETS)[keyof typeof TOUR_TARGETS];
  /** Speech body as a ReactNode (so the per-step file can render
   *  multi-paragraph copy without re-implementing the wrapper). */
  speech: ReactNode;
  /** Optional testid override. Defaults to the step id. */
  testid?: string;
  /** Lab Mode fix manager R1 (2026-05-22): optional builder for
   *  additional cursor actions to play AFTER the tab click. Receives
   *  the helpers it needs so per-step files don't have to re-import
   *  cursor-script primitives.
   *
   *  Returning a null entry is OK (compactScript drops nulls). The
   *  builder runs only when the tab anchor existed; if the overlay
   *  isn't mounted, the per-tab script short-circuits to [] and the
   *  builder is skipped.
   *
   *  Helper notes:
   *   - `safeClickAction` resolves at BUILD time; only use it for
   *     anchors that already exist (the tab content as soon as the
   *     tab click plays, OR pre-mounted UI).
   *   - `deferredClickAction` resolves at PLAYBACK time — use this
   *     for follow-up clicks on UI that mounts in response to an
   *     earlier action in the same script (e.g. clicking a popup
   *     close button after opening the popup). */
  additionalActions?: (helpers: {
    safeClickAction: typeof safeClickAction;
    safeTypeAction: typeof safeTypeAction;
    safeGlideToElementAction: typeof safeGlideToElementAction;
    deferredClickAction: typeof deferredClickAction;
    callbackAction: typeof callbackAction;
  }) => Promise<ReadonlyArray<CursorAction | null>>;
}

interface LabModeTabSpeechProps {
  testid: string;
  children: ReactNode;
}

function LabModeTabSpeech({ testid, children }: LabModeTabSpeechProps) {
  useLabModeResumeGuard();
  return (
    <div
      data-step-id={testid}
      data-testid={testid}
      className="space-y-2"
    >
      {children}
    </div>
  );
}

/**
 * Build a lab-mode tab step body. Each step's cursorScript clicks
 * the tab button by `data-tour-target`; `safeClickAction` no-ops
 * when the target isn't on screen (the user closed the viewer
 * mid-step, the overlay hasn't mounted yet on a refresh, etc.).
 */
export function buildLabModeTabStep(input: LabModeTabStepInput): TourStep {
  return buildWalkthroughStep({
    id: input.id,
    pose: "pointing",
    speech: () => (
      <LabModeTabSpeech testid={input.testid ?? input.id}>
        {input.speech}
      </LabModeTabSpeech>
    ),
    targetSelector: targetSelector(input.tabTarget),
    cursorScript: cursorScript(async () => {
      // Resume-friendly short-circuit: if the demo viewer overlay
      // isn't mounted (the user manually closed it, the warp step
      // didn't fire, etc.), the tab anchor won't exist. Probing the
      // DOM directly avoids the 5s `waitForElement` timeout that
      // would otherwise stall the cursor.
      if (typeof document !== "undefined") {
        if (!document.querySelector(targetSelector(input.tabTarget))) {
          return [];
        }
      }
      const tabClick = await safeClickAction(targetSelector(input.tabTarget));
      const extras = input.additionalActions
        ? await input.additionalActions({
            safeClickAction,
            safeTypeAction,
            safeGlideToElementAction,
            deferredClickAction,
            callbackAction,
          })
        : [];
      return compactScript([tabClick, ...extras]);
    }),
    completion: manualAdvance("Got it, next"),
    conditionalOn: (picks) => picks?.account_type === "lab",
  });
}

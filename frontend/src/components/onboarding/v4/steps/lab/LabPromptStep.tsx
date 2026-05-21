"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import { cleanupBeakerBotLabUser } from "./lib/lab-fake-user";

/**
 * lab-prompt step body. §6.16 entry, L20 lock.
 *
 * Fires at the end of the main walkthrough when Q1 = "lab". Asks the
 * user: Now / Later / Dismiss. Each branch writes the appropriate
 * sidecar field via `patchOnboarding`:
 *
 *   - Now      : no sidecar write beyond clearing any prior opt-out.
 *                The controller advances to `lab-spawn-beakerbot`.
 *   - Later    : `lab_tour_pending: true`. The controller skips the
 *                remaining lab cluster (jumps to `phase4-cleanup`).
 *                The natural-Lab-Mode-entry trigger (P3b territory,
 *                outside P7 scope) re-prompts when the user opens
 *                `/lab` on their own.
 *   - Dismiss  : `lab_tour_dismissed_at: <ISO timestamp>`. Permanent.
 *                Settings re-run is the only path back. Controller
 *                skips the remaining lab cluster.
 *
 * The speech bubble itself renders the three branch buttons (we
 * override the default "Got it, next" affordance entirely with three
 * action buttons inside the speech ReactNode). The `manual`
 * completion type with a hidden / no-render button label is the
 * minimum-friction way to do this within the P1 controller surface;
 * each button calls `noteManualAdvance()` after the corresponding
 * sidecar write so the controller advances to the next applicable
 * step under the freshly-updated picks.
 *
 * Tour-controller integration:
 *   - We expose a factory function `buildLabPromptStep()` that the
 *     step-registry patcher calls; the factory captures the
 *     controller's actions via the hook inside the rendered speech
 *     ReactNode. The TourStep body is a static object; the speech
 *     ReactNode uses an internal React component that calls
 *     `useTourController` to dispatch the advance.
 */

interface LabPromptInnerProps {
  /** Override for the auto-cleanup that fires on Dismiss. Tests pass
   *  a mock so they don't try to read the file system. Falls back to
   *  the real helper. */
  onDismiss?: (recipient: string) => Promise<void>;
}

function LabPromptInner({ onDismiss }: LabPromptInnerProps) {
  const controller = useTourController();
  const [busy, setBusy] = useState<"now" | "later" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dismissedRef = useRef(false);

  const persistPick = async (
    pick: "now" | "later" | "dismiss",
  ): Promise<boolean> => {
    setBusy(pick);
    setError(null);
    try {
      const username = await getCurrentUserCached();
      if (!username) {
        setError(
          "Couldn't read your username. Try again, or skip this step.",
        );
        return false;
      }
      const dismissedAt =
        pick === "dismiss" ? new Date().toISOString() : null;
      await patchOnboarding(username, (cur) => ({
        ...cur,
        lab_tour_pending: pick === "later",
        lab_tour_dismissed_at: dismissedAt,
      }));
      return true;
    } catch (err) {
      console.error("[onboarding-v4] lab-prompt persist failed", err);
      setError("Couldn't save that. Try again, or skip this step.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleNow = async () => {
    if (busy) return;
    const ok = await persistPick("now");
    if (ok) controller.noteManualAdvance();
  };

  const handleLater = async () => {
    if (busy) return;
    const ok = await persistPick("later");
    if (ok) {
      // Later writes `lab_tour_pending: true`. Skip the remaining lab
      // cluster: the controller's `getNextStep` honours the
      // step-machine, which still treats the cluster as gated on
      // account_type alone. We jump straight to phase4-cleanup so the
      // user lands at the end of the tour proper.
      controller.exitTour();
    }
  };

  const handleDismiss = async () => {
    if (busy) return;
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    const ok = await persistPick("dismiss");
    if (!ok) {
      dismissedRef.current = false;
      return;
    }
    // Dismiss tears down anything the spawn step might already have
    // created (in case the user picked Now → went forward → back-
    // stepped → picked Dismiss). The helper is idempotent + safe when
    // nothing was created.
    try {
      const username = await getCurrentUserCached();
      if (username) {
        const cleanup = onDismiss ?? cleanupBeakerBotLabUser;
        await cleanup(username);
      }
    } catch (err) {
      console.warn(
        "[onboarding-v4] lab-prompt dismiss cleanup failed (best effort)",
        err,
      );
    }
    controller.exitTour();
  };

  return (
    <div data-step-id="lab-prompt" className="space-y-3">
      <div className="leading-relaxed">
        Bonus round: Lab Mode tour. Want to see how collaboration works?
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleNow()}
          disabled={busy !== null}
          data-lab-prompt-pick="now"
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 text-left"
        >
          Now ({"~"}2 min)
        </button>
        <button
          type="button"
          onClick={() => void handleLater()}
          disabled={busy !== null}
          data-lab-prompt-pick="later"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50 text-left"
        >
          Later (I&apos;ll prompt you the first time you open Lab Mode)
        </button>
        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={busy !== null}
          data-lab-prompt-pick="dismiss"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 text-left"
        >
          Dismiss (re-run from Settings any time)
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Build the registry entry for the `lab-prompt` step. The speech
 * renders the three-branch picker; pose is "pointing" (BeakerBot
 * gesturing toward the buttons); completion is "manual" but the
 * button label is hidden because the in-speech buttons handle
 * advance themselves. Calling the default "Got it, next" affordance
 * would skip the prompt entirely: we leave the label populated as a
 * fallback so a keyboard-only user with no button click can still
 * advance.
 *
 * Useful surface for tests: pass `overrides.onDismiss` to mock the
 * cleanup helper so the test doesn't touch the file system.
 */
export interface BuildLabPromptStepOptions {
  /** Override the dismiss-cleanup hook. Tests use this to mock
   *  `cleanupBeakerBotLabUser`. */
  onDismiss?: (recipient: string) => Promise<void>;
}

export function buildLabPromptStep(
  options: BuildLabPromptStepOptions = {},
): TourStep {
  return {
    id: "lab-prompt",
    speech: () => <LabPromptInner onDismiss={options.onDismiss} />,
    pose: "pointing",
    completion: {
      type: "manual",
      // Hidden affordance kept as a keyboard fallback. The default
      // "Got it, next" reads as "skip the picker": relabel for clarity.
      buttonLabel: "Skip lab tour",
    },
  };
}

export default LabPromptInner;

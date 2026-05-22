"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — universal speech intro.
 *
 * Lab Mode manager 2026-05-22. Pure narration step. Explains what
 * Lab Mode is and warns the user that the next beat warps them into
 * a demo viewer because their own Lab Mode is empty (they're brand
 * new). No cursor, no DOM target.
 *
 * Conditional on `lab_mode_tour_choice === "now"` — reached only via
 * the Now branch of `lab-mode-prompt`. The step-machine gate uses
 * `picks.account_type === "lab"` for the cluster as a whole; this
 * step's body also probes the sidecar on mount and branches away to
 * lab-cleanup if the user landed here via a stale resume_state when
 * their pick was actually Later or Dismiss.
 */
import { useEffect } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";

/** Sidecar resume safety: re-used across every lab-mode-* body to
 *  branch away when the user's stored pick says they declined the
 *  walk. Exported so the per-step files share one implementation. */
export function useLabModeResumeGuard(): void {
  const controller = useTourController();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const username = await getCurrentUserCached();
        if (!username) return;
        const cur = await readOnboarding(username);
        if (cancelled) return;
        const choice = cur.lab_mode_tour_choice;
        if (choice === "later" || choice === "dismiss") {
          // Stale resume into a step the user shouldn't be on. Jump to
          // lab-cleanup (next applicable lab step). Idempotent because
          // branchTo only acts once per step lifetime.
          controller.branchTo("lab-cleanup");
        }
      } catch {
        // Best-effort probe. On read failure, render normally.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller]);
}

function LabModeIntroInner() {
  useLabModeResumeGuard();
  return (
    <div data-step-id="lab-mode-intro" data-testid="lab-mode-intro" className="space-y-2">
      <p>
        Lab Mode is for finding old experiments, seeing what teammates
        are working on, summarizing everyone&apos;s purchase orders,
        methods usage, and so on.
      </p>
      <p>
        Your own Lab Mode is empty right now, you&apos;re brand new. So
        I&apos;m going to flip you over to a demo version that&apos;s
        already populated. You&apos;ll be looking at someone else&apos;s
        data, but it shows what yours will look like in a few weeks.
      </p>
    </div>
  );
}

export const labModeIntroStep: TourStep = buildWalkthroughStep({
  id: "lab-mode-intro",
  pose: "pointing",
  speech: () => <LabModeIntroInner />,
  completion: manualAdvance("Got it, take me there"),
  conditionalOn: (picks) => picks?.account_type === "lab",
});

export default LabModeIntroInner;

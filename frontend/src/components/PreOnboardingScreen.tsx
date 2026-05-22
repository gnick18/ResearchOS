"use client";

import { useEffect, useState } from "react";
import {
  hasSeenPreOnboarding,
  markPreOnboardingSeen,
  resetPreOnboardingSeen,
} from "@/lib/pre-onboarding/pre-onboarding-storage";

/**
 * Pre-onboarding screen — P0 STUB.
 *
 * This component is the minimum viable surface that the providers.tsx
 * gate can mount and dismiss. It is INTENTIONALLY content-free: the
 * welcome / data-security / folder-choice / cloud-provider / ready
 * screens land in P1+ along with the screen-state machine, BeakerBot
 * mascot, and speech bubble (see PRE_ONBOARDING_PROPOSAL.md §4.2 /
 * §6).
 *
 * Lifecycle:
 *
 *   1. providers.tsx renders <PreOnboardingScreen onComplete=…>
 *      because the gate predicate fired (first-touch, no folder, not
 *      in demo/wikiCapture/preview mode).
 *   2. On mount we honor `?reset-pre-onboarding=1` for manual QA so
 *      developers can replay the flow without digging into devtools
 *      storage. The flag clears localStorage and removes itself from
 *      the URL so a refresh doesn't keep wiping state.
 *   3. The Skip button calls `markPreOnboardingSeen()` and then
 *      `onComplete()` — providers.tsx flips its gate state and the
 *      existing ResearchFolderSetupNew takes over.
 *
 * The component does NOT consult fileSystem context or any other
 * provider, by design — the gate predicate in providers.tsx is the
 * single decision point for whether to mount. Keeping this screen
 * provider-agnostic also makes it trivially renderable in tests
 * (a single Skip click is the entire P0 contract).
 */
export interface PreOnboardingScreenProps {
  onComplete: () => void;
}

export default function PreOnboardingScreen({
  onComplete,
}: PreOnboardingScreenProps) {
  // Manual-QA reset hook. We run this exactly once on mount: clear the
  // flag if the URL opts in, then strip the flag from the URL so the
  // user doesn't keep wiping state on every soft navigation. Note that
  // the gate predicate has already fired at this point — the user is
  // staring at the screen — so clearing the flag here doesn't re-mount
  // anything, it just resets the persistence so the NEXT cold load
  // sees the intro again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reset-pre-onboarding") === "1") {
        resetPreOnboardingSeen();
        params.delete("reset-pre-onboarding");
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : "") +
          window.location.hash;
        window.history.replaceState(null, "", next);
      }
    } catch {
      // URL parsing or history mutation can fail in exotic embeds;
      // never crash the screen over a dev hook.
    }
  }, []);

  // We don't actually need component-level state for P0 — the entire
  // dismiss flow is a single onComplete() call — but keeping a tiny
  // useState here means the P1 state machine can swap in without
  // changing the export shape.
  const [dismissing, setDismissing] = useState(false);

  const handleSkip = () => {
    if (dismissing) return;
    setDismissing(true);
    markPreOnboardingSeen();
    onComplete();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4"
      data-pre-onboarding-screen="stub"
      role="dialog"
      aria-modal="true"
      aria-label="ResearchOS pre-onboarding"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white/10 p-6 text-white backdrop-blur-xl">
        <h2 className="mb-3 text-xl font-bold">Welcome to ResearchOS</h2>
        <p className="mb-6 text-sm text-slate-200">
          Pre-onboarding screen — implementation in progress.
        </p>
        <button
          type="button"
          onClick={handleSkip}
          disabled={dismissing}
          className="inline-flex items-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          data-testid="pre-onboarding-skip"
        >
          Skip and pick a folder
        </button>
      </div>
    </div>
  );
}

// Re-export the persistence read so callers (providers.tsx gate, dev
// tooling) can hit a single import path rather than reaching into the
// lib folder directly. Keeps the screen's public API self-contained.
export { hasSeenPreOnboarding };

"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import TourBootstrap from "./TourBootstrap";
import { TourControllerProvider } from "./TourController";
// Lab Mode redesign 2026-05-22 — append-only mount for the Phase 2c
// DemoLabModeViewer overlay. The host is window-event-driven and sits
// alongside TourControllerProvider so the overlay survives across
// multiple lab-mode-* tour sub-steps. No-op when no step has dispatched
// `lab-mode-tour:open`.
import DemoLabModeMount from "./DemoLabModeMount";
// Cleanup retirement 2026-05-22 (Cleanup manager R2) — sibling overlay
// host for the new `tour-goodbye` terminal step. Window-event-driven;
// renders nothing until the step body dispatches
// `tour-goodbye:play-outro` on its onExit hook. The overlay survives
// the controller's currentStep going null (the tour ends as soon as
// the user clicks "Let's go"), runs auto-cleanup + animations, then
// routes to `/`.
import { TourGoodbyeOverlay } from "./steps/cleanup/TourGoodbyeStep";

/**
 * Onboarding v4 P11 mount wrapper. Holds the active user's sidecar in
 * state, threads it through `<TourControllerProvider>` (which the
 * ModalSetupShell reads for `feature_picks` + `artifacts_created`),
 * and exposes the canonical `patchSidecar` callback the setup step
 * bodies use to persist Q1-Q6 answers.
 *
 * Cleanup retirement 2026-05-22 (Cleanup manager R2): the old
 * onComplete / onSkip callbacks that patched `wizard_completed_at` /
 * `wizard_skipped_at` from inside the cleanup grid Finish handler are
 * gone. The new `tour-goodbye` terminal step + auto-cleanup overlay
 * owns the sidecar finalize patch (writes `wizard_completed_at` +
 * clears `wizard_resume_state`) so V4MountForUser no longer needs to
 * thread completion callbacks. The mount tree gains a
 * `<TourGoodbyeOverlay>` sibling that catches the `tour-goodbye:
 * play-outro` window event from the step body.
 */
interface V4MountForUserProps {
  username: string;
  children: ReactNode;
}

export default function V4MountForUser({
  username,
  children,
}: V4MountForUserProps) {
  const [sidecar, setSidecar] = useState<OnboardingSidecar | null>(null);

  // One-shot load on mount + username change. Failures fall through to
  // a null sidecar; the TourController degrades to a no-persist mode in
  // that branch (ModalSetupShell still renders, just doesn't write).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await readOnboarding(username);
        if (!cancelled) setSidecar(current);
      } catch (err) {
        console.error("[onboarding-v4] sidecar load failed", err);
        if (!cancelled) setSidecar(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Stable patch hook that keeps the local sidecar snapshot in sync
  // with disk. The setup step bodies await this so the Next button
  // gating tracks the persisted state correctly.
  const patchSidecar = useCallback(
    async (patch: (cur: OnboardingSidecar) => OnboardingSidecar) => {
      const next = await patchOnboarding(username, patch);
      setSidecar(next);
    },
    [username],
  );

  return (
    <TourControllerProvider
      sidecar={sidecar}
      patchSidecar={patchSidecar}
      username={username}
      initialFeaturePicks={sidecar?.feature_picks ?? null}
    >
      <TourBootstrap username={username} />
      {children}
      {/* Lab Mode redesign 2026-05-22 — Phase 2c demo viewer host.
          Window-event-driven; renders nothing until the
          `lab-mode-warp-to-demo` step dispatches the open event. */}
      <DemoLabModeMount />
      {/* Cleanup retirement 2026-05-22 (Cleanup manager R2) — terminal
          step goodbye animation + auto-cleanup host. Window-event-driven;
          renders nothing until the `tour-goodbye` step body dispatches
          `tour-goodbye:play-outro`. Sits as a sibling of the
          TourControllerProvider's overlay tree so it survives the
          tour state going null on advance. */}
      <TourGoodbyeOverlay username={username} />
    </TourControllerProvider>
  );
}

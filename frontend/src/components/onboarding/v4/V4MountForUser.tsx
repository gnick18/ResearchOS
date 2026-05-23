"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  onSidecarWriteError,
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
  type SidecarWriteErrorEvent,
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
  // Wave 1 sidecar hardening manager (v2) 2026-05-22: persist-failure
  // surface. The sidecar bus dispatches on any writeOnboarding /
  // patchOnboarding rejection scoped to the active user. We render an
  // inline amber alert with a Retry affordance so the user can recover
  // without ending the tour blindly. `lastError` carries the most
  // recent dispatch; the `retryRef` holds the failed operation so the
  // Retry button can re-fire it.
  const [persistError, setPersistError] =
    useState<SidecarWriteErrorEvent | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  // Track in-flight patches so a Retry click re-runs the same patch
  // (not just a stale snapshot). Wrapped in a ref because the most
  // recent patch closure is what we want to re-fire; capturing it in
  // state would force a re-render every patchSidecar call.
  const lastPatchRef = useRef<
    ((cur: OnboardingSidecar) => OnboardingSidecar) | null
  >(null);

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

  // Subscribe to the sidecar's persist-error bus. The dispatch happens
  // from inside the rethrow path of writeOnboarding / patchOnboarding,
  // so the rejection still propagates to the caller (TourController
  // logs + moves on). The subscriber below is the ONLY UI-facing
  // notice that disk state is wedged — without it the tour silently
  // diverges from disk and a refresh teleports the user backwards.
  // Scope to the active username so a multi-user tab swap doesn't
  // light up the toast for someone else's wedge.
  useEffect(() => {
    const unsubscribe = onSidecarWriteError((event) => {
      if (event.username !== username) return;
      setPersistError(event);
    });
    return unsubscribe;
  }, [username]);

  // Stable patch hook that keeps the local sidecar snapshot in sync
  // with disk. The setup step bodies await this so the Next button
  // gating tracks the persisted state correctly. Wave 1 v2: stashes
  // the latest patch in a ref so the persist-error toast's Retry
  // button can re-fire the exact patch that failed.
  const patchSidecar = useCallback(
    async (patch: (cur: OnboardingSidecar) => OnboardingSidecar) => {
      lastPatchRef.current = patch;
      const next = await patchOnboarding(username, patch);
      setSidecar(next);
    },
    [username],
  );

  // Retry handler: re-fire the most recent failed patch (if any).
  // Clears the error state on success; re-arms it on a second failure
  // via the same bus subscription above. Falls back to a no-op when no
  // patch is tracked (e.g. a writeOnboarding-only failure).
  retryRef.current = useCallback(async () => {
    const patch = lastPatchRef.current;
    if (!patch) {
      setPersistError(null);
      return;
    }
    try {
      await patchSidecar(patch);
      setPersistError(null);
    } catch {
      // The bus subscription above re-arms persistError on a second
      // failure; nothing to do here.
    }
  }, [patchSidecar]);

  return (
    <TourControllerProvider
      sidecar={sidecar}
      patchSidecar={patchSidecar}
      username={username}
      initialFeaturePicks={sidecar?.feature_picks ?? null}
    >
      <TourBootstrap username={username} />
      {children}
      {persistError && (
        <div
          role="alert"
          data-testid="onboarding-persist-error"
          className="fixed bottom-4 right-4 z-[1000] max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg"
        >
          <p className="font-medium">Tour can&apos;t save your progress.</p>
          <p className="mt-1 text-xs">
            Check that your folder allows writes, or click Exit Tour to
            end early.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void retryRef.current?.();
              }}
              data-testid="onboarding-persist-error-retry"
              className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setPersistError(null)}
              data-testid="onboarding-persist-error-dismiss"
              className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
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

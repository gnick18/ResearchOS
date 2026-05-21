"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import type { CleanupSummary } from "./steps/cleanup/cleanup-execution";
import TourBootstrap from "./TourBootstrap";
import { TourControllerProvider } from "./TourController";

/**
 * Onboarding v4 P11 mount wrapper. Holds the active user's sidecar in
 * state, threads it through `<TourControllerProvider>` (which the
 * ModalSetupShell + Phase4CleanupStep read for `feature_picks` +
 * `artifacts_created`), and exposes the canonical `patchSidecar`
 * callback the setup step bodies use to persist Q1-Q6 answers.
 *
 * Lifts the sidecar load + patch wiring out of `lib/providers.tsx` so
 * the providers file stays focused on the high-level mount tree and
 * the v4-specific I/O stays adjacent to v4's other source files.
 *
 * onComplete + onSkip both patch the sidecar with the appropriate
 * completion timestamp + clear `wizard_resume_state` so a subsequent
 * page open does not re-fire the tour. The TourController's exit-tour
 * path lands on `phase4-cleanup` and Finish there dispatches onSkip
 * (when `enteredCleanupViaSkip` is set) or onComplete; both end the
 * same way as far as the sidecar is concerned (one of the two
 * timestamps is set; resume state cleared; force_show cleared).
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

  const onComplete = useCallback(
    async (_summary: CleanupSummary) => {
      // Normal completion path. Wizard ran end-to-end; mark completed,
      // clear resume state + force-show flag.
      await patchSidecar((cur) => ({
        ...cur,
        wizard_completed_at: new Date().toISOString(),
        wizard_skipped_at: null,
        wizard_force_show: false,
        wizard_resume_state: null,
      }));
    },
    [patchSidecar],
  );

  const onSkip = useCallback(
    async (_summary: CleanupSummary) => {
      // "I've got it from here" path. Wizard reached cleanup grid via
      // the exit-tour shortcut; mark skipped instead of completed.
      await patchSidecar((cur) => ({
        ...cur,
        wizard_skipped_at: new Date().toISOString(),
        wizard_completed_at: null,
        wizard_force_show: false,
        wizard_resume_state: null,
      }));
    },
    [patchSidecar],
  );

  return (
    <TourControllerProvider
      sidecar={sidecar}
      patchSidecar={patchSidecar}
      username={username}
      initialFeaturePicks={sidecar?.feature_picks ?? null}
      onComplete={onComplete}
      onSkip={onSkip}
    >
      <TourBootstrap username={username} />
      {children}
    </TourControllerProvider>
  );
}

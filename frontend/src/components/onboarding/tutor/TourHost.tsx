"use client";

// Onboarding tutor — the app-shell mount host.
//
// This is the persistent overlay that mounts the guided first-run ABOVE the
// route outlet (rendered from providers.tsx), so Beaker can drive the real
// router during the deep demos without unmounting himself. It gates on a fresh
// account + the flag (tour-gate), renders the tutor once, and records completion
// so it does not replay.
//
// INTEGRATION STATE (feat/onboarding-tour-mount worktree): this host + the gate
// are the foundation. The remaining live-mount work is marked with TODO(live)
// and tracked in docs/handoffs/2026-06-15-onboarding-tour-mount-build-plan.md:
//   - enter/exit tour-scoped DEMO MODE with field-personalized fixtures
//   - persist onRememberFact to the per-user account-vault memory
//   - the deep/AI beats render transparent over the real page (soft-ring spotlight)
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useState } from "react";
import OnboardingTutor from "./OnboardingTutor";
import {
  shouldRunOnboardingTutor,
  markOnboardingTutorDone,
} from "@/lib/onboarding/tour-gate";

export interface TourHostProps {
  /** True when the user just created an account (no folder yet). The caller in
   *  providers.tsx derives this from session state. */
  freshAccount: boolean;
}

export default function TourHost({ freshAccount }: TourHostProps) {
  const [active, setActive] = useState(() =>
    shouldRunOnboardingTutor({ freshAccount }),
  );

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    setActive(false);
    // TODO(live): exit the tour-scoped demo-data mode here so the user lands in
    // their own clean empty workspace.
  }, []);

  const handleRememberFact = useCallback(() => {
    // TODO(live): persist the proposed fact to the per-user account-vault memory
    // (user-memory.ts model + the real vault write). Captured here so the wiring
    // has one place to land.
  }, []);

  if (!active) return null;

  return (
    <OnboardingTutor
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
    />
  );
}

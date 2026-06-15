"use client";

// Onboarding tutor — the app-shell mount host.
//
// The persistent overlay that mounts the guided first-run ABOVE the route outlet
// (rendered from providers.tsx as a peer of CelebrationManager etc.), so Beaker
// can drive the real router during the deep demos without unmounting himself. It
// gates on a brand-new account (isFreshUserForWizard, the same no-footprint
// predicate the setup wizard uses, so EXISTING users are never onboarded) + the
// flag + a once-per-device marker, renders the tutor once, and records completion.
//
// INTEGRATION STATE (feat/onboarding-tour-mount): this mount + gate are the
// foundation. TODO(live) items (tour-scoped demo mode, real-page transparent
// overlay + soft-ring spotlight, vault memory persistence) are tracked in
// docs/handoffs/2026-06-15-onboarding-tour-mount-build-plan.md. With the flag
// OFF this whole host is inert (shouldRunOnboardingTutor returns false).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import OnboardingTutor from "./OnboardingTutor";
import {
  shouldRunOnboardingTutor,
  markOnboardingTutorDone,
} from "@/lib/onboarding/tour-gate";
import { isFreshUserForWizard } from "@/lib/onboarding/is-fresh-user";

export interface TourHostProps {
  /** The connected user, from providers. Null while none is connected. */
  username: string | null;
}

export default function TourHost({ username }: TourHostProps) {
  // Resolve the brand-new-account signal (async, reads the user's footprint).
  const [fresh, setFresh] = useState<boolean | null>(null);
  useEffect(() => {
    if (!username) {
      setFresh(false);
      return;
    }
    let cancelled = false;
    void isFreshUserForWizard(username).then((f) => {
      if (!cancelled) setFresh(f);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Decide whether to run once the signal resolves. The gate also checks the
  // flag, so this is false in prod until ONBOARDING_TUTOR_ENABLED is on.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (fresh === null) return;
    setActive(shouldRunOnboardingTutor({ freshAccount: fresh }));
  }, [fresh]);

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    setActive(false);
    // TODO(live): exit the tour-scoped demo-data mode so the user lands in their
    // own clean empty workspace.
  }, []);

  const handleRememberFact = useCallback(() => {
    // TODO(live): persist the proposed fact to the per-user account-vault memory.
  }, []);

  if (!active) return null;

  return (
    <OnboardingTutor
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
    />
  );
}

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
import {
  readTourResume,
  clearTourResume,
  type TourResumeState,
} from "@/lib/onboarding/tour-demo-session";

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

  // A resume marker from a pre-reload run (the demo-entry reload, build plan §2).
  // When present the tour was mid-run and re-entered demo mode, so it resumes at
  // the live-demo beat instead of replaying welcome/picker. Also the path a
  // mid-tour refresh takes. Read once on mount (synchronous, sessionStorage).
  const [resume] = useState<TourResumeState | null>(() => readTourResume());

  // Decide whether to run once the signal resolves. The gate also checks the
  // flag, so this is false in prod until ONBOARDING_TUTOR_ENABLED is on. A live
  // resume marker forces it active regardless of the fresh-account read, so a
  // post-reload (or refreshed) tour always picks back up rather than evaluating
  // freshness against the now-demo footprint.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (resume) {
      setActive(true);
      return;
    }
    if (fresh === null) return;
    setActive(shouldRunOnboardingTutor({ freshAccount: fresh }));
  }, [fresh, resume]);

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    // Drop the resume marker so a later fresh run never picks up this tour.
    clearTourResume();
    setActive(false);
    // TODO(live): exit tour-scoped demo mode (clearDemoMode +
    // restorePreDemoStateOrClear) so the user lands in their own clean empty
    // workspace. Browser-coupled (it reloads out of demo); verify in checkpoint D.
  }, []);

  const handleRememberFact = useCallback(() => {
    // TODO(live): persist the proposed fact to the per-user account-vault memory.
  }, []);

  if (!active) return null;

  // TODO(live): when `resume` is set, hand its beatIndex + picks + fixtureFlavor
  // to OnboardingTutor as an initial machine state so it re-enters at the
  // live-demo beat (skipping welcome/picker). That machine-resume prop + the
  // begin-show reload that writes the marker are the browser-coupled half of
  // increment 2 (verify in checkpoint A). The marker plumbing + gate are wired.
  return (
    <OnboardingTutor
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
    />
  );
}

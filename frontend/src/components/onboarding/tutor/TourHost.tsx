"use client";

// Onboarding tutor — the app-shell mount host.
//
// The persistent overlay that mounts the guided first-run ABOVE the route outlet
// (rendered from providers.tsx as a peer of CelebrationManager etc.). It gates on
// a brand-new account (isFreshUserForWizard, the same no-footprint predicate the
// setup wizard uses, so EXISTING users are never onboarded) + the flag + a
// once-per-device marker, renders the tutor once, and records completion.
//
// NO-WARP REDESIGN (2026-06-19): the tutor plays entirely as centered overlays in
// place over the page the user is on (OnboardingTutor renders ShowcaseStage, the
// self-contained presenter stage). It NEVER enters /demo and never touches the
// real folder, so a resumed run rebuilds its state from the durable progress and
// keeps playing inline. The earlier build hard-reloaded into /demo to give the
// deep demos fixture data; that warp is gone. The one piece of demo machinery
// kept here is a one-way EXIT safety net in handleComplete: a user who is still
// stuck in a lingering demo session (e.g. the pre-redesign trap, where a persisted
// `playing` progress used to re-enter demo on every boot) is rescued the moment
// they skip or finish, by restoring their real folder and leaving demo.
//
// With the flag OFF this whole host is inert (shouldRunOnboardingTutor false).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import OnboardingTutor from "./OnboardingTutor";
import {
  shouldRunOnboardingTutor,
  markOnboardingTutorDone,
  isForceLiveTourArmed,
} from "@/lib/onboarding/tour-gate";
import { isFreshUserForWizard } from "@/lib/onboarding/is-fresh-user";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import {
  clearTourResume,
  endTourDemoSession,
} from "@/lib/onboarding/tour-demo-session";
import {
  readTourProgress,
  saveTourProgress,
  clearTourProgress,
  progressFromState,
  stateFromProgress,
  type TourProgress,
} from "@/lib/onboarding/tour-progress";
import type { TutorState } from "@/lib/onboarding/tutor-machine";
import type { Role } from "@/lib/onboarding/reel-director";
import { clearDemoMode, getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import { consumePreDemoRoute } from "@/lib/file-system/pre-demo-route";

/** Dev only. The dev "Start tour" button arms a force-live flag so the tour can be
 *  mounted over the real app without a pristine fresh folder; this is read only in
 *  development, so prod can never be forced on by a stray flag. */
const IS_DEV = process.env.NODE_ENV === "development";

export interface TourHostProps {
  /** The connected user, from providers. Null while none is connected. */
  username: string | null;
}

export default function TourHost({ username }: TourHostProps) {
  // The intertwined flow: the account the user just set up in the wizard feeds the
  // tour. The name greets them ("Nice to meet you, {name}") and lab-head status
  // pre-selects the interest picker so a PI sees the lab-head tour without
  // re-answering (still changeable). useIsLabHead returns undefined while loading,
  // so a not-yet-resolved account just leaves the picker unseeded.
  const isLabHead = useIsLabHead(username);
  const seedRole: Role | undefined = isLabHead === true ? "pi" : undefined;

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

  // The durable, full-state progress (localStorage), read once on mount. This is
  // the single source of truth for "reopen exactly where the user was": it holds
  // the phase + picks + beat and survives any refresh, folder reconnect, or tab
  // close-and-reopen-later. Present (and never cleared until done/skip) means the
  // run is in flight, so the walkthrough reopens regardless of the freshness
  // re-check (which can flip false on reconnect) instead of dropping the user home.
  const [progress] = useState<TourProgress | null>(() => readTourProgress());

  // Dev-only forced run (read once on mount). When armed it mounts the tour over
  // the real app regardless of the fresh-account gate, so a developer can watch the
  // run without a pristine empty folder.
  const [forceLive] = useState(() => IS_DEV && isForceLiveTourArmed());

  // Decide whether to run. A persisted progress always resumes; a dev forced run
  // mounts regardless of freshness; otherwise the gate (flag + fresh account +
  // not-done) makes the first-time decision. The gate is false in prod until
  // ONBOARDING_TUTOR_ENABLED is on.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (progress) {
      setActive(true);
      return;
    }
    if (forceLive) {
      setActive(true);
      return;
    }
    if (fresh === null) return;
    setActive(shouldRunOnboardingTutor({ freshAccount: fresh }));
  }, [fresh, progress, forceLive]);

  // Persist the full machine state on every change (OnboardingTutor calls this on
  // mount and every transition); clear it the moment the run goes terminal so a
  // later reload does not reopen a finished tour.
  const handleProgress = useCallback((state: TutorState) => {
    const p = progressFromState(state);
    if (p) saveTourProgress(p);
    else clearTourProgress();
  }, []);

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    // The run is over (finished or skipped): drop the durable progress so it never
    // reopens. This is the ONLY thing that ends the walkthrough.
    clearTourProgress();
    if (getDemoMode()) {
      // Safety net for a user still stuck in a lingering demo session (the
      // pre-redesign trap: a persisted `playing` progress used to re-enter demo on
      // every boot). The no-warp tutor never enters demo itself, so this branch
      // only fires for that legacy state: restore the real folder, clear the demo
      // sticky + resume marker, then HARD-reload back to where they were, so the
      // user lands on their own clean workspace (the real exit path, same as
      // DevDemoToggleButton / LeaveDemoModal). endTourDemoSession navigates, so
      // nothing after it runs.
      void endTourDemoSession({
        restore: restorePreDemoStateOrClear,
        clearDemoMode,
        clearMarker: clearTourResume,
        consumeRoute: consumePreDemoRoute,
        replace: (url) => window.location.replace(url),
      });
      return;
    }
    // Normal path (no demo involved): drop the resume marker and deactivate.
    clearTourResume();
    setActive(false);
  }, []);

  const handleRememberFact = useCallback(() => {
    // TODO(live): persist the proposed fact to the per-user account-vault memory.
  }, []);

  if (!active) return null;

  // Rebuild the EXACT machine state from the durable progress, so the run reopens
  // where the user left it: welcome and picker keep their picks, a playing beat
  // rebuilds the same reel and resumes at that beat (stateFromProgress). Absent
  // for a brand-new run, which starts at welcome.
  const initialState = progress ? stateFromProgress(progress) : undefined;

  return (
    <OnboardingTutor
      onProgress={handleProgress}
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
      initialState={initialState}
      displayName={username}
      seedRole={seedRole}
    />
  );
}

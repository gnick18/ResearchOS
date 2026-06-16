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
  saveTourResume,
  beginTourDemoSession,
  endTourDemoSession,
  type TourResumeState,
} from "@/lib/onboarding/tour-demo-session";
import { resumeTutorState } from "@/lib/onboarding/tutor-machine";
import type { Role, GoalKey } from "@/lib/onboarding/reel-director";
import { clearDemoMode, getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import {
  storePreDemoRoute,
  consumePreDemoRoute,
} from "@/lib/file-system/pre-demo-route";

/** The marker the picker hands to onBeginShow (machine-level: role + goals +
 *  resume beat). TourHost adds the demo fixtureFlavor before persisting it. */
type TourMarker = { role: Role; goals: GoalKey[]; beatIndex: number };

/** Which demo fixture set the tour seeds. The /demo route currently installs one
 *  fixture set (the demo lab), so this is constant; when field-personalized
 *  fixtures land it can be derived from role + goals. */
const DEMO_FIXTURE_FLAVOR = "default";

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

  // The "Setting the stage" handoff: the picker's start hands us the marker, we
  // paint an opaque cover, then (next frame, so the cover is visible) persist the
  // marker + HARD-reload into /demo. Keeping the nav in an effect off the rendered
  // cover guarantees the reload flash is hidden.
  const [staging, setStaging] = useState<TourResumeState | null>(null);
  useEffect(() => {
    if (!staging) return;
    const id = window.setTimeout(() => {
      beginTourDemoSession(staging, {
        saveMarker: saveTourResume,
        storePreDemoRoute,
        currentRoute: () => window.location.pathname + window.location.search,
        navigate: (url) => window.location.assign(url),
      });
    }, 60);
    return () => window.clearTimeout(id);
  }, [staging]);

  const handleBeginShow = useCallback((marker: TourMarker) => {
    setStaging({ ...marker, fixtureFlavor: DEMO_FIXTURE_FLAVOR });
  }, []);

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    if (getDemoMode()) {
      // We are in tour-scoped demo mode: restore the real folder, clear the demo
      // sticky + resume marker, then HARD-reload back to where the tour started,
      // so the user lands on their own clean workspace (the real exit path, same
      // as DevDemoToggleButton / LeaveDemoModal). endTourDemoSession navigates,
      // so nothing after it runs.
      void endTourDemoSession({
        restore: restorePreDemoStateOrClear,
        clearDemoMode,
        clearMarker: clearTourResume,
        consumeRoute: consumePreDemoRoute,
        replace: (url) => window.location.replace(url),
      });
      return;
    }
    // Never entered demo (skipped at welcome/picker before the reload): just drop
    // the marker and deactivate, no reload.
    clearTourResume();
    setActive(false);
  }, []);

  const handleRememberFact = useCallback(() => {
    // TODO(live): persist the proposed fact to the per-user account-vault memory.
  }, []);

  if (!active) return null;

  // The opaque "Setting the stage" cover, shown for the one frame between the
  // picker start and the hard reload into demo mode, so the reload flash never
  // shows. The reload happens from the effect above.
  if (staging) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[var(--surface,#fff)] text-[var(--muted,#6b716a)]">
        <span className="text-sm font-semibold">Setting the stage...</span>
      </div>
    );
  }

  // When a resume marker is present (post-reload or refresh, build plan §2),
  // rebuild the playing machine state from it so the reel re-enters at the
  // live-demo beat, skipping welcome/picker. The marker's role/goals are stored
  // as strings (decoupled storage); cast to the reel-director unions here (they
  // were written from valid machine state). TODO(live): the begin-show reload
  // that WRITES this marker + the demo enter/exit are the browser-coupled half
  // of increment 2 (verify in checkpoint A).
  const initialState = resume
    ? resumeTutorState({
        role: resume.role as Role,
        goals: resume.goals as GoalKey[],
        beatIndex: resume.beatIndex,
      })
    : undefined;

  return (
    <OnboardingTutor
      live
      onBeginShow={handleBeginShow}
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
      initialState={initialState}
    />
  );
}

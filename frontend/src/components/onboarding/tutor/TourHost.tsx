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
  clearTourResume,
  saveTourResume,
  beginTourDemoSession,
  endTourDemoSession,
  type TourResumeState,
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

  // The durable, full-state progress (localStorage), read once on mount. This is
  // the single source of truth for "reopen exactly where the user was": it holds
  // the phase + picks + beat and survives any refresh, folder reconnect, or tab
  // close-and-reopen-later. Present (and never cleared until done/skip) means the
  // run is in flight, so the walkthrough reopens regardless of the freshness
  // re-check (which can flip false on reconnect) instead of dropping the user home.
  const [progress] = useState<TourProgress | null>(() => readTourProgress());

  // Decide whether to run. A persisted progress always resumes; otherwise the
  // gate (flag + fresh account + not-done) makes the first-time decision. The gate
  // is false in prod until ONBOARDING_TUTOR_ENABLED is on.
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (progress) {
      setActive(true);
      return;
    }
    if (fresh === null) return;
    setActive(shouldRunOnboardingTutor({ freshAccount: fresh }));
  }, [fresh, progress]);

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
    // Persist the durable progress as PLAYING at the first deep-demo beat BEFORE
    // the reload, so the post-reload mount resumes straight into the deep demos
    // (the sessionStorage demo marker only survives the same-session reload; the
    // durable progress is what carries the resume across everything).
    saveTourProgress({
      phase: "playing",
      role: marker.role,
      goals: marker.goals,
      beatIndex: marker.beatIndex,
    });
    setStaging({ ...marker, fixtureFlavor: DEMO_FIXTURE_FLAVOR });
  }, []);

  // Persist the full machine state on every change (OnboardingTutor calls this on
  // mount and every transition); clear it the moment the run goes terminal so a
  // later reload does not reopen a finished tour.
  const handleProgress = useCallback((state: TutorState) => {
    const p = progressFromState(state);
    if (p) saveTourProgress(p);
    else clearTourProgress();
  }, []);

  // Cross-session resume of a deep-demo beat: demo mode is sessionStorage-backed,
  // so closing the tab drops it. If a persisted PLAYING run reopens while NOT in
  // demo, re-enter demo (same staging + reload) so the deep demos have their
  // fixture data again. A same-session reload that is still in demo skips this and
  // resumes directly. A playing record with no role cannot rebuild a reel, so it
  // falls back to the picker (handled by stateFromProgress) and is not re-entered.
  useEffect(() => {
    if (progress?.phase === "playing" && progress.role && !getDemoMode()) {
      setStaging({
        role: progress.role,
        goals: progress.goals,
        beatIndex: progress.beatIndex,
        fixtureFlavor: DEMO_FIXTURE_FLAVOR,
      });
    }
    // Run once on mount against the initial progress read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = useCallback(() => {
    markOnboardingTutorDone();
    // The run is over (finished or skipped): drop the durable progress so it never
    // reopens. This is the ONLY thing that ends the walkthrough.
    clearTourProgress();
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

  // Rebuild the EXACT machine state from the durable progress, so the run reopens
  // where the user left it: welcome and picker keep their picks, a playing beat
  // rebuilds the same reel and resumes at that beat (stateFromProgress). Absent
  // for a brand-new run, which starts at welcome.
  const initialState = progress ? stateFromProgress(progress) : undefined;

  return (
    <OnboardingTutor
      live
      onBeginShow={handleBeginShow}
      onProgress={handleProgress}
      onComplete={handleComplete}
      onRememberFact={handleRememberFact}
      initialState={initialState}
    />
  );
}

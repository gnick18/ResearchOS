"use client";

// Onboarding tutor — the container that runs the step machine.
//
// Mounts only when NEXT_PUBLIC_ONBOARDING_TUTOR is on (flag-gated, dark in prod).
// Owns the tutorReducer and renders the current phase: welcome takeover, the
// interest picker, then the playing reel. The playing beats (deep demos, AI
// demo, montage, memory, recap) are PLACEHOLDERS in this phase of the build,
// Phase 3 replaces them with the real on-page showcase (presenter cursor +
// ephemeral seed). Back/Next/Skip always work (no soft-lock). onComplete fires
// when the run finishes or is skipped so the host can unmount + mark it done.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useReducer, useEffect, useState, type ReactNode } from "react";
import { ONBOARDING_TUTOR_ENABLED } from "@/lib/onboarding/config";
import {
  tutorReducer,
  initialTutorState,
  currentBeat,
  isFinished,
  tourResumeMarkerFor,
  type TutorState,
} from "@/lib/onboarding/tutor-machine";
import type { Role, GoalKey } from "@/lib/onboarding/reel-director";

// The lab-head role value, and the individual-researcher role we fall back to
// when the user picks lab head then chooses "I work solo" in the disclosure.
export const LAB_HEAD_ROLE: Role = "pi";
export const SOLO_ROLE: Role = "grad";

/** Whether picking this role should open the lab-head disclosure popup. Only the
 *  lab-head role triggers it, so a direct solo pick never shows the popup. */
export function shouldDiscloseLabHead(role: Role): boolean {
  return role === LAB_HEAD_ROLE;
}
import { summarize } from "@/lib/onboarding/tutor-summary";
import { newMeter, type OnboardingMeter } from "@/lib/onboarding/onboarding-meter";
import WelcomeTakeover from "./WelcomeTakeover";
import InterestPicker from "./InterestPicker";
import LabHeadDisclosure from "./LabHeadDisclosure";
import ShowcaseStage from "./ShowcaseStage";
import LiveCursorLayer from "./LiveCursorLayer";
import AiDemoBeat from "./AiDemoBeat";
import MontageBeat from "./MontageBeat";
import MemoryProposeBeat from "./MemoryProposeBeat";
import RecapBeat from "./RecapBeat";

export interface OnboardingTutorProps {
  /** Fires when the run reaches done or skipped. The host unmounts the tutor and
   *  records that onboarding has run so it does not fire again. */
  onComplete: () => void;
  /** Called when the user accepts the memory proposal. The host persists the
   *  fact to the per-user account memory (the real vault write, injected so this
   *  component stays storage-agnostic). Omit during preview. */
  onRememberFact?: (fact: string) => void;
  /** The capped onboarding token meter, for the visible spend indicator. The
   *  live layer accrues real usage into it. Defaults to a fresh full meter. */
  meter?: OnboardingMeter;
  /** Mount regardless of the feature flag. Dev preview only, never set in the
   *  real after-account mount (that path respects ONBOARDING_TUTOR_ENABLED). */
  forceEnabled?: boolean;
  /** LIVE coupled pass: when true the deep demos render the transparent
   *  LiveCursorLayer over the REAL surface (the real-page presenter cursor + soft
   *  ring), and the picker's start hands off to onBeginShow instead of building
   *  the reel inline. The real TourHost mount sets this; the dev preview leaves it
   *  false so it keeps using the self-contained ShowcaseStage stand-in (it mounts
   *  over a mock page with no real [data-tutor-target] controls to point at). */
  live?: boolean;
  /** LIVE only: called when the user starts the tour from the picker, with the
   *  resume marker (role + goals + first-playable beatIndex). The host persists it
   *  and HARD-reloads into tour-scoped demo mode, after which the tour resumes via
   *  initialState at the first deep demo. Omit (dev preview) to build the reel
   *  inline and play on the stand-in stage with no reload. */
  onBeginShow?: (marker: { role: Role; goals: GoalKey[]; beatIndex: number }) => void;
  /** Called on EVERY machine-state change (and once on mount) so the host can
   *  persist the full resumable state, and clear it when the run finishes. This
   *  is what lets the walkthrough reopen to exactly where the user was after any
   *  refresh / reconnect / close-and-reopen. Omit (dev preview) to not persist. */
  onProgress?: (state: TutorState) => void;
  /** Resume straight into a `playing` state (build plan §2): after the tour set
   *  the demo sticky and reloaded, TourHost rebuilds this from the persisted
   *  marker so the reel picks back up at the live-demo beat instead of replaying
   *  welcome/picker. Omit for a normal first run (starts at welcome). */
  initialState?: TutorState;
  /** The account name (from the setup wizard) so the welcome greets the user by
   *  name. The whole point of the intertwined flow. Omit for the generic greeting. */
  displayName?: string | null;
  /** The role inferred from the account the user just set up (lab-head -> "pi"),
   *  used to PRE-SELECT the interest picker so a lab head sees the lab-head tour
   *  without re-answering, while still being free to change it. Omit to leave the
   *  picker unseeded (the user picks from scratch). */
  seedRole?: Role;
}

export default function OnboardingTutor({
  onComplete,
  onRememberFact,
  meter,
  forceEnabled = false,
  live = false,
  onBeginShow,
  onProgress,
  initialState,
  displayName,
  seedRole,
}: OnboardingTutorProps) {
  const tokenMeter = meter ?? newMeter();
  // Seed the role from the account when there is no resume state to restore, so a
  // lab head lands on the picker with "PI" pre-selected (still changeable). A
  // resume (initialState) always wins so a mid-tour reload restores exactly.
  const [state, dispatch] = useReducer(
    tutorReducer,
    initialState ?? (seedRole ? { ...initialTutorState, role: seedRole } : initialTutorState),
  );
  // Whether the user accepted the memory proposal (drives the recap framing). In
  // a later phase this also triggers the actual per-user memory write.
  const [remembered, setRemembered] = useState(false);
  // Whether the lab-head disclosure popup is open. It opens when the user picks
  // the lab-head role in the picker, so they see what a lab account is before
  // committing. Confirm keeps the role and closes, "I work solo" flips to solo.
  const [showLabHeadDisclosure, setShowLabHeadDisclosure] = useState(false);

  const handleSetRole = (role: Role) => {
    dispatch({ type: "setRole", role });
    // Only the lab-head pick discloses. A direct solo pick just selects and
    // never opens the popup.
    setShowLabHeadDisclosure(shouldDiscloseLabHead(role));
  };

  useEffect(() => {
    if (isFinished(state)) onComplete();
  }, [state, onComplete]);

  // Persist the full resumable state on every change (and on mount), so the host
  // can durably remember exactly where the user is. The host decides storage and
  // clears it when the run finishes.
  useEffect(() => {
    onProgress?.(state);
  }, [state, onProgress]);

  if (!ONBOARDING_TUTOR_ENABLED && !forceEnabled) return null;
  if (isFinished(state)) return null;

  if (state.phase === "welcome") {
    return (
      <WelcomeTakeover
        onStart={() => dispatch({ type: "start" })}
        onSkip={() => dispatch({ type: "skip" })}
        tokensUsed={tokenMeter.used}
        tokenCap={tokenMeter.cap}
        displayName={displayName}
      />
    );
  }

  if (state.phase === "picking") {
    return (
      <>
        <InterestPicker
          role={state.role}
          goals={state.goals}
          onSetRole={handleSetRole}
          onToggleGoal={(goal) => dispatch({ type: "toggleGoal", goal })}
          onStart={() => {
            // LIVE: hand off to the host to enter demo mode + reload, so the deep
            // demos play over the real page. The host persists the resume marker
            // first, so the post-reload mount resumes at the first deep demo.
            // PREVIEW: build the reel inline and play on the stand-in stage.
            if (live && onBeginShow && state.role) {
              onBeginShow(tourResumeMarkerFor({ role: state.role, goals: state.goals }));
            } else {
              dispatch({ type: "beginReel" });
            }
          }}
          onSkip={() => dispatch({ type: "skip" })}
          onBack={() => dispatch({ type: "back" })}
        />
        {showLabHeadDisclosure ? (
          <LabHeadDisclosure
            onConfirm={() => setShowLabHeadDisclosure(false)}
            onSolo={() => {
              dispatch({ type: "setRole", role: SOLO_ROLE });
              setShowLabHeadDisclosure(false);
            }}
          />
        ) : null}
      </>
    );
  }

  // phase === "playing". Route each beat to its component. A tour-level "Skip for
  // now" stays available on every beat (no soft-lock). onDone/onFinish advance
  // the reel; the final beat advancing past the end flips the machine to done,
  // which fires onComplete via the effect above.
  const beat = currentBeat(state);
  const next = () => dispatch({ type: "next" });
  const summary = summarize(
    state.role,
    state.goals,
    state.reel?.deepSurfaces ?? [],
  );

  let body: ReactNode = null;
  if (beat?.kind === "deep_demo" && beat.surface) {
    // LIVE: the transparent real-page overlay (cursor + soft ring over the real
    // [data-tutor-target] control). PREVIEW: the self-contained stand-in stage.
    body = live ? (
      <LiveCursorLayer
        key={`${beat.surface}-${state.beatIndex}`}
        surface={beat.surface}
        onDone={next}
      />
    ) : (
      <ShowcaseStage
        key={`${beat.surface}-${state.beatIndex}`}
        surface={beat.surface}
        onDone={next}
      />
    );
  } else if (beat?.kind === "ai_demo" && beat.aiVariant) {
    body = <AiDemoBeat key={state.beatIndex} variant={beat.aiVariant} onDone={next} />;
  } else if (beat?.kind === "montage" && beat.surfaces) {
    body = <MontageBeat key={state.beatIndex} surfaces={beat.surfaces} onDone={next} />;
  } else if (beat?.kind === "memory_propose") {
    body = (
      <MemoryProposeBeat
        fact={summary.memoryFact}
        onRemember={() => {
          onRememberFact?.(summary.memoryFact);
          setRemembered(true);
          next();
        }}
        onDecline={next}
      />
    );
  } else if (beat?.kind === "recap") {
    body = (
      <RecapBeat recap={summary.recap} remembered={remembered} onFinish={next} />
    );
  }

  return (
    <div>
      <button
        onClick={() => dispatch({ type: "skip" })}
        className="fixed right-4 top-4 z-[70] text-xs text-[var(--muted,#6b716a)] hover:underline"
      >
        Skip for now
      </button>
      {body}
    </div>
  );
}

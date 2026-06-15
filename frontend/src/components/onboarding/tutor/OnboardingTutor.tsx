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
} from "@/lib/onboarding/tutor-machine";
import { summarize } from "@/lib/onboarding/tutor-summary";
import WelcomeTakeover from "./WelcomeTakeover";
import InterestPicker from "./InterestPicker";
import ShowcaseStage from "./ShowcaseStage";
import AiDemoBeat from "./AiDemoBeat";
import MontageBeat from "./MontageBeat";
import MemoryProposeBeat from "./MemoryProposeBeat";
import RecapBeat from "./RecapBeat";

export interface OnboardingTutorProps {
  /** Fires when the run reaches done or skipped. The host unmounts the tutor and
   *  records that onboarding has run so it does not fire again. */
  onComplete: () => void;
}

export default function OnboardingTutor({ onComplete }: OnboardingTutorProps) {
  const [state, dispatch] = useReducer(tutorReducer, initialTutorState);
  // Whether the user accepted the memory proposal (drives the recap framing). In
  // a later phase this also triggers the actual per-user memory write.
  const [remembered, setRemembered] = useState(false);

  useEffect(() => {
    if (isFinished(state)) onComplete();
  }, [state, onComplete]);

  if (!ONBOARDING_TUTOR_ENABLED) return null;
  if (isFinished(state)) return null;

  if (state.phase === "welcome") {
    return (
      <WelcomeTakeover
        onStart={() => dispatch({ type: "start" })}
        onSkip={() => dispatch({ type: "skip" })}
      />
    );
  }

  if (state.phase === "picking") {
    return (
      <InterestPicker
        role={state.role}
        goals={state.goals}
        onSetRole={(role) => dispatch({ type: "setRole", role })}
        onToggleGoal={(goal) => dispatch({ type: "toggleGoal", goal })}
        onStart={() => dispatch({ type: "beginReel" })}
      />
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
    body = (
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

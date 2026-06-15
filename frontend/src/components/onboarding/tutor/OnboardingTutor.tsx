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

import { useReducer, useEffect } from "react";
import { ONBOARDING_TUTOR_ENABLED } from "@/lib/onboarding/config";
import {
  tutorReducer,
  initialTutorState,
  currentBeat,
  isFinished,
} from "@/lib/onboarding/tutor-machine";
import WelcomeTakeover from "./WelcomeTakeover";
import InterestPicker from "./InterestPicker";

export interface OnboardingTutorProps {
  /** Fires when the run reaches done or skipped. The host unmounts the tutor and
   *  records that onboarding has run so it does not fire again. */
  onComplete: () => void;
}

export default function OnboardingTutor({ onComplete }: OnboardingTutorProps) {
  const [state, dispatch] = useReducer(tutorReducer, initialTutorState);

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

  // phase === "playing" — placeholder beat surface (Phase 3 replaces with the
  // real on-page showcase). Shows what the reel director chose so the flow is
  // walkable and testable end to end now.
  const beat = currentBeat(state);
  const total = state.reel?.beats.length ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--surface,#fff)] px-6 text-center">
      <button
        onClick={() => dispatch({ type: "skip" })}
        className="absolute right-4 top-4 text-xs text-[var(--muted,#6b716a)] hover:underline"
      >
        Skip for now
      </button>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint,#9aa097)]">
        Beat {state.beatIndex + 1} of {total}
      </div>
      <div className="mt-2 text-lg font-bold" data-testid="tutor-beat-kind">
        {beat?.kind}
        {beat?.surface ? ` · ${beat.surface}` : ""}
        {beat?.aiVariant ? ` · ${beat.aiVariant}` : ""}
      </div>
      <div className="mt-1 max-w-xs text-xs text-[var(--muted,#6b716a)]">
        Phase 3 renders the real on-page showcase here (Beaker's presenter cursor
        + the morph reveal). For now this confirms the director's running order.
      </div>
      {beat?.surfaces ? (
        <div className="mt-2 text-xs text-[var(--faint,#9aa097)]">
          montage: {beat.surfaces.join(", ")}
        </div>
      ) : null}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={() => dispatch({ type: "back" })}
          className="rounded-lg border border-[var(--line2,#d2d5cd)] px-4 py-2 text-xs font-semibold text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]"
        >
          Back
        </button>
        <button
          onClick={() => dispatch({ type: "next" })}
          className="rounded-lg bg-[var(--brand,#1d9e75)] px-4 py-2 text-xs font-bold text-white hover:brightness-105"
        >
          Next
        </button>
      </div>
    </div>
  );
}

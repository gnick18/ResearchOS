"use client";

// Onboarding tutor — the showcase stage (one DEEP demo).
//
// Runs a single surface choreography via the pure showcase player on a timer,
// and renders Beaker's presenter cursor, the coach bubble, and the reveal. In
// THIS phase of the build the stage is a self-contained placeholder (a labeled
// frame standing in for the real page), so the mechanic is walkable and the
// timing is real. The final phase swaps the placeholder for the live surface and
// resolves the cursor target to the real element via guide_to_element, but the
// player + cursor + bubble built here are exactly what drives it.
//
// Pause and skip-this-demo keep the user in control (no soft-lock). onDone fires
// when the demo finishes or is skipped. No emojis, no em-dashes, no mid-sentence
// colons.

import { useEffect, useReducer, useRef } from "react";
import {
  initPlayer,
  playerReducer,
  cursorTarget,
  isClicking,
  isRevealed,
  narration,
  currentStep,
} from "@/lib/onboarding/showcase-player";
import { choreographyFor } from "@/lib/onboarding/showcase-choreography";
import type { Surface } from "@/lib/onboarding/reel-director";
import PresenterCursor from "./PresenterCursor";
import CoachBubble from "./CoachBubble";
import TutorScreen from "./TutorScreen";

export interface ShowcaseStageProps {
  surface: Surface;
  onDone: () => void;
}

const TICK_MS = 80;
// Placeholder anchor for the cursor + target marker on the stand-in stage. The
// live phase replaces this with the real element rect.
const TARGET_POS = { x: 320, y: 150 };

export default function ShowcaseStage({ surface, onDone }: ShowcaseStageProps) {
  const choreography = choreographyFor(surface);
  const [state, dispatch] = useReducer(playerReducer, choreography, initPlayer);
  const doneRef = useRef(false);

  // Drive the player on a fixed-interval tick while playing.
  useEffect(() => {
    if (state.status !== "playing") return;
    const id = setInterval(() => dispatch({ type: "tick", deltaMs: TICK_MS }), TICK_MS);
    return () => clearInterval(id);
  }, [state.status]);

  // Fire onDone exactly once when the demo completes.
  useEffect(() => {
    if (state.status === "done" && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [state.status, onDone]);

  const target = cursorTarget(state);
  const cursorVisible = target !== null;
  const revealed = isRevealed(state);
  const step = currentStep(state);

  return (
    <TutorScreen contentClassName="flex-col">
      <div className="mb-2 flex w-full max-w-xl items-center justify-between text-[10.5px] uppercase tracking-wide text-[var(--faint,#9aa097)]">
        <span>on {choreography.route}</span>
        <span className="rounded border border-[var(--amber,#b9770f)] bg-[var(--amber-soft,#fbf0dc)] px-1.5 py-0.5 font-bold text-[var(--amber-ink,#8a5908)]">
          SAMPLE DATA · nothing saved
        </span>
      </div>

      {/* The stand-in stage. relative so the cursor + bubble position within it. */}
      <div className="relative h-72 w-full max-w-xl overflow-hidden rounded-xl border border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)]">
        {/* the seeded object + the reveal, as a simple before/after */}
        <div className="absolute left-5 top-5 text-xs font-semibold text-[var(--muted,#6b716a)]">
          {choreography.seedKind.replace(/_/g, " ")}
        </div>
        <div
          className="absolute left-5 top-12 h-16 w-28 rounded-lg border border-[var(--line2,#d2d5cd)] bg-[var(--surface,#fff)] transition-opacity"
          style={{ opacity: 1 }}
        />
        {/* reveal result */}
        <div
          className="absolute h-20 w-32 rounded-lg border border-[var(--brand,#1d9e75)] bg-[var(--surface,#fff)] shadow-md transition-all duration-700"
          style={{
            left: 260,
            top: 110,
            opacity: revealed ? 1 : 0,
            transform: revealed ? "scale(1)" : "scale(0.6)",
          }}
        />
        {/* target marker for the control the cursor heads to */}
        {cursorVisible ? (
          <div
            className="absolute rounded-md border-2 border-[var(--info,#2563eb)] px-2 py-1 text-[9px] font-semibold text-[var(--info-ink,#1b4fa8)]"
            style={{ left: TARGET_POS.x - 8, top: TARGET_POS.y - 26 }}
          >
            {target}
          </div>
        ) : null}

        <PresenterCursor
          x={cursorVisible ? TARGET_POS.x : null}
          y={cursorVisible ? TARGET_POS.y : null}
          clicking={isClicking(state)}
        />
        <CoachBubble line={narration(state)} />
      </div>

      {/* per-demo controls (the tour-level Back/Next/Skip live in the container) */}
      <div className="mt-3 flex w-full max-w-xl items-center justify-between">
        <span className="text-[10px] text-[var(--faint,#9aa097)]">{step?.kind}</span>
        <div className="flex gap-2">
          <button
            onClick={() =>
              dispatch({
                type: state.status === "paused" ? "resume" : "pause",
              })
            }
            className="rounded-md border border-[var(--line2,#d2d5cd)] px-3 py-1 text-xs text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]"
          >
            {state.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => dispatch({ type: "skip" })}
            className="rounded-md bg-[var(--brand,#1d9e75)] px-3 py-1 text-xs font-bold text-white hover:brightness-105"
          >
            Skip demo
          </button>
        </div>
      </div>
    </TutorScreen>
  );
}

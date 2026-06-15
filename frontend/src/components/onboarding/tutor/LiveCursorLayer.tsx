"use client";

// Onboarding tutor — the live cursor layer (increment 3 scaffold).
//
// The TRANSPARENT real-page analog of ShowcaseStage. For a deep_demo beat the
// tutor overlay goes see-through so the actual page shows, and this layer floats
// Beaker's presenter cursor + coach bubble + a SOFT RING (no dim, Grant pick B)
// over the real control. It runs the SAME pure showcase player as the stand-in
// stage, navigates to the surface route on the ARRIVE step, and resolves the
// cursor/ring to the live [data-tutor-target] element via tutor-target.ts (the
// controls tagged in increment 4). pointer-events-none so the page underneath
// stays usable.
//
// BROWSER-VERIFIED behavior (checkpoint B/C, not provable in jsdom): the ring +
// cursor land ON the real control, the ring tracks through layout/scroll, the
// router.push actually navigates, and the overlay survives that nav. The player
// timing, target resolution math (resolveTargetPoint/Rect), and route-on-arrive
// trigger are all from already-tested pure code; this component is the thin DOM
// shell over them. Not mounted yet (OnboardingTutor still renders ShowcaseStage)
// so it is inert until the coupled pass swaps it in.
//
// Icon-guard: PresenterCursor + CoachBubble own all glyphs; the ring is a plain
// div. No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  resolveTargetPoint,
  resolveTargetRect,
  type Point,
  type BoxLike,
} from "@/lib/onboarding/tutor-target";
import PresenterCursor from "./PresenterCursor";
import CoachBubble from "./CoachBubble";

export interface LiveCursorLayerProps {
  surface: Surface;
  /** Fires once when the choreography finishes or is skipped. */
  onDone: () => void;
}

/** How much the soft ring pads beyond the control's box, so it hugs without
 *  clipping. Tuned visually in the browser; a sensible default here. */
const RING_PAD = 8;

export default function LiveCursorLayer({ surface, onDone }: LiveCursorLayerProps) {
  const choreography = choreographyFor(surface);
  const [state, dispatch] = useReducer(playerReducer, choreography, initPlayer);
  const layerRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const arrivedRef = useRef(false);
  const router = useRouter();

  const [point, setPoint] = useState<Point | null>(null);
  const [box, setBox] = useState<BoxLike | null>(null);

  // Drive the player on real elapsed time (mirrors ShowcaseStage). rAF pauses in
  // a background tab; the delta is clamped so a resume cannot jump a whole step.
  useEffect(() => {
    if (state.status !== "playing") return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (last !== 0 && !document.hidden) {
        const delta = Math.min(now - last, 120);
        if (delta > 0) dispatch({ type: "tick", deltaMs: delta });
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state.status]);

  // Navigate to the surface route on the ARRIVE step, once. The page morphs in
  // underneath the transparent layer. Idempotent at the bridge level too.
  const stepKind = currentStep(state)?.kind ?? null;
  useEffect(() => {
    if (stepKind === "arrive" && !arrivedRef.current) {
      arrivedRef.current = true;
      router.push(choreography.route);
    }
  }, [stepKind, router, choreography.route]);

  // Resolve the live target to a point + box whenever the cursor target changes,
  // and keep it tracking the real control through scroll / resize. Resolved
  // against THIS layer (position fixed inset-0, so its rect is the viewport).
  const target = cursorTarget(state);
  useEffect(() => {
    if (!target) {
      setPoint(null);
      setBox(null);
      return;
    }
    const recompute = () => {
      const c = layerRef.current;
      setPoint(resolveTargetPoint(target, c));
      setBox(resolveTargetRect(target, c));
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [target]);

  // Fire onDone exactly once.
  useEffect(() => {
    if (state.status === "done" && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [state.status, onDone]);

  return (
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1200]"
    >
      {/* Soft ring around the live control (no dim). Hugs the control's box. */}
      {box ? (
        <div
          className="absolute rounded-xl border-2 border-[var(--brand,#1d9e75)] shadow-[0_0_0_4px_var(--brand-soft,rgba(29,158,117,0.25))] transition-all duration-300"
          style={{
            left: box.x - RING_PAD,
            top: box.y - RING_PAD,
            width: box.width + RING_PAD * 2,
            height: box.height + RING_PAD * 2,
          }}
        />
      ) : null}

      <PresenterCursor
        x={point ? point.x : null}
        y={point ? point.y : null}
        clicking={isClicking(state)}
      />
      <CoachBubble line={narration(state)} />

      {/* isRevealed drives nothing on the real page here (the page's own morph
          shows the result); kept referenced so the reveal step is observable to
          future tuning without an unused-import lint. */}
      <span hidden data-revealed={isRevealed(state) ? "1" : "0"} />
    </div>
  );
}

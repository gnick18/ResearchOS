"use client";

// frontend/src/components/BeakerBotBugStompScene.tsx
//
// Side easter-egg scene: BeakerBot notices a cartoon "software bug"
// insect crawling across the bottom of the viewport, rushes over, and
// stomps it. Plays through a fixed ~7.4s sequence, then calls
// `onComplete` so the parent can unmount.
//
// Built on the same skeleton as the ladder scene (multi-stage CSS
// keyframe animation, portaled into document.body, position:fixed,
// reduced-motion fallback). All animation runs via scoped @keyframes
// + animation-delay so the browser owns the timing — no rAF loops in
// React. The stages are documented in the keyframe blocks below.
//
// API
//   <BeakerBotBugStompScene
//     active
//     onComplete={() => setShowScene(false)}
//     beakerBotEntersFrom="right"  // default
//   />
//
// Z-index 800: below modals (1000+) but above ordinary app chrome.
// The whole overlay is `pointer-events: none` so the scene is purely
// decorative — the user can keep clicking the UI underneath.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";

export interface BeakerBotBugStompSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response — the component does not unmount
   *  itself. */
  onComplete: () => void;
  /** Side BeakerBot enters from. Bug enters from the OPPOSITE side
   *  so the two characters approach each other across the viewport.
   *  Default `"right"` (BeakerBot enters from the right, bug from
   *  the left). */
  beakerBotEntersFrom?: "left" | "right";
}

/** Total scene duration in milliseconds — sum of all stage timings.
 *  Kept as a single constant so the timer + keyframe `animation`
 *  shorthand stay in sync. If you tweak stage durations below, update
 *  this and the `animation-duration` values in the <style> block. */
const SCENE_DURATION_MS = 7400;
// Stage breakdown (cumulative):
//   1. Bug enters + crawls         :    0 → 1000   (1.0s)
//   2. BeakerBot enters + spots    : 1000 → 2500   (1.5s, includes "!" 400ms)
//   3. Rush                        : 2500 → 3300   (0.8s)
//   4. Stomp (impact + compress)   : 3300 → 3900   (0.6s)
//   5. Bug poof                    : 3300 → 3600   (0.3s, overlaps stomp)
//   6. Victory pose                : 3900 → 4900   (1.0s)
//   7. Exit (float away)           : 4900 → 6400   (1.5s)
//   + tail buffer for last frame   : 6400 → 7400   (1.0s settle)

/** Reduced-motion fallback duration — the scene just shows a static
 *  "stomp complete" tableau (BeakerBot + a defeated bug) for ~2s,
 *  then calls onComplete. No animation, no movement. */
const REDUCED_MOTION_DURATION_MS = 2000;

/** Tiny "software bug" SVG — oval body, two antennae, four legs.
 *  Pulled out as its own component so the test can assert it renders
 *  and so the keyframes can target `.bbs-bug` without coupling to
 *  BeakerBot's path data. Stroke uses currentColor so the parent can
 *  tint via `text-*` utility classes. */
function BugGlyph({
  className,
  defeated = false,
}: {
  className?: string;
  /** When true, render an X over the eyes (defeated state — used
   *  by the reduced-motion fallback so the static frame reads as
   *  "bug was stomped" not "bug is crawling"). */
  defeated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={defeated ? "Defeated bug" : "Cartoon bug"}
      className={className ?? "w-6 h-6 text-neutral-800"}
    >
      {/* Body — oval */}
      <ellipse cx="12" cy="14" rx="5" ry="4" fill="currentColor" stroke="none" />
      {/* Center-line down the back */}
      <path d="M12 10 L12 18" stroke="white" strokeWidth={0.8} />
      {/* Head dot */}
      <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
      {/* Antennae */}
      <path d="M11 8 L9 5" />
      <path d="M13 8 L15 5" />
      {/* Legs — three per side, alternating animation pairs handled
          via .bbs-bug-leg-{a,b} classes targeted in the keyframes. */}
      <g className="bbs-bug-leg-a">
        <path d="M7 13 L4 12" />
        <path d="M7 15 L4 16" />
        <path d="M17 14 L20 14" />
      </g>
      <g className="bbs-bug-leg-b">
        <path d="M7 14 L4 14" />
        <path d="M17 13 L20 12" />
        <path d="M17 15 L20 16" />
      </g>
      {defeated && (
        <>
          {/* X-eyes for the defeated state — drawn on top of the
              head dot so they read as "knocked out". */}
          <path d="M10.5 8 L13.5 10 M13.5 8 L10.5 10" stroke="white" strokeWidth={1} />
        </>
      )}
    </svg>
  );
}

export default function BeakerBotBugStompScene({
  active,
  onComplete,
  beakerBotEntersFrom = "right",
}: BeakerBotBugStompSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Capture the onComplete callback in a ref so the timer effect
  // doesn't re-fire (and reset the sequence) every time the parent
  // re-renders with a new inline-fn reference.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Portal-mount detection (SSR-safe): render nothing on the server,
  // flip to mounted on client mount so createPortal(document.body) is
  // safe to call. Same pattern as OnboardingTipCard.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call.
    setMounted(true);
  }, []);

  // Honor prefers-reduced-motion. Read once on mount; we don't
  // subscribe to changes mid-scene because the scene is short-lived
  // (~7s) and a mid-play flip would be more jarring than ignoring it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the user's reduced-motion preference; safe because the scene only runs for a few seconds and any mid-play change would be more jarring than ignoring it.
    setReducedMotion(mq.matches);
  }, []);

  // Timer: fires onComplete after the full scene duration (or the
  // reduced-motion shortcut). Keyed to `active` so toggling
  // false → true restarts the sequence cleanly.
  useEffect(() => {
    if (!active) return;
    const duration = reducedMotion ? REDUCED_MOTION_DURATION_MS : SCENE_DURATION_MS;
    const handle = window.setTimeout(() => {
      onCompleteRef.current();
    }, duration);
    return () => window.clearTimeout(handle);
  }, [active, reducedMotion]);

  // Direction memo — drives both the keyframe selection and the
  // BeakerBot `direction` prop (so his arm/face point toward the
  // bug, not into the void). Bug enters from the OPPOSITE side.
  const direction = useMemo(() => {
    const beakerFromLeft = beakerBotEntersFrom === "left";
    return {
      beakerStartX: beakerFromLeft ? "-20vw" : "120vw",
      beakerExitX: beakerFromLeft ? "-30vw" : "130vw",
      bugStartX: beakerFromLeft ? "120vw" : "-10vw",
      // Where the rush + stomp lands — slightly off-center toward
      // the bug's side so the two characters meet, not pass each
      // other.
      stompX: beakerFromLeft ? "70vw" : "30vw",
      // BeakerBot's facing direction during the entry/rush stages.
      // When he enters from the right, he faces LEFT (toward the
      // bug on the left). When entering from the left, he faces
      // RIGHT. The BeakerBot SVG's `direction` prop accepts
      // "left" / "right" — flips the whole SVG via scaleX(-1).
      beakerFacing: (beakerFromLeft ? "right" : "left") as "left" | "right",
    };
  }, [beakerBotEntersFrom]);

  if (!active || !mounted) return null;

  // Reduced-motion fallback: static tableau, no animation. Just shows
  // BeakerBot in a `cheering` pose next to a defeated bug, so the
  // user gets the gist of the easter egg without any motion. Calls
  // onComplete via the same timer effect above (REDUCED_MOTION_DURATION_MS).
  if (reducedMotion) {
    return createPortal(
      <div
        data-testid="beakerbot-bug-stomp-scene"
        data-reduced-motion="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 800,
        }}
        aria-hidden="true"
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "10vh",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
          }}
        >
          <BeakerBot
            pose="cheering"
            className="w-16 h-16 text-sky-500"
            ariaLabel="BeakerBot victorious"
          />
          <BugGlyph className="w-6 h-6 text-neutral-800" defeated />
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <>
      {/* Scoped keyframes for the full sequence. Each character has
          its own animation; stages are sequenced via `animation-delay`
          + animation-fill-mode: both (hold the final keyframe so the
          character doesn't snap back at the end of a sub-animation
          before the next one kicks in). */}
      <style>{`
        /* Bug crawl-in: slides from off-screen to ~center bottom over 1s. */
        @keyframes bbs-bug-crawl-in {
          0%   { transform: translate(var(--bbs-bug-start-x), 0); }
          100% { transform: translate(var(--bbs-bug-stomp-x), 0); }
        }
        /* Bug poof: 300ms fade + scale-down + slight upward drift,
           fires at the stomp moment. */
        @keyframes bbs-bug-poof {
          0%   { opacity: 1; transform: translate(var(--bbs-bug-stomp-x), 0) scale(1); }
          60%  { opacity: 0.7; transform: translate(var(--bbs-bug-stomp-x), -4px) scale(1.2); }
          100% { opacity: 0; transform: translate(var(--bbs-bug-stomp-x), -8px) scale(0.4); }
        }
        /* Subtle leg-wiggle — alternating pairs so the bug looks
           like it's actually walking, not just sliding. Two groups
           (.bbs-bug-leg-a and .bbs-bug-leg-b) offset 180deg out of
           phase via animation-direction. */
        @keyframes bbs-bug-legs {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-0.5px); }
        }
        .bbs-bug-leg-a {
          transform-origin: 12px 14px;
          animation: bbs-bug-legs 0.25s ease-in-out infinite;
        }
        .bbs-bug-leg-b {
          transform-origin: 12px 14px;
          animation: bbs-bug-legs 0.25s ease-in-out infinite;
          animation-direction: reverse;
        }

        /* BeakerBot entry: slides in from off-screen to mid-screen
           over 1.1s, then holds (the spot + ! happens via the next
           animation). The "stops abruptly" feel comes from ease-out. */
        @keyframes bbs-beaker-enter {
          0%   { transform: translate(var(--bbs-beaker-start-x), 0); }
          100% { transform: translate(var(--bbs-beaker-mid-x), 0); }
        }
        /* BeakerBot rush: zooms from mid-screen to stomp position
           with a slight vertical bob to suggest fast movement. */
        @keyframes bbs-beaker-rush {
          0%   { transform: translate(var(--bbs-beaker-mid-x), 0); }
          25%  { transform: translate(calc((var(--bbs-beaker-mid-x) + var(--bbs-beaker-stomp-x)) / 2), -6px); }
          50%  { transform: translate(calc((var(--bbs-beaker-mid-x) + var(--bbs-beaker-stomp-x)) / 2), 0); }
          75%  { transform: translate(calc((var(--bbs-beaker-mid-x) + 3 * var(--bbs-beaker-stomp-x)) / 4), -4px); }
          100% { transform: translate(var(--bbs-beaker-stomp-x), 0); }
        }
        /* Stomp impact: body compresses on landing then springs back. */
        @keyframes bbs-beaker-stomp {
          0%   { transform: translate(var(--bbs-beaker-stomp-x), 0) scaleY(1); }
          30%  { transform: translate(var(--bbs-beaker-stomp-x), 4px) scaleY(0.85); }
          70%  { transform: translate(var(--bbs-beaker-stomp-x), -2px) scaleY(1.05); }
          100% { transform: translate(var(--bbs-beaker-stomp-x), 0) scaleY(1); }
        }
        /* Victory pose: subtle body sway ("brushing hands off"). */
        @keyframes bbs-beaker-victory {
          0%, 100% { transform: translate(var(--bbs-beaker-stomp-x), 0) rotate(0deg); }
          25%      { transform: translate(var(--bbs-beaker-stomp-x), -2px) rotate(-3deg); }
          75%      { transform: translate(var(--bbs-beaker-stomp-x), -2px) rotate(3deg); }
        }
        /* Exit: floats up + out off the original exit side. */
        @keyframes bbs-beaker-exit {
          0%   { transform: translate(var(--bbs-beaker-stomp-x), 0); opacity: 1; }
          100% { transform: translate(var(--bbs-beaker-exit-x), -40vh); opacity: 0; }
        }

        /* Eye-widen pulse — brief scale-up applied at the "spot" moment. */
        @keyframes bbs-eye-widen {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.15); }
        }
        /* Exclamation mark: pops in above his head, holds 400ms, fades. */
        @keyframes bbs-exclaim {
          0%   { opacity: 0; transform: translate(-50%, 4px) scale(0.4); }
          20%  { opacity: 1; transform: translate(-50%, -8px) scale(1.15); }
          70%  { opacity: 1; transform: translate(-50%, -8px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -12px) scale(0.9); }
        }
        /* Dust cloud on impact — radiates outward + fades over 250ms. */
        @keyframes bbs-dust {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0.3); }
          30%  { opacity: 0.7; transform: translate(-50%, -4px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -10px) scale(1.6); }
        }
      `}</style>

      <div
        data-testid="beakerbot-bug-stomp-scene"
        data-reduced-motion="false"
        style={
          {
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 800,
            // CSS custom properties feed into the keyframes above so
            // the left/right entry direction (and the stomp landing
            // x-coord) are data, not duplicated keyframe blocks.
            "--bbs-bug-start-x": direction.bugStartX,
            "--bbs-bug-stomp-x": direction.stompX,
            "--bbs-beaker-start-x": direction.beakerStartX,
            "--bbs-beaker-mid-x": beakerBotEntersFrom === "left" ? "30vw" : "70vw",
            "--bbs-beaker-stomp-x": direction.stompX,
            "--bbs-beaker-exit-x": direction.beakerExitX,
          } as React.CSSProperties
        }
        aria-hidden="true"
      >
        {/* Ground line at 80vh — characters sit on this. Absolute
            positioning here is the anchor point; per-character
            translate() inside the keyframes handles x + bob. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "calc(80vh - 12px)",
            width: 0,
            height: 0,
          }}
        >
          {/* Bug — crawls in, then poofs at the stomp moment. Two
              animations chained via animation-delay; the second one
              has fill-mode: forwards so the bug stays gone. */}
          <div
            className="bbs-bug"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${direction.bugStartX}, 0)`,
              animation: [
                "bbs-bug-crawl-in 1000ms linear forwards",
                "bbs-bug-poof 300ms ease-out 3300ms forwards",
              ].join(", "),
              willChange: "transform, opacity",
            }}
          >
            <BugGlyph className="w-6 h-6 text-neutral-800 block" />
          </div>

          {/* BeakerBot — chained: enter → (hold) → rush → stomp →
              victory → exit. Each segment uses animation-fill-mode:
              both so the final transform of each segment is held
              while the next segment is in its delay window. */}
          <div
            className="bbs-beaker"
            style={{
              position: "absolute",
              left: 0,
              // BeakerBot is taller — float him so his "feet" line up
              // with the bug at the ground line.
              top: "-40px",
              transform: `translate(${direction.beakerStartX}, 0)`,
              animation: [
                "bbs-beaker-enter 1100ms ease-out 1000ms both",
                "bbs-beaker-rush 800ms ease-in 2500ms both",
                "bbs-beaker-stomp 600ms ease-out 3300ms both",
                "bbs-beaker-victory 1000ms ease-in-out 3900ms both",
                "bbs-beaker-exit 1500ms ease-in 4900ms both",
              ].join(", "),
              willChange: "transform, opacity",
            }}
          >
            <div style={{ position: "relative" }}>
              {/* Exclamation mark — pops in during the "spot" moment
                  (2100ms after scene start, ~1100ms after BeakerBot's
                  entry animation begins so it lands during the brief
                  pause before the rush). */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "-20px",
                  fontSize: 24,
                  fontWeight: 800,
                  color: "#dc2626", // red-600
                  transform: "translate(-50%, 4px) scale(0.4)",
                  opacity: 0,
                  animation: "bbs-exclaim 400ms ease-out 2100ms forwards",
                  fontFamily: "system-ui, sans-serif",
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                !
              </div>

              {/* Dust cloud — fires at impact (3500ms), small wisp
                  centered under his feet. Two staggered puffs for a
                  cheaper "cloud" feel than a single SVG. */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "62px",
                  width: 24,
                  height: 8,
                  borderRadius: "50%",
                  background: "rgba(120, 113, 108, 0.6)", // stone-500/60
                  transform: "translate(-50%, 0) scale(0.3)",
                  opacity: 0,
                  animation: "bbs-dust 250ms ease-out 3500ms forwards",
                  filter: "blur(2px)",
                }}
                aria-hidden="true"
              />
              <div
                style={{
                  position: "absolute",
                  left: "30%",
                  top: "64px",
                  width: 14,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(168, 162, 158, 0.5)", // stone-400/50
                  transform: "translate(-50%, 0) scale(0.3)",
                  opacity: 0,
                  animation: "bbs-dust 280ms ease-out 3550ms forwards",
                  filter: "blur(2px)",
                }}
                aria-hidden="true"
              />
              <div
                style={{
                  position: "absolute",
                  left: "70%",
                  top: "64px",
                  width: 14,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(168, 162, 158, 0.5)",
                  transform: "translate(-50%, 0) scale(0.3)",
                  opacity: 0,
                  animation: "bbs-dust 280ms ease-out 3580ms forwards",
                  filter: "blur(2px)",
                }}
                aria-hidden="true"
              />

              {/* BeakerBot pose: pointing-down toward the bug during
                  entry/rush/stomp (his "stomp" gesture), then a
                  brief swap to cheering during the victory pose.
                  We render BOTH stacked and toggle opacity via a
                  third keyframe so the swap doesn't trigger a React
                  re-render mid-animation (which would reset the
                  parent's chained animations). The cheering pose
                  fades in at 3900ms (victory stage start). */}
              <PoseStack facing={direction.beakerFacing} />
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * Two BeakerBot SVGs stacked, only one visible at a time. We toggle
 * via CSS opacity at fixed timestamps so the swap happens inside the
 * animation pipeline — toggling via React state would unmount/remount
 * the elements and reset every chained transform animation on the
 * parent.
 */
function PoseStack({ facing }: { facing: "left" | "right" }) {
  return (
    <>
      <style>{`
        /* Pointing-down pose: visible from 0 → 3900ms (entry through
           stomp), then fades out as victory begins. */
        @keyframes bbs-pose-pointing {
          0%, 53%   { opacity: 1; }
          55%, 100% { opacity: 0; }
        }
        /* Cheering pose: invisible until 3900ms (53% of 7400ms ≈ 3922ms),
           then visible through exit. */
        @keyframes bbs-pose-cheering {
          0%, 53%   { opacity: 0; }
          55%, 100% { opacity: 1; }
        }
        /* Eye-widen overlay: brief scale pulse on the eyes during
           the "spot" moment (2100ms). Implemented as an overlay
           BeakerBot rendered at slightly larger scale that fades
           in/out over a 250ms window. */
        @keyframes bbs-eyes {
          0%, 27%   { opacity: 0; transform: scale(1); }
          28%, 32%  { opacity: 0.5; transform: scale(1.08); }
          33%, 100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <BeakerBot
          pose={"pointing-down" as BeakerBotPose}
          direction={facing}
          className="w-16 h-16 text-sky-500"
          ariaLabel="BeakerBot spotting bug"
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 1,
            animation: "bbs-pose-pointing 7400ms linear forwards",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            animation: "bbs-pose-cheering 7400ms linear forwards",
          }}
        >
          <BeakerBot
            pose={"cheering" as BeakerBotPose}
            className="w-16 h-16 text-sky-500"
            ariaLabel="BeakerBot victorious"
          />
        </div>
        {/* Eye-widen overlay: a slightly enlarged BeakerBot pinned to
            the "spot" moment. Visible only briefly (~250ms) at
            2100ms into the scene, blended at 50% opacity for a
            "pop" effect that doesn't disrupt the base pose. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            transformOrigin: "center center",
            animation: "bbs-eyes 7400ms linear forwards",
            pointerEvents: "none",
          }}
        >
          <BeakerBot
            pose={"pointing-down" as BeakerBotPose}
            direction={facing}
            className="w-16 h-16 text-sky-500"
            ariaLabel=""
          />
        </div>
      </div>
    </>
  );
}

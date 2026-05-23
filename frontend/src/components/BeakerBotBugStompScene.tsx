"use client";

// frontend/src/components/BeakerBotBugStompScene.tsx
//
// Side easter-egg scene (R2 rewrite): a swarm of cartoon "software bugs"
// scatters across the viewport, then BeakerBot sneaks in with a fly
// swatter, stalks the nearest target with predatory body language, and
// WHACKS it — leaving a splat residue on the ground as proof. The splat
// stays on screen through the celebrate + walk-off stages, which is the
// satisfying punchline (v1's bug evaporated, this one leaves evidence).
//
// Built on the same skeleton as the other side scenes (Ladder, Eureka,
// TooManyBeakers): multi-stage CSS keyframe animation, portaled into
// document.body, position:fixed, pointer-events:none, z-index 800.
// All motion runs via scoped @keyframes + animation-delay so the
// browser owns the timing.
//
// Stage timeline (~6.3s total in motion mode):
//   1. bugsScatter   0      -> 1500ms  (4-6 bugs spawn from center, scatter)
//   2. spot          1500   -> 2000ms  (BeakerBot enters, panicked pose)
//   3. sneak         2000   -> 3800ms  (pointing-down + lean, tip-toe jerky)
//   4. whack         3800   -> 4100ms  (swatter arcs down, body squash)
//   5. splat         4100   -> 4700ms  (residue appears, holds remaining)
//   6. celebrate     4700   -> 5500ms  (cheering pose, swatter raised, "!")
//   7. exit          5500   -> 6300ms  (walks off, body bob, splat holds)
//
// Reduced-motion fallback: static tableau (BeakerBot mid-cheer with
// swatter raised, one splat residue, 2-3 frozen bugs scattered) for 2s,
// then onComplete.
//
// API
//   <BeakerBotBugStompScene
//     active
//     onComplete={() => setShowScene(false)}
//     beakerBotEntersFrom="right"  // default
//   />

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import {
  BEAKERBOT_SCENE_SIZE_CLASS,
  BEAKERBOT_SCENE_SIZE_PX,
  SCENE_GROUND_BOTTOM_CSS,
} from "./beakerbot/scene-constants";

export interface BeakerBotBugStompSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false to true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response — the component does not unmount
   *  itself. */
  onComplete: () => void;
  /** Side BeakerBot enters from. Default "right". The bug swarm
   *  spawns from a center point on the viewport, so this prop only
   *  affects BeakerBot's entry/exit edge — the bugs are always in
   *  the middle. */
  beakerBotEntersFrom?: "left" | "right";
}

/** Stage durations in ms. Exported so tests can re-derive the total. */
export const STAGE_DURATIONS = {
  bugsScatter: 1500,
  spot: 500,
  sneak: 1800,
  whack: 300,
  splat: 600,
  celebrate: 800,
  exit: 800,
} as const;

export const SCENE_DURATION_MS =
  STAGE_DURATIONS.bugsScatter +
  STAGE_DURATIONS.spot +
  STAGE_DURATIONS.sneak +
  STAGE_DURATIONS.whack +
  STAGE_DURATIONS.splat +
  STAGE_DURATIONS.celebrate +
  STAGE_DURATIONS.exit; // 6300ms

/** Cumulative stage start offsets (ms from scene start). */
const STAGE_OFFSETS = {
  bugsScatter: 0,
  spot: STAGE_DURATIONS.bugsScatter,
  sneak: STAGE_DURATIONS.bugsScatter + STAGE_DURATIONS.spot,
  whack:
    STAGE_DURATIONS.bugsScatter + STAGE_DURATIONS.spot + STAGE_DURATIONS.sneak,
  /** 200ms into the whack stage — when the swatter is at the bottom
   *  of its arc and the bug should poof. */
  whackImpact:
    STAGE_DURATIONS.bugsScatter +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    200,
  splat:
    STAGE_DURATIONS.bugsScatter +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack,
  celebrate:
    STAGE_DURATIONS.bugsScatter +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack +
    STAGE_DURATIONS.splat,
  exit:
    STAGE_DURATIONS.bugsScatter +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack +
    STAGE_DURATIONS.splat +
    STAGE_DURATIONS.celebrate,
} as const;

/** Reduced-motion fallback duration — static aftermath tableau for
 *  ~2s, then onComplete. */
const REDUCED_MOTION_DURATION_MS = 2000;

/** Number of bugs in the swarm. Deterministic so tests can assert. */
const BUG_COUNT = 5;

/** Pre-computed scatter targets for each bug. Hand-picked so the
 *  swarm spreads across the visible area without overlapping. Bug 0
 *  is the TARGET (the one BeakerBot whacks); bugs 1..N stay scattered
 *  as witnesses then panic-scatter further during exit. Coordinates
 *  are { xVw, yPx }: xVw is absolute viewport-width position, yPx
 *  is offset above the ground line (positive = higher up). */
const BUG_TARGETS: ReadonlyArray<{ xVw: number; yPx: number }> = [
  { xVw: 50, yPx: 0 }, // target — on ground line near center
  { xVw: 32, yPx: 40 }, // upper-left of swarm
  { xVw: 65, yPx: -20 }, // lower-right
  { xVw: 28, yPx: -10 },
  { xVw: 72, yPx: 30 },
];

/** Tiny "software bug" SVG — oval body, two antennae, six legs. */
function BugGlyph({
  className,
  defeated = false,
}: {
  className?: string;
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
      <ellipse cx="12" cy="14" rx="5" ry="4" fill="currentColor" stroke="none" />
      <path d="M12 10 L12 18" stroke="white" strokeWidth={0.8} />
      <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <path d="M11 8 L9 5" />
      <path d="M13 8 L15 5" />
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
        <path
          d="M10.5 8 L13.5 10 M13.5 8 L10.5 10"
          stroke="white"
          strokeWidth={1}
        />
      )}
    </svg>
  );
}

/** Fly swatter SVG — brown sloped handle + red mesh head with grid
 *  pattern. The handle's lower-right corner is the "grip" pivot point;
 *  the rotation transform-origin on the parent should match it so
 *  the swatter swings from the hand. */
function FlySwatter({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 32"
      fill="none"
      role="img"
      aria-label="Fly swatter"
      className={className ?? "w-6 h-8"}
    >
      {/* Handle: thin brown stick, sloped from grip (bottom-right) up
          to the mesh head (top-left). */}
      <line
        x1="22"
        y1="30"
        x2="10"
        y2="12"
        stroke="#8B4513"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      {/* Grip wrap at the bottom of the handle */}
      <line
        x1="22"
        y1="30"
        x2="19"
        y2="26"
        stroke="#5A2E0A"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      {/* Mesh head: rounded rect, bright red */}
      <rect
        x="1"
        y="2"
        width="14"
        height="11"
        rx="2.5"
        ry="2.5"
        fill="#dc2626"
        stroke="#991b1b"
        strokeWidth={0.8}
      />
      {/* Mesh grid — lighter red lines suggesting holes */}
      <g stroke="#fca5a5" strokeWidth={0.4} opacity={0.85}>
        <line x1="4.5" y1="2" x2="4.5" y2="13" />
        <line x1="8" y1="2" x2="8" y2="13" />
        <line x1="11.5" y1="2" x2="11.5" y2="13" />
        <line x1="1" y1="5" x2="15" y2="5" />
        <line x1="1" y1="7.5" x2="15" y2="7.5" />
        <line x1="1" y1="10" x2="15" y2="10" />
      </g>
    </svg>
  );
}

/** Splat residue SVG — irregular dark olive blob with spatter drops.
 *  Stays on screen from the splat stage through the end of the scene
 *  (the satisfying "evidence remains" gag). */
function SplatResidue({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 32"
      fill="none"
      role="img"
      aria-label="Splat residue"
      className={className ?? "w-12 h-10"}
    >
      {/* Main jagged blob — 9-vertex irregular polygon. */}
      <path
        d="M18 6 L23 4 L27 7 L31 6 L33 11 L30 15 L32 19 L27 21 L24 25 L18 24 L13 26 L10 21 L8 17 L11 13 L9 9 L14 7 Z"
        fill="#3D2B1F"
        stroke="#2A1D14"
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
      {/* Wet highlight glint */}
      <ellipse cx="17" cy="12" rx="2" ry="1" fill="#5C4530" opacity={0.7} />
      {/* Spatter drops — 4 small irregular polygons. */}
      <path
        d="M4 14 L5.5 12 L7 14 L5.5 16 Z"
        fill="#4B5320"
        stroke="#2A1D14"
        strokeWidth={0.4}
      />
      <path
        d="M35 9 L36.5 7.5 L38 9 L36.5 10.5 Z"
        fill="#4B5320"
        stroke="#2A1D14"
        strokeWidth={0.4}
      />
      <path
        d="M32 26 L33.5 24.5 L35 26 L33.5 28 Z"
        fill="#3D2B1F"
        stroke="#2A1D14"
        strokeWidth={0.4}
      />
      <path
        d="M6 27 L7.5 25.5 L9 27 L7.5 28.5 Z"
        fill="#4B5320"
        stroke="#2A1D14"
        strokeWidth={0.4}
      />
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
  // Capture onComplete in a ref so the timer effect doesn't re-fire
  // (and reset the sequence) every time the parent re-renders with a
  // new inline-fn reference.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Portal-mount detection (SSR-safe).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call.
    setMounted(true);
  }, []);

  // Honor prefers-reduced-motion. Read once on mount.
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
  // false -> true restarts the sequence cleanly.
  useEffect(() => {
    if (!active) return;
    const duration = reducedMotion ? REDUCED_MOTION_DURATION_MS : SCENE_DURATION_MS;
    const handle = window.setTimeout(() => {
      onCompleteRef.current();
    }, duration);
    return () => window.clearTimeout(handle);
  }, [active, reducedMotion]);

  // Direction memo — drives the keyframe x-coords. Bug 0 (the target)
  // is always at 50vw so BeakerBot's stalk path crosses the swarm
  // regardless of his entry side.
  const direction = useMemo(() => {
    const beakerFromLeft = beakerBotEntersFrom === "left";
    return {
      beakerStartX: beakerFromLeft ? "-20vw" : "120vw",
      // Spot pause — BeakerBot stops near his entry edge to react to
      // the swarm before he starts stalking.
      beakerSpotX: beakerFromLeft ? "10vw" : "90vw",
      // Sneak ends a few vw "behind" bug 0 from BeakerBot's side
      // (he's stalking, not standing on top of it).
      beakerStalkX: beakerFromLeft ? "42vw" : "58vw",
      beakerExitX: beakerFromLeft ? "-30vw" : "130vw",
      // +1 if walking rightward (entered from left), -1 if leftward.
      // Drives swatter hand-side and exit bob direction.
      sneakSign: (beakerFromLeft ? 1 : -1) as 1 | -1,
    };
  }, [beakerBotEntersFrom]);

  if (!active || !mounted) return null;

  // Reduced-motion fallback: static aftermath, no animation.
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
            bottom: SCENE_GROUND_BOTTOM_CSS,
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
          }}
        >
          {/* Splat residue — the satisfying evidence. */}
          <div data-testid="beakerbot-bug-stomp-splat">
            <SplatResidue className="w-12 h-10" />
          </div>
          {/* BeakerBot mid-cheer with swatter raised. */}
          <div style={{ position: "relative" }}>
            <BeakerBot
              pose="cheering"
              className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
              ariaLabel="BeakerBot victorious"
            />
            <div
              data-testid="beakerbot-bug-stomp-swatter"
              style={{
                position: "absolute",
                top: -12,
                right: 0,
                transform: "rotate(30deg)",
                transformOrigin: "bottom right",
              }}
            >
              <FlySwatter className="w-8 h-10" />
            </div>
          </div>
          {/* 2 frozen bugs scattered nearby. */}
          <div style={{ display: "flex", gap: 24, marginLeft: 12 }}>
            <BugGlyph className="w-8 h-8 text-neutral-800" />
            <BugGlyph className="w-8 h-8 text-neutral-800" />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Full animated scene.
  return createPortal(
    <>
      {/* Scoped keyframes for the full sequence. */}
      <style>{`
        /* Bug scatter: each bug starts at center spawn point (0,0
           relative to its container which is pinned to 50vw) and
           translates to its assigned target. Path arcs slightly upward
           mid-flight to read as scuttle, not slide. */
        @keyframes bbs-bug-scatter {
          0%   { transform: translate(0, 0) scale(0.6); opacity: 0; }
          15%  { opacity: 1; }
          50%  {
            transform: translate(calc(var(--bbs-bug-target-x) * 0.5), calc(var(--bbs-bug-target-y) - 6px)) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(var(--bbs-bug-target-x), var(--bbs-bug-target-y)) scale(1);
            opacity: 1;
          }
        }
        /* Bug idle wiggle — once scattered, bugs jitter in place. */
        @keyframes bbs-bug-idle {
          0%, 100% { transform: translate(var(--bbs-bug-target-x), var(--bbs-bug-target-y)) rotate(0deg); }
          25%      { transform: translate(calc(var(--bbs-bug-target-x) + 1px), var(--bbs-bug-target-y)) rotate(2deg); }
          75%      { transform: translate(calc(var(--bbs-bug-target-x) - 1px), var(--bbs-bug-target-y)) rotate(-2deg); }
        }
        /* Target bug poof — fires at whack impact (200ms into whack
           stage). Quick opacity dump + scale-down; the splat residue
           handles the "evidence stays" beat. */
        @keyframes bbs-bug-poof {
          0%   { opacity: 1; transform: translate(var(--bbs-bug-target-x), var(--bbs-bug-target-y)) scale(1); }
          100% { opacity: 0; transform: translate(var(--bbs-bug-target-x), var(--bbs-bug-target-y)) scale(0.3); }
        }
        /* Other bugs panic-scatter during exit — radiate outward
           faster than the original scatter. */
        @keyframes bbs-bug-panic {
          0%   { transform: translate(var(--bbs-bug-target-x), var(--bbs-bug-target-y)) scale(1); opacity: 1; }
          100% {
            transform: translate(calc(var(--bbs-bug-target-x) * 1.6), calc(var(--bbs-bug-target-y) - 20px)) scale(0.7);
            opacity: 0.3;
          }
        }
        /* Bug-leg wiggle (preserved from v1). */
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

        /* Splat residue — appears at start of splat stage, holds for
           the remainder of the scene. */
        @keyframes bbs-splat-appear {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0); }
          40%  { opacity: 1; transform: translate(-50%, 0) scale(1.1); }
          70%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }

        /* BeakerBot entry: slides in to spot position over 500ms. */
        @keyframes bbs-beaker-enter {
          0%   { transform: translate(var(--bbs-beaker-start-x), 0) rotate(0deg); }
          100% { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(0deg); }
        }
        /* Sneak: tip-toe jerky movement spot -> stalk over 1.8s.
           Discrete jumps (~5 steps), each step lands then pauses.
           Body leans forward via rotate(-15deg) throughout. */
        @keyframes bbs-beaker-sneak {
          0%   { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(0deg); }
          5%   { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(-15deg); }
          12%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.2), 0) rotate(-15deg); }
          22%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.2), 0) rotate(-15deg); }
          32%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.4), 0) rotate(-15deg); }
          42%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.4), 0) rotate(-15deg); }
          52%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.6), 0) rotate(-15deg); }
          62%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.6), 0) rotate(-15deg); }
          72%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.8), 0) rotate(-15deg); }
          82%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.8), 0) rotate(-15deg); }
          95%  { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(-15deg); }
          100% { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(-15deg); }
        }
        /* Whack: body squashes vertically on impact (1.0 -> 0.95 -> 1.0).
           Body stays leaned forward (-15deg). Swatter rotation is
           on the swatter element separately. */
        @keyframes bbs-beaker-whack {
          0%   { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(-15deg) scaleY(1); }
          50%  { transform: translate(var(--bbs-beaker-stalk-x), 2px) rotate(-15deg) scaleY(0.95); }
          100% { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(-15deg) scaleY(1); }
        }
        /* Celebrate: body straightens, small bounce. */
        @keyframes bbs-beaker-celebrate {
          0%   { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(-15deg); }
          25%  { transform: translate(var(--bbs-beaker-stalk-x), -6px) rotate(0deg); }
          50%  { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(0deg); }
          75%  { transform: translate(var(--bbs-beaker-stalk-x), -4px) rotate(0deg); }
          100% { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(0deg); }
        }
        /* Exit: walks off the way he came, with body bob. */
        @keyframes bbs-beaker-exit {
          0%   { transform: translate(var(--bbs-beaker-stalk-x), 0) rotate(0deg); }
          15%  { transform: translate(calc(var(--bbs-beaker-stalk-x) + (var(--bbs-beaker-exit-x) - var(--bbs-beaker-stalk-x)) * 0.15), -4px) rotate(0deg); }
          30%  { transform: translate(calc(var(--bbs-beaker-stalk-x) + (var(--bbs-beaker-exit-x) - var(--bbs-beaker-stalk-x)) * 0.30), 0) rotate(0deg); }
          45%  { transform: translate(calc(var(--bbs-beaker-stalk-x) + (var(--bbs-beaker-exit-x) - var(--bbs-beaker-stalk-x)) * 0.45), -4px) rotate(0deg); }
          60%  { transform: translate(calc(var(--bbs-beaker-stalk-x) + (var(--bbs-beaker-exit-x) - var(--bbs-beaker-stalk-x)) * 0.60), 0) rotate(0deg); }
          75%  { transform: translate(calc(var(--bbs-beaker-stalk-x) + (var(--bbs-beaker-exit-x) - var(--bbs-beaker-stalk-x)) * 0.75), -4px) rotate(0deg); }
          100% { transform: translate(var(--bbs-beaker-exit-x), 0) rotate(0deg); }
        }

        /* Swatter whack: 0 -> 90deg in first 66% of the 300ms (200ms,
           anticipation snap), then back 90 -> 0 in the last 34% (100ms). */
        @keyframes bbs-swatter-whack {
          0%   { transform: rotate(0deg); }
          66%  { transform: rotate(90deg); }
          100% { transform: rotate(0deg); }
        }
        /* Swatter raised on celebrate (rotate +30deg, hold). */
        @keyframes bbs-swatter-celebrate {
          0%   { transform: rotate(0deg); }
          20%  { transform: rotate(30deg); }
          100% { transform: rotate(30deg); }
        }

        /* Exclamation mark on celebrate. */
        @keyframes bbs-exclaim {
          0%   { opacity: 0; transform: translate(-50%, 4px) scale(0.4); }
          25%  { opacity: 1; transform: translate(-50%, -8px) scale(1.15); }
          70%  { opacity: 1; transform: translate(-50%, -8px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -12px) scale(0.9); }
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
            "--bbs-beaker-start-x": direction.beakerStartX,
            "--bbs-beaker-spot-x": direction.beakerSpotX,
            "--bbs-beaker-stalk-x": direction.beakerStalkX,
            "--bbs-beaker-exit-x": direction.beakerExitX,
          } as React.CSSProperties
        }
        aria-hidden="true"
      >
        {/* Ground line anchor — shared SCENE_GROUND_BOTTOM_VH so the
            swarm + BeakerBot land on the same baseline as other
            bench-style scenes. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: SCENE_GROUND_BOTTOM_CSS,
            width: 0,
            height: 0,
          }}
        >
          {/* Bug swarm — BUG_COUNT bugs spawn from a center point
              (50vw) and scatter to their targets. Bug 0 is the target
              (poofed at whack impact); bugs 1..N panic-scatter
              outward during exit. */}
          {Array.from({ length: BUG_COUNT }).map((_, i) => {
            const target = BUG_TARGETS[i] ?? BUG_TARGETS[0];
            const isTarget = i === 0;
            const exitAnim = isTarget
              ? `bbs-bug-poof 100ms ease-out ${STAGE_OFFSETS.whackImpact}ms forwards`
              : `bbs-bug-panic 800ms ease-out ${STAGE_OFFSETS.exit}ms forwards`;
            return (
              <div
                key={i}
                data-testid={`beakerbot-bug-stomp-bug-${i}`}
                data-bug-is-target={isTarget ? "true" : "false"}
                style={
                  {
                    position: "absolute",
                    left: "50vw",
                    top: 0,
                    transform: "translate(0, 0)",
                    "--bbs-bug-target-x": `${target.xVw - 50}vw`,
                    "--bbs-bug-target-y": `${-target.yPx}px`,
                    animation: [
                      // Scatter: 0 -> 1500ms. Stagger entries by 80ms
                      // per bug so they don't all spawn on one frame.
                      `bbs-bug-scatter ${1500 - i * 80}ms ease-out ${i * 80}ms both`,
                      // Idle wiggle: kicks in after scatter, loops.
                      `bbs-bug-idle 600ms ease-in-out ${STAGE_OFFSETS.spot}ms infinite`,
                      // Exit beat (poof for target, panic-scatter
                      // for the rest).
                      exitAnim,
                    ].join(", "),
                    willChange: "transform, opacity",
                  } as React.CSSProperties
                }
              >
                <BugGlyph className="w-10 h-10 text-neutral-800 block" />
              </div>
            );
          })}

          {/* Splat residue — appears at start of splat stage at the
              target bug's position (50vw, ground line), HOLDS through
              celebrate + exit (the satisfying gag). */}
          <div
            data-testid="beakerbot-bug-stomp-splat"
            style={{
              position: "absolute",
              left: "50vw",
              top: -8,
              transform: "translate(-50%, 0) scale(0)",
              opacity: 0,
              animation: `bbs-splat-appear 250ms ease-out ${STAGE_OFFSETS.splat}ms forwards`,
              willChange: "transform, opacity",
            }}
            aria-hidden="true"
          >
            <SplatResidue className="w-12 h-10" />
          </div>

          {/* BeakerBot — chained enter -> sneak -> whack -> celebrate
              -> exit. Each segment uses fill-mode: both so the final
              transform of each segment holds while the next segment
              is in its delay window. */}
          <div
            className="bbs-beaker"
            style={{
              position: "absolute",
              left: 0,
              // Float him so his "feet" line up with the ground line.
              top: "-80px",
              transform: `translate(${direction.beakerStartX}, 0)`,
              animation: [
                `bbs-beaker-enter 500ms ease-out ${STAGE_OFFSETS.spot}ms both`,
                `bbs-beaker-sneak 1800ms linear ${STAGE_OFFSETS.sneak}ms both`,
                `bbs-beaker-whack 300ms ease-in ${STAGE_OFFSETS.whack}ms both`,
                `bbs-beaker-celebrate 800ms ease-out ${STAGE_OFFSETS.celebrate}ms both`,
                `bbs-beaker-exit 800ms ease-in ${STAGE_OFFSETS.exit}ms both`,
              ].join(", "),
              willChange: "transform, opacity",
            }}
          >
            <div
              style={{
                position: "relative",
                width: BEAKERBOT_SCENE_SIZE_PX,
                height: BEAKERBOT_SCENE_SIZE_PX,
              }}
            >
              {/* Exclamation mark — pops in during celebrate. */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "-32px",
                  fontSize: 40,
                  fontWeight: 800,
                  color: "#dc2626",
                  transform: "translate(-50%, 4px) scale(0.4)",
                  opacity: 0,
                  animation: `bbs-exclaim 600ms ease-out ${STAGE_OFFSETS.celebrate}ms forwards`,
                  fontFamily: "system-ui, sans-serif",
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                !
              </div>

              {/* BeakerBot pose stack — three poses cross-faded by
                  timed opacity keyframes (panicked / pointing-down /
                  cheering). */}
              <PoseStack />

              {/* Fly swatter — anchored to BeakerBot's hand area, on
                  the bug-facing side. Whack rotation pivots from the
                  grip (bottom corner). Hidden until sneak start. */}
              <SwatterRig sneakSign={direction.sneakSign} />
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * Three BeakerBot poses stacked, cross-faded via opacity keyframes:
 *   - `panicked`      during bugsScatter + spot (0 -> 2000ms)
 *   - `pointing-down` during sneak + whack + splat (2000 -> 4700ms)
 *   - `cheering`      during celebrate + exit (4700 -> 6300ms)
 *
 * Toggling via CSS opacity (not React state) keeps the swap inside
 * the animation pipeline so the parent's chained transform animations
 * don't reset.
 */
function PoseStack() {
  // Stage-relative opacity keyframe breakpoints as percentages of
  // SCENE_DURATION_MS (6300ms).
  const sneakStartPct = (STAGE_OFFSETS.sneak / SCENE_DURATION_MS) * 100; // ~31.7%
  const celebrateStartPct = (STAGE_OFFSETS.celebrate / SCENE_DURATION_MS) * 100; // ~74.6%
  // 1% crossfade gap on either side of each transition.
  const fadeGap = 1;
  return (
    <>
      <style>{`
        @keyframes bbs-pose-panicked {
          0%, ${sneakStartPct.toFixed(2)}%   { opacity: 1; }
          ${(sneakStartPct + fadeGap).toFixed(2)}%, 100% { opacity: 0; }
        }
        @keyframes bbs-pose-pointing {
          0%, ${sneakStartPct.toFixed(2)}%   { opacity: 0; }
          ${(sneakStartPct + fadeGap).toFixed(2)}%, ${celebrateStartPct.toFixed(2)}% { opacity: 1; }
          ${(celebrateStartPct + fadeGap).toFixed(2)}%, 100% { opacity: 0; }
        }
        @keyframes bbs-pose-cheering {
          0%, ${celebrateStartPct.toFixed(2)}%   { opacity: 0; }
          ${(celebrateStartPct + fadeGap).toFixed(2)}%, 100% { opacity: 1; }
        }
      `}</style>
      <div style={{ position: "absolute", inset: 0 }}>
        <BeakerBot
          pose={"panicked" as BeakerBotPose}
          className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
          ariaLabel="BeakerBot spots swarm"
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 1,
            animation: `bbs-pose-panicked ${SCENE_DURATION_MS}ms linear forwards`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          animation: `bbs-pose-pointing ${SCENE_DURATION_MS}ms linear forwards`,
        }}
      >
        <BeakerBot
          pose={"pointing-down" as BeakerBotPose}
          className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
          ariaLabel="BeakerBot sneaking"
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          animation: `bbs-pose-cheering ${SCENE_DURATION_MS}ms linear forwards`,
        }}
      >
        <BeakerBot
          pose={"cheering" as BeakerBotPose}
          className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
          ariaLabel="BeakerBot victorious"
        />
      </div>
    </>
  );
}

/**
 * Fly swatter rig — anchored to BeakerBot's lower-hand area on the
 * bug-facing side. During whack, the swatter rotates 0 -> 90 -> 0
 * (anticipation snap down + quick return) pivoting from the grip.
 * During celebrate, it raises to +30deg. Hidden until sneak start
 * so the panicked-entry frame doesn't have a swatter floating in air.
 */
function SwatterRig({ sneakSign }: { sneakSign: 1 | -1 }) {
  // sneakSign +1 = walking rightward (entered from left), bug is to
  // the right -> swatter on the right hand. -1 = mirror.
  const isRightSide = sneakSign === 1;
  const sneakStartPct = (STAGE_OFFSETS.sneak / SCENE_DURATION_MS) * 100;
  return (
    <>
      <style>{`
        @keyframes bbs-swatter-appear {
          0%, ${sneakStartPct.toFixed(2)}% { opacity: 0; }
          ${(sneakStartPct + 1).toFixed(2)}%, 100% { opacity: 1; }
        }
      `}</style>
      <div
        data-testid="beakerbot-bug-stomp-swatter"
        style={{
          position: "absolute",
          [isRightSide ? "right" : "left"]: 16,
          bottom: 36,
          width: 28,
          height: 40,
          opacity: 0,
          // Mirror SVG horizontally when BeakerBot is walking
          // leftward so the head leads the strike toward the bug.
          transform: isRightSide ? "none" : "scaleX(-1)",
          transformOrigin: "center bottom",
          animation: `bbs-swatter-appear ${SCENE_DURATION_MS}ms linear forwards`,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {/* Inner wrapper handles the rotation animations. Pivot is
            the bottom-right corner = grip. */}
        <div
          style={{
            width: "100%",
            height: "100%",
            transformOrigin: "bottom right",
            transform: "rotate(0deg)",
            animation: [
              `bbs-swatter-whack 300ms ease-in ${STAGE_OFFSETS.whack}ms both`,
              `bbs-swatter-celebrate 800ms ease-out ${STAGE_OFFSETS.celebrate}ms both`,
            ].join(", "),
            willChange: "transform",
          }}
        >
          <FlySwatter className="w-7 h-10" />
        </div>
      </div>
    </>
  );
}

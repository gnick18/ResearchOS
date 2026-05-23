"use client";

// frontend/src/components/BeakerBotBugStompScene.tsx
//
// Side easter-egg scene (R3 simplification). ONE bug sits on the
// ground; BeakerBot walks in carrying a fly swatter, spots it, sneaks
// HORIZONTALLY across the screen to close the distance, then arcs the
// swatter down on the bug. The bug becomes a splat residue that stays
// on screen as the satisfying punchline while BeakerBot cheers and
// walks off.
//
// Why R3? R2 had three problems Grant called out:
//   1. The PoseStack cross-fade mechanism rendered all three poses at
//      full opacity simultaneously, giving BeakerBot three visible
//      arms.
//   2. A 5-bug swarm overcrowded the gag (just one bug is funnier).
//   3. BeakerBot stayed in place — the swatter waved around in empty
//      space, never reaching a bug.
//
// R3 fixes all three: a single `pose` prop on a single <BeakerBot/>,
// ONE bug at a deterministic position, and a real translateX sneak
// covering ~40+vw so the whack happens NEXT TO the bug.
//
// Stage timeline (~5.0s total in motion mode):
//   1. walkIn     0    -> 600ms   BeakerBot enters from chosen side
//                                  carrying the swatter, idle pose
//   2. spot       600  -> 1100ms  Stops, panicked pose (sees the bug)
//   3. sneak      1100 -> 2600ms  pointing-down + lean, translateX
//                                  the long distance to next-to-bug
//   4. whack      2600 -> 3000ms  Stops. Swatter arcs down (0->90deg
//                                  in 200ms anticipation, snap back
//                                  0deg in 200ms). Body squashes.
//   5. splat      3000 -> 3500ms  Bug -> splat residue (scale 0 ->
//                                  1.1 -> 1.0 + opacity). Holds.
//   6. celebrate  3500 -> 4300ms  cheering pose, swatter raised, "!"
//   7. exit       4300 -> 5000ms  Walks back off the side he came
//                                  from, idle pose. Splat HOLDS.
//
// Reduced-motion fallback: a static tableau (BeakerBot mid-cheer with
// swatter raised + splat residue, no bug) holds for 2s, then
// onComplete.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import { SCENE_GROUND_BOTTOM_CSS } from "./beakerbot/scene-constants";

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
  /** Side BeakerBot enters from. Default "right". The single bug
   *  spawns at a fixed deterministic position; only BeakerBot's entry
   *  edge changes. */
  beakerBotEntersFrom?: "left" | "right";
}

/** Stage durations in ms. Exported so tests can re-derive the total. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  spot: 500,
  sneak: 1500,
  whack: 400,
  splat: 500,
  celebrate: 800,
  exit: 700,
} as const;

export const SCENE_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.spot +
  STAGE_DURATIONS.sneak +
  STAGE_DURATIONS.whack +
  STAGE_DURATIONS.splat +
  STAGE_DURATIONS.celebrate +
  STAGE_DURATIONS.exit; // 5000ms

/** Cumulative stage start offsets (ms from scene start). */
const STAGE_OFFSETS = {
  walkIn: 0,
  spot: STAGE_DURATIONS.walkIn,
  sneak: STAGE_DURATIONS.walkIn + STAGE_DURATIONS.spot,
  whack:
    STAGE_DURATIONS.walkIn + STAGE_DURATIONS.spot + STAGE_DURATIONS.sneak,
  /** 200ms into the whack stage — when the swatter is at the bottom
   *  of its arc and the bug should disappear into the splat. */
  whackImpact:
    STAGE_DURATIONS.walkIn +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    200,
  splat:
    STAGE_DURATIONS.walkIn +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack,
  celebrate:
    STAGE_DURATIONS.walkIn +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack +
    STAGE_DURATIONS.splat,
  exit:
    STAGE_DURATIONS.walkIn +
    STAGE_DURATIONS.spot +
    STAGE_DURATIONS.sneak +
    STAGE_DURATIONS.whack +
    STAGE_DURATIONS.splat +
    STAGE_DURATIONS.celebrate,
} as const;

/** Reduced-motion fallback duration — static aftermath tableau for
 *  ~2s, then onComplete. */
const REDUCED_MOTION_DURATION_MS = 2000;

/** Single bug position. xVw is absolute viewport-width position,
 *  yPx is offset above the ground line (positive = higher up). The
 *  bug sits on the ground line near 65vw, so BeakerBot entering from
 *  the left has a satisfying ~50vw sneak path. (When BeakerBot enters
 *  from the right, the path is the mirror — bug is positioned at
 *  35vw instead; see `bugX` in the direction memo.) */
const BUG_Y_PX = 0;

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

/** Which stage we're currently in. Drives the single <BeakerBot/>
 *  pose prop swap. */
type Stage =
  | "walkIn"
  | "spot"
  | "sneak"
  | "whack"
  | "splat"
  | "celebrate"
  | "exit";

/** Pose for each stage. Used by the single <BeakerBot/> instance so
 *  we never render more than one BeakerBot SVG at a time (= no
 *  three-arm bug from R2's PoseStack). */
const STAGE_POSES: Record<Stage, BeakerBotPose> = {
  walkIn: "idle",
  spot: "panicked",
  sneak: "pointing-down",
  whack: "pointing-down",
  splat: "pointing-down",
  celebrate: "cheering",
  exit: "idle",
};

export default function BeakerBotBugStompScene({
  active,
  onComplete,
  beakerBotEntersFrom = "right",
}: BeakerBotBugStompSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [stage, setStage] = useState<Stage>("walkIn");
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

  // Stage scheduler — drives the single BeakerBot pose swap from
  // `walkIn` -> `spot` -> ... -> `exit` at the stage boundaries.
  // Each stage transition is one React re-render with a new `pose`
  // prop on the same single <BeakerBot/> instance; the CSS animations
  // (driven by animation-delay) run independently and don't restart
  // when state changes.
  useEffect(() => {
    if (!active || reducedMotion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset of stage state when the scene is inactive or in reduced-motion mode; needed so toggling active false -> true restarts the sequence from walkIn rather than wherever the previous play left it.
      setStage("walkIn");
      return;
    }
    const handles: number[] = [];
    const schedule = (delay: number, next: Stage) => {
      handles.push(
        window.setTimeout(() => {
          setStage(next);
        }, delay),
      );
    };
    setStage("walkIn");
    schedule(STAGE_OFFSETS.spot, "spot");
    schedule(STAGE_OFFSETS.sneak, "sneak");
    schedule(STAGE_OFFSETS.whack, "whack");
    schedule(STAGE_OFFSETS.splat, "splat");
    schedule(STAGE_OFFSETS.celebrate, "celebrate");
    schedule(STAGE_OFFSETS.exit, "exit");
    return () => {
      handles.forEach((h) => window.clearTimeout(h));
    };
  }, [active, reducedMotion]);

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

  // Direction memo — drives the keyframe x-coords. The bug sits on
  // the OPPOSITE side from BeakerBot's entry so the sneak path is
  // long and visible (~50vw of horizontal travel).
  const direction = useMemo(() => {
    const beakerFromLeft = beakerBotEntersFrom === "left";
    return {
      beakerStartX: beakerFromLeft ? "-20vw" : "120vw",
      // Spot pause — BeakerBot stops near his entry edge to react to
      // the bug before he starts stalking.
      beakerSpotX: beakerFromLeft ? "12vw" : "88vw",
      // Sneak ends a few vw "behind" the bug from BeakerBot's side
      // (he's stalking, not standing on top of it). The bug is on
      // the opposite side of the screen.
      beakerStalkX: beakerFromLeft ? "58vw" : "42vw",
      beakerExitX: beakerFromLeft ? "-30vw" : "130vw",
      /** Bug X position (vw). On the opposite side from BeakerBot's
       *  entry so the sneak distance is long. */
      bugX: beakerFromLeft ? "68vw" : "32vw",
      // +1 if walking rightward (entered from left), -1 if leftward.
      // Drives swatter hand-side.
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
              className="w-32 h-32 text-sky-500"
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
        </div>
      </div>,
      document.body,
    );
  }

  // Full animated scene.
  const currentPose = STAGE_POSES[stage];
  return createPortal(
    <>
      {/* Scoped keyframes for the full sequence. */}
      <style>{`
        /* Bug-leg wiggle (preserved from v1/R2). */
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

        /* Bug poof: fires at whack impact (200ms into whack stage).
           Quick opacity dump + scale-down; the splat residue handles
           the "evidence stays" beat. */
        @keyframes bbs-bug-poof {
          0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, 0) scale(0.3); }
        }

        /* Splat residue — appears at start of splat stage, holds for
           the remainder of the scene. */
        @keyframes bbs-splat-appear {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0); }
          40%  { opacity: 1; transform: translate(-50%, 0) scale(1.1); }
          70%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }

        /* BeakerBot entry: slides in to spot position over 600ms.
           Body bobs gently (walking gait). */
        @keyframes bbs-beaker-walkIn {
          0%   { transform: translate(var(--bbs-beaker-start-x), 0) rotate(0deg); }
          25%  { transform: translate(calc(var(--bbs-beaker-start-x) + (var(--bbs-beaker-spot-x) - var(--bbs-beaker-start-x)) * 0.25), -4px) rotate(0deg); }
          50%  { transform: translate(calc(var(--bbs-beaker-start-x) + (var(--bbs-beaker-spot-x) - var(--bbs-beaker-start-x)) * 0.50), 0) rotate(0deg); }
          75%  { transform: translate(calc(var(--bbs-beaker-start-x) + (var(--bbs-beaker-spot-x) - var(--bbs-beaker-start-x)) * 0.75), -4px) rotate(0deg); }
          100% { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(0deg); }
        }
        /* Spot: hold in place. (Pose change handles the "saw the bug" beat.) */
        @keyframes bbs-beaker-spot {
          0%, 100% { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(0deg); }
        }
        /* Sneak: smooth horizontal translation from spot to next-to-bug
           over 1500ms. Body leans forward via rotate(-15deg) throughout.
           A subtle 2-step bob keeps the tip-toe energy without the
           heavy jerky stop-start that read as "stuck" in R2. */
        @keyframes bbs-beaker-sneak {
          0%   { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(0deg); }
          8%   { transform: translate(var(--bbs-beaker-spot-x), 0) rotate(-15deg); }
          25%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.22), -3px) rotate(-15deg); }
          50%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.50), 0) rotate(-15deg); }
          75%  { transform: translate(calc(var(--bbs-beaker-spot-x) + (var(--bbs-beaker-stalk-x) - var(--bbs-beaker-spot-x)) * 0.78), -3px) rotate(-15deg); }
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

        /* Swatter whack: 0 -> 90deg in first half (200ms, anticipation),
           then back 90 -> 0 in the second half (200ms, snap). */
        @keyframes bbs-swatter-whack {
          0%   { transform: rotate(0deg); }
          50%  { transform: rotate(90deg); }
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
        data-stage={stage}
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
            bug + BeakerBot land on the same baseline as other
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
          {/* Single bug — sits at `direction.bugX` (opposite side from
              BeakerBot's entry). Wiggles its legs in place from mount
              until the whack impact, then poofs into nothing. The
              splat residue (rendered separately below) handles the
              "evidence remains" payoff. */}
          <div
            data-testid="beakerbot-bug-stomp-bug-0"
            data-bug-is-target="true"
            style={{
              position: "absolute",
              left: direction.bugX,
              top: `${-BUG_Y_PX}px`,
              transform: "translate(-50%, 0)",
              animation: `bbs-bug-poof 120ms ease-out ${STAGE_OFFSETS.whackImpact}ms forwards`,
              willChange: "transform, opacity",
            }}
          >
            <BugGlyph className="w-10 h-10 text-neutral-800 block" />
          </div>

          {/* Splat residue — appears at start of splat stage at the
              bug's position, HOLDS through celebrate + exit. */}
          <div
            data-testid="beakerbot-bug-stomp-splat"
            style={{
              position: "absolute",
              left: direction.bugX,
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

          {/* BeakerBot — chained walkIn -> spot -> sneak -> whack ->
              celebrate -> exit. Each segment uses fill-mode: both so
              the final transform of each segment holds while the next
              segment is in its delay window. The pose prop on the
              single <BeakerBot/> instance is swapped via React state
              at stage boundaries (no overlapping pose stack). */}
          <div
            className="bbs-beaker"
            style={{
              position: "absolute",
              left: 0,
              // Float him so his "feet" line up with the ground line.
              top: "-80px",
              transform: `translate(${direction.beakerStartX}, 0)`,
              animation: [
                `bbs-beaker-walkIn 600ms ease-out ${STAGE_OFFSETS.walkIn}ms both`,
                `bbs-beaker-spot 500ms linear ${STAGE_OFFSETS.spot}ms both`,
                `bbs-beaker-sneak 1500ms linear ${STAGE_OFFSETS.sneak}ms both`,
                `bbs-beaker-whack 400ms ease-in ${STAGE_OFFSETS.whack}ms both`,
                `bbs-beaker-celebrate 800ms ease-out ${STAGE_OFFSETS.celebrate}ms both`,
                `bbs-beaker-exit 700ms ease-in ${STAGE_OFFSETS.exit}ms both`,
              ].join(", "),
              willChange: "transform, opacity",
            }}
          >
            <div style={{ position: "relative", width: 128, height: 128 }}>
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

              {/* Single BeakerBot — the `pose` prop is swapped via
                  React state at stage boundaries. ONE BeakerBot in
                  the DOM at all times (no overlapping pose stack =
                  no three-arm bug from R2). */}
              <BeakerBot
                pose={currentPose}
                className="w-32 h-32 text-sky-500"
                ariaLabel="BeakerBot bug stomper"
              />

              {/* Fly swatter — anchored to BeakerBot's hand area, on
                  the bug-facing side. Whack rotation pivots from the
                  grip (bottom corner). Visible the whole scene since
                  he's carrying it from walkIn through exit. */}
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
 * Fly swatter rig — anchored to BeakerBot's lower-hand area on the
 * bug-facing side. During whack, the swatter rotates 0 -> 90 -> 0
 * (anticipation snap down + quick return) pivoting from the grip.
 * During celebrate, it raises to +30deg. Visible from the moment
 * BeakerBot walks in (he's carrying it the whole time).
 */
function SwatterRig({ sneakSign }: { sneakSign: 1 | -1 }) {
  // sneakSign +1 = walking rightward (entered from left), bug is to
  // the right -> swatter on the right hand. -1 = mirror.
  const isRightSide = sneakSign === 1;
  return (
    <div
      data-testid="beakerbot-bug-stomp-swatter"
      style={{
        position: "absolute",
        [isRightSide ? "right" : "left"]: 16,
        bottom: 36,
        width: 28,
        height: 40,
        // Mirror SVG horizontally when BeakerBot is walking
        // leftward so the head leads the strike toward the bug.
        transform: isRightSide ? "none" : "scaleX(-1)",
        transformOrigin: "center bottom",
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
            `bbs-swatter-whack 400ms ease-in ${STAGE_OFFSETS.whack}ms both`,
            `bbs-swatter-celebrate 800ms ease-out ${STAGE_OFFSETS.celebrate}ms both`,
          ].join(", "),
          willChange: "transform",
        }}
      >
        <FlySwatter className="w-7 h-10" />
      </div>
    </div>
  );
}

"use client";

// frontend/src/components/BeakerBotCoffeeRefillScene.tsx
//
// Reward easter-egg scene (R2 full redesign): BeakerBot walks in carrying
// a small bag of coffee beans, dumps them into the top of a classic drip
// coffee machine, waits while the machine slowly brews a full pot
// (whistling a tune with ♪ ♫ glyphs drifting up), then picks up the
// finished pot and carries it off-screen. The long brewing beat IS the
// joke — "I waited 8 seconds for this coffee, but look how happy I am."
// The whistle sway plus drifting musical notes sell the wait as
// intentional, not a glitch.
//
// Built on the same skeleton as BeakerBotEurekaScene and
// BeakerBotTooManyBeakersScene:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none (purely decorative)
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static "pot in hand" fallback
//
// Stage timeline (~13s total in motion mode):
//   1. walkIn        0     → 800ms    (enters carrying beans bag)
//   2. pourBeans     800   → 2000ms   (tilts bag over machine top, beans rattle in)
//   3. setupComplete 2000  → 2400ms   (sets bag down, machine LED glows on)
//   4. brewing       2400  → 10400ms  (8s slow drip + pot fills + whistle sway + ♪ notes)
//   5. ready         10400 → 11000ms  (drip stops, pose=amazed, steam wisp from pot)
//   6. carryOff      11000 → 13000ms  (picks up pot, walks off opposite side)
//
// Reduced-motion fallback: render BeakerBot at the bench position
// proudly holding the FULL pot next to the machine, with one ♪ note
// floating mid-air to suggest the whistle. Hold 2000ms then fire
// onComplete.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import {
  BEAKERBOT_SCENE_SIZE_CLASS,
  BEAKERBOT_SCENE_SIZE_PX,
  SCENE_GROUND_BOTTOM_CSS,
  SCENE_GROUND_BOTTOM_VH,
} from "./beakerbot/scene-constants";

export interface BeakerBotCoffeeRefillSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters carrying the beans bag. Default
   *  "left". He exits the opposite side carrying the full pot. */
  enterFrom?: "left" | "right";
  /** Where the scene's full-screen portal mounts. Defaults to
   *  document.body (the global easter-egg behavior, unchanged). The
   *  showcase Scenes view passes its scaled in-frame viewport so the
   *  scene plays inside the fixed window. When explicitly null the scene
   *  renders nothing (the target is not live yet). */
  portalTarget?: HTMLElement | null;
}

/** Stage durations in ms. Exported so tests can derive the total without
 *  hard-coding the sum. Total: 800+1200+400+8000+600+2000 = 13000ms.
 *  Brewing intentionally long — the wait IS the gag. */
export const STAGE_DURATIONS = {
  walkIn: 800,
  pourBeans: 1200,
  setupComplete: 400,
  brewing: 8000,
  ready: 600,
  carryOff: 2000,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.pourBeans +
  STAGE_DURATIONS.setupComplete +
  STAGE_DURATIONS.brewing +
  STAGE_DURATIONS.ready +
  STAGE_DURATIONS.carryOff;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type CoffeeRefillStage =
  | "idle"
  | "walkIn"
  | "pourBeans"
  | "setupComplete"
  | "brewing"
  | "ready"
  | "carryOff"
  | "done";

export const STAGE_ORDER: readonly CoffeeRefillStage[] = [
  "walkIn",
  "pourBeans",
  "setupComplete",
  "brewing",
  "ready",
  "carryOff",
] as const;

// ----- Visual constants -----

/** Coffee liquid color — rich brown, slightly warm. */
const COFFEE_COLOR = "#6B4423";
/** Coffee liquid highlight (slightly lighter, used at the top of the gradient). */
const COFFEE_HIGHLIGHT = "#8B5E3C";
/** Coffee bean fill color. */
const BEAN_COLOR = "#5C3A1E";
/** Coffee machine body color — clean off-white. */
const MACHINE_BODY = "#F1F5F9";
const MACHINE_ACCENT = "#CBD5E1";
const MACHINE_OUTLINE = "#475569";
/** Machine LED — gray when off, cyan when brewing. */
const LED_OFF = "#94A3B8";
const LED_ON = "#22D3EE";
/** Glass carafe outline / handle stroke. */
const POT_OUTLINE = "#475569";
const POT_GLASS_FILL = "rgba(241, 245, 249, 0.55)"; // semi-transparent for the "glass" look
/** Beans bag — cream/tan canvas look. */
const BAG_BODY = "#E8D9B5";
const BAG_OUTLINE = "#8B6F47";
const BAG_LABEL = "#6B4423";
/** Musical note color — cheerful sky-blue. */
const NOTE_COLOR = "#38BDF8"; // sky-400
const NOTE_STROKE = "#0284C7"; // sky-600
/** Steam wisp color (over the fresh pot). */
const STEAM_COLOR = "rgba(148, 163, 184, 0.7)";

/** Z-index slot — matches the other reward scenes. */
const SCENE_Z_INDEX = 800;

/** SSR-safe client detection — same pattern used elsewhere. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// ----- SVG glyphs -----

/** Classic drip coffee machine. Rectangular silhouette with three
 *  sections: grinder/hopper top (where beans go in), brewing body
 *  (with the LED), and bottom hot-plate recess (where the pot sits).
 *  A small downward-pointing nozzle protrudes between the body and
 *  the hot plate — that's where the drip falls from. */
function CoffeeMachineGlyph({
  className,
  ledOn,
}: {
  className?: string;
  /** When true, the brewing-indicator LED glows cyan. */
  ledOn: boolean;
}) {
  return (
    <svg
      viewBox="0 0 28 32"
      fill="none"
      role="img"
      aria-label="Coffee machine"
      className={className ?? "w-7 h-8"}
    >
      {/* Grinder / hopper top — narrow trapezoid feeding the body */}
      <path
        d="M 8 1 L 20 1 L 19 5 L 9 5 Z"
        fill={MACHINE_ACCENT}
        stroke={MACHINE_OUTLINE}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Tiny opening at top of hopper (where beans fall in) */}
      <ellipse cx="14" cy="1.2" rx="4" ry="0.6" fill="#1E293B" />
      {/* Brewing body — main rectangle */}
      <rect
        x="4"
        y="5"
        width="20"
        height="14"
        rx="1.2"
        fill={MACHINE_BODY}
        stroke={MACHINE_OUTLINE}
        strokeWidth="0.7"
      />
      {/* Subtle horizontal panel line — looks like a removable filter cap */}
      <line x1="4" y1="9" x2="24" y2="9" stroke={MACHINE_ACCENT} strokeWidth="0.5" />
      {/* LED dot — brewing indicator */}
      <circle
        cx="21"
        cy="7"
        r="0.9"
        fill={ledOn ? LED_ON : LED_OFF}
        stroke={MACHINE_OUTLINE}
        strokeWidth="0.25"
      />
      {/* Drip nozzle — small downward triangle protruding from the body's bottom */}
      <path
        d="M 12.5 19 L 15.5 19 L 14 21 Z"
        fill={MACHINE_OUTLINE}
      />
      {/* Hot plate / pot rest — recessed area below the body */}
      <rect
        x="3"
        y="22"
        width="22"
        height="9"
        rx="0.8"
        fill={MACHINE_ACCENT}
        stroke={MACHINE_OUTLINE}
        strokeWidth="0.7"
      />
      {/* Hot plate surface — slightly darker inner rect (where the pot sits) */}
      <rect
        x="4.5"
        y="29"
        width="19"
        height="1.5"
        rx="0.4"
        fill="#94A3B8"
      />
    </svg>
  );
}

/** Classic round glass carafe with handle. Coffee fills inside up to
 *  `fillRatio` (0..1). Liquid drawn as a brown rect masked to the
 *  carafe interior, with a slight gradient top→bottom for depth. */
function CoffeePotGlyph({
  className,
  fillRatio,
  showHandleOnRight = true,
  gradientId,
}: {
  className?: string;
  /** Coffee fill level inside the pot. 0 = empty, 1 = full to the brim. */
  fillRatio: number;
  /** Side the curved handle hangs off. */
  showHandleOnRight?: boolean;
  /** Unique id for the liquid gradient — required so multiple pot
   *  instances (bench + held) don't collide in a single document. */
  gradientId: string;
}) {
  const fill = Math.max(0, Math.min(1, fillRatio));
  // Pot inside spans roughly y=8..y=22 (14 units of vertical liquid).
  // fillRatio=1 → liquid top at y=8; fillRatio=0 → at y=22.
  const liquidTopY = 22 - fill * 14;
  const showLiquid = fill > 0.001;
  return (
    <svg
      viewBox="0 0 24 26"
      fill="none"
      role="img"
      aria-label="Coffee pot"
      className={className ?? "w-6 h-7"}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COFFEE_HIGHLIGHT} />
          <stop offset="100%" stopColor={COFFEE_COLOR} />
        </linearGradient>
        {/* Clip path masks the liquid rectangle to the carafe interior */}
        <clipPath id={`${gradientId}-clip`}>
          <path d="M 7 4 L 7 22 Q 7 24, 9 24 L 15 24 Q 17 24, 17 22 L 17 4 Z" />
        </clipPath>
      </defs>

      {/* Glass carafe body — slightly tapered neck + rounded bottom */}
      <path
        d="M 6.5 4
           L 6.5 22
           Q 6.5 24.5, 9 24.5
           L 15 24.5
           Q 17.5 24.5, 17.5 22
           L 17.5 4 Z"
        fill={POT_GLASS_FILL}
        stroke={POT_OUTLINE}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* Liquid inside — masked to the carafe interior path */}
      {showLiquid && (
        <rect
          x="7"
          y={liquidTopY}
          width="10"
          height={24 - liquidTopY}
          fill={`url(#${gradientId})`}
          clipPath={`url(#${gradientId}-clip)`}
        />
      )}

      {/* Spout / mouth — slight neck taper at the top */}
      <path
        d="M 6.5 4
           Q 6.5 2.5, 8 2.2
           L 16 2.2
           Q 17.5 2.5, 17.5 4"
        fill={MACHINE_BODY}
        stroke={POT_OUTLINE}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {/* Pot mouth opening — dark ellipse for depth */}
      <ellipse cx="12" cy="2.4" rx="4" ry="0.5" fill="#1E293B" opacity="0.75" />

      {/* Handle — D-shape on the chosen side */}
      {showHandleOnRight ? (
        <path
          d="M 17.5 7 C 22 7, 22 18, 17.5 18"
          stroke={POT_OUTLINE}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M 6.5 7 C 2 7, 2 18, 6.5 18"
          stroke={POT_OUTLINE}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Small canvas-style sack of coffee beans. Cinched top with a coffee
 *  bean label on the body. Rendered slightly tilted during pour. */
function BeansBagGlyph({
  className,
  tilted = false,
}: {
  className?: string;
  /** When true, the bag tilts forward as if pouring. */
  tilted?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 20"
      fill="none"
      role="img"
      aria-label="Bag of coffee beans"
      className={className ?? "w-4 h-5"}
      style={{ transform: tilted ? "rotate(-35deg)" : undefined, transformOrigin: "bottom center" }}
    >
      {/* Bag body — gathered rounded shape */}
      <path
        d="M 4 6
           Q 2 8, 2.5 12
           Q 3 17, 5 18
           L 11 18
           Q 13 17, 13.5 12
           Q 14 8, 12 6 Z"
        fill={BAG_BODY}
        stroke={BAG_OUTLINE}
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {/* Cinched top — narrow neck with a tied band */}
      <path
        d="M 5 6 L 4.5 4 Q 4.5 3, 5.5 3 L 10.5 3 Q 11.5 3, 11.5 4 L 11 6 Z"
        fill={BAG_BODY}
        stroke={BAG_OUTLINE}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Tie band */}
      <rect x="4.7" y="4.6" width="6.6" height="0.8" fill={BAG_OUTLINE} />
      {/* Coffee bean label — a single bean glyph centered on the body */}
      <ellipse
        cx="8"
        cy="12"
        rx="2.2"
        ry="3"
        fill={BAG_LABEL}
      />
      {/* Bean crease line */}
      <path
        d="M 8 9.2 Q 8.8 12, 8 14.8"
        stroke={BAG_BODY}
        strokeWidth="0.45"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Single coffee bean — small oval with a center crease. Used for the
 *  falling beans during the pour stage. */
function CoffeeBeanGlyph({
  size = 6,
  rotateDeg = 0,
}: {
  size?: number;
  rotateDeg?: number;
}) {
  return (
    <svg
      viewBox="0 0 8 6"
      width={size}
      height={size * 0.75}
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rotateDeg}deg)` }}
    >
      <ellipse cx="4" cy="3" rx="3.6" ry="2.6" fill={BEAN_COLOR} />
      <path
        d="M 4 0.6 Q 5 3, 4 5.4"
        stroke="#1E1107"
        strokeWidth="0.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Musical note glyph — used during the whistle/brew beat. Two variants
 *  (single and paired eighth notes), selectable via `variant`. */
function MusicalNoteGlyph({
  size = 14,
  variant = "single",
}: {
  size?: number;
  variant?: "single" | "paired";
}) {
  if (variant === "paired") {
    return (
      <svg
        viewBox="0 0 16 14"
        width={size * 1.15}
        height={size}
        fill="none"
        aria-hidden="true"
      >
        {/* Two stems with a connecting flag (♫) */}
        <ellipse cx="3" cy="11" rx="2.2" ry="1.6" fill={NOTE_COLOR} stroke={NOTE_STROKE} strokeWidth="0.5" />
        <ellipse cx="11" cy="11" rx="2.2" ry="1.6" fill={NOTE_COLOR} stroke={NOTE_STROKE} strokeWidth="0.5" />
        <line x1="5.1" y1="11" x2="5.1" y2="2" stroke={NOTE_STROKE} strokeWidth="1.1" strokeLinecap="round" />
        <line x1="13.1" y1="11" x2="13.1" y2="2" stroke={NOTE_STROKE} strokeWidth="1.1" strokeLinecap="round" />
        {/* Connecting flag/beam */}
        <path d="M 5.1 2 L 13.1 2 L 13.1 4 L 5.1 4 Z" fill={NOTE_STROKE} />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 10 14"
      width={size * 0.75}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      {/* Single eighth note (♪) — stem + flag */}
      <ellipse cx="3" cy="11" rx="2.2" ry="1.6" fill={NOTE_COLOR} stroke={NOTE_STROKE} strokeWidth="0.5" />
      <line x1="5.1" y1="11" x2="5.1" y2="2" stroke={NOTE_STROKE} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M 5.1 2 Q 8.5 4, 8 7" stroke={NOTE_STROKE} strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function BeakerBotCoffeeRefillScene({
  active,
  onComplete,
  enterFrom = "left",
  portalTarget,
}: BeakerBotCoffeeRefillSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<CoffeeRefillStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion. Listen for live changes since the
  // scene runs for ~13s and a mid-play toggle is uncommon but cheap.
  useEffect(() => {
    if (!active || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => {
      mql.removeEventListener?.("change", sync);
    };
  }, [active]);

  // Stage driver: chains setTimeouts through STAGE_ORDER, then fires
  // onComplete. Reduced-motion mode skips straight to "done" + dwells.
  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stage when scene deactivates so a re-activation restarts from "walkIn"
      setStage("idle");
      return;
    }

    if (reducedMotion) {
      setStage("done");
      const t = window.setTimeout(() => {
        onCompleteRef.current?.();
      }, REDUCED_MOTION_DURATION_MS);
      return () => window.clearTimeout(t);
    }

    const timers: number[] = [];
    let elapsed = 0;
    setStage(STAGE_ORDER[0]);
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      const prev = STAGE_ORDER[i - 1];
      elapsed += STAGE_DURATIONS[prev as keyof typeof STAGE_DURATIONS];
      const next = STAGE_ORDER[i];
      const handle = window.setTimeout(() => setStage(next), elapsed);
      timers.push(handle);
    }
    const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
    elapsed += STAGE_DURATIONS[lastStage as keyof typeof STAGE_DURATIONS];
    const doneHandle = window.setTimeout(() => {
      setStage("done");
      onCompleteRef.current?.();
    }, elapsed);
    timers.push(doneHandle);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [active, reducedMotion]);

  // Per-mount keyframe + gradient id suffix so multiple scene instances
  // don't share names. Same pattern as the other scenes.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbcr-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // to a center bench position next to the coffee machine, then exits
  // the opposite side carrying the pot.
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      botStartX: fromLeft ? "-20vw" : "120vw",
      botBenchX: "50vw",
      botExitX: fromLeft ? "120vw" : "-20vw",
      // Machine sits offset to the side BeakerBot walks toward (the
      // exit side) so he naturally tilts the bag over it.
      machineOffsetPx: fromLeft ? 56 : -56,
      facing: (fromLeft ? "right" : "left") as "left" | "right",
      sideSign: fromLeft ? 1 : -1,
      // Carried pot: handle faces away from BeakerBot's body during
      // walkOff (entry side, the way he came).
      handleOnRightDuringCarry: fromLeft,
    };
  }, [enterFrom]);

  // Default (prop omitted) keeps the global behavior: portal to body.
  // An explicit null means "target not live yet" so we render nothing.
  const portalRoot = portalTarget === undefined ? document.body : portalTarget;
  if (!active || !isClient || !portalRoot) return null;

  // ----- Stage-driven visual state -----

  // Pot is on the hot plate during all stages EXCEPT carryOff (when
  // BeakerBot lifts it) and done/idle. In reduced-motion "done", the
  // pot is held in hand for the proud-finished-pot tableau (handled by
  // the separate `potHeld` flag below — this branch already excludes
  // "done" via the explicit stage check).
  const potOnHotPlate =
    stage === "walkIn" ||
    stage === "pourBeans" ||
    stage === "setupComplete" ||
    stage === "brewing" ||
    stage === "ready";

  const potHeld =
    stage === "carryOff" || (reducedMotion && stage === "done");

  // Bag is visible while BeakerBot is holding/pouring it. After
  // setupComplete he sets it down (we don't bother drawing a discarded
  // bag — keeps the scene clean).
  const bagHeld =
    stage === "walkIn" || stage === "pourBeans" || stage === "setupComplete";
  const bagTilted = stage === "pourBeans";

  // Falling beans visible during pourBeans only.
  const beansFalling = stage === "pourBeans";

  // Machine LED on during brewing + ready (and reduced-motion tableau).
  const ledOn =
    stage === "brewing" ||
    stage === "ready" ||
    stage === "carryOff" ||
    (reducedMotion && stage === "done");

  // Drip stream from the machine nozzle into the pot — only during brewing.
  const dripVisible = stage === "brewing";

  // Pot fill ratio.
  //   walkIn / pourBeans / setupComplete: 0 (empty)
  //   brewing: animates from 0 → 0.95 over the 8s CSS transition
  //   ready / carryOff: 0.95 (full)
  //   done (rm): 0.95 (full proud-pot tableau)
  let potFillRatio = 0;
  switch (stage) {
    case "walkIn":
    case "pourBeans":
    case "setupComplete":
      potFillRatio = 0;
      break;
    case "brewing":
      // CSS transition handles the smooth 0 → 0.95 over the 8s window.
      potFillRatio = 0.95;
      break;
    case "ready":
    case "carryOff":
      potFillRatio = 0.95;
      break;
    case "done":
      potFillRatio = reducedMotion ? 0.95 : 0;
      break;
    default:
      potFillRatio = 0;
  }

  // Steam rises from the pot once it's full + hot (ready / carryOff /
  // reduced-motion tableau).
  const steamVisible =
    stage === "ready" ||
    stage === "carryOff" ||
    (reducedMotion && stage === "done");

  // Whistling musical notes drift up during brewing only (and in
  // reduced-motion, a single static note suggests the whistle).
  const notesAnimating = stage === "brewing";
  const notesStatic = reducedMotion && stage === "done";

  // Body sway loop during brewing (whistle while you work).
  const bodyWhistling = stage === "brewing";

  // BeakerBot pose by stage:
  //   walkIn / carryOff: idle (walking)
  //   pourBeans: pointing-down (tilted forward, focused on the machine top)
  //   setupComplete: idle (transitional, brief)
  //   brewing: idle with sway (waiting + whistling)
  //   ready: amazed (eyes wide — "finally, it's done!")
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
    case "carryOff":
      pose = "idle";
      break;
    case "pourBeans":
      pose = "pointing-down";
      break;
    case "setupComplete":
    case "brewing":
      pose = "idle";
      break;
    case "ready":
      pose = "amazed";
      break;
    case "done":
      pose = reducedMotion ? "amazed" : "idle";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position + per-stage body adjustments.
  let botTranslateX: string;
  let botBobPx = 0;
  let botLeanDeg = 0;
  let botLeanTranslateY = 0;
  switch (stage) {
    case "walkIn":
      botTranslateX = direction.botStartX;
      break;
    case "pourBeans":
      botTranslateX = direction.botBenchX;
      // Forward lean over the machine top.
      botLeanDeg = 6 * direction.sideSign;
      botLeanTranslateY = 2;
      break;
    case "setupComplete":
    case "brewing":
    case "ready":
      botTranslateX = direction.botBenchX;
      break;
    case "carryOff":
      botTranslateX = direction.botExitX;
      botBobPx = -1;
      break;
    case "done":
      botTranslateX = direction.botBenchX;
      break;
    default:
      botTranslateX = direction.botStartX;
  }

  // Transition timing per stage — slow on walkIn/carryOff/brewing,
  // snappier on the interaction beats.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "carryOff") transitionMs = STAGE_DURATIONS.carryOff;
  else if (stage === "pourBeans") transitionMs = STAGE_DURATIONS.pourBeans;

  // Bench-mounted machine + pot horizontal position.
  const machineTransform = `translate(calc(-50% + ${direction.machineOffsetPx}px), 0)`;

  // Pot sits centered on the machine's hot plate (same horizontal
  // origin as the machine).
  const potBenchTransform = `translate(calc(-50% + ${direction.machineOffsetPx}px), 0)`;

  return createPortal(
    <div
      data-testid="beakerbot-coffee-refill-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes for all per-stage motion. */}
      <style>{`
        @keyframes ${animSuffix}-pot-fill {
          0%   { transform: scaleY(0); }
          100% { transform: scaleY(1); }
        }
        @keyframes ${animSuffix}-drip-fall {
          0%   { opacity: 0; transform: translateY(0) scaleY(0.3); }
          30%  { opacity: 1; transform: translateY(8px) scaleY(1); }
          90%  { opacity: 1; transform: translateY(18px) scaleY(1); }
          100% { opacity: 0; transform: translateY(22px) scaleY(0.5); }
        }
        @keyframes ${animSuffix}-bean-fall {
          0%   { opacity: 0; transform: translate(var(--bbcr-bean-start-x), 0) rotate(0deg); }
          20%  { opacity: 1; transform: translate(var(--bbcr-bean-mid-x), 14px) rotate(180deg); }
          100% { opacity: 0; transform: translate(var(--bbcr-bean-end-x), 32px) rotate(360deg); }
        }
        @keyframes ${animSuffix}-note-drift {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6) rotate(-8deg); }
          15%  { opacity: 1; transform: translate(var(--bbcr-note-mid-x), -10px) scale(1) rotate(-4deg); }
          70%  { opacity: 0.9; transform: translate(var(--bbcr-note-end-x), -34px) scale(1.05) rotate(4deg); }
          100% { opacity: 0; transform: translate(var(--bbcr-note-end-x), -52px) scale(0.85) rotate(10deg); }
        }
        @keyframes ${animSuffix}-whistle-sway {
          0%, 100% { transform: rotate(-3deg); }
          50%      { transform: rotate(3deg); }
        }
        @keyframes ${animSuffix}-steam-rise {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          25%  { opacity: 0.75; transform: translate(0, -8px) scale(0.9); }
          70%  { opacity: 0.5; transform: translate(2px, -20px) scale(1.05); }
          100% { opacity: 0; transform: translate(4px, -32px) scale(1.2); }
        }
        @keyframes ${animSuffix}-led-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.65; }
        }
      `}</style>

      {/* COFFEE MACHINE — fixed on the bench. Always rendered (it's the
          centerpiece). LED state and the optional drip animate per
          stage; the machine itself stays put. */}
      <div
        data-testid="beakerbot-coffee-refill-scene-machine"
        style={{
          position: "absolute",
          left: direction.botBenchX,
          bottom: SCENE_GROUND_BOTTOM_CSS,
          transform: machineTransform,
          // 2.6x scale (28x32 → ~73x83), big enough to read as the
          // scene's anchor object.
          width: 72,
          height: 84,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            // LED-pulse during brewing.
            animation:
              stage === "brewing" && !reducedMotion
                ? `${animSuffix}-led-pulse 1400ms ease-in-out infinite`
                : undefined,
          }}
        >
          <CoffeeMachineGlyph
            className="w-[72px] h-[84px]"
            ledOn={ledOn}
          />
        </div>

        {/* DRIP STREAM — small brown droplets falling from the machine
            nozzle into the pot during brewing. Rendered as a single
            looping animated element sitting just under the nozzle. */}
        {dripVisible && (
          <div
            data-testid="beakerbot-coffee-refill-scene-drip"
            style={{
              position: "absolute",
              // Nozzle is at ~(14, 21) in the 28x32 viewBox → at this
              // scale, ~50% horizontal, ~55% vertical.
              left: "50%",
              top: "55%",
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          >
            {[0, 300, 600].map((delay, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: -1.5,
                  top: 0,
                  width: 3,
                  height: 10,
                  background: COFFEE_COLOR,
                  borderRadius: 1.5,
                  transformOrigin: "top center",
                  opacity: 0,
                  animation: `${animSuffix}-drip-fall 900ms ease-in ${delay}ms infinite`,
                }}
              />
            ))}
          </div>
        )}

        {/* FALLING BEANS — small bean glyphs cascading from the
            machine's top (hopper opening) during pourBeans. Each bean
            has slight horizontal drift via CSS vars so the column
            doesn't read as a single rigid stripe. */}
        {beansFalling && (
          <div
            data-testid="beakerbot-coffee-refill-scene-beans"
            style={{
              position: "absolute",
              // Hopper opening is at the very top of the machine
              // (viewBox y ≈ 1) — that's ~1.5% from top.
              left: "50%",
              top: "-4px",
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          >
            {[
              { startX: -2, midX: -1, endX: 0, delay: 0 },
              { startX: 1, midX: 2, endX: 3, delay: 120 },
              { startX: -3, midX: -2, endX: -1, delay: 280 },
              { startX: 2, midX: 1, endX: 0, delay: 440 },
              { startX: -1, midX: 0, endX: 1, delay: 620 },
              { startX: 0, midX: 1, endX: 2, delay: 820 },
            ].map((b, i) => (
              <div
                key={i}
                data-testid="beakerbot-coffee-refill-scene-bean"
                style={
                  {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    opacity: 0,
                    ["--bbcr-bean-start-x" as string]: `${b.startX}px`,
                    ["--bbcr-bean-mid-x" as string]: `${b.midX}px`,
                    ["--bbcr-bean-end-x" as string]: `${b.endX}px`,
                    animation: `${animSuffix}-bean-fall 600ms ease-in ${b.delay}ms forwards`,
                  } as React.CSSProperties
                }
              >
                <CoffeeBeanGlyph size={7} rotateDeg={i * 30} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* COFFEE POT — on the hot plate while not held. When held, it
          renders attached to BeakerBot below. */}
      {potOnHotPlate && (
        <div
          data-testid="beakerbot-coffee-refill-scene-pot-bench"
          style={{
            position: "absolute",
            left: direction.botBenchX,
            // Pot sits on the hot plate (which is at the very bottom of
            // the machine, ~3-4px above ground line).
            bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh + 2px)`,
            transform: potBenchTransform,
            // 2.3x scale (24x26 → ~56x60).
            width: 56,
            height: 60,
            pointerEvents: "none",
          }}
        >
          {/* Steam wisps once the pot is full + hot. */}
          {steamVisible && !reducedMotion && (
            <SteamWisps animSuffix={animSuffix} />
          )}
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {/* Static pot chrome — lid, handle, body silhouette, spout.
                Never transforms during brewing; only the liquid layer
                animates. (Bug fix: previously the entire pot SVG was
                scaled 0→1 during brewing, which made the lid + handle
                appear to grow inside the empty pot.) */}
            <CoffeePotGlyph
              className="w-14 h-[60px]"
              fillRatio={0}
              showHandleOnRight={direction.sideSign > 0}
              gradientId={`${animSuffix}-pot-bench-grad-empty`}
            />
            {/* Liquid-only overlay — a separate brown rect clipped to
                the pot's interior cavity. Animates its scaleY from
                0→1 (pivoting at the cavity bottom) over the brewing
                window, so only the liquid rises — no phantom lid or
                handle. */}
            {(stage === "brewing" || stage === "ready") && (
              <CoffeePotLiquidOverlay
                testId="beakerbot-coffee-refill-scene-pot-bench-liquid"
                animSuffix={animSuffix}
                gradientId={`${animSuffix}-pot-bench-liquid-grad`}
                clipId={`${animSuffix}-pot-bench-liquid-clip`}
                animating={stage === "brewing" && !reducedMotion}
                fillToFull={stage === "ready" || (stage === "brewing" && reducedMotion)}
              />
            )}
          </div>
        </div>
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage. */}
      <div
        data-testid="beakerbot-coffee-refill-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh - 4px)`,
          // Canonical scene scale — see BEAKERBOT_SCENE_SIZE_PX in
          // beakerbot/scene-constants.ts.
          width: BEAKERBOT_SCENE_SIZE_PX,
          height: BEAKERBOT_SCENE_SIZE_PX,
          transform: `translate(calc(${botTranslateX} - ${BEAKERBOT_SCENE_SIZE_PX / 2}px), ${botBobPx}px)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" || stage === "carryOff" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Body-lean wrapper — pivots from the bottom so the pour tilt
            reads as "leaning over the machine" rather than "falling". */}
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `rotate(${botLeanDeg}deg) translateY(${botLeanTranslateY}px)`,
            transformOrigin: "center bottom",
            transition: `transform ${transitionMs}ms ease-out`,
            position: "relative",
          }}
        >
          {/* Whistle-sway wrapper — gentle side-to-side rotation loop
              during brewing. Pivots from the bottom so feet stay
              planted while shoulders sway. */}
          <div
            style={{
              width: "100%",
              height: "100%",
              animation: bodyWhistling
                ? `${animSuffix}-whistle-sway 1000ms ease-in-out infinite`
                : undefined,
              transformOrigin: "center bottom",
            }}
          >
            <BeakerBot
              pose={pose}
              direction={direction.facing}
              className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
              ariaLabel="BeakerBot"
            />
          </div>

          {/* HELD BAG — attached to BeakerBot's hand during walkIn,
              pourBeans, and setupComplete. Positioned roughly where his
              arm extends in the idle / pointing-down poses. Tilts
              during pourBeans. */}
          {bagHeld && (
            <div
              data-testid="beakerbot-coffee-refill-scene-bag-held"
              style={{
                position: "absolute",
                // Bag held in front of his body, at roughly chest level.
                bottom: stage === "pourBeans" ? 84 : 56,
                left: "50%",
                transform: `translateX(-50%) translateX(${20 * direction.sideSign}px)`,
                transition: "bottom 250ms ease-out",
                // 2.2x scale (16x20 → ~36x44).
                width: 36,
                height: 44,
                pointerEvents: "none",
              }}
            >
              <BeansBagGlyph
                className="w-9 h-11"
                tilted={bagTilted}
              />
            </div>
          )}

          {/* HELD POT — attached to BeakerBot's hand during carryOff
              (and the reduced-motion proud-pot tableau). */}
          {potHeld && (
            <div
              data-testid="beakerbot-coffee-refill-scene-pot-held"
              style={{
                position: "absolute",
                bottom: 56,
                left: "50%",
                transform: `translateX(-50%) translateX(${
                  reducedMotion ? 0 : 14 * direction.sideSign
                }px)`,
                transition: "transform 300ms ease-out, bottom 300ms ease-out",
                // 2.3x scale (24x26 → ~56x60).
                width: 56,
                height: 60,
                pointerEvents: "none",
              }}
            >
              {/* Steam from the held hot pot. */}
              {steamVisible && !reducedMotion && (
                <SteamWisps animSuffix={animSuffix} />
              )}
              <CoffeePotGlyph
                className="w-14 h-[60px]"
                fillRatio={potFillRatio}
                showHandleOnRight={direction.handleOnRightDuringCarry}
                gradientId={`${animSuffix}-pot-held-grad`}
              />
            </div>
          )}

          {/* MUSICAL NOTES — drift up from BeakerBot's mouth area
              during brewing (and one static note in reduced-motion).
              Six notes total, staggered ~1.2s apart, alternating ♪/♫. */}
          {notesAnimating && (
            <div
              data-testid="beakerbot-coffee-refill-scene-notes"
              aria-hidden="true"
              style={{
                position: "absolute",
                // Mouth area is roughly upper-middle of the bot.
                // Notes drift up + to the side opposite his facing.
                top: 48,
                left: "50%",
                transform: `translateX(-50%) translateX(${-14 * direction.sideSign}px)`,
                pointerEvents: "none",
              }}
            >
              {[
                { variant: "single" as const, midX: -6, endX: -14, delay: 200, size: 14 },
                { variant: "paired" as const, midX: 4, endX: 10, delay: 1400, size: 16 },
                { variant: "single" as const, midX: -4, endX: -10, delay: 2700, size: 13 },
                { variant: "paired" as const, midX: 6, endX: 14, delay: 4000, size: 15 },
                { variant: "single" as const, midX: -5, endX: -12, delay: 5300, size: 14 },
                { variant: "paired" as const, midX: 3, endX: 9, delay: 6600, size: 16 },
              ].map((n, i) => (
                <div
                  key={i}
                  data-testid="beakerbot-coffee-refill-scene-note"
                  style={
                    {
                      position: "absolute",
                      left: 0,
                      top: 0,
                      opacity: 0,
                      transform: "translate(0, 0) scale(0.6)",
                      ["--bbcr-note-mid-x" as string]: `${n.midX * direction.sideSign}px`,
                      ["--bbcr-note-end-x" as string]: `${n.endX * direction.sideSign}px`,
                      animation: `${animSuffix}-note-drift 1500ms ease-out ${n.delay}ms forwards`,
                    } as React.CSSProperties
                  }
                >
                  <MusicalNoteGlyph size={n.size} variant={n.variant} />
                </div>
              ))}
            </div>
          )}

          {/* Static single note for the reduced-motion tableau —
              suggests the whistle without animating. */}
          {notesStatic && (
            <div
              data-testid="beakerbot-coffee-refill-scene-notes"
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 28,
                left: "50%",
                transform: `translateX(-50%) translateX(${-22 * direction.sideSign}px)`,
                pointerEvents: "none",
                opacity: 0.85,
              }}
            >
              <MusicalNoteGlyph size={16} variant="single" />
            </div>
          )}
        </div>
      </div>
    </div>,
    portalRoot,
  );
}

/** Three small steam wisps drifting straight up off the pot's mouth.
 *  Rendered as thin curved SVG paths with per-wisp delays so the
 *  column reads as continuous wisps, not a single puff. */
function SteamWisps({
  animSuffix,
}: {
  animSuffix: string;
}) {
  return (
    <div
      data-testid="beakerbot-coffee-refill-scene-steam"
      aria-hidden="true"
      style={{
        position: "absolute",
        // Wisps emerge from above the pot's mouth.
        left: "50%",
        top: -8,
        transform: "translateX(-50%)",
        width: 24,
        height: 32,
        pointerEvents: "none",
      }}
    >
      {[
        { left: -4, delay: 0 },
        { left: 2, delay: 250 },
        { left: 8, delay: 500 },
      ].map((w, i) => (
        <svg
          key={i}
          width="10"
          height="20"
          viewBox="0 0 10 20"
          fill="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: w.left + 6,
            top: 0,
            opacity: 0,
            animation: `${animSuffix}-steam-rise 1200ms ease-out ${w.delay}ms infinite`,
          }}
        >
          <path
            d="M 5 18 C 3 14, 7 12, 5 8 C 3 4, 7 2, 5 0"
            stroke={STEAM_COLOR}
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ))}
    </div>
  );
}

/** Liquid-only overlay that fills the coffee pot's interior cavity.
 *
 *  The parent renders the static pot chrome (lid, handle, body, spout)
 *  separately. This overlay sits on top at the same SVG coords and
 *  animates ONLY the brown liquid rect — clipped to the pot's interior
 *  cavity path — from empty to full via a bottom-anchored scaleY. The
 *  result: no phantom lid or handle "growing" inside the static pot.
 *
 *  Geometry matches `CoffeePotGlyph`'s interior:
 *    - viewBox: 24 × 26
 *    - cavity path: M 7 4 L 7 22 Q 7 24, 9 24 L 15 24 Q 17 24, 17 22 L 17 4 Z
 *    - liquid rect: x=7, y=4, width=10, height=20 (fills the full cavity)
 *    - transform-origin: 12 24 (bottom-center of the cavity)
 */
function CoffeePotLiquidOverlay({
  testId,
  animSuffix,
  gradientId,
  clipId,
  animating,
  fillToFull,
}: {
  testId?: string;
  animSuffix: string;
  /** Unique id for this overlay's gradient (so multiple instances coexist). */
  gradientId: string;
  /** Unique id for this overlay's clip path. */
  clipId: string;
  /** When true, run the 0→1 fill animation over the brewing window. */
  animating: boolean;
  /** When true, snap to full (no animation) — for the "ready" stage and
   *  reduced-motion brewing tableau. */
  fillToFull: boolean;
}) {
  return (
    <svg
      data-testid={testId}
      viewBox="0 0 24 26"
      fill="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COFFEE_HIGHLIGHT} />
          <stop offset="100%" stopColor={COFFEE_COLOR} />
        </linearGradient>
        {/* Pot interior cavity — matches CoffeePotGlyph's clip path. */}
        <clipPath id={clipId}>
          <path d="M 7 4 L 7 22 Q 7 24, 9 24 L 15 24 Q 17 24, 17 22 L 17 4 Z" />
        </clipPath>
      </defs>
      {/* Liquid rect at FULL fill, clipped to the cavity. Animated via
          scaleY pivoting at the cavity bottom — so only the liquid rises;
          the lid, handle, and spout (all part of the static pot below)
          are never inside this overlay. */}
      <rect
        x="7"
        y="4"
        width="10"
        height="20"
        fill={`url(#${gradientId})`}
        clipPath={`url(#${clipId})`}
        style={{
          transformBox: "fill-box",
          transformOrigin: "center bottom",
          transform: fillToFull ? "scaleY(1)" : "scaleY(0)",
          animation: animating
            ? `${animSuffix}-pot-fill ${STAGE_DURATIONS.brewing}ms linear forwards`
            : undefined,
        }}
      />
    </svg>
  );
}

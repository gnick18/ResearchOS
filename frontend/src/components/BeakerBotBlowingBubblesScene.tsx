"use client";

// frontend/src/components/BeakerBotBlowingBubblesScene.tsx
//
// Side easter-egg scene: BeakerBot walks in carrying a bubble wand,
// settles near the center of the viewport, and blows a stream of
// iridescent soap bubbles. Each bubble spawns at the wand tip, grows,
// detaches, then drifts upward + sideways with a slight sine-wobble.
// Bubbles can be CLICKED to pop them immediately, or they auto-pop
// after 3-4 seconds. This is the first BeakerBot scene with USER
// INTERACTIVITY: the bubble overlay exposes pointer-events so clicks
// register through the otherwise pointer-events:none scene wrapper.
//
// Built on the same skeleton as the other bench-style scenes:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none ON THE WRAPPER (keeps the rest of the app
//     interactive), but each bubble <g> opts BACK IN to pointerEvents:
//     "auto" so clicks can pop them.
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static fallback
//
// Stage timeline (~8000ms total in motion mode):
//   1. walkIn      0    → 600ms   (BeakerBot enters carrying the wand)
//   2. settle      600  → 900ms   (Stops near center, brief beat)
//   3. blowing     900  → 6900ms  (Main attraction — emits a bubble
//                                  every ~800ms while bobbing slightly)
//   4. settleDone  6900 → 7500ms  (Stops blowing, cheering pose +
//                                  wand raised in triumph)
//   5. exit        7500 → 8000ms  (Walks off the way he came; any
//                                  bubbles still on screen keep
//                                  floating + popping naturally)
//
// Reduced-motion fallback: render BeakerBot mid-blow with 3-4 bubbles
// frozen at staggered heights, no movement, no click interactivity.
// Hold 2000ms then fire onComplete.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import {
  BEAKERBOT_SCENE_SIZE_CLASS,
  BEAKERBOT_SCENE_SIZE_PX,
  SCENE_GROUND_BOTTOM_VH,
} from "./beakerbot/scene-constants";

export interface BeakerBotBlowingBubblesSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters. Default "right". */
  enterFrom?: "left" | "right";
}

/** Stage durations in ms. Kept as a const so tests can re-derive the
 *  total without hard-coding the sum. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  settle: 300,
  blowing: 6000,
  settleDone: 600,
  exit: 500,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.settle +
  STAGE_DURATIONS.blowing +
  STAGE_DURATIONS.settleDone +
  STAGE_DURATIONS.exit;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type BlowingBubblesStage =
  | "idle"
  | "walkIn"
  | "settle"
  | "blowing"
  | "settleDone"
  | "exit"
  | "done";

export const STAGE_ORDER: readonly BlowingBubblesStage[] = [
  "walkIn",
  "settle",
  "blowing",
  "settleDone",
  "exit",
] as const;

/** Z-index slot — matches BeakerBotEurekaScene + sibling scenes. */
const SCENE_Z_INDEX = 800;

/** Cap of simultaneously-floating bubbles. When a new bubble spawns
 *  past this, the OLDEST bubble is popped to make room. */
const MAX_BUBBLES_ON_SCREEN = 5;

/** Spawn cadence in ms while the blowing stage runs. */
const BUBBLE_SPAWN_INTERVAL_MS = 800;

/** Lifetime range (auto-pop age). Each bubble samples a uniform value
 *  in [min, max] at spawn so they don't all pop in lockstep. */
const BUBBLE_LIFETIME_MIN_MS = 3000;
const BUBBLE_LIFETIME_MAX_MS = 4000;

/** Pop-out animation duration (scale-fade after pop fires). After
 *  this elapses the bubble is fully removed from state. */
const POP_ANIMATION_MS = 300;

/** Bubble physics — vy is upward (negative), vx is horizontal drift.
 *  All values are in px/sec; the rAF loop integrates by elapsed dt. */
const BUBBLE_VY_MIN = -40; // fastest rise (most negative)
const BUBBLE_VY_MAX = -20; // slowest rise (least negative)
const BUBBLE_VX_RANGE = 10; // ±10 px/s horizontal drift
/** Wobble amplitude in px — bubbles oscillate sideways as they rise. */
const BUBBLE_WOBBLE_AMPLITUDE_PX = 6;
const BUBBLE_WOBBLE_FREQ_HZ = 0.7;

/** Bubble radius range (in px) at full size. Bubbles grow from 0 to
 *  their target radius during the spawn-grow phase. */
const BUBBLE_RADIUS_MIN = 8;
const BUBBLE_RADIUS_MAX = 12;

/** Duration of the spawn-grow phase (r=0 → r=target). */
const BUBBLE_GROW_MS = 400;

/** SSR-safe client detection — same pattern used by the other scenes. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Per-bubble runtime state. */
interface Bubble {
  id: number;
  /** px from left of viewport */
  x: number;
  /** px from top of viewport */
  y: number;
  /** spawn-baseline x — sine-wobble oscillates around this */
  baseX: number;
  /** px/sec horizontal drift (the wobble layers on top of this) */
  vx: number;
  /** px/sec upward (negative) */
  vy: number;
  /** target radius once fully grown */
  targetR: number;
  /** ms timestamp when the bubble spawned */
  spawnedAt: number;
  /** ms lifetime — auto-pops at age >= lifetime */
  lifetimeMs: number;
  /** false: still floating. true: popping (scale-fade in progress). */
  popped: boolean;
  /** ms timestamp when the pop began (only meaningful when popped). */
  poppedAt: number | null;
}

/** Bubble wand glyph — handle + soapy ring at the tip. The bot holds
 *  the bottom of the handle. Width 12, height 24. */
function BubbleWand({
  width = 12,
  height = 24,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 24"
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Handle — thin vertical rod, warm brown */}
      <rect x="5" y="6" width="2" height="18" rx="0.6" fill="#8B6F47" />
      {/* Soapy ring at the tip — thin sky-cyan stroke suggests a wet
          soap film. Faint interior fill hints at iridescence. */}
      <circle
        cx="6"
        cy="4"
        r="3.5"
        fill="rgba(186,230,253,0.25)"
        stroke="#7DD3FC"
        strokeWidth="0.7"
      />
      {/* Tiny highlight on the ring */}
      <circle cx="4.7" cy="2.8" r="0.5" fill="white" opacity="0.85" />
    </svg>
  );
}

/** Single bubble inner SVG content. Iridescent rim + specular
 *  highlights. The wrapping <g> (rendered by the parent) handles the
 *  translate + scale + click. */
function BubbleGlyph({
  bubble,
  gradientIdBase,
}: {
  bubble: Bubble;
  gradientIdBase: string;
}) {
  // Per-bubble gradient id so each bubble has its own gradient stop
  // chain (no SVG def collisions when many bubbles share the parent
  // <svg>). The bubble id is stable + unique within this scene mount.
  const gradId = `${gradientIdBase}-${bubble.id}`;
  return (
    <>
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="70%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="85%" stopColor="rgba(255,182,193,0.45)" />
          <stop offset="95%" stopColor="rgba(186,160,232,0.55)" />
          <stop offset="100%" stopColor="rgba(125,211,252,0.85)" />
        </radialGradient>
      </defs>
      {/* Invisible hit pad — a bit bigger than the bubble so clicks
          register without the user needing to be pixel-precise. */}
      <circle cx="0" cy="0" r={Math.max(14, bubble.targetR + 6)} fill="transparent" />
      {/* Bubble body */}
      <circle
        cx="0"
        cy="0"
        r={bubble.targetR}
        fill={`url(#${gradId})`}
        stroke="rgba(186,160,232,0.65)"
        strokeWidth="0.6"
      />
      {/* Specular highlight — small white ellipse upper-left */}
      <ellipse
        cx={-bubble.targetR * 0.35}
        cy={-bubble.targetR * 0.4}
        rx={bubble.targetR * 0.22}
        ry={bubble.targetR * 0.14}
        fill="white"
        opacity="0.85"
        transform={`rotate(-30 ${-bubble.targetR * 0.35} ${-bubble.targetR * 0.4})`}
      />
      {/* Smaller secondary highlight */}
      <ellipse
        cx={bubble.targetR * 0.25}
        cy={-bubble.targetR * 0.45}
        rx={bubble.targetR * 0.08}
        ry={bubble.targetR * 0.05}
        fill="white"
        opacity="0.7"
      />
    </>
  );
}

export default function BeakerBotBlowingBubblesScene({
  active,
  onComplete,
  enterFrom = "right",
}: BeakerBotBlowingBubblesSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<BlowingBubblesStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion.
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
      setBubbles([]);
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

  // Per-mount keyframe id suffix so multiple scene instances don't
  // share animation names. Also drives the per-bubble gradient id.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbbb-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );
  const bubbleGradId = `${animSuffix}-bubble-grad`;

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // toward the center, settles, blows bubbles, and exits the SAME
  // side he came in from.
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      beakerStartX: fromLeft ? "-20vw" : "120vw",
      beakerSettleX: "50vw",
      // BeakerBot faces toward viewport center while blowing — the
      // facing direction is the opposite of entry direction.
      facing: (fromLeft ? "right" : "left") as "left" | "right",
      sideSign: fromLeft ? 1 : -1,
    };
  }, [enterFrom]);

  // Compute the wand tip position in viewport px so newly-spawned
  // bubbles emerge from there. Recomputed on resize. We assume a
  // center-mounted bot on a vw-based settle position.
  const computeWandTipPos = useCallback(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // BeakerBot center is at 50vw. The wand is held mid-body and its
    // tip sits a bit above the bot's mouth (mid-upper body level).
    const feetY = vh - (vh * SCENE_GROUND_BOTTOM_VH) / 100;
    const wandTipY = feetY - 84; // approximate mouth height
    const wandTipX = vw * 0.5 + direction.sideSign * 18;
    return { x: wandTipX, y: wandTipY };
  }, [direction.sideSign]);

  const wandTipPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    wandTipPosRef.current = computeWandTipPos();
    if (typeof window === "undefined") return;
    const onResize = () => {
      wandTipPosRef.current = computeWandTipPos();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [computeWandTipPos]);

  // Bubble id allocator — incremented every spawn. Ref keeps it
  // stable across renders.
  const nextBubbleIdRef = useRef(1);

  /** Sample a fresh bubble with randomized physics + lifetime. */
  const sampleBubble = useCallback(
    (now: number, originX: number, originY: number): Bubble => {
      const id = nextBubbleIdRef.current++;
      // vy in [BUBBLE_VY_MIN, BUBBLE_VY_MAX]. Both are negative; min
      // is the most-negative (fastest rise).
      const vy =
        BUBBLE_VY_MIN + Math.random() * (BUBBLE_VY_MAX - BUBBLE_VY_MIN);
      const vx = (Math.random() * 2 - 1) * BUBBLE_VX_RANGE;
      const targetR =
        BUBBLE_RADIUS_MIN +
        Math.random() * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);
      const lifetimeMs =
        BUBBLE_LIFETIME_MIN_MS +
        Math.random() * (BUBBLE_LIFETIME_MAX_MS - BUBBLE_LIFETIME_MIN_MS);
      return {
        id,
        x: originX,
        y: originY,
        baseX: originX,
        vx,
        vy,
        targetR,
        spawnedAt: now,
        lifetimeMs,
        popped: false,
        poppedAt: null,
      };
    },
    [],
  );

  /** Pop a bubble by id. Sets popped=true + poppedAt=now; the rAF
   *  loop removes it from state once POP_ANIMATION_MS elapses. */
  const popBubble = useCallback((id: number) => {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === id && !b.popped ? { ...b, popped: true, poppedAt: now } : b,
      ),
    );
  }, []);

  // Bubble spawner: while in "blowing" stage, push a new bubble every
  // BUBBLE_SPAWN_INTERVAL_MS. After the blowing stage ends, existing
  // bubbles keep floating; we just stop spawning.
  useEffect(() => {
    if (reducedMotion) return;
    if (stage !== "blowing") return;
    const spawn = () => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const { x, y } = wandTipPosRef.current;
      setBubbles((prev) => {
        // Cap-and-drop-oldest: if we're at the cap, force the OLDEST
        // non-popped bubble to start popping so the new one fits.
        const next = [...prev];
        const liveCount = next.filter((b) => !b.popped).length;
        if (liveCount >= MAX_BUBBLES_ON_SCREEN) {
          let oldestIdx = -1;
          let oldestT = Infinity;
          for (let i = 0; i < next.length; i++) {
            const b = next[i]!;
            if (!b.popped && b.spawnedAt < oldestT) {
              oldestT = b.spawnedAt;
              oldestIdx = i;
            }
          }
          if (oldestIdx >= 0) {
            next[oldestIdx] = {
              ...next[oldestIdx]!,
              popped: true,
              poppedAt: now,
            };
          }
        }
        next.push(sampleBubble(now, x, y));
        return next;
      });
    };
    // Spawn one immediately so the first bubble doesn't take 800ms.
    spawn();
    const handle = window.setInterval(spawn, BUBBLE_SPAWN_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [stage, reducedMotion, sampleBubble]);

  // rAF physics loop: while ANY bubbles exist (even past the blowing
  // stage), integrate positions + check auto-pop lifetimes + drop
  // fully-popped bubbles after the pop animation completes.
  const hasBubbles = bubbles.length > 0;
  useEffect(() => {
    if (reducedMotion) return;
    if (!hasBubbles) return;
    if (typeof window === "undefined") return;
    let rafHandle = 0;
    let lastT = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      setBubbles((prev) => {
        if (prev.length === 0) return prev;
        const next: Bubble[] = [];
        for (const b of prev) {
          if (b.popped) {
            // Drop bubbles whose pop animation has finished.
            if (b.poppedAt !== null && now - b.poppedAt >= POP_ANIMATION_MS) {
              continue;
            }
            next.push(b);
            continue;
          }
          // Live bubble: integrate position + check age.
          const age = now - b.spawnedAt;
          if (age >= b.lifetimeMs) {
            // Auto-pop on lifetime hit.
            next.push({ ...b, popped: true, poppedAt: now });
            continue;
          }
          // Integrate horizontal drift + apply sine wobble. Integrate
          // vy directly into y.
          const newBaseX = b.baseX + b.vx * dt;
          const ageSec = age / 1000;
          const wobble =
            BUBBLE_WOBBLE_AMPLITUDE_PX *
            Math.sin(ageSec * BUBBLE_WOBBLE_FREQ_HZ * 2 * Math.PI);
          const newX = newBaseX + wobble;
          const newY = b.y + b.vy * dt;
          next.push({ ...b, x: newX, y: newY, baseX: newBaseX });
        }
        return next;
      });
      rafHandle = window.requestAnimationFrame(step);
    };
    rafHandle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafHandle);
  }, [hasBubbles, reducedMotion]);

  // Reduced-motion: synthesize a static tableau of 4 bubbles at
  // staggered heights when we enter the reduced-motion "done" stage.
  useEffect(() => {
    if (!reducedMotion || stage !== "done" || !active) return;
    if (typeof window === "undefined") return;
    const { x: tipX, y: tipY } = computeWandTipPos();
    const tableau: Bubble[] = [
      {
        id: 1001,
        x: tipX - 12,
        y: tipY - 30,
        baseX: tipX - 12,
        vx: 0,
        vy: 0,
        targetR: 10,
        spawnedAt: 0,
        lifetimeMs: Infinity,
        popped: false,
        poppedAt: null,
      },
      {
        id: 1002,
        x: tipX + 8,
        y: tipY - 70,
        baseX: tipX + 8,
        vx: 0,
        vy: 0,
        targetR: 8,
        spawnedAt: 0,
        lifetimeMs: Infinity,
        popped: false,
        poppedAt: null,
      },
      {
        id: 1003,
        x: tipX - 4,
        y: tipY - 110,
        baseX: tipX - 4,
        vx: 0,
        vy: 0,
        targetR: 12,
        spawnedAt: 0,
        lifetimeMs: Infinity,
        popped: false,
        poppedAt: null,
      },
      {
        id: 1004,
        x: tipX + 16,
        y: tipY - 150,
        baseX: tipX + 16,
        vx: 0,
        vy: 0,
        targetR: 9,
        spawnedAt: 0,
        lifetimeMs: Infinity,
        popped: false,
        poppedAt: null,
      },
    ];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot population of the reduced-motion tableau when the scene enters its done state
    setBubbles(tableau);
  }, [reducedMotion, stage, active, computeWandTipPos]);

  if (!active || !isClient) return null;

  // ----- Stage-driven visual state -----

  // BeakerBot pose by stage:
  //   - walkIn / settle / blowing / exit: idle (walking + blowing).
  //     We reuse idle for blowing; a subtle body-bob keyframe layered
  //     on top mimics breath cadence.
  //   - settleDone / done (reduced-motion): cheering (wand raised in
  //     triumph at end of the act).
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
    case "settle":
    case "blowing":
    case "exit":
      pose = "idle";
      break;
    case "settleDone":
      pose = "cheering";
      break;
    case "done":
      pose = "idle";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position by stage.
  let beakerTranslateX: string;
  switch (stage) {
    case "walkIn":
      beakerTranslateX = direction.beakerStartX;
      break;
    case "settle":
    case "blowing":
    case "settleDone":
      beakerTranslateX = direction.beakerSettleX;
      break;
    case "exit":
      beakerTranslateX = direction.beakerStartX;
      break;
    case "done":
      // Reduced-motion tableau parks him at the settle position.
      beakerTranslateX = reducedMotion
        ? direction.beakerSettleX
        : direction.beakerStartX;
      break;
    default:
      beakerTranslateX = direction.beakerStartX;
  }

  // Transition timing per stage.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "exit") transitionMs = STAGE_DURATIONS.exit;
  else if (stage === "settleDone") transitionMs = STAGE_DURATIONS.settleDone;

  // The wand is visible the whole scene (he carries it in + out). He
  // raises it during settleDone (and during the reduced-motion
  // tableau).
  const wandRaised = stage === "settleDone" || (reducedMotion && stage === "done");

  // Body-bob (breathing) is active during the blowing stage only.
  const breathing = stage === "blowing";

  // The bubbles overlay is visible whenever we have any bubbles in
  // state — that includes after blowing ends (lingering bubbles).
  const bubblesVisible = bubbles.length > 0;

  // For positioning the bubble <g>'s pop-animation transform-origin we
  // need a stable, per-bubble computed value below. The rAF loop
  // updates `x`/`y` continuously; using them directly in transform-
  // origin is fine because the popping <g> stops being repositioned
  // (popped bubbles freeze in place once they start popping).
  return createPortal(
    <div
      data-testid="beakerbot-blowing-bubbles-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-bubble-count={bubbles.filter((b) => !b.popped).length}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        // Default to pointer-events: none so the rest of the app
        // stays interactive. Individual bubbles opt back IN via their
        // own pointer-events: auto on the <g> wrapper.
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes for the body breath-bob, per-bubble
          spawn-grow, and pop-out scale-fade. */}
      <style>{`
        @keyframes ${animSuffix}-breath {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        @keyframes ${animSuffix}-bubble-grow {
          0%   { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes ${animSuffix}-bubble-pop {
          0%   { transform: scale(1); opacity: 1; }
          40%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0); opacity: 0; }
        }
      `}</style>

      {/* BUBBLES — rendered as a single SVG overlaying the whole
          viewport. Each bubble is a <g> with its own onClick to pop
          itself. pointer-events: auto on the <g>; the wrapping <svg>
          stays pointer-events: none so empty regions remain
          click-through. */}
      {bubblesVisible && (
        <svg
          data-testid="beakerbot-blowing-bubbles-scene-bubble-layer"
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {bubbles.map((bubble) => {
            const popping = bubble.popped;
            // The outer <g> handles the moving translate (driven by
            // the rAF loop). The inner <g> handles the per-bubble
            // grow + pop scale-fade via CSS keyframes — so we don't
            // need to compute time-based scale during render. The
            // grow keyframe runs once at mount; the pop keyframe
            // takes over when `popping` flips true.
            return (
              <g
                key={bubble.id}
                data-testid="beakerbot-blowing-bubbles-scene-bubble"
                data-bubble-id={bubble.id}
                data-popping={popping ? "true" : "false"}
                transform={`translate(${bubble.x} ${bubble.y})`}
                style={{
                  // CRITICAL: opt this bubble back IN to pointer
                  // events. The scene wrapper sets pointer-events:
                  // none so the rest of the app stays interactive;
                  // bubbles are the one exception so the user can
                  // click to pop them. Popping bubbles disable input
                  // again so a second click doesn't re-fire.
                  pointerEvents: popping ? "none" : "auto",
                  cursor: popping ? "default" : "pointer",
                }}
                onClick={() => popBubble(bubble.id)}
              >
                <g
                  style={{
                    // In reduced-motion mode we hold the static
                    // tableau at scale 1 (no animation). In motion
                    // mode the grow keyframe runs once on mount,
                    // then the pop keyframe takes over on click /
                    // auto-pop and overrides the static scale.
                    transformOrigin: "0 0",
                    animation: reducedMotion
                      ? undefined
                      : popping
                        ? `${animSuffix}-bubble-pop ${POP_ANIMATION_MS}ms ease-out forwards`
                        : `${animSuffix}-bubble-grow ${BUBBLE_GROW_MS}ms ease-out forwards`,
                  }}
                >
                  <BubbleGlyph
                    bubble={bubble}
                    gradientIdBase={bubbleGradId}
                  />
                </g>
              </g>
            );
          })}
        </svg>
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage.
          Holds the wand in his hand on the facing side. */}
      <div
        data-testid="beakerbot-blowing-bubbles-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh - 4px)`,
          // Canonical scene scale — see BEAKERBOT_SCENE_SIZE_PX in
          // beakerbot/scene-constants.ts.
          width: BEAKERBOT_SCENE_SIZE_PX,
          height: BEAKERBOT_SCENE_SIZE_PX,
          transform: `translate(calc(${beakerTranslateX} - ${BEAKERBOT_SCENE_SIZE_PX / 2}px), 0)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" || stage === "exit" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Body breath-bob wrapper — gentle Y oscillation during the
            blowing stage, mimicking breath cadence. */}
        <div
          data-testid="beakerbot-blowing-bubbles-scene-bot-breath"
          style={{
            width: "100%",
            height: "100%",
            animation:
              breathing && !reducedMotion
                ? `${animSuffix}-breath 700ms ease-in-out infinite`
                : undefined,
            position: "relative",
          }}
        >
          <BeakerBot
            pose={pose}
            direction={direction.facing}
            className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
            ariaLabel="BeakerBot"
          />

          {/* WAND — anchored in front of the bot's body on the facing
              side. Pivots when raised at settleDone. */}
          <div
            data-testid="beakerbot-blowing-bubbles-scene-wand"
            style={{
              position: "absolute",
              // Hand sits ~mid-body on the facing side. The 128x128
              // bot frame: hand is roughly at (50% ± 18px,
              // ~50px from top).
              left: `calc(50% + ${direction.sideSign * 18}px)`,
              top: 50,
              width: 12,
              height: 24,
              transformOrigin: "50% 100%",
              transform: wandRaised
                ? "rotate(-15deg) translateY(-6px)"
                : "rotate(0deg) translateY(0)",
              transition: "transform 300ms ease-out",
              pointerEvents: "none",
            }}
          >
            <BubbleWand width={12} height={24} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

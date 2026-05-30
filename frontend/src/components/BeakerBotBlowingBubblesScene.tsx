"use client";

// frontend/src/components/BeakerBotBlowingBubblesScene.tsx
//
// Side easter-egg scene: BeakerBot walks in carrying a bubble wand,
// settles on the LEFT side of the viewport, and blows a stream of
// iridescent soap bubbles RIGHTWARD across the screen. He holds the
// wand off to his right side with one extended arm; the other arm
// rests against the body silhouette (not drawn). Each bubble spawns
// at the wand tip with HIGHLY randomized physics (variable rise speed,
// horizontal drift direction, wobble amp + frequency) and drifts
// across a large portion of the viewport before auto-popping. Bubbles
// can be CLICKED to pop them immediately, or they auto-pop after
// 6-8 seconds. Each new bubble spawn fires a small wind-gust puff
// from BeakerBot's mouth toward the wand, suggesting blowing.
// This is the first BeakerBot scene with USER INTERACTIVITY: the
// bubble overlay exposes pointer-events so clicks register through
// the otherwise pointer-events:none scene wrapper.
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
  /** Where the scene's full-screen portal mounts. Defaults to
   *  document.body (the global easter-egg behavior, unchanged). The
   *  showcase Scenes view passes its scaled in-frame viewport so the
   *  scene plays inside the fixed window. When explicitly null the scene
   *  renders nothing (the target is not live yet). */
  portalTarget?: HTMLElement | null;
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
 *  in [min, max] at spawn so they don't all pop in lockstep. Extended
 *  to 6-8s (was 3-4s) so bubbles travel a large portion of the
 *  viewport before vanishing — they spawn on the LEFT (at BeakerBot's
 *  wand) and need time to drift across to the right + up. */
const BUBBLE_LIFETIME_MIN_MS = 6000;
const BUBBLE_LIFETIME_MAX_MS = 8000;

/** Pop-out animation duration (scale-fade after pop fires). After
 *  this elapses the bubble is fully removed from state. */
const POP_ANIMATION_MS = 300;

/** Bubble physics — vy is upward (negative), vx is horizontal drift.
 *  All values are in px/sec; the rAF loop integrates by elapsed dt.
 *  Cranked up (was -40..-20 / ±10) so bubbles cover ground from the
 *  left-side wand position out across the viewport. */
const BUBBLE_VY_MIN = -90; // fastest rise (most negative)
const BUBBLE_VY_MAX = -30; // slowest rise (least negative)
/** ±range px/s horizontal drift. With bot on the LEFT and wand
 *  emitting rightward, biased rightward is fine but we keep a full
 *  ±range so some bubbles drift left, some right, some hold steady. */
const BUBBLE_VX_RANGE = 60;
/** Wobble amplitude RANGE in px — per-bubble random value in
 *  [min, max] so some wobble tight, others swing wide. */
const BUBBLE_WOBBLE_AMP_MIN_PX = 3;
const BUBBLE_WOBBLE_AMP_MAX_PX = 22;
/** Wobble frequency RANGE in Hz — per-bubble random value so some
 *  wobble fast, others slow. */
const BUBBLE_WOBBLE_FREQ_MIN_HZ = 0.25;
const BUBBLE_WOBBLE_FREQ_MAX_HZ = 1.2;
/** Wobble phase offset RANGE in radians — per-bubble random so two
 *  bubbles spawned at the same moment don't sway in lockstep. */
const BUBBLE_WOBBLE_PHASE_MAX = Math.PI * 2;

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

/** Per-bubble runtime state. EVERY visible-physics parameter is
 *  sampled per-bubble at spawn so two bubbles spawned at the same
 *  moment look visibly distinct: different rise speed, drift
 *  direction, wobble shape, baseline rotation. */
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
  /** Per-bubble sine wobble amplitude in px (random per spawn). */
  wobbleAmpPx: number;
  /** Per-bubble sine wobble frequency in Hz (random per spawn). */
  wobbleFreqHz: number;
  /** Per-bubble sine wobble phase offset in radians (random per spawn)
   *  so wobble shapes don't align across simultaneously-spawned
   *  bubbles. */
  wobblePhase: number;
  /** Per-bubble base rotation (deg) — visual variety, applied to the
   *  inner <g> so the specular highlights land in different positions
   *  across the stream of bubbles. */
  baseRotationDeg: number;
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
  portalTarget,
}: BeakerBotBlowingBubblesSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<BlowingBubblesStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  /** Increments on each bubble spawn during the blowing stage. Drives
   *  the wind-gust puff icon: a key bump re-mounts the puff element so
   *  its quick opacity-0→1→0 keyframe re-fires from frame zero. The
   *  puff renders only while > 0 AND we're in blowing stage. */
  const [puffSpawnKey, setPuffSpawnKey] = useState(0);

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
  // to his LEFT-side settle position (12vw), blows bubbles toward the
  // open right side of the viewport, then exits the same side he came
  // in from. The bot always FACES RIGHT at settle so the wand-bearing
  // arm extends out across the open viewport regardless of which side
  // he entered from. The wand is offset +44px from the body center
  // (held at the end of an extended right arm) so the emission
  // origin is clearly off to the side, not in front of the body.
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      beakerStartX: fromLeft ? "-20vw" : "120vw",
      // LEFT-side settle so the bot has a wide open viewport on his
      // right to blow bubbles into.
      beakerSettleX: "12vw",
      // Always face right at settle so the wand sticks out toward the
      // open viewport regardless of entry direction.
      facing: "right" as "left" | "right",
      // sideSign drives wand + arm positioning: always +1 (right side)
      // so the wand is held off to the right.
      sideSign: 1,
    };
  }, [enterFrom]);

  /** Horizontal offset (px from the bot's body center) where the wand
   *  is held — out at arm's length, not next to the body. This is the
   *  ONE source of truth for "where is the wand in bot-local coords"
   *  shared by the wand transform, the arm bezier, and the wand-tip
   *  spawn origin. */
  const WAND_HAND_OFFSET_PX = 44;

  // Compute the wand tip position in viewport px so newly-spawned
  // bubbles emerge from there. Recomputed on resize. The bot's
  // body-center sits at `beakerSettleX` (12vw). The wand is held at
  // hand position (offset from body) and its tip sits roughly at
  // mouth-height (~84px above the feet line). When the wand is
  // angled ~30deg upward, the tip ends up a bit higher and a bit
  // outward from the hand; the small extra dx + dy below approximate
  // that tilt so bubbles spawn at the ring of the wand, not the hand.
  const computeWandTipPos = useCallback(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const feetY = vh - (vh * SCENE_GROUND_BOTTOM_VH) / 100;
    // Body center sits at 12vw; the wand-bearing hand is +44px out;
    // the wand tilts ~30deg above horizontal so the soapy-ring tip
    // ends up further outward (~+14px) AND up (~-8px) from the hand.
    const handX = vw * 0.12 + direction.sideSign * WAND_HAND_OFFSET_PX;
    const handY = feetY - 70; // hand height (mid-upper body)
    const wandTipX = handX + direction.sideSign * 14;
    const wandTipY = handY - 8;
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

  /** Sample a fresh bubble with HIGHLY randomized physics + lifetime.
   *  Every visible physics parameter is sampled per-bubble so a stream
   *  of bubbles looks like individuals (different rise speeds, drift
   *  directions, wobble shapes, rotation tumble) rather than a uniform
   *  conveyor belt. */
  const sampleBubble = useCallback(
    (now: number, originX: number, originY: number): Bubble => {
      const id = nextBubbleIdRef.current++;
      // vy in [BUBBLE_VY_MIN, BUBBLE_VY_MAX]. Both are negative; min
      // is the most-negative (fastest rise). Each bubble picks its own
      // rise speed so some race upward, others linger.
      const vy =
        BUBBLE_VY_MIN + Math.random() * (BUBBLE_VY_MAX - BUBBLE_VY_MIN);
      // Horizontal drift in [-VX_RANGE, +VX_RANGE]. Even bias around 0
      // so some bubbles drift left, some right, some hold steady — but
      // because the bot sits on the LEFT with the wand emitting
      // rightward, even bubbles that pick a small negative vx still
      // drift broadly across the open viewport to the right.
      const vx = (Math.random() * 2 - 1) * BUBBLE_VX_RANGE;
      const targetR =
        BUBBLE_RADIUS_MIN +
        Math.random() * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);
      const lifetimeMs =
        BUBBLE_LIFETIME_MIN_MS +
        Math.random() * (BUBBLE_LIFETIME_MAX_MS - BUBBLE_LIFETIME_MIN_MS);
      const wobbleAmpPx =
        BUBBLE_WOBBLE_AMP_MIN_PX +
        Math.random() * (BUBBLE_WOBBLE_AMP_MAX_PX - BUBBLE_WOBBLE_AMP_MIN_PX);
      const wobbleFreqHz =
        BUBBLE_WOBBLE_FREQ_MIN_HZ +
        Math.random() *
          (BUBBLE_WOBBLE_FREQ_MAX_HZ - BUBBLE_WOBBLE_FREQ_MIN_HZ);
      const wobblePhase = Math.random() * BUBBLE_WOBBLE_PHASE_MAX;
      const baseRotationDeg = Math.random() * 360;
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
        wobbleAmpPx,
        wobbleFreqHz,
        wobblePhase,
        baseRotationDeg,
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
      // Bump puff key so the wind-gust puff re-mounts + replays its
      // quick opacity-0→1→0 keyframe with this new bubble's spawn.
      setPuffSpawnKey((k) => k + 1);
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
          // Integrate horizontal drift + apply PER-BUBBLE sine wobble
          // (amp + frequency + phase all sampled at spawn so each
          // bubble has its own oscillation signature). Integrate vy
          // directly into y.
          const newBaseX = b.baseX + b.vx * dt;
          const ageSec = age / 1000;
          const wobble =
            b.wobbleAmpPx *
            Math.sin(
              ageSec * b.wobbleFreqHz * 2 * Math.PI + b.wobblePhase,
            );
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
    // Reduced-motion tableau: 4 static bubbles arranged in a fan
    // RIGHTWARD + UPWARD from the wand tip (since the bot sits on the
    // left and bubbles travel out across the open viewport). Each has
    // the new wobble/rotation fields populated with zeros so the
    // type-check passes; they're never read in reduced-motion mode
    // because the rAF loop is gated off.
    const staticBubble = (
      id: number,
      dx: number,
      dy: number,
      r: number,
    ): Bubble => ({
      id,
      x: tipX + dx,
      y: tipY + dy,
      baseX: tipX + dx,
      vx: 0,
      vy: 0,
      targetR: r,
      spawnedAt: 0,
      lifetimeMs: Infinity,
      popped: false,
      poppedAt: null,
      wobbleAmpPx: 0,
      wobbleFreqHz: 0,
      wobblePhase: 0,
      baseRotationDeg: 0,
    });
    const tableau: Bubble[] = [
      staticBubble(1001, 12, -30, 10),
      staticBubble(1002, 48, -70, 8),
      staticBubble(1003, 90, -110, 12),
      staticBubble(1004, 140, -150, 9),
    ];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot population of the reduced-motion tableau when the scene enters its done state
    setBubbles(tableau);
  }, [reducedMotion, stage, active, computeWandTipPos]);

  // Default (prop omitted) keeps the global behavior: portal to body.
  // An explicit null means "target not live yet" so we render nothing.
  const portalRoot =
    typeof document === "undefined"
      ? null
      : portalTarget === undefined
        ? document.body
        : portalTarget;
  if (!active || !isClient || !portalRoot) return null;

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
          spawn-grow, pop-out scale-fade, and the wind-gust puff that
          fires when each bubble spawns. */}
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
        /* Wind-gust puff: each puff arc starts at the bot's mouth and
           drifts a short distance outward toward the wand while fading
           in then back out, suggesting a quick exhale. The translate
           direction is set inline via custom-prop --puff-dx because it
           depends on the bot's facing direction (always right in this
           polished version). */
        @keyframes ${animSuffix}-puff {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          30%  { opacity: 0.85; }
          100% { opacity: 0; transform: translate(var(--puff-dx, 14px), var(--puff-dy, -2px)) scale(1.15); }
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
                // Pop the instant the cursor runs over the bubble (no click
                // needed). onClick is kept so a tap still pops on touch, where
                // there is no hover.
                onMouseEnter={() => popBubble(bubble.id)}
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
                  {/* Per-bubble rotation wrapper — applies a static
                      baseline rotation sampled at spawn so the
                      specular highlights aren't aligned across the
                      stream of bubbles. */}
                  <g transform={`rotate(${bubble.baseRotationDeg})`}>
                    <BubbleGlyph
                      bubble={bubble}
                      gradientIdBase={bubbleGradId}
                    />
                  </g>
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

          {/* ARM + WAND — BeakerBot extends his RIGHT arm out to the
              side, holding the bubble wand at the end. The arm is a
              small inline SVG (a single stroked line from the body's
              shoulder area out to the wand hand), the wand sits at
              the end of the arm tilted ~30deg above horizontal. The
              other arm rests against the body silhouette (not drawn —
              same convention as the regular `idle`/`typing` poses).

              All three sub-elements (arm, wand, puff) sit inside one
              absolutely-positioned container anchored at the bot's
              "hand pivot" point — shoulder height (top:42px) on the
              facing side. The arm draws OUTWARD from a small inward
              offset toward (WAND_HAND_OFFSET_PX, 0); the wand draws
              UPWARD from that endpoint after a small wand-tilt
              rotation. */}
          <div
            data-testid="beakerbot-blowing-bubbles-scene-wand"
            style={{
              position: "absolute",
              // Shoulder pivot — hand starts on the facing side at the
              // bot's upper body. We place the container ON the
              // shoulder; the arm + wand draw outward from there.
              left: `calc(50% + ${direction.sideSign * 6}px)`,
              top: 42,
              width: 1,
              height: 1,
              // Raise the whole arm-wand assembly slightly when the
              // bot does his triumph cheer at the end of the act.
              transformOrigin: "0 100%",
              transform: wandRaised
                ? "rotate(-18deg) translateY(-6px)"
                : "rotate(0deg) translateY(0)",
              transition: "transform 300ms ease-out",
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            {/* Arm — drawn as an SVG line from the shoulder (0,0) out
                to the hand endpoint. The hand sits at
                (sideSign * WAND_HAND_OFFSET_PX, +4) so the arm reads
                as a slight downward+outward extension. Stroke matches
                the BeakerBot's currentColor sky-blue line family.

                Hidden during settleDone since the `cheering` pose
                already draws both arms up — our custom side-arm would
                read as a third arm there. The wand continues to
                render and translates upward to read as "raised in
                triumph" alongside cheering. In reduced-motion mode
                the pose stays `idle`, so the custom arm renders to
                hold the wand in the static tableau. */}
            {stage !== "settleDone" && (
              <svg
                data-testid="beakerbot-blowing-bubbles-scene-arm"
                width="80"
                height="40"
                viewBox="-10 -6 80 40"
                style={{
                  position: "absolute",
                  left: direction.sideSign > 0 ? 0 : -70,
                  top: -6,
                  overflow: "visible",
                  color: "rgb(14 165 233)", // sky-500 — matches BeakerBot tint
                }}
                aria-hidden="true"
              >
                {/* The arm: a single rounded line from shoulder out to
                    the hand. */}
                <line
                  x1="0"
                  y1="0"
                  x2={direction.sideSign * WAND_HAND_OFFSET_PX}
                  y2="4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                {/* Hand — small circle at the end of the arm holding
                    the base of the wand. */}
                <circle
                  cx={direction.sideSign * WAND_HAND_OFFSET_PX}
                  cy="4"
                  r="2.4"
                  fill="currentColor"
                />
              </svg>
            )}

            {/* Wand — anchored at the hand end of the arm, tilted
                ~30deg above horizontal so the soapy ring points
                outward + slightly upward (natural emission angle for
                a stream of rising bubbles). The wand container's
                local origin is at the bottom of the wand (the hand
                grip); rotation pivots about that grip. */}
            <div
              data-testid="beakerbot-blowing-bubbles-scene-wand-glyph"
              style={{
                position: "absolute",
                left: direction.sideSign * WAND_HAND_OFFSET_PX,
                top: 4,
                width: 12,
                height: 24,
                // Center the wand horizontally on the hand point, then
                // tilt outward. Rotation pivot at the bottom-center of
                // the wand (the grip).
                transformOrigin: "50% 100%",
                transform: `translate(-50%, -100%) rotate(${direction.sideSign * 30}deg)`,
                pointerEvents: "none",
              }}
            >
              <BubbleWand width={12} height={24} />
            </div>

            {/* WIND-GUST PUFF — fires from the bot's MOUTH area toward
                the wand each time a new bubble spawns. Rendered as
                2-3 small curved arcs (suggesting puffs of air) with a
                quick opacity-0→1→0 + outward-translate keyframe.
                Re-mounted on each spawn via the `puffSpawnKey` key so
                the keyframe replays from frame zero. Only renders
                during the blowing stage (so it doesn't fire after the
                blowing window ends + lingering bubbles persist). */}
            {!reducedMotion && stage === "blowing" && puffSpawnKey > 0 && (
              <svg
                key={puffSpawnKey}
                data-testid="beakerbot-blowing-bubbles-scene-puff"
                data-puff-key={puffSpawnKey}
                width="40"
                height="20"
                viewBox="0 0 40 20"
                style={{
                  position: "absolute",
                  // Anchor at the bot's MOUTH — roughly 10px above the
                  // shoulder (the shoulder is `top:42`, the mouth sits
                  // higher) and offset slightly out toward the wand.
                  left: direction.sideSign * 4,
                  top: -16,
                  overflow: "visible",
                  // Direction-dependent translate target: outward
                  // toward the wand position.
                  ["--puff-dx" as unknown as string]: `${direction.sideSign * 16}px`,
                  ["--puff-dy" as unknown as string]: "-2px",
                  animation: `${animSuffix}-puff 320ms ease-out forwards`,
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                {/* 3 small curved arcs at staggered offsets — each is
                    a faint cubic curve suggesting a wisp of air. Color
                    is a light sky-blue so it reads as "puff of breath"
                    against most page backgrounds. */}
                <path
                  d="M 4 12 Q 10 6 18 10"
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.85)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <path
                  d="M 6 16 Q 14 12 22 14"
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.7)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <path
                  d="M 2 8 Q 8 4 14 6"
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.6)"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>,
    portalRoot,
  );
}

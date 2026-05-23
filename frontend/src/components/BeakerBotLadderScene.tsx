"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";

/**
 * Side easter-egg scene: BeakerBot climbs a ladder, cleans an invisible
 * screen, slips off it, and tumbles away alongside the ladder.
 *
 * This is a SCENE component — it orchestrates several SVG elements
 * (ladder + BeakerBot) across stages. Lives outside the BeakerBot SVG
 * viewBox because the ladder extends well below BeakerBot and the
 * fall trajectory exits the viewport.
 *
 * The companion to the locked, in-production BeakerBot mascot
 * (`BeakerBot.tsx`). Onboarding shows BeakerBot once and then he
 * disappears for the life of the app — this scene + future trigger
 * logic (idle / page-specific) keep him present in small doses.
 *
 * Mount approach:
 *  - Renders into a React portal at `document.body`
 *  - `position: fixed` overlay so it can extend to viewport edges
 *  - `z-index: 800` — above app chrome (cursor is 400) but below
 *    modals (10000+) so user-blocking UI always wins
 *  - `pointer-events: none` end-to-end — the scene is purely visual,
 *    never intercepts clicks
 *
 * Stage timeline (~10.8s total in motion mode):
 *  1. ladder-rise        0      → 800ms    (ladder slides up from below)
 *  2. climb              800    → 3600ms   (BeakerBot translates up
 *                                           the *full* ladder height —
 *                                           continuous, no snap to top)
 *  3. top                3600   → 3900ms   (settles at top of ladder)
 *  4. clean              3900   → 8900ms   (wipe-back-and-forth + sparkles)
 *  5. disruption         8900   → 9300ms   (unprompted slip — hands fly
 *                                           off, body tilts + lurches)
 *  6. fall               9300   → 10800ms  (BeakerBot + ladder tumble off)
 *  7. done               10800ms           (onComplete fires, parent unmounts)
 *
 * Reduced-motion fallback: when
 * `prefers-reduced-motion: reduce` is set, the scene renders BeakerBot
 * statically at the top of the ladder with no climb / clean / fall
 * animations, holds for 3s, then calls onComplete.
 *
 * The caller is responsible for setting `active` back to false after
 * `onComplete` fires — this component does not manage its own
 * "should-I-show-up" state. Future trigger logic (idle detection,
 * page-specific easter eggs) composes that on top.
 */

export interface BeakerBotLadderSceneProps {
  /** When true, the scene mounts + animation plays. When the
   *  animation finishes the scene calls `onComplete`; the parent
   *  should then set this back to false. Toggling false mid-animation
   *  is safe — the portal unmounts immediately, no onComplete fires. */
  active: boolean;
  /** Called once when the full animation sequence (or the
   *  reduced-motion short-circuit) finishes. */
  onComplete: () => void;
  /** Which side of the viewport the ladder appears on. Default
   *  `"right"`. The ladder sits ~24px from the chosen edge. */
  side?: "left" | "right";
}

type Stage =
  | "ladder-rise"
  | "climb"
  | "top"
  | "clean"
  | "disruption"
  | "fall"
  | "done";

/** Timings in ms. Tweak here, not at usage sites. */
const STAGE_MS = {
  ladderRise: 800,
  // Climb takes 2800ms so the *full ladder height* is covered at a
  // leisurely, readable rate. The keyframes interpolate continuously
  // from foot-of-ladder to top-of-ladder (no mid-climb snap).
  climb: 2800,
  top: 300,
  clean: 5000,
  // Brief, unprompted slip: hands fly off the rails, body lurches +
  // tilts. ~400ms — just long enough for the "oh-no" beat to read
  // before the fall keyframes take over.
  disruption: 400,
  fall: 1500,
} as const;

const REDUCED_MOTION_HOLD_MS = 3000;

/** z-index slot — above cursor (400) + app chrome, below modals
 *  (10000+). See `Tooltip.tsx` for the broader stacking convention. */
const SCENE_Z_INDEX = 800;

/** Ladder dimensions. Width is the SVG viewBox width; on-screen we
 *  scale to LADDER_WIDTH_PX. Height tracks 50vh so the ladder is
 *  half the viewport regardless of screen size. */
const LADDER_VIEWBOX_W = 60;
const LADDER_VIEWBOX_H = 400;
const LADDER_WIDTH_PX = 60;
/** BeakerBot render size at climb-top. 96px matches the onboarding
 *  tip card size — feels consistent if the easter-egg fires after a
 *  fresh user has just seen the welcome modal. */
const BEAKERBOT_SIZE_PX = 96;
/** Distance the ladder sits inset from the chosen viewport edge. */
const EDGE_INSET_PX = 24;
/** How far the ladder is shifted INWARD (toward BeakerBot's grasping
 *  hand) from a centered position. In the `pointing-up` pose with
 *  direction="left" (right-side ladder), BeakerBot's hand reaches
 *  inward to roughly bot_center - 28.8px (hand SVG-x=8 of 40, scaled
 *  to bot's 96px frame). The ladder's inner rail naturally sits at
 *  bot_center - 20px (rail at viewBox-x=10 of 60, scaled to 60px).
 *  Shifting the ladder ~10px inward closes that gap so the hand
 *  visibly grips a rung instead of grasping at empty air. */
const LADDER_INWARD_SHIFT_PX = 10;
/** Vertical overlap between BeakerBot's feet and the top of the
 *  ladder when he's at the "top" / "clean" stages. Without this the
 *  bot floats above the ladder; with it his feet are visually
 *  planted ON the top rung. Also used at the foot of the ladder so
 *  the climb start + end have symmetric foot-on-rung placement. */
const FEET_OVERLAP_PX = 24;

/** SSR safety guard for createPortal. `'use client'` files still
 *  render once on the server during prerendering, so `document` is
 *  undefined. We subscribe to the "is client" state via
 *  useSyncExternalStore — same effect as the classic
 *  `useEffect(() => setMounted(true), [])` pattern but lints clean
 *  under `react-hooks/set-state-in-effect`. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    // No-op subscribe — the value never changes after first paint.
    () => () => {},
    () => true,
    () => false,
  );
}

export default function BeakerBotLadderScene({
  active,
  onComplete,
  side = "right",
}: BeakerBotLadderSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<Stage>("ladder-rise");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-progression effect can
  // call it without re-running when the parent passes a fresh
  // function identity on every render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion via a matchMedia subscription.
  // The subscribe-and-sync pattern keeps the lint clean
  // (`react-hooks/set-state-in-effect`) and also picks up live
  // changes if the user toggles their OS preference between
  // easter-egg fires. We only attach when active so we don't keep
  // a listener around for the entire app lifetime.
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => {
      mql.removeEventListener?.("change", sync);
    };
  }, [active]);

  // Stage progression — schedules setTimeouts to advance through
  // the timeline. All setState calls happen inside timer callbacks
  // (external system events) which keeps the
  // `react-hooks/set-state-in-effect` rule happy. The reset to
  // "ladder-rise" runs in a 0ms timer too so it counts as a
  // callback rather than a sync render-cycle update. Clears all
  // timers on cleanup so toggling `active` off mid-animation
  // doesn't fire onComplete after unmount.
  useEffect(() => {
    if (!active) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delay: number, fn: () => void) => {
      timers.push(setTimeout(fn, delay));
    };

    // Reset stage on every active→true transition so re-firing the
    // easter egg replays the full sequence. Scheduled as a 0-delay
    // timer rather than a sync setState so the lint treats it as a
    // callback-driven update.
    schedule(0, () => setStage("ladder-rise"));

    if (reducedMotion) {
      // Skip the choreography — show BeakerBot static at the top of
      // the ladder + hold for REDUCED_MOTION_HOLD_MS, then complete.
      schedule(0, () => setStage("top"));
      schedule(REDUCED_MOTION_HOLD_MS, () => {
        setStage("done");
        onCompleteRef.current();
      });
      return () => {
        for (const t of timers) clearTimeout(t);
      };
    }

    // Full timeline.
    let elapsed = 0;
    elapsed += STAGE_MS.ladderRise;
    schedule(elapsed, () => setStage("climb"));
    elapsed += STAGE_MS.climb;
    schedule(elapsed, () => setStage("top"));
    elapsed += STAGE_MS.top;
    schedule(elapsed, () => setStage("clean"));
    elapsed += STAGE_MS.clean;
    schedule(elapsed, () => setStage("disruption"));
    elapsed += STAGE_MS.disruption;
    schedule(elapsed, () => setStage("fall"));
    elapsed += STAGE_MS.fall;
    schedule(elapsed, () => {
      setStage("done");
      onCompleteRef.current();
    });

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [active, reducedMotion]);

  // Per-mount keyframe id suffix so multiple scene instances
  // (extremely unlikely but cheap to defend against) don't share
  // animation names. CSS `@keyframes` are document-global. `useId`
  // gives a stable, pure identifier — `Math.random()` here would
  // trip the react/purity rule. We sanitize the colon characters
  // some bundlers emit (`:r0:` → `r0`) so the suffix is a valid
  // CSS identifier.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbls-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  if (!active || !isClient) return null;

  // Edge positioning — ladder sits inset (EDGE_INSET_PX +
  // LADDER_INWARD_SHIFT_PX) from the chosen side so the inner rail
  // meets BeakerBot's grasping hand. BeakerBot sits at the original
  // EDGE_INSET_PX-only offset (centered on his own frame), which
  // keeps the bot from drifting toward the viewport edge while only
  // the ladder slides inward to meet his hand.
  const ladderEdgeStyle: React.CSSProperties =
    side === "right"
      ? { right: `${EDGE_INSET_PX + LADDER_INWARD_SHIFT_PX}px` }
      : { left: `${EDGE_INSET_PX + LADDER_INWARD_SHIFT_PX}px` };

  // BeakerBot stays centered on the ORIGINAL (un-shifted) ladder
  // position. We compute his horizontal offset relative to the
  // pre-shift ladder center so the inward-shifted rail visually
  // aligns with his outstretched hand.
  const botEdgeStyle: React.CSSProperties =
    side === "right"
      ? {
          right: `${EDGE_INSET_PX + LADDER_WIDTH_PX / 2 - BEAKERBOT_SIZE_PX / 2}px`,
        }
      : {
          left: `${EDGE_INSET_PX + LADDER_WIDTH_PX / 2 - BEAKERBOT_SIZE_PX / 2}px`,
        };

  return createPortal(
    <div
      data-testid="beakerbot-ladder-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
      }}
    >
      {/* Per-mount keyframes. Inlined because the choreography
          coordinates several CSS custom properties (ladder Y, climb
          Y, wipe X, fall Y/rotate) that would be awkward to express
          as a Tailwind utility. */}
      <style>{`
        @keyframes bbls-ladder-rise-${animSuffix} {
          from { transform: translateY(110%); }
          to   { transform: translateY(0%); }
        }
        @keyframes bbls-climb-${animSuffix} {
          /* IMPORTANT: vertical distance is driven by the
             --bbls-climb-dist custom property (set inline below),
             which equals the actual distance from the bot's resting
             "top-of-ladder" position down to the foot of the ladder.
             The keyframes interpolate continuously from
             translateY(+climb-dist) (foot of ladder) at 0% down to
             translateY(0) (top of ladder, matching the static
             "top" stage's bottom value) at 100%. No mid-stage snap,
             no overshoot past the top.

             Horizontal +/-3px sway gives a "rung-by-rung" feel. */
          0%   { transform: translate(0,    var(--bbls-climb-dist)); }
          12%  { transform: translate(-3px, calc(var(--bbls-climb-dist) * 0.88)); }
          25%  { transform: translate(3px,  calc(var(--bbls-climb-dist) * 0.75)); }
          37%  { transform: translate(-3px, calc(var(--bbls-climb-dist) * 0.63)); }
          50%  { transform: translate(3px,  calc(var(--bbls-climb-dist) * 0.50)); }
          62%  { transform: translate(-3px, calc(var(--bbls-climb-dist) * 0.38)); }
          75%  { transform: translate(3px,  calc(var(--bbls-climb-dist) * 0.25)); }
          87%  { transform: translate(-3px, calc(var(--bbls-climb-dist) * 0.12)); }
          100% { transform: translate(0,    0); }
        }
        @keyframes bbls-wipe-${animSuffix} {
          0%, 100% { transform: translateX(-8px) rotate(-6deg); }
          50%      { transform: translateX(8px)  rotate(6deg); }
        }
        @keyframes bbls-sparkle-${animSuffix} {
          0%, 100% { opacity: 0; transform: scale(0.6); }
          50%      { opacity: 1; transform: scale(1); }
        }
        @keyframes bbls-fall-bot-${animSuffix} {
          0%   { transform: translate(0, 0) rotate(0deg); }
          25%  { transform: translate(-10px, 20vh) rotate(-90deg); }
          60%  { transform: translate(15px, 60vh) rotate(-220deg); }
          100% { transform: translate(-5px, 120vh) rotate(-540deg); }
        }
        @keyframes bbls-fall-ladder-${animSuffix} {
          0%   { transform: translate(0, 0) rotate(0deg); }
          30%  { transform: translate(10px, 15vh) rotate(15deg); }
          70%  { transform: translate(-15px, 60vh) rotate(-25deg); }
          100% { transform: translate(20px, 120vh) rotate(40deg); }
        }
        @keyframes bbls-slip-${animSuffix} {
          /* Unprompted "oh-no" slip: hands fly off the rail (no more
             grip), body tilts ~22deg + lurches a touch outward and
             downward as gravity catches up. The end transform is the
             starting frame for the fall keyframes (translate(0,0) +
             rotate but we hand off cleanly — the fall keyframe
             overrides at 0% with translate(0,0) rotate(0) which
             reads as a tiny "reset" but in motion you see the slip
             slide directly into the tumble). */
          0%   { transform: translate(0, 0) rotate(0deg); }
          40%  { transform: translate(-4px, 2px) rotate(-8deg); }
          100% { transform: translate(6px, 8px) rotate(22deg); }
        }
      `}</style>

      {/* Ladder + BeakerBot share a falling wrapper during stage 6
          so they exit together. Before fall they're positioned
          independently. */}

      {/* LADDER */}
      <div
        data-testid="beakerbot-ladder-scene-ladder"
        style={{
          position: "absolute",
          bottom: 0,
          ...ladderEdgeStyle,
          width: `${LADDER_WIDTH_PX}px`,
          height: "50vh",
          // Stage-driven animations.
          animation:
            stage === "ladder-rise"
              ? `bbls-ladder-rise-${animSuffix} ${STAGE_MS.ladderRise}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`
              : stage === "fall"
                ? `bbls-fall-ladder-${animSuffix} ${STAGE_MS.fall}ms cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : undefined,
          // Pre-rise: keep the ladder hidden below the fold so the
          // first frame doesn't flash the ladder in its final spot.
          transform:
            stage === "ladder-rise" ? "translateY(110%)" : undefined,
        }}
      >
        <svg
          viewBox={`0 0 ${LADDER_VIEWBOX_W} ${LADDER_VIEWBOX_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ display: "block" }}
        >
          {/* Two vertical rails — wood tone. */}
          <line
            x1="10"
            y1="0"
            x2="10"
            y2={LADDER_VIEWBOX_H}
            stroke="#8b4513"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="0"
            x2="50"
            y2={LADDER_VIEWBOX_H}
            stroke="#8b4513"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* 5 rungs evenly spaced (roughly 50, 120, 200, 280, 360). */}
          {[50, 120, 200, 280, 360].map((y) => (
            <line
              key={y}
              x1="10"
              y1={y}
              x2="50"
              y2={y}
              stroke="#a0522d"
              strokeWidth="4"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>

      {/* BEAKERBOT — vertical positioning controlled per-stage.
          During fall, lives inside the same coordinate space as
          the ladder so both tumble off together.

          Vertical anchor strategy (the climb-glitch fix):
            - Static `bottom` is FIXED at the "top of ladder" value
              across every non-ladder-rise stage (climb / top / clean /
              disruption / fall). The bot is anchored there.
            - Pre-climb (during ladder-rise) the inline transform
              pushes him DOWN by --bbls-climb-dist so he sits at the
              foot of the (still-rising) ladder.
            - The climb keyframe interpolates from translateY(+dist)
              at 0% back to translateY(0) at 100% — landing him
              EXACTLY at the static "top" position. No snap. */}
      <div
        data-testid="beakerbot-ladder-scene-bot"
        style={
          {
            position: "absolute",
            // Ladder-rise: hidden below the viewport. Every other
            // stage: anchored at the top of the ladder. Feet overlap
            // the top rung by FEET_OVERLAP_PX so the bot reads as
            // standing ON the ladder rather than floating above it.
            bottom:
              stage === "ladder-rise"
                ? `-${BEAKERBOT_SIZE_PX}px`
                : `calc(50vh - ${FEET_OVERLAP_PX}px)`,
            // Climb distance: from the top-anchored resting position
            // down to the foot of the ladder. Equals (50vh -
            // FEET_OVERLAP_PX) - FEET_OVERLAP_PX so the climb start
            // has the bot's feet overlapping the BOTTOM rung by the
            // same amount as the top, giving symmetric foot-on-rung
            // placement at both ends of the climb.
            "--bbls-climb-dist": `calc(50vh - ${FEET_OVERLAP_PX * 2}px)`,
            ...botEdgeStyle,
            width: `${BEAKERBOT_SIZE_PX}px`,
            height: `${BEAKERBOT_SIZE_PX}px`,
            animation:
              stage === "climb"
                ? `bbls-climb-${animSuffix} ${STAGE_MS.climb}ms linear forwards`
                : stage === "disruption"
                  ? `bbls-slip-${animSuffix} ${STAGE_MS.disruption}ms ease-out forwards`
                  : stage === "fall"
                    ? `bbls-fall-bot-${animSuffix} ${STAGE_MS.fall}ms cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                    : undefined,
            // Pre-climb hold: park BeakerBot at the foot of the
            // ladder by pre-applying the same translateY the climb
            // keyframe will animate AWAY from. Matches keyframe-0%
            // exactly so the climb→start transition has zero pop.
            transform:
              stage === "ladder-rise"
                ? `translateY(var(--bbls-climb-dist))`
                : undefined,
            // Pre-rise: stay hidden until the ladder is in place.
            // Reduced motion uses the static "top" stage which keeps
            // BeakerBot visible from the moment the scene mounts.
            opacity: stage === "ladder-rise" ? 0 : 1,
            transition: "opacity 200ms",
          } as unknown as React.CSSProperties
        }
      >
        {/* Pose-by-stage:
              climb        → "pointing-up" (mirrored so the
                              triangle reaches for the next rung
                              above-and-inward)
              top / clean  → "pointing" (mirrored — arm extended
                              toward the imaginary screen)
              disruption   → "cheering" (arms-up = startled, "uh-oh")
              fall         → "cheering" (arms flailing) */}
        <BeakerBot
          pose={
            stage === "climb"
              ? "pointing-up"
              : stage === "top" || stage === "clean"
                ? "pointing"
                : stage === "disruption" || stage === "fall"
                  ? "cheering"
                  : "idle"
          }
          direction={side === "right" ? "left" : "right"}
          className="w-full h-full text-sky-500"
        />

        {/* Wiping hand overlay during clean stage. A small circle
            translated back-and-forth in front of BeakerBot to
            simulate the wipe. Lives in the BeakerBot's coordinate
            space so it follows him correctly. */}
        {stage === "clean" && (
          <div
            data-testid="beakerbot-ladder-scene-wipe"
            style={{
              position: "absolute",
              top: "30%",
              left: side === "right" ? "-25%" : "100%",
              width: "20%",
              height: "20%",
              animation: `bbls-wipe-${animSuffix} 800ms ease-in-out infinite`,
              transformOrigin: "center",
            }}
          >
            <svg viewBox="0 0 20 20" width="100%" height="100%">
              {/* Tiny cleaning cloth — soft yellow square with a
                  small fold line. */}
              <rect
                x="2"
                y="4"
                width="16"
                height="12"
                rx="2"
                fill="#fef3c7"
                stroke="#d97706"
                strokeWidth="1"
              />
              <path
                d="M 6 10 L 14 10"
                stroke="#d97706"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}

        {/* Cleaning sparkles — three small "✦" marks that pulse
            during the clean stage. Optional polish. */}
        {stage === "clean" && (
          <>
            {[
              { top: "20%", left: "-30%", delay: 0 },
              { top: "45%", left: "-35%", delay: 250 },
              { top: "70%", left: "-25%", delay: 500 },
            ].map((sp, i) =>
              side === "right" ? (
                <span
                  key={i}
                  data-testid="beakerbot-ladder-scene-sparkle"
                  style={{
                    position: "absolute",
                    top: sp.top,
                    left: sp.left,
                    fontSize: "14px",
                    color: "#fbbf24",
                    animation: `bbls-sparkle-${animSuffix} 1200ms ease-in-out ${sp.delay}ms infinite`,
                    pointerEvents: "none",
                  }}
                >
                  ✦
                </span>
              ) : (
                <span
                  key={i}
                  data-testid="beakerbot-ladder-scene-sparkle"
                  style={{
                    position: "absolute",
                    top: sp.top,
                    right: sp.left,
                    fontSize: "14px",
                    color: "#fbbf24",
                    animation: `bbls-sparkle-${animSuffix} 1200ms ease-in-out ${sp.delay}ms infinite`,
                    pointerEvents: "none",
                  }}
                >
                  ✦
                </span>
              ),
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

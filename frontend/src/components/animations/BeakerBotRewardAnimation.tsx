"use client";

// frontend/src/components/animations/BeakerBotRewardAnimation.tsx
//
// Reward animation mode "beakerbot". Plays on every task / list-item
// completion when the user has selected the BeakerBot animation in
// Settings -> Animation.
//
// Behavior contract (per BeakerBot reward animation manager brief):
//
//   1. ALWAYS render a BeakerBot-blue radial ripple at the click
//      position. The ripple is ~80-120px peak diameter, fades over
//      ~600ms, then unmounts.
//
//   2. If no scene is currently playing -> pick a random fullscreen
//      BeakerBot scene from the 8 narrative scenes, render it via
//      portal at document.body, and clear the module-level
//      "is scene playing?" flag on the scene's onComplete callback.
//
//   3. If a scene IS already playing -> only the ripple renders, no
//      second scene (cooldown rule). This prevents a torrent of
//      overlapping fullscreen scenes when a user blows through a
//      checklist.
//
// The 8 scenes live as their own components in components/BeakerBot*Scene.tsx;
// we import them as-is and wrap them in `active`/`onComplete` props.
//
// Sceneplay-cooldown state is a module-level singleton (NOT React state)
// so that mount/unmount of the reward animation component itself does
// not reset the cooldown. The reward animation is mounted briefly per
// click; the scene runs longer than that lifecycle, so the gate has to
// live outside the component tree.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import BeakerBotLadderScene from "../BeakerBotLadderScene";
import BeakerBotBugStompScene from "../BeakerBotBugStompScene";
import BeakerBotSkateboardScene from "../BeakerBotSkateboardScene";
import BeakerBotScreenBumpScene from "../BeakerBotScreenBumpScene";
import BeakerBotTooManyBeakersScene from "../BeakerBotTooManyBeakersScene";
import BeakerBotMouseWaveScene from "../BeakerBotMouseWaveScene";
import BeakerBotCentrifugeScene from "../BeakerBotCentrifugeScene";
import BeakerBotEurekaScene from "../BeakerBotEurekaScene";

// ---------------------------------------------------------------------
// Module-level singletons (cross-instance cooldown)
// ---------------------------------------------------------------------

/** True while any instance of the reward animation is currently
 *  displaying a fullscreen scene. Cleared when that scene's onComplete
 *  fires. Lives outside React so that the gate survives mount/unmount
 *  of the reward animation component itself (each click mounts a fresh
 *  one; the scene runs longer than the wrapping reward animation). */
let isScenePlaying = false;

/** Lightweight subscriber list so a freshly mounted reward animation
 *  can wait its turn if a scene is in flight on another mount, then
 *  react to scene end. The reward-animation contract is fire-and-forget
 *  per click, so subscribers are NOT used to retro-play missed scenes;
 *  they exist purely so tests can probe the singleton via the exports
 *  below. */
type SceneFlagListener = (playing: boolean) => void;
const sceneFlagListeners: Set<SceneFlagListener> = new Set();

function setIsScenePlaying(value: boolean) {
  isScenePlaying = value;
  for (const listener of sceneFlagListeners) listener(value);
}

/** Test-only escape hatches. Exported so the unit test can reset the
 *  cooldown between cases without poking module internals directly. */
export const __testing = {
  reset() {
    isScenePlaying = false;
    sceneFlagListeners.clear();
  },
  isScenePlaying(): boolean {
    return isScenePlaying;
  },
};

// ---------------------------------------------------------------------
// Scene registry — the 8 BeakerBot narrative scenes
// ---------------------------------------------------------------------

/** Stable list of scene components. Each scene exposes the same
 *  `{ active, onComplete }` contract; we render via React with `active`
 *  pinned to true (we only mount the scene once per reward fire). */
const SCENES = [
  BeakerBotLadderScene,
  BeakerBotBugStompScene,
  BeakerBotSkateboardScene,
  BeakerBotScreenBumpScene,
  BeakerBotTooManyBeakersScene,
  BeakerBotMouseWaveScene,
  BeakerBotCentrifugeScene,
  BeakerBotEurekaScene,
] as const;

/** Stable test ids for each scene slot (for the unit test's
 *  "picks from valid 8" assertion via mocked Math.random). */
export const SCENE_NAMES = [
  "ladder",
  "bug-stomp",
  "skateboard",
  "screen-bump",
  "too-many-beakers",
  "mouse-wave",
  "centrifuge",
  "eureka",
] as const;

// ---------------------------------------------------------------------
// Ripple sizing / timing
// ---------------------------------------------------------------------

/** Peak diameter of the ripple at the end of its expand-out animation.
 *  Brief asks for 80-120px; 100px is centered in the range. */
const RIPPLE_PEAK_DIAMETER_PX = 100;

/** Total ripple lifespan in ms — fade-out + unmount. Brief asks ~600ms. */
const RIPPLE_DURATION_MS = 600;

/** BeakerBot sky-blue, matches BeakerBotCursor.tsx's `#0ea5e9` and
 *  Tailwind's `text-sky-500`. Used as the ripple's outer gradient stop. */
const BEAKERBOT_BLUE = "#0ea5e9";

// ---------------------------------------------------------------------
// BlueRipple — sky-blue radial pulse, fixed-positioned at click
// ---------------------------------------------------------------------

interface BlueRippleProps {
  x: number;
  y: number;
  /** Fires once the ripple has fully faded out — the parent uses this
   *  to decide when "the reward animation is done" overall. */
  onDone?: () => void;
}

function BlueRipple({ x, y, onDone }: BlueRippleProps) {
  const [visible, setVisible] = useState(true);

  // Cache onDone in a ref so the unmount timer doesn't re-arm when
  // the parent passes a fresh function identity on every render.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Single fade-and-unmount timer. We set visible=false at the very
  // end so the keyframe runs to its final frame before the element
  // disappears (avoids a hard cut).
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDoneRef.current?.();
    }, RIPPLE_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  // Unique keyframes id per mount so multiple overlapping ripples
  // don't share animation names (CSS @keyframes are document-global).
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbr-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  if (!visible) return null;

  return (
    <div
      data-testid="beakerbot-reward-ripple"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: RIPPLE_PEAK_DIAMETER_PX,
        height: RIPPLE_PEAK_DIAMETER_PX,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        // z-index 850: above the scene (800) so the ripple is always
        // visible at the click, below modals (10000+). The ripple is
        // tiny and centered at the click, so even when a fullscreen
        // scene is playing the ripple reads as a small accent rather
        // than competing for attention.
        zIndex: 850,
      }}
    >
      <style>{`
        @keyframes ${animSuffix} {
          from {
            transform: scale(0.4);
            opacity: 0.7;
          }
          to {
            transform: scale(1);
            opacity: 0;
          }
        }
      `}</style>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          // Radial gradient: bright BeakerBot blue at center, fading
          // to transparent at the edge. Matches the visual language
          // of BeakerBotCursor.tsx's ripple but as a solid pulse
          // rather than a stroked ring (this fires for ALL reward
          // animations, not just cursor-driven ones, so the visual
          // is intentionally a bit more substantial).
          background: `radial-gradient(circle, ${BEAKERBOT_BLUE}AA 0%, ${BEAKERBOT_BLUE}55 45%, ${BEAKERBOT_BLUE}00 70%)`,
          animation: `${animSuffix} ${RIPPLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// BeakerBotRewardAnimation — public component
// ---------------------------------------------------------------------

interface BeakerBotRewardAnimationProps {
  /** Click position in viewport pixels — DynamicAnimation feeds the
   *  same x/y it gives the other reward animations. */
  x: number;
  y: number;
  /** Called once the reward animation as a whole is done. The current
   *  contract: fires after the ripple fades (600ms), regardless of
   *  whether a fullscreen scene is also playing. The scene continues
   *  in its own portal independently — this is correct because the
   *  reward-animation container in DynamicAnimation otherwise blocks
   *  the next reward from firing while a scene is on-screen, which
   *  would defeat the cooldown rule. */
  onComplete: () => void;
}

/** Pick a scene index uniformly from the 8-scene registry. Wrapped so
 *  tests can stub `Math.random()` and assert the picker stays in
 *  bounds. */
function pickSceneIndex(): number {
  return Math.floor(Math.random() * SCENES.length);
}

export default function BeakerBotRewardAnimation({
  x,
  y,
  onComplete,
}: BeakerBotRewardAnimationProps) {
  // Decide ONCE at mount whether this fire gets a scene. If the gate
  // is already set we render ripple-only (cooldown). Lazy useState
  // initializer keeps `Math.random()` out of the render body (purity
  // rule) and ensures the choice is stable across re-renders.
  const [sceneIndex] = useState<number | null>(() => {
    if (isScenePlaying) return null;
    const idx = pickSceneIndex();
    // Clamp defensively in case the picker is stubbed with a value
    // outside [0, 1). Floor + min keeps us in-bounds even if a test
    // stubs Math.random() to e.g. 0.999999.
    return Math.min(idx, SCENES.length - 1);
  });

  // Claim the cooldown gate as a mount side-effect (not during render
  // — would violate the purity rule). The claim is a no-op if we
  // already lost the race (sceneIndex === null).
  useEffect(() => {
    if (sceneIndex === null) return;
    setIsScenePlaying(true);
    // Note: we DON'T release on unmount. The scene component keeps
    // running in its own portal even after this wrapper unmounts (the
    // wrapper unmounts when onComplete fires after the ripple, which
    // is ~600ms; scenes run multiple seconds). The release happens
    // in handleSceneComplete below, which is called by the scene
    // itself.
  }, [sceneIndex]);

  // Fire the parent's onComplete after the ripple's 600ms lifespan,
  // independent of any scene that may still be playing. The scene
  // manages its own portal lifecycle and clears the cooldown flag
  // when it finishes.
  const handleRippleDone = () => {
    onComplete();
  };

  const handleSceneComplete = () => {
    setIsScenePlaying(false);
  };

  // Pick the scene component for this fire. If sceneIndex is null
  // (cooldown), no scene renders this turn.
  const SceneComponent = sceneIndex !== null ? SCENES[sceneIndex] : null;
  const sceneName = sceneIndex !== null ? SCENE_NAMES[sceneIndex] : null;

  return (
    <div
      data-testid="beakerbot-reward-animation"
      data-scene-playing={SceneComponent ? "true" : "false"}
      data-scene-name={sceneName ?? "none"}
      // The wrapper itself is invisible / pointer-events-none. The
      // ripple positions itself via fixed coordinates; the scene
      // renders into its own portal. We exist solely as a host node
      // so React keeps both subtrees alive together.
      style={{ pointerEvents: "none" }}
    >
      <BlueRipple x={x} y={y} onDone={handleRippleDone} />
      {SceneComponent ? (
        <SceneComponent active onComplete={handleSceneComplete} />
      ) : null}
    </div>
  );
}

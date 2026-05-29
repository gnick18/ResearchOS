"use client";

// frontend/src/components/BeakerBotTwirlScene.tsx
//
// New drag-stage scene (proposal R2.2, P1). The twirl/spin: BeakerBot
// plants center stage and does a celebratory double spin (rotateY),
// trailing rainbow motion streaks arcing behind him in his own five
// liquid colors, settling on a cheering freeze. Short (~1.5s), joyful,
// very gif-able. Pure-joy rainbow beat, highest effort-to-delight.
//
// Composes from existing primitives only: a CSS rotateY on the bot
// wrapper (trivial) + a set of fading arc strokes in the five liquid
// stops, spawned like the existing particle arrays (VOLCANO_PARTICLES
// shape) but laid out on a circular path. No new bot art (ends on the
// existing cheering pose).
//
// Same scene envelope as the 9 existing scenes (portal to body, z 800,
// reduced-motion gate, onComplete). `bounds` accepted, unused in P1.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import { BEAKERBOT_SCENE_SIZE_PX } from "./beakerbot/scene-constants";
import type { SceneBounds } from "./BeakerBotRunwayStrutScene";
import showcaseStyles from "./showcase/showcase.module.css";

export interface BeakerBotTwirlSceneProps {
  active: boolean;
  onComplete?: () => void;
  bounds?: SceneBounds;
  /** Where the scene's full-screen portal mounts. Defaults to
   *  document.body (the global easter-egg behavior, unchanged). The
   *  showcase Scenes view passes its scaled in-frame viewport so the
   *  scene plays inside the fixed window. When explicitly null the scene
   *  renders nothing (the target is not live yet). */
  portalTarget?: HTMLElement | null;
}

export const TWIRL_DURATION_MS = 1500;
const REDUCED_MOTION_HOLD_MS = 2000;
const SCENE_Z_INDEX = 800;

/** BeakerBot's five liquid stops (R2.6), reused for the rainbow trail. */
const RAINBOW_STOPS = [
  "#FFD2B0",
  "#FFF1A8",
  "#B7EBB1",
  "#A6D2F4",
  "#D6B5F0",
] as const;

/** 10 trail dots laid on a circular path: each gets an arc angle (so it
 *  flings out on a different bearing), a rainbow color, and a stagger
 *  delay (mirrors the VOLCANO_PARTICLES delayMs stagger pattern). */
const TWIRL_TRAIL = Array.from({ length: 10 }, (_, i) => ({
  angleDeg: i * 36,
  fill: RAINBOW_STOPS[i % RAINBOW_STOPS.length]!,
  delayMs: (i % 5) * 40,
}));

const subscribeNoop = () => () => {};
function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export default function BeakerBotTwirlScene({
  active,
  onComplete,
  portalTarget,
}: BeakerBotTwirlSceneProps) {
  const mounted = useClientMounted();
  const [reducedMotion, setReducedMotion] = useState(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot snapshot of matchMedia at activation; runs once per active flip
    setReducedMotion(reduced);
  }, [active]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const hold = reducedMotion ? REDUCED_MOTION_HOLD_MS : TWIRL_DURATION_MS + 400;
    const handle = window.setTimeout(() => onCompleteRef.current?.(), hold);
    return () => window.clearTimeout(handle);
  }, [active, reducedMotion]);

  // Default (prop omitted) keeps the global behavior: portal to body.
  // An explicit null means "target not live yet" so we render nothing.
  const portalRoot = portalTarget === undefined ? document.body : portalTarget;
  if (!mounted || !active || !portalRoot) return null;

  return createPortal(
    <div
      data-testid="beakerbot-twirl-scene"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: SCENE_Z_INDEX,
        pointerEvents: "none",
      }}
    >
      {/* Rainbow trail: suppressed entirely under reduced motion (pure
          motion), per R3.10. */}
      {!reducedMotion && (
        <div
          className={showcaseStyles.twirlTrail}
          style={{ ["--twirl-dur" as string]: `${TWIRL_DURATION_MS}ms` }}
        >
          {TWIRL_TRAIL.map((t, i) => (
            <span
              key={i}
              className={showcaseStyles.twirlTrailArc}
              style={{
                background: t.fill,
                ["--arc-angle" as string]: `${t.angleDeg}deg`,
                ["--trail-delay" as string]: `${t.delayMs}ms`,
              }}
            />
          ))}
        </div>
      )}
      <div
        className={showcaseStyles.twirlBot}
        style={{
          width: BEAKERBOT_SCENE_SIZE_PX,
          height: BEAKERBOT_SCENE_SIZE_PX,
          ["--twirl-dur" as string]: `${TWIRL_DURATION_MS}ms`,
        }}
      >
        <BeakerBot
          pose="cheering"
          className="w-full h-full text-sky-500"
          ariaLabel="BeakerBot twirls"
        />
      </div>
    </div>,
    portalRoot,
  );
}

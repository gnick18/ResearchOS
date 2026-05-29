"use client";

// frontend/src/components/BeakerBotRunwayStrutScene.tsx
//
// New drag-stage scene (proposal R2.2, P1). The signature strut:
// BeakerBot enters from stage-left, struts down the lit catwalk toward
// the pit with a confident bob-and-sway walk, hits his mark center-
// front, strikes a freeze (cheering), and the moment lands. Composes
// from the existing primitives only (no new bot art): a horizontal
// translate + a perspective scale ramp (the skateboard/coffee
// translate patterns) plus a sway-bob loop, ending on an existing
// freeze pose.
//
// Same scene envelope as the 9 existing scenes (portal to document.body,
// position: fixed, z-index 800, prefers-reduced-motion gate, onComplete)
// so it plugs into the showcase sequencer. The `bounds` prop is the R1
// section 4 Option-1 shape, accepted but unused in P1 (portal-to-body).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import { BEAKERBOT_SCENE_SIZE_PX } from "./beakerbot/scene-constants";
import showcaseStyles from "./showcase/showcase.module.css";

/** R1 section 4 optional-bounds shape (undefined in P1). */
export interface SceneBounds {
  container: HTMLElement;
  width: number;
  height: number;
}

export interface BeakerBotRunwayStrutSceneProps {
  active: boolean;
  onComplete?: () => void;
  /** P2+ in-frame bounds target; ignored in P1. */
  bounds?: SceneBounds;
  /** Where the scene's full-screen portal mounts. Defaults to
   *  document.body (the global easter-egg behavior, unchanged). The
   *  showcase Scenes view passes its scaled in-frame viewport so the
   *  scene plays inside the fixed window. When explicitly null the scene
   *  renders nothing (the target is not live yet). */
  portalTarget?: HTMLElement | null;
}

export const STRUT_DURATION_MS = 3200;
const REDUCED_MOTION_HOLD_MS = 2000;

const SCENE_Z_INDEX = 800;

/** SSR-safe one-shot mount flag, matching the existing scenes'
 *  useSyncExternalStore portal-mount pattern. */
const subscribeNoop = () => () => {};
function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export default function BeakerBotRunwayStrutScene({
  active,
  onComplete,
  portalTarget,
}: BeakerBotRunwayStrutSceneProps) {
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
    const hold = reducedMotion ? REDUCED_MOTION_HOLD_MS : STRUT_DURATION_MS + 400;
    const handle = window.setTimeout(() => onCompleteRef.current?.(), hold);
    return () => window.clearTimeout(handle);
  }, [active, reducedMotion]);

  // Default (prop omitted) keeps the global behavior: portal to body.
  // An explicit null means "target not live yet" so we render nothing.
  const portalRoot =
    typeof document === "undefined"
      ? null
      : portalTarget === undefined
        ? document.body
        : portalTarget;
  if (!mounted || !active || !portalRoot) return null;

  // Reduced motion: the "she served" static freeze of the end pose
  // (cheering) on the mark (R3.10).
  const pose = reducedMotion ? "cheering" : "cheering";

  return createPortal(
    <div
      data-testid="beakerbot-runway-strut-scene"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: SCENE_Z_INDEX,
        pointerEvents: "none",
      }}
    >
      <div
        className={showcaseStyles.strutBot}
        style={{
          width: BEAKERBOT_SCENE_SIZE_PX,
          height: BEAKERBOT_SCENE_SIZE_PX,
          ["--strut-dur" as string]: `${STRUT_DURATION_MS}ms`,
        }}
      >
        <div className={showcaseStyles.strutSway}>
          <BeakerBot
            pose={pose}
            className="w-full h-full text-sky-500"
            ariaLabel="BeakerBot struts the runway"
          />
        </div>
      </div>
    </div>,
    portalRoot,
  );
}

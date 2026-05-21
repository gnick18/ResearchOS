"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";

/**
 * Pose-only celebration scene. Wraps a single `<BeakerBot>` pose
 * (cheering / bouncing / volcano-eruption) in the same
 * `{ active, onComplete }` envelope the multi-stage scenes use
 * (Ladder / Eureka / MouseWave) so the CelebrationManager can treat
 * every entry in the random scene pool uniformly.
 *
 * Why this exists: the random pool the milestone scheduler picks from
 * has six entries; three are full multi-stage scenes (already shipped
 * as side easter-eggs) and three are bare poses. The poses don't have
 * their own "scene" wrapper because they're animation-by-CSS-keyframe
 * loops, not orchestrated timelines. This wrapper gives every pool
 * entry the same lifecycle:
 *   - mount when `active=true`
 *   - render BeakerBot at the bottom-right corner with the chosen pose
 *   - hold for `holdMs` (defaults to 2000)
 *   - fire `onComplete` once at the end
 *   - unmount when the parent flips `active=false`
 *
 * Positioning matches the multi-stage scenes' "bottom-right corner"
 * convention (proposal §4.5 "Celebration surface"). The wrapper
 * portals into document.body so it survives ancestor unmounts the
 * way the multi-stage scenes do, and uses `pointer-events: none` so
 * it never intercepts clicks on the underlying page.
 *
 * Reduced-motion handling is delegated to `<BeakerBot>` itself: its
 * `animated` prop already respects `prefers-reduced-motion: reduce`
 * via its module CSS. We don't need a separate matchMedia listener
 * here: the pose either animates or stays static based on the OS
 * preference, and the 2000ms hold runs regardless.
 */

export interface BeakerBotPoseCelebrationSceneProps {
  /** When true, the scene mounts. When false, the scene renders
   *  nothing (and any pending hold timer is cancelled). Toggle from
   *  false → true to (re)play. */
  active: boolean;
  /** The pose to render. Limited to the celebration-friendly poses
   *  (cheering, bouncing, volcano-eruption). Other poses are
   *  semantically wrong for a celebration but the type allows the
   *  full pose union so a future pool addition (e.g. "waving")
   *  doesn't need a wrapper change. */
  pose: BeakerBotPose;
  /** Fires once after the hold elapses. The parent (CelebrationManager)
   *  is expected to set `active=false` in response, which unmounts the
   *  portal and lets the next queued celebration take over. */
  onComplete?: () => void;
  /** How long to hold the pose before firing onComplete, in ms.
   *  Defaults to 2000 which feels long enough to register but short
   *  enough not to feel like a blocker. Tests pass a smaller value to
   *  keep fake-timer advancement light. */
  holdMs?: number;
}

/** z-index slot: matches the multi-stage scenes' SCENE_Z_INDEX (800)
 *  so a pose celebration and a multi-stage celebration both float in
 *  the same layer relative to app chrome and modals. */
const SCENE_Z_INDEX = 800;

const DEFAULT_HOLD_MS = 2000;

/** SSR safety: `createPortal` to `document.body` is client-only. The
 *  multi-stage scenes use this same useSyncExternalStore pattern; copy
 *  it here so behavior + lint posture match. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export default function BeakerBotPoseCelebrationScene({
  active,
  pose,
  onComplete,
  holdMs = DEFAULT_HOLD_MS,
}: BeakerBotPoseCelebrationSceneProps) {
  const isClient = useIsClient();

  // Stash onComplete in a ref so the hold-timer effect can fire it
  // without re-running every time the parent passes a fresh function
  // identity. Matches the convention used in BeakerBotLadderScene
  // (line 156: `onCompleteRef` pattern).
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      onCompleteRef.current?.();
    }, holdMs);
    return () => clearTimeout(timer);
  }, [active, holdMs]);

  if (!active || !isClient) return null;

  return createPortal(
    <div
      data-testid="beakerbot-pose-celebration-scene"
      data-pose={pose}
      aria-hidden="true"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 96,
        height: 96,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
      }}
    >
      <BeakerBot pose={pose} className="w-full h-full text-sky-500" />
    </div>,
    document.body,
  );
}

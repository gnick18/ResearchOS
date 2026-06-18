"use client";

import { useCallback, useEffect } from "react";
import BeakerBotBugStompScene from "@/components/BeakerBotBugStompScene";
import { POPUP_ANIMATIONS_ENABLED } from "@/lib/animations/popup-gate";
import BeakerBotTwirlScene from "@/components/BeakerBotTwirlScene";
import {
  useSceneTriggerStore,
  type SceneTriggerId,
} from "@/lib/scene-trigger-store";

/**
 * Global host for fire-and-forget easter-egg scenes.
 *
 * Mount exactly once at the AppShell level (or any always-mounted
 * surface above the routes). Subscribes to `useSceneTriggerStore` and
 * renders whatever scene is currently active. When the scene's
 * `onComplete` fires, the host invokes the caller's stored callback
 * THEN clears the active scene (in that order — callers may want to
 * pop a follow-up modal that should appear right as the scene
 * unmounts, not after a render gap).
 *
 * Renders null when no scene is active.
 *
 * The mapping from `SceneTriggerId` to component is a hard switch
 * rather than a registry so dead-code-elimination keeps unused scenes
 * out of the bundle by default. Add a case per new triggerable scene.
 */
export default function SceneTriggerHost() {
  const activeScene = useSceneTriggerStore((s) => s.activeScene);
  const activeOnComplete = useSceneTriggerStore((s) => s.activeOnComplete);
  const clearActiveScene = useSceneTriggerStore((s) => s.clearActiveScene);

  const handleComplete = useCallback(() => {
    // Run the caller's callback BEFORE clearing — the callback usually
    // opens a follow-up modal, and clearing first would render a frame
    // with no scene + no modal, briefly exposing the underlying UI.
    if (activeOnComplete) {
      try {
        activeOnComplete();
      } catch (err) {
        // Don't let a buggy callback strand the host in active state.
        console.error("[SceneTriggerHost] onComplete callback threw:", err);
      }
    }
    clearActiveScene();
  }, [activeOnComplete, clearActiveScene]);

  // A decorative scene gated off by POPUP_ANIMATIONS_ENABLED still needs to run
  // its onComplete (which often opens a follow-up modal, e.g. the bug report), so
  // we complete it from an EFFECT, never during render (calling handleComplete
  // mid-render would set state on this host and the follow-up modal as a side
  // effect of rendering). When the flag is on, the scene renders normally.
  const skipGated =
    activeScene === "bugstomp" && !POPUP_ANIMATIONS_ENABLED;
  useEffect(() => {
    if (skipGated) handleComplete();
  }, [skipGated, handleComplete]);

  if (activeScene === null || skipGated) return null;

  return renderScene(activeScene, handleComplete);
}

function renderScene(
  sceneId: SceneTriggerId,
  onComplete: () => void,
): React.ReactElement | null {
  switch (sceneId) {
    case "bugstomp":
      // Gated by POPUP_ANIMATIONS_ENABLED in the host above (it completes the
      // scene from an effect when the flag is off), so this only renders when on.
      return <BeakerBotBugStompScene active onComplete={onComplete} />;
    case "twirlMilestone":
      // The celebratory twirl, fired once per rare checkpoint milestone
      // by useMilestoneTwirlTrigger. Portals to body (prop omitted) like
      // every other global easter-egg scene.
      return <BeakerBotTwirlScene active onComplete={onComplete} />;
    default: {
      // Exhaustiveness guard: if we add a new SceneTriggerId without a
      // case here, TS will flag this assignment at compile time.
      const _exhaustive: never = sceneId;
      void _exhaustive;
      return null;
    }
  }
}

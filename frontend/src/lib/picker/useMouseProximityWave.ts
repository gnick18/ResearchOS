"use client";

import { useEffect, useRef, useState } from "react";
import type { BeakerBotPose } from "@/components/BeakerBot";

/**
 * Proximity-driven pose hook for the folder-picker BeakerBot.
 *
 * Returns a {@link BeakerBotPose} that flips between `"idle"` (the
 * default subtle bob) and `"waving"` (the wave keyframe) based on
 * mouse-cursor distance from the target element.
 *
 * Trigger rule:
 *   - When the cursor enters within `thresholdPx` of the target's center
 *     AND we are not currently inside the cooldown window, set pose to
 *     `"waving"` for `waveDurationMs`.
 *   - After the wave finishes, revert to `"idle"` and start a cooldown
 *     timer of `cooldownMs` during which the wave cannot retrigger
 *     (prevents flicker when the mouse loiters near BeakerBot).
 *   - Cursor leaving the threshold does NOT cut the wave short; the
 *     current wave plays to completion either way.
 *
 * Reduced-motion respect: if the OS prefers-reduced-motion is on, the
 * hook returns `"idle"` permanently. The proximity listener never
 * attaches. Matches BeakerBot's own internal reduced-motion handling.
 *
 * Composition note: this is intentionally NOT using
 * `BeakerBotMouseWaveScene` because that primitive is a portal-fixed
 * corner-anchored overlay. The picker BeakerBot is an in-flow centered
 * mascot, so the simpler pose-flip approach fits the layout.
 *
 * Caller wires a ref to the wrapper div around `<BeakerBot>` and passes
 * the returned pose to the `pose` prop.
 */
export interface UseMouseProximityWaveOptions {
  /** Distance from the target's center, in px, at which the wave
   *  triggers. Defaults to 200px which matches "the mouse came close
   *  to BeakerBot" at typical picker viewport sizes. */
  thresholdPx?: number;
  /** How long the wave plays before reverting to idle, in ms. */
  waveDurationMs?: number;
  /** After a wave completes, how long before the next one can fire.
   *  Prevents the mascot from waving frantically if the cursor lingers. */
  cooldownMs?: number;
}

const DEFAULT_THRESHOLD_PX = 200;
const DEFAULT_WAVE_MS = 1800;
const DEFAULT_COOLDOWN_MS = 3500;

export function useMouseProximityWave(
  targetRef: React.RefObject<HTMLElement | null>,
  options: UseMouseProximityWaveOptions = {},
): BeakerBotPose {
  const {
    thresholdPx = DEFAULT_THRESHOLD_PX,
    waveDurationMs = DEFAULT_WAVE_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = options;

  const [pose, setPose] = useState<BeakerBotPose>("idle");

  // Use refs for the gating state so the mousemove handler doesn't
  // need to be re-created on every render (which would mean removing
  // and re-attaching the listener constantly).
  const wavingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Respect reduced-motion. Single read on mount; if the user toggles
    // it mid-session they'll see the behavior change on next reload.
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) return;

    const handleMove = (event: MouseEvent) => {
      const el = targetRef.current;
      if (!el) return;
      if (wavingRef.current) return;
      if (Date.now() < cooldownUntilRef.current) return;

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= thresholdPx) {
        wavingRef.current = true;
        setPose("waving");
        if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
        waveTimerRef.current = setTimeout(() => {
          wavingRef.current = false;
          cooldownUntilRef.current = Date.now() + cooldownMs;
          setPose("idle");
        }, waveDurationMs);
      }
    };

    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
    };
  }, [targetRef, thresholdPx, waveDurationMs, cooldownMs]);

  return pose;
}

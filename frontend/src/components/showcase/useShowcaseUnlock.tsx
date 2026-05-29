"use client";

// frontend/src/components/showcase/useShowcaseUnlock.tsx
//
// The click-count unlock for the BeakerBot showcase (R3.9). Composes ON
// TOP of the existing per-click heart easter egg in BeakerBot.tsx
// (handleClick -> spawnHeart, capped at HEART_MAX_CONCURRENT = 6) without
// changing it: the brand-mark BeakerBot keeps easterEgg="heart" so clicks
// 1 to 6 still spawn hearts exactly as today. This hook only COUNTS the
// clicks; on the UNLOCK_CLICK_COUNT-th click (7, the "lucky" feel) it
// fires the Curtain Reveal and routes to /showcase instead of being just
// another heart.
//
// Wired into the AppShell brand-mark BeakerBot only (which also serves
// the public /demo, since /demo renders the same AppShell). Settings /
// tip-card BeakerBot instances do NOT use this hook, so they stay
// hearts-only (no surprise navigations mid-task).
//
// The counter is per-session and resets after the reveal so it stays a
// delight, not a chore. No emojis.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import CurtainReveal from "./CurtainReveal";

/** Clicks needed to unlock the backstage door. 7 = the "lucky" feel
 *  (R1/R2/R3). Clicks 1 to 6 spawn hearts (existing behavior); click 7
 *  fires the reveal. */
export const UNLOCK_CLICK_COUNT = 7;

/** The route the reveal lands on. */
export const SHOWCASE_ROUTE = "/showcase";

export interface UseShowcaseUnlockResult {
  /** Attach to the brand-mark BeakerBot's wrapper onClick. Call this on
   *  every click (it does not interfere with the heart easter egg, which
   *  fires from inside BeakerBot on the same click). */
  onBeakerBotClick: () => void;
  /** True while the Curtain Reveal transition is playing. */
  isRevealing: boolean;
  /** Render this where the brand mark lives; it is the CurtainReveal
   *  overlay (portaled to body) while revealing, else null. */
  revealElement: ReactNode;
}

export function useShowcaseUnlock(): UseShowcaseUnlockResult {
  const router = useRouter();
  const clickCountRef = useRef(0);
  const [isRevealing, setIsRevealing] = useState(false);

  const onBeakerBotClick = useCallback(() => {
    if (isRevealing) return; // ignore clicks mid-reveal
    clickCountRef.current += 1;
    if (clickCountRef.current >= UNLOCK_CLICK_COUNT) {
      clickCountRef.current = 0; // reset so it stays a delight
      setIsRevealing(true);
    }
    // Clicks below the threshold do nothing here; the heart easter egg
    // (internal to BeakerBot) handles the per-click feedback.
  }, [isRevealing]);

  const onRouteSwap = useCallback(() => {
    // Route change during the held beat (hidden behind the closed
    // curtain), so there is no flash of unstyled content.
    router.push(SHOWCASE_ROUTE);
  }, [router]);

  const onArrived = useCallback(() => {
    setIsRevealing(false);
  }, []);

  const revealElement = isRevealing ? (
    <CurtainReveal onRouteSwap={onRouteSwap} onArrived={onArrived} />
  ) : null;

  return { onBeakerBotClick, isRevealing, revealElement };
}

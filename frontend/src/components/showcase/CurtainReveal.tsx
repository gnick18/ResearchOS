"use client";

// frontend/src/components/showcase/CurtainReveal.tsx
//
// The Curtain Reveal unlock transition (R3.9). Frame-by-frame:
//   t=0..600ms      the dim: stage-black fades IN from the viewport
//                   edges inward (keeps the dark takeover from jarring
//                   against the light app/demo chrome).
//   t=600..1420ms   the plum stage curtains sweep CLOSED with a slight
//                   overshoot thunk.
//   t=1420..1820ms  the held beat (the route swap to /showcase happens
//                   here, hidden behind the closed curtain).
//   t=1820..2640ms  the curtains PART to reveal the marquee.
//   t=2640ms+       onArrived fires.
// Total ~2.6s. Doubles as the page-entry animation.
//
// Reduced motion (R3.10): instant cut to stage-black, curtains already
// parted, immediate onArrived. Rendered to document.body so it overlays
// the whole viewport above all app chrome. No emojis.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import styles from "./showcase.module.css";

/** Reveal milestones (ms from the 7th click), pinned from R3.9. */
export const REVEAL_ROUTE_SWAP_MS = 1420; // route change during the held beat
export const REVEAL_TOTAL_MS = 2640; // curtains finished parting

const subscribeNoop = () => () => {};
function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export default function CurtainReveal({
  onRouteSwap,
  onArrived,
  showToast = true,
}: {
  /** Fired at the held-beat (REVEAL_ROUTE_SWAP_MS) so the caller can
   *  navigate to /showcase while the closed curtain hides the swap. */
  onRouteSwap?: () => void;
  /** Fired once the curtains finish parting (REVEAL_TOTAL_MS). */
  onArrived?: () => void;
  showToast?: boolean;
}) {
  const mounted = useClientMounted();
  const [reducedMotion, setReducedMotion] = useState(false);
  const swapRef = useRef(onRouteSwap);
  const arrivedRef = useRef(onArrived);

  useEffect(() => {
    swapRef.current = onRouteSwap;
    arrivedRef.current = onArrived;
  }, [onRouteSwap, onArrived]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot snapshot of matchMedia on mount
    setReducedMotion(reduced);

    if (reduced) {
      // Instant cut: route swap immediately, arrive immediately.
      swapRef.current?.();
      const t = window.setTimeout(() => arrivedRef.current?.(), 50);
      return () => window.clearTimeout(t);
    }

    const swap = window.setTimeout(
      () => swapRef.current?.(),
      REVEAL_ROUTE_SWAP_MS,
    );
    const arrive = window.setTimeout(
      () => arrivedRef.current?.(),
      REVEAL_TOTAL_MS,
    );
    return () => {
      window.clearTimeout(swap);
      window.clearTimeout(arrive);
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.revealRoot}
      data-testid="showcase-curtain-reveal"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
    >
      <div className={styles.revealDim} />
      <div className={styles.revealBlack} />
      <div className={`${styles.revealCurtain} ${styles.revealCurtainLeft}`} />
      <div className={`${styles.revealCurtain} ${styles.revealCurtainRight}`} />
      {showToast && (
        <div className={styles.revealToast}>The stage is yours</div>
      )}
    </div>,
    document.body,
  );
}

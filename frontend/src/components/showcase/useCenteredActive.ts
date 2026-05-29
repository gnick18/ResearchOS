"use client";

// frontend/src/components/showcase/useCenteredActive.ts
//
// The IntersectionObserver sequencer (R1 section 4 Option 3, pinned in
// R3.8). Tracks a list of element refs and reports the index of the one
// most comfortably centered in the viewport. Exactly ONE index is active
// at a time, which is the no-overlap mechanism for the Performance Hall
// (only the active scene plays; others rest as posters) and also drives
// the runway's per-look spotlight / placard / flash entry.
//
// Threshold array [0, 0.5, 0.6, 1] + rootMargin "-20% 0px -20% 0px" so
// an element only goes active when it is comfortably centered, not as it
// is half-entering. When ratios tie (transitional scroll), the element
// whose bounding-rect center is closest to viewport center wins.

import { useEffect, useRef, useState } from "react";

export function useCenteredActive(count: number): {
  activeIndex: number;
  registerRef: (index: number) => (el: HTMLElement | null) => void;
} {
  const [activeIndex, setActiveIndex] = useState(0);
  // Sparse registry of element refs by index. Never sized or read during
  // render (only mutated in the ref callback + read inside the effect),
  // so it never triggers the refs-during-render lint rule.
  const elementsRef = useRef<Map<number, HTMLElement | null>>(new Map());

  const registerRef = (index: number) => (el: HTMLElement | null) => {
    if (el) {
      elementsRef.current.set(index, el);
    } else {
      elementsRef.current.delete(index);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;

    // Track each element's latest intersectionRatio so we can pick a
    // winner whenever any of them crosses a threshold.
    const ratios = new Map<Element, number>();

    const registry = elementsRef.current;

    const recomputeWinner = () => {
      const viewportCenter = window.innerHeight / 2;
      let best = -1;
      let bestRatio = -1;
      let bestCenterDist = Number.POSITIVE_INFINITY;
      registry.forEach((el, i) => {
        if (!el) return;
        const ratio = ratios.get(el) ?? 0;
        if (ratio < 0.6) return; // must be comfortably centered
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - viewportCenter);
        // Highest ratio wins; tie-break on proximity to viewport center.
        if (ratio > bestRatio + 0.001) {
          bestRatio = ratio;
          best = i;
          bestCenterDist = dist;
        } else if (Math.abs(ratio - bestRatio) <= 0.001 && dist < bestCenterDist) {
          best = i;
          bestCenterDist = dist;
        }
      });
      if (best >= 0) {
        setActiveIndex((prev) => (prev === best ? prev : best));
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.intersectionRatio);
        }
        recomputeWinner();
      },
      {
        threshold: [0, 0.5, 0.6, 1],
        rootMargin: "-20% 0px -20% 0px",
      },
    );

    registry.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      ratios.clear();
    };
  }, [count]);

  return { activeIndex, registerRef };
}

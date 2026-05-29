"use client";

// frontend/src/app/showcase/page.tsx
//
// The BeakerBot Drag Main Stage showcase (P1). A hidden, unlinked route
// (reachable by URL or via the click-count unlock on the AppShell brand
// mark; never in the main nav). Dark stage-black takeover EVERYWHERE per
// Grant's locked decision: no light variant. Audience is members AND the
// public /demo (both render the same AppShell brand mark that unlocks
// this route).
//
// Top to bottom:
//   - the persistent set (StageBackdrop: marquee, rainbow wash, plum
//     curtains + gold valance, light-up catwalk, tracking spotlight,
//     photographers' pit), rendered once behind the scroll;
//   - the "BeakerBot Live" marquee hero;
//   - the Runway (21 poses as snap-scroll looks with category placards);
//   - the Performance Hall (the scenes as one-at-a-time prosceniums);
//   - the curtain-call footer.
//
// See docs/proposals/BEAKERBOT_SHOWCASE_PROPOSAL.md (R3) for the spec.
// Built by the showcase-build P1 sub-bot per orchestrator manager.

import { useEffect, useRef } from "react";
import { StageBackdrop } from "@/components/showcase/StageChrome";
import { MarqueeHero, CurtainCallFooter } from "@/components/showcase/ShowcaseSections";
import Runway from "@/components/showcase/Runway";
import PerformanceHall from "@/components/showcase/PerformanceHall";
import styles from "@/components/showcase/showcase.module.css";

export default function ShowcasePage() {
  const hallRef = useRef<HTMLDivElement>(null);

  // Honor reduced motion at the scroll level: the snap is forced
  // (mandatory) for full motion and gentled (proximity) under
  // reduced motion. The CSS module media query handles the visual
  // collapse; here we set scroll-snap on the document scroller and
  // make the stage own the viewport (no app chrome on this route).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlSnap = html.style.scrollSnapType;
    const prevBodyBg = body.style.backgroundColor;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    html.style.scrollSnapType = reduced ? "y proximity" : "y mandatory";
    body.style.backgroundColor = "#0b0b12";
    return () => {
      html.style.scrollSnapType = prevHtmlSnap;
      body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  const skipToScenes = () => {
    hallRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={styles.stageRoot} data-testid="showcase-page">
      <StageBackdrop spotlightActive />
      {/* "Skip to the scenes" corner pin (R2/R3 optional polish). */}
      <button
        type="button"
        className={styles.skipPin}
        onClick={skipToScenes}
        data-testid="showcase-skip-pin"
      >
        Skip to the scenes
      </button>
      <MarqueeHero />
      <Runway />
      <div ref={hallRef}>
        <PerformanceHall />
      </div>
      <CurtainCallFooter />
    </div>
  );
}

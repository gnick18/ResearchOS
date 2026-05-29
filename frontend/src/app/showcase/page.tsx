"use client";

// frontend/src/app/showcase/page.tsx
//
// The BeakerBot showcase (P1, redesigned). A hidden, unlinked route
// (reachable by URL or via the click-count unlock on the AppShell brand
// mark; never in the main nav). Dark stage-black takeover EVERYWHERE per
// Grant's locked decision: no light variant. Audience is members AND the
// public /demo.
//
// Two shows, top to bottom:
//   - the persistent set (StageBackdrop: marquee, rainbow wash, plum
//     curtains + gold valance, light-up catwalk, tracking spotlight,
//     photographers' pit), rendered once behind everything;
//   - the "BeakerBot Live" marquee hero;
//   - the Runway: a self-contained AUTO-PLAYING show occupying the first
//     viewport. BeakerBot cycles all 21 emotions on a timer; the user
//     does NOT scroll to advance poses. Clicking fires camera flashes.
//   - scrolling DOWN past the runway reveals the Performance Hall (the
//     scenes as one-at-a-time prosceniums, still IntersectionObserver
//     driven);
//   - the curtain-call footer.
//
// See docs/proposals/BEAKERBOT_SHOWCASE_PROPOSAL.md (R3) for the spec.
// Redesigned by the showcase-runway-redesign sub-bot per orchestrator
// manager.

import { useEffect, useRef } from "react";
import { StageBackdrop } from "@/components/showcase/StageChrome";
import { MarqueeHero, CurtainCallFooter } from "@/components/showcase/ShowcaseSections";
import Runway from "@/components/showcase/Runway";
import PerformanceHall from "@/components/showcase/PerformanceHall";
import styles from "@/components/showcase/showcase.module.css";

export default function ShowcasePage() {
  const hallRef = useRef<HTMLDivElement>(null);

  // The route is a dark stage takeover: the body goes stage-black for the
  // duration. The runway is now a hands-free auto-show (no per-pose snap
  // scrolling), so we no longer force scroll-snap on the document; normal
  // scrolling carries the viewer from the runway show down to the
  // Performance Hall (whose own IntersectionObserver sequences the
  // scenes).
  useEffect(() => {
    const body = document.body;
    const prevBodyBg = body.style.backgroundColor;
    body.style.backgroundColor = "#0b0b12";
    return () => {
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

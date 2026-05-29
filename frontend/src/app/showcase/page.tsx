"use client";

// frontend/src/app/showcase/page.tsx
//
// The BeakerBot showcase (P1, redesigned). A hidden, unlinked route
// (reachable by URL or via the click-count unlock on the AppShell brand
// mark; never in the main nav). Dark stage-black takeover EVERYWHERE per
// Grant's locked decision: no light variant. Audience is members AND the
// public /demo.
//
// Change 3 (orchestrator manager): the page is no longer a long scroll
// between sections. It is a CLICK-SWITCHED two-view layout:
//   - the persistent set (StageBackdrop: marquee logo, rainbow wash, plum
//     curtains + gold valance, light-up catwalk, softened overhead beam,
//     photographers' pit) renders once behind everything;
//   - a persistent StageNav (marquee-style buttons) switches between:
//       * Runway view  - the auto-cycling runway (BeakerBot cycles all
//         21 looks on a timer; clicking fires camera flashes). The auto
//         show + its timer run ONLY while this view is mounted.
//       * Scenes view  - the Performance Hall (the one-scene-at-a-time
//         IntersectionObserver sequencer). The sequencer runs ONLY while
//         this view is mounted.
//   - the Leave control exits the show (routes back to home).
// Only one view is mounted at a time (Runway XOR Scenes), so each view's
// clock/sequencer is naturally gated by mount/unmount.
//
// The 7-click Curtain Reveal unlock (useShowcaseUnlock) and the BeakerBot
// marquee logo are untouched.
//
// See docs/proposals/BEAKERBOT_SHOWCASE_PROPOSAL.md (R3) for the spec.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StageBackdrop, Marquee } from "@/components/showcase/StageChrome";
import { StageNav, type ShowcaseView } from "@/components/showcase/ShowcaseSections";
import Runway from "@/components/showcase/Runway";
import PerformanceHall from "@/components/showcase/PerformanceHall";
import styles from "@/components/showcase/showcase.module.css";

export default function ShowcasePage() {
  const router = useRouter();
  const [view, setView] = useState<ShowcaseView>("runway");

  // The route is a dark stage takeover: the body goes stage-black for the
  // duration. With click nav (no scroll model) we do not touch scroll
  // behavior; the views fit a single screen each.
  useEffect(() => {
    const body = document.body;
    const prevBodyBg = body.style.backgroundColor;
    body.style.backgroundColor = "#0b0b12";
    return () => {
      body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  const leaveShow = () => {
    router.push("/");
  };

  return (
    <div
      className={styles.stageRoot}
      data-testid="showcase-page"
      data-view={view}
    >
      <StageBackdrop spotlightActive />

      {/* The BEAKERBOT marquee logo on its OWN page-level layer (above the
          backdrop AND the runway's dark overhead spotlight, below the
          StageNav), so it always reads fully lit and is never dimmed by the
          emotions-stage focus light. Position + design are identical to the
          old in-backdrop placement. */}
      <Marquee />

      {/* One view mounted at a time. Mounting gates each view's clock: the
          runway autoplay timer only runs while Runway is mounted, and the
          Performance Hall IntersectionObserver sequencer only runs while
          Scenes is mounted. */}
      {view === "runway" ? <Runway /> : <PerformanceHall />}

      {/* Persistent click nav: Runway / Scenes (views) + Leave (exit). */}
      <StageNav view={view} onSelect={setView} onLeave={leaveShow} />
    </div>
  );
}

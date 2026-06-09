"use client";

// Entry snap surface (account-setup revamp). One vertical scroll-snap container
// with two full-height sections:
//
//   Section 1 (top)    StartScreen, the 3 start actions. A bouncing
//                      "What is ResearchOS?" arrow snaps DOWN to section 2.
//   Section 2 (below)  the welcome / sell page. An inverse arrow at the top
//                      snaps UP to get back to the start actions.
//
// The welcome content is the existing WelcomePage embedded as-is; a separate
// effort reworks that page's content later. This component owns ONLY the snap
// mechanism and the two arrow affordances, so a welcome rework does not collide
// with it. The up-arrow is an overlay in this container, not inside WelcomePage.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useRef } from "react";

import LightOnly from "@/components/LightOnly";
import WelcomePage from "@/components/welcome/WelcomePage";
import {
  StartScreen,
  type StartScreenProps,
} from "@/components/onboarding/StartScreen";

export type EntrySnapSurfaceProps = Omit<StartScreenProps, "onScrollDown">;

export function EntrySnapSurface(props: EntrySnapSurfaceProps) {
  const startRef = useRef<HTMLDivElement>(null);
  const welcomeRef = useRef<HTMLDivElement>(null);

  const snapTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-screen overflow-y-auto snap-y snap-proximity">
      {/* Section 1: the start actions */}
      <section ref={startRef} className="snap-start">
        <StartScreen {...props} onScrollDown={() => snapTo(welcomeRef)} />
      </section>

      {/* Section 2: the welcome / sell page, with an inverse snap-up arrow */}
      <section ref={welcomeRef} className="relative snap-start">
        <button
          type="button"
          onClick={() => snapTo(startRef)}
          aria-label="Back to get started"
          className="absolute top-4 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-brand-action shadow-sm backdrop-blur hover:text-brand-ink transition-colors animate-bounce"
        >
          <span className="block w-3 h-3 border-t-2 border-l-2 border-current rotate-45" />
          <span className="text-xs font-medium">Back to get started</span>
        </button>
        <LightOnly>
          <WelcomePage />
        </LightOnly>
      </section>
    </div>
  );
}

export default EntrySnapSurface;

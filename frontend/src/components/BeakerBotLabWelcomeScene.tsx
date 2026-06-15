"use client";

// <BeakerBotLabWelcomeScene />
//
// An INLINE welcome scene for the branded lab-join page (Phase 2). BeakerBot
// stands and waves while holding up a small sign that shows the lab name (or the
// PI line). Modeled on BeakerBotMouseWaveScene's wave feel, but in-flow rather
// than a fixed-position portal, since here the scene IS the hero, not a corner
// easter egg.
//
// Brand rule: BeakerBot stays pastel (the rainbow liquid is a hardcoded gradient,
// not currentColor, so the sky-500 tint only colors the outline). The sign is a
// plain card on a stick so the lab name reads clearly without competing with the
// mascot.
//
// Motion: a gentle three-beat wave pulse layered on the waving pose, plus a soft
// rise-in on mount. Fully disabled under prefers-reduced-motion (the keyframes go
// to a static waving pose).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import BeakerBot from "./BeakerBot";

export default function BeakerBotLabWelcomeScene({
  signText,
  className = "",
}: {
  /** The short label shown on the held sign. Usually the lab name. */
  signText: string;
  className?: string;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => mql.removeEventListener?.("change", sync);
  }, []);

  // Keep the sign label from overflowing the card.
  const label =
    signText.length > 28 ? `${signText.slice(0, 27)}…` : signText;

  return (
    <div
      data-testid="beakerbot-lab-welcome-scene"
      aria-hidden="true"
      className={`relative mx-auto flex h-40 w-full max-w-sm items-end justify-center ${className}`.trim()}
    >
      <style>{`
        @keyframes bblw-wave-pulse {
          0%   { transform: rotate(0deg); }
          16%  { transform: rotate(-8deg); }
          33%  { transform: rotate(0deg); }
          50%  { transform: rotate(-8deg); }
          66%  { transform: rotate(0deg); }
          83%  { transform: rotate(-8deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes bblw-rise-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* The held sign, tucked to BeakerBot's left so the waving arm stays free
          on the right. A card on a short stick. */}
      <div
        data-testid="beakerbot-lab-welcome-sign"
        className="absolute bottom-6 left-2 flex flex-col items-center"
        style={{
          animation: reducedMotion ? undefined : "bblw-rise-in 420ms ease-out both",
          animationDelay: reducedMotion ? undefined : "120ms",
        }}
      >
        <div className="max-w-[12rem] rounded-lg border border-border bg-surface px-3 py-1.5 text-center shadow-sm">
          <span className="block text-meta font-semibold leading-tight text-foreground">
            {label}
          </span>
        </div>
        {/* The stick. */}
        <div className="h-6 w-1 rounded-b bg-border" />
      </div>

      {/* BeakerBot, waving. The wave-pulse rotates the wrapper a few degrees
          back and forth on top of the static waving pose, just like the
          mouse-wave scene. */}
      <div
        className="relative"
        style={{
          width: 128,
          height: 128,
          transformOrigin: "center bottom",
          animation: reducedMotion ? undefined : "bblw-wave-pulse 1500ms ease-in-out infinite",
        }}
      >
        <BeakerBot
          pose="waving"
          direction="right"
          animated={!reducedMotion}
          className="h-full w-full text-sky-500"
          ariaLabel="BeakerBot, the ResearchOS assistant, waving hello"
        />
      </div>
    </div>
  );
}

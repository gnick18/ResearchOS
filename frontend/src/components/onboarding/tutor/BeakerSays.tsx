"use client";

// Onboarding tutor — Beaker, speaking.
//
// The ONE shared composition for "Beaker says something" across every tutor beat
// (welcome / interest picker / deep demos / memory / recap): BeakerBot at his full
// signature size, OUTSIDE/beside the beat content, with a speech bubble in his
// signature AI voice font (--font-ai). Beats used to each roll their own tiny
// Beaker + plain-font bubble, so he looked small and off-brand on the later beats.
// Routing them all through this keeps him consistent.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { ReactNode } from "react";
import BeakerBot from "@/components/BeakerBot";

export interface BeakerSaysProps {
  /** The line(s) Beaker speaks, rendered inside the bubble. */
  children: ReactNode;
  /** Extra classes on the wrapper row (e.g. a width cap to match the beat below). */
  className?: string;
}

export default function BeakerSays({ children, className = "" }: BeakerSaysProps) {
  return (
    <div className={`mb-3 flex items-start gap-3 ${className}`}>
      <div className="h-40 w-40 flex-none">
        <BeakerBot pose="idle" animated alive ariaLabel="Beaker" className="h-full w-full" />
      </div>
      <div
        className="mt-7 max-w-md rounded-xl rounded-tl-sm border border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)] px-3.5 py-2.5 text-base text-[var(--fg,#1f2421)]"
        style={{ fontFamily: "var(--font-ai)" }}
      >
        {children}
      </div>
    </div>
  );
}

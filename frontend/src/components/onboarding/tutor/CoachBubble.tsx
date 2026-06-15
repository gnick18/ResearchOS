"use client";

// Onboarding tutor — the coach bubble.
//
// Beaker's narration while he drives a page. A floating bubble with a mini
// Beaker, anchored on the page (NOT the chat panel, which only appears for the
// one AI demo). Shows the handoff line for the current beat. Presentational, the
// parent passes the line and an optional anchor position. No emojis, no
// em-dashes, no mid-sentence colons.

import { BeakerBotScene } from "@/components/onboarding/BeakerBotScene";

export interface CoachBubbleProps {
  line: string | null;
  /** Optional anchor in the stage's coordinate space. Defaults to bottom-left. */
  x?: number;
  y?: number;
}

export default function CoachBubble({ line, x, y }: CoachBubbleProps) {
  if (!line) return null;
  const positioned = x !== undefined && y !== undefined;
  return (
    <div
      className="pointer-events-none absolute z-[58] flex max-w-[230px] items-end gap-2"
      style={positioned ? { left: x, top: y } : { left: 16, bottom: 16 }}
    >
      <div className="h-7 w-7 flex-none">
        <BeakerBotScene name="solo" className="h-full w-full" />
      </div>
      <div className="rounded-xl rounded-bl-sm bg-[var(--surface,#fff)] px-3 py-2 text-xs shadow-lg">
        {line}
      </div>
    </div>
  );
}

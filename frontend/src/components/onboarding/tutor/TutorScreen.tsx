"use client";

// Onboarding tutor — shared screen frame.
//
// Every beat after the welcome hero sits on the same signature backdrop (the
// drifting pastel-rainbow auroras + dot grid) over an opaque base, so no beat is
// a barren white page and the whole run feels like one continuous stage. The
// welcome uses its own vivid hero treatment; these content beats use the quiet
// "soft" tone so the brand life is present without competing with the content.
//
// Render the beat's content as children; it is centered in a relative z-10 layer
// above the wash. No emojis, no em-dashes, no mid-sentence colons.

import type { ReactNode } from "react";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";

export interface TutorScreenProps {
  children: ReactNode;
  /** "soft" (default) for content beats, "vivid" for hero moments. */
  tone?: "soft" | "vivid";
  /** Extra classes on the centered content layer (e.g. flex-col). */
  contentClassName?: string;
}

export default function TutorScreen({
  children,
  tone = "soft",
  contentClassName = "",
}: TutorScreenProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[var(--bg,#f6f7f5)]">
      <MarketingBackdrop tone={tone} />
      <div
        className={`relative z-10 flex h-full w-full items-center justify-center px-6 ${contentClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

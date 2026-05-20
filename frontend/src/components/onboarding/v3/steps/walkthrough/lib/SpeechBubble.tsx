import type { ReactNode } from "react";

/**
 * Small layout primitive the W1-W9 step bodies use to render
 * BeakerBot's static speech text (L12: speech bubble is static, no
 * typewriter animation on the speech itself — the live-typing
 * animations belong to the demo surfaces below).
 *
 * The wizard shell already renders the BeakerBot mascot in the modal
 * header; this component is purely the speech text card that sits at
 * the top of every walkthrough step.
 */

interface SpeechBubbleProps {
  children: ReactNode;
}

export default function SpeechBubble({ children }: SpeechBubbleProps) {
  return (
    <div
      data-beakerbot-speech
      className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 leading-relaxed"
    >
      {children}
    </div>
  );
}

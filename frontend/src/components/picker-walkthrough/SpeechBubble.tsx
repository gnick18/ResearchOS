"use client";

import type { ReactNode } from "react";

/**
 * White speech bubble that sits below BeakerBot on every walkthrough
 * beat. A small upward-pointing notch on the top edge visually anchors
 * the bubble to BeakerBot above it. The bubble itself is a white card
 * with a sky-blue border, matching the v4 wizard's modal voice so the
 * walkthrough reads as continuous with the in-product tour.
 *
 * The notch is rendered with a layered pair of absolutely-positioned
 * triangles (outer = border color, inner = white) so the seam between
 * bubble and notch reads cleanly without an extra SVG.
 *
 * Salvaged from the retired pre-onboarding flow (75c6107b) and rehomed
 * under picker-walkthrough/ as the opt-in walkthrough modal's shared
 * bubble component.
 */
export interface SpeechBubbleProps {
  children: ReactNode;
  /** Optional test id passthrough so beat-specific tests can pin the
   *  bubble for that beat without grepping shared markup. */
  testId?: string;
  /** Widens the bubble for beats that host a wide interactive (the
   *  data-flow explainer). Default keeps the narrow reading width. */
  wide?: boolean;
}

export default function SpeechBubble({
  children,
  testId,
  wide = false,
}: SpeechBubbleProps) {
  return (
    <div
      className={`relative mt-4 w-full ${wide ? "max-w-3xl" : "max-w-xl"}`}
      data-testid={testId}
    >
      {/* Notch border (outer triangle, sky-300) */}
      <div
        aria-hidden="true"
        className="absolute -top-3 left-1/2 h-0 w-0 -translate-x-1/2"
        style={{
          borderLeft: "10px solid transparent",
          borderRight: "10px solid transparent",
          borderBottom: "12px solid rgb(125, 211, 252)",
        }}
      />
      {/* Notch fill (inner triangle, white, 1px lower to leave a 1px
          sky-blue line as the visible "border") */}
      <div
        aria-hidden="true"
        className="absolute -top-2 left-1/2 h-0 w-0 -translate-x-1/2"
        style={{
          borderLeft: "9px solid transparent",
          borderRight: "9px solid transparent",
          borderBottom: "11px solid white",
        }}
      />
      <div className="rounded-2xl border border-sky-300 bg-white p-6 text-slate-900 shadow-xl">
        {children}
      </div>
    </div>
  );
}

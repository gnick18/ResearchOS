"use client";

// The exact bubbling BeakerBot from the marketing-deck title slide
// (docs/mockups/2026-06-10-entry-flow-oauth-first.html, the .introbot SVG). The
// shared <BeakerBot> component draws on a different viewBox, so the deck's bubble
// overlay (whose positions are geometry-matched to THIS drawing) only sits inside
// the glass when paired with this exact SVG. That mismatch is why the hero
// bubbles floated outside the beaker.
//
// It is the same sky-blue BeakerBot character, just the self-contained title-slide
// rendering with the pastel-rainbow liquid. Lives under components/animations/
// (icon-guard exempt) because it is a decorative animated mark, not a registry
// icon. The gradient id is per-instance (useId) so two of these never collide.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useId } from "react";

export function IntroBeaker({ className }: { className?: string }) {
  const liq = useId();
  return (
    <svg
      viewBox="8 3 24 31"
      fill="none"
      stroke="#1AA0E6"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={liq} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD2B0" />
          <stop offset="25%" stopColor="#FFF1A8" />
          <stop offset="50%" stopColor="#B7EBB1" />
          <stop offset="75%" stopColor="#A6D2F4" />
          <stop offset="100%" stopColor="#D6B5F0" />
        </linearGradient>
      </defs>
      {/* White glass body, then the wavy pastel liquid on top of it. */}
      <path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
        stroke="none"
      />
      <path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill={`url(#${liq})`}
        stroke="none"
      />
      {/* Lip curl, glass outline, rim. */}
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      <path d="M11 12 L29 12" />
      {/* Eyes + smile. */}
      <circle cx="17" cy="18" r="1.2" fill="#1AA0E6" stroke="none" />
      <circle cx="23" cy="18" r="1.2" fill="#1AA0E6" stroke="none" />
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Little arms. */}
      <path d="M14 26 L15.5 26" />
      <path d="M24.5 26 L26 26" />
    </svg>
  );
}

export default IntroBeaker;

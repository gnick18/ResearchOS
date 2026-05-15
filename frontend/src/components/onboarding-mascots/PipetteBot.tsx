"use client";

/**
 * PipetteBot — anthropomorphized micropipette-tip mascot for the
 * onboarding-tips system. Same prop/style contract as `BeakerBot.tsx`:
 * 40×40 viewBox, 2px currentColor strokes, rounded caps/joins, no fills
 * except eye dots.
 *
 * Design choice: tapered cone shape (wider top "barrel" tapering to a
 * single point at the bottom), with a small cap-disc at the very top
 * (the plunger-collar), two eye dots on the wide upper section, and a
 * subtle volume-graduation tick on one side. The cone IS the mascot's
 * defining silhouette — different from BeakerBot's rounded body, the
 * dish's flat oval, the owl's egg, and the tardigrade's segmented oval.
 *
 * Pointing mechanism (deliberately different from the other mascots):
 * because the cone tapers to a natural point at its bottom, there's no
 * separate "arm" — the WHOLE TIP rotates so the cone's point aims at
 * the target. `direction="right"` rotates the outer group ~-55° about
 * its center (point swings to the lower-right / east-southeast).
 * `direction="left"` rotates +55° (point swings to the lower-left).
 * Idle pose: zero rotation, point straight down. This keeps the mascot
 * geometrically clean and lab-iconic.
 */

export interface PipetteBotProps {
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export default function PipetteBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
}: PipetteBotProps) {
  // The cone naturally points down (south). For the pointing pose, rotate
  // the whole group about the visual center so the tip swings to the side.
  // ~-55° for right, ~+55° for left — angles chosen so the tip clears the
  // viewBox bottom but still reads as "directional."
  const rotation = pose === "pointing" ? (direction === "left" ? 55 : -55) : 0;
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ariaLabel}
      className={className ?? "w-10 h-10 text-sky-500"}
    >
      <g transform={rotation !== 0 ? `rotate(${rotation} 20 20)` : undefined}>
        {/* Plunger collar — flat cap at the very top */}
        <path d="M14 6 L26 6" />
        {/* Barrel shoulders — short verticals from cap into the wide top */}
        <path d="M15 6 L15 9" />
        <path d="M25 6 L25 9" />
        {/* Body — tapered cone: wide top to single point at the bottom */}
        <path d="M13 9 L13 18 L20 34 L27 18 L27 9 Z" />
        {/* Wide-section divider — horizontal line where the barrel meets the taper */}
        <path d="M13 18 L27 18" />
        {/* Volume tick on the left side of the barrel */}
        <path d="M15 13 L17 13" />
        {/* Eyes — sit on the wide upper barrel section */}
        <circle cx="17" cy="13" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="23" cy="13" r="1.1" fill="currentColor" stroke="none" />
        {/* Small smile below the eyes */}
        <path d="M18 16 Q 20 17.5, 22 16" />
      </g>
    </svg>
  );
}

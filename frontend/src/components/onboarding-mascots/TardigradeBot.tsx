"use client";

/**
 * TardigradeBot — chibi water bear mascot variant for the onboarding-tips
 * system. Same prop/style contract as `BeakerBot.tsx` (40×40 viewBox,
 * 2px currentColor strokes, rounded caps/joins, no fill except eyes +
 * pointer triangle).
 *
 * Design choice: a horizontally-oriented chubby segmented body (three
 * segment dividers across a tall-oval silhouette) with four stubby legs
 * along the bottom and four along the top edge — the brief calls for 8
 * legs, and a side-view tardigrade reads more obviously as "water bear"
 * than a top-down one at icon scale. Eyes are two dots near the front
 * of the body; a tiny mouth-stitch sits between them. Two short bristle
 * marks on the back add the squishy-biology texture.
 *
 * Pointing pose: the front-most leg extends forward and outward, ending
 * in a filled triangle ("claw point"). `direction="left"` mirrors the
 * whole SVG via `transform: scaleX(-1)` so the claw points west, exactly
 * like BeakerBot.
 */

export interface TardigradeBotProps {
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export default function TardigradeBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
}: TardigradeBotProps) {
  const flip = pose === "pointing" && direction === "left";
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
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      {/* Body — chubby horizontal oval, head on the right side */}
      <path d="M8 18 C 8 12, 14 10, 22 10 C 30 10, 34 14, 34 20 C 34 26, 30 28, 22 28 C 14 28, 8 24, 8 18 Z" />
      {/* Segment dividers (three) — curved lines across the body */}
      <path d="M15 11 Q 15 19, 15 27" />
      <path d="M22 10 Q 22 19, 22 28" />
      <path d="M28 10.5 Q 28 19, 28 27.5" />
      {/* Bottom legs — 4 stubby nubs */}
      <path d="M11 26 L11 30" />
      <path d="M18 28 L18 32" />
      <path d="M25 28 L25 32" />
      <path d="M31 26 L31 30" />
      {/* Top legs — 4 stubby nubs (these add the "many legs" silhouette) */}
      <path d="M11 11 L11 7.5" />
      <path d="M18 10 L18 6.5" />
      <path d="M25 10 L25 6.5" />
      <path d="M31 11 L31 7.5" />
      {/* Eyes — front of the body (right side) */}
      <circle cx="29" cy="16" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="32" cy="17" r="1.1" fill="currentColor" stroke="none" />
      {/* Tiny mouth — a single stitch between the eyes and the front */}
      <path d="M32 20 Q 33 21, 33.5 20.2" />
      {pose === "pointing" && (
        <>
          {/* Front leg extended forward and outward */}
          <path d="M31 26 L36 28" />
          {/* Claw triangle — fills currentColor so it reads as a pointer */}
          <path d="M36 28 L37 30 L38 27 Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

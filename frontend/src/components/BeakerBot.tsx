"use client";

/**
 * Inline-SVG mascot for the onboarding tip system. Two pose variants,
 * `idle` (eyes neutral, smile) and `pointing` (one arm raised + finger
 * triangle), with a `direction` flip for the pointing pose so the bot
 * faces the target.
 *
 * All paths use `stroke="currentColor"` so the parent can tint via any
 * Tailwind text-color utility. 2px stroke + rounded line caps and joins
 * match the rest of the app's icon family — see the icon-style sweep
 * commits (`f3e39af3`, `11054b2a`, `1bc9fe36`, `72b0c385`) for the
 * convention.
 *
 * Aesthetic is from proposal §"Direction 1 — Beaker-bot": round-bottomed
 * chemistry-beaker silhouette, two dot eyes, rounded smile, hair-flick,
 * measurement-mark cheek dashes.
 */

export interface BeakerBotProps {
  pose: "idle" | "pointing";
  /** Pointing direction. Ignored for `pose="idle"`. When "left", the
   *  whole SVG flips horizontally so the finger points west. */
  direction?: "left" | "right";
  /** Tailwind class string applied to the wrapping <svg>. Default sizes
   *  it to 40×40 and tints `text-sky-500`. */
  className?: string;
  /** Accessible label. Defaults to "ResearchOS assistant". */
  ariaLabel?: string;
}

export default function BeakerBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
}: BeakerBotProps) {
  // Mirror via CSS transform so the path data stays canonical (cheaper
  // than maintaining two mirrored sets).
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
      {/* Hair flick — a small curl at the top, anime-ish */}
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      {/* Body — rounded-bottom beaker silhouette */}
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      {/* Beaker lip */}
      <path d="M11 12 L29 12" />
      {/* Eyes — filled dots, no stroke outline so they read at small sizes */}
      <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
      {/* Smile */}
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Measurement-mark "cheek" dashes */}
      <path d="M14 25 L15.5 25" />
      <path d="M24.5 25 L26 25" />
      {pose === "pointing" && (
        <>
          {/* Arm extended right */}
          <path d="M28 18 L33 16" />
          {/* Finger triangle — fills currentColor so it reads as a
              directional arrow at-a-glance. */}
          <path d="M33 16 L32 14 L34.5 15 Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

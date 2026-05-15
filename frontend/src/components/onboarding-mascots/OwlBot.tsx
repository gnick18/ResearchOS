"use client";

/**
 * OwlBot — chubby round-owl mascot variant for the onboarding-tips
 * system. Same prop/style contract as `BeakerBot.tsx`: 40×40 viewBox,
 * 2px currentColor strokes, rounded caps/joins, no fills except eye
 * pupils and the pointer triangle.
 *
 * Design choice: tall-egg owl silhouette with two pointed tufted ear
 * horns at the top, two large round eye discs (concentric rings with a
 * dot pupil — distinct from BeakerBot's tiny dot eyes), a small
 * triangular beak between them, and a hint of belly feathering as a
 * curved chest line. The two ear tufts are what makes the silhouette
 * unmistakably owl even at 16px.
 *
 * Pointing pose: one wing extends outward from the body, ending in a
 * filled triangle pointer. `direction="left"` mirrors the whole SVG via
 * `transform: scaleX(-1)` so the wing points west, identical to BeakerBot.
 */

export interface OwlBotProps {
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export default function OwlBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
}: OwlBotProps) {
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
      {/* Ear tufts — two short triangular horns at the top */}
      <path d="M13 10 L11 6 L14.5 8 Z" />
      <path d="M27 10 L29 6 L25.5 8 Z" />
      {/* Body — chubby egg silhouette */}
      <path d="M9 18 C 9 11, 14 8, 20 8 C 26 8, 31 11, 31 18 L31 26 C 31 31, 26 33, 20 33 C 14 33, 9 31, 9 26 Z" />
      {/* Eye discs — concentric: outer ring + filled pupil */}
      <circle cx="16" cy="17" r="3" />
      <circle cx="24" cy="17" r="3" />
      <circle cx="16" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="24" cy="17" r="1.1" fill="currentColor" stroke="none" />
      {/* Beak — small downward triangle between the eyes */}
      <path d="M19 21 L21 21 L20 23 Z" />
      {/* Belly feather curve — soft chest line */}
      <path d="M14 24 Q 20 28, 26 24" />
      {pose === "pointing" && (
        <>
          {/* Wing extended outward — short curved line from body */}
          <path d="M30 22 Q 33 22, 35 21" />
          {/* Pointer triangle at the wing tip */}
          <path d="M35 21 L37 22 L35 23.5 Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

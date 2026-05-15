"use client";

/**
 * PetriDishBot — a small round culture-dish mascot for the onboarding-tips
 * system. Same prop/style contract as `BeakerBot.tsx`: 40×40 viewBox,
 * 2px currentColor strokes, rounded caps/joins, no fills except eye dots
 * and the pointer triangle.
 *
 * Design choice: side-on petri-dish silhouette — a low rounded dish
 * (wide ellipse base) topped by a thin rim ellipse to suggest the lid.
 * Two eyes peek over the rim from inside the dish; a small smile arc
 * sits below. The flat, wide silhouette is the visual identity and is
 * what makes this distinct from the round-bodied BeakerBot — even at
 * 16px it reads as "wide low dish."
 *
 * Pointing pose: an "agar splash" tendril rises over the rim and curves
 * outward, ending in a filled triangle. `direction="left"` mirrors the
 * whole SVG so the splash points west — same model as BeakerBot.
 */

export interface PetriDishBotProps {
  pose: "idle" | "pointing";
  direction?: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export default function PetriDishBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
}: PetriDishBotProps) {
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
      {/* Dish body — wide low rounded rectangle (the "bowl") */}
      <path d="M6 18 L6 28 C 6 31, 9 33, 12 33 L28 33 C 31 33, 34 31, 34 28 L34 18" />
      {/* Rim ellipse top — flat oval cap suggesting the lid edge */}
      <ellipse cx="20" cy="18" rx="14" ry="3" />
      {/* Eyes peeking over the rim — sit just above the back rim line */}
      <circle cx="16" cy="17" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="24" cy="17" r="1.2" fill="currentColor" stroke="none" />
      {/* Smile — small arc below the eyes, inside the dish */}
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Two small agar-colony dots inside the dish for texture */}
      <circle cx="13" cy="27" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="27" cy="28" r="0.9" fill="currentColor" stroke="none" />
      {pose === "pointing" && (
        <>
          {/* Splash tendril — rises over the back rim and curves outward */}
          <path d="M30 17 C 32 13, 35 13, 36 15" />
          {/* Pointer triangle at the tip */}
          <path d="M36 15 L38 14 L37 17 Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

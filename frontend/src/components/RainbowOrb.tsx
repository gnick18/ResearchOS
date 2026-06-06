"use client";

// The rainbow user identity ("pastel" / "vivid") rendered as a self-contained
// SVG circle. We use SVG instead of a CSS background gradient because a CSS
// gradient painted onto a bordered, rounded element tiles into the 2px border
// box and shows reversed color slivers on the left/right edges (the long-running
// "square in a circle" artifact). An SVG <circle> clips its own <linearGradient>
// to the disc, so the rainbow is always clean at any size, bordered or not.
//
// Drop it in as an absolutely-positioned fill behind avatar letters, or as the
// whole swatch. The gradient id is per-instance (useId) so multiple orbs on one
// page never collide.

import { useId } from "react";

import {
  RAINBOW_PASTEL_STOPS,
  RAINBOW_VIVID_STOPS,
  type RainbowVariant,
} from "@/lib/colors";

export default function RainbowOrb({
  variant,
  className,
}: {
  variant: RainbowVariant;
  /** Sizing / positioning classes (e.g. "absolute inset-0 h-full w-full"). */
  className?: string;
}) {
  const uid = useId();
  const gid = `ros-rainbow-${uid}`;
  const stops = variant === "vivid" ? RAINBOW_VIVID_STOPS : RAINBOW_PASTEL_STOPS;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          {stops.map((c, i) => (
            <stop
              key={c}
              offset={i / (stops.length - 1)}
              stopColor={c}
            />
          ))}
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${gid})`} />
    </svg>
  );
}

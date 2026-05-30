"use client";

// frontend/src/components/showcase/clickRewardAssets.tsx
//
// Custom inline-SVG assets for the /showcase click rewards (click-rewards
// sub-bot, orchestrator manager). All hand-drawn, no emojis. Palette pinned
// to the stage: gold #E7C873, white sparkle, plum #3a1d3d / #4a2750, rose
// reds + greens, rainbow liquid stops for confetti. Each is a small, self-
// contained <svg> the overlay positions absolutely. aria-hidden throughout.

import type { CSSProperties } from "react";

/* ── Tier 1: cursor burst pieces ───────────────────────────────────────── */

/** A four-point sparkle / twinkle (gold-white). The Tier-1 spray + the
 *  Tier-2 edge twinkles both use this. */
export function SparkleSvg({
  size = 18,
  color = "#FFF1A8",
  style,
  className,
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M12 0 C13 7 17 11 24 12 C17 13 13 17 12 24 C11 17 7 13 0 12 C7 11 11 7 12 0 Z"
        fill={color}
      />
    </svg>
  );
}

/** A tiny five-point star (gold). A heavier accent in the Tier-1 spray. */
export function StarSvg({
  size = 16,
  color = "#E7C873",
  style,
  className,
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M12 1.5 L15 9 L23 9.5 L16.8 14.4 L19 22 L12 17.5 L5 22 L7.2 14.4 L1 9.5 L9 9 Z"
        fill={color}
      />
    </svg>
  );
}

/* ── Tier 2: thrown tributes ───────────────────────────────────────────── */

/** A long-stemmed rose, drawn pointing up (the overlay rotates it along the
 *  throw arc). Red bloom + green stem and leaf. */
export function RoseSvg({
  size = 40,
  style,
  className,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 100"
      width={size}
      height={size * 2.5}
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* stem */}
      <path
        d="M20 30 C20 55 20 75 20 96"
        stroke="#2f7d3a"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* leaf */}
      <path
        d="M20 60 C10 58 5 64 4 72 C14 73 20 68 20 60 Z"
        fill="#3a9b49"
      />
      <path
        d="M20 72 C30 70 35 76 36 84 C26 85 20 80 20 72 Z"
        fill="#2f7d3a"
      />
      {/* outer petals */}
      <path
        d="M20 4 C7 4 2 14 4 24 C6 33 14 36 20 35 C26 36 34 33 36 24 C38 14 33 4 20 4 Z"
        fill="#c2253b"
      />
      {/* inner bloom swirl */}
      <path
        d="M20 11 C13 11 10 17 12 23 C14 28 18 29 20 28 C22 29 26 28 28 23 C30 17 27 11 20 11 Z"
        fill="#e2415a"
      />
      <path
        d="M20 16 C16 16 14 20 16 24 C18 27 20 26 20 24 C20 26 22 27 24 24 C26 20 24 16 20 16 Z"
        fill="#a81b30"
      />
    </svg>
  );
}

/** A cheeky thrown bra: two soft cups + connecting band + a strap. Simple,
 *  cartoonish, plum/pink, tasteful (Grant asked for it among the roses). */
export function BraSvg({
  size = 48,
  style,
  className,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 40"
      width={size}
      height={size * 0.625}
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* straps */}
      <path
        d="M12 20 C8 10 6 6 10 3"
        stroke="#d77ba8"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M52 20 C56 10 58 6 54 3"
        stroke="#d77ba8"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* left cup */}
      <path
        d="M5 18 C5 30 12 36 20 36 C28 36 31 28 31 20 C31 18 30 17 28 17 C18 16 9 16 7 16 C6 16 5 17 5 18 Z"
        fill="#ec9cc4"
        stroke="#d77ba8"
        strokeWidth="1.5"
      />
      {/* right cup */}
      <path
        d="M59 18 C59 30 52 36 44 36 C36 36 33 28 33 20 C33 18 34 17 36 17 C46 16 55 16 57 16 C58 16 59 17 59 18 Z"
        fill="#ec9cc4"
        stroke="#d77ba8"
        strokeWidth="1.5"
      />
      {/* center bow / clasp */}
      <circle cx="32" cy="19" r="2.4" fill="#d77ba8" />
    </svg>
  );
}

/* ── Tier 2: confetti + applause ───────────────────────────────────────── */

const CONFETTI_COLORS = [
  "#FFD2B0",
  "#FFF1A8",
  "#B7EBB1",
  "#A6D2F4",
  "#D6B5F0",
  "#E7C873",
];

/** A single confetti rectangle. The color cycles through the rainbow liquid
 *  stops + gold so a flurry reads festive. */
export function ConfettiSvg({
  colorIndex = 0,
  size = 12,
  style,
  className,
}: {
  colorIndex?: number;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const color = CONFETTI_COLORS[colorIndex % CONFETTI_COLORS.length]!;
  return (
    <svg
      viewBox="0 0 12 16"
      width={size}
      height={size * 1.33}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="10" height="14" rx="2" fill={color} />
    </svg>
  );
}

/** A small clapping / open-hand silhouette for the edge applause flourish.
 *  Plain gold mitt shape (four fingers + thumb), no face, no emoji. */
export function ClapHandSvg({
  size = 26,
  color = "#E7C873",
  style,
  className,
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 28"
      width={size}
      height={size * 1.17}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M6 14 L6 6 C6 4.5 8 4.5 8 6 L8 12 L9.5 12 L9.5 3.5 C9.5 2 11.5 2 11.5 3.5 L11.5 12 L13 12 L13 3 C13 1.5 15 1.5 15 3 L15 12 L16.5 12 L16.5 5 C16.5 3.5 18.5 3.5 18.5 5 L18.5 16 C18.5 22 15 26 11 26 C7.5 26 5 23.5 4 20 L2.5 15.5 C2 14 4 12.8 5 14 Z"
        fill={color}
      />
    </svg>
  );
}

export { CONFETTI_COLORS };

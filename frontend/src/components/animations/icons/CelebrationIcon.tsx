import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * CelebrationIcon: a party cone (confetti cannon) erupting with ribbons,
 * stars, and a sparkle. Readable at small sizes (w-5 h-5) — the cone +
 * burst silhouette stays legible while the bright pastel-on-bright color
 * pops at larger sizes. Uses hardcoded celebration palette so it reads as
 * a party regardless of parent `color` inheritance.
 */
const CelebrationIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
  >
    <defs>
      <linearGradient id="celebration-icon-cone" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#ff6b9d" />
        <stop offset="100%" stopColor="#feca57" />
      </linearGradient>
      <linearGradient id="celebration-icon-star" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fff8dc" />
        <stop offset="100%" stopColor="#feca57" />
      </linearGradient>
    </defs>

    {/* Party cone (confetti cannon), pointing up-right */}
    <path
      d="M3 21 L9 15 L13 19 L7 21 Z"
      fill="url(#celebration-icon-cone)"
      stroke="#ff5e7e"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    {/* Cone stripes for festive texture */}
    <path d="M5.5 18.5 L7 20" stroke="#fff" strokeWidth="0.7" strokeLinecap="round" opacity="0.85" />
    <path d="M8 17.5 L10 19.5" stroke="#fff" strokeWidth="0.7" strokeLinecap="round" opacity="0.85" />

    {/* Confetti ribbons / streamers bursting out */}
    <path
      d="M10 14 Q 13 9, 18 9"
      stroke="#48dbfb"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M11 13 Q 15 11, 20 13"
      stroke="#a78bfa"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M10.5 12.5 Q 13 6, 16 4"
      stroke="#34d399"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />

    {/* Confetti dots */}
    <circle cx="17" cy="6" r="1.1" fill="#ff6b9d" />
    <circle cx="20" cy="11" r="0.9" fill="#feca57" />
    <circle cx="14" cy="7" r="0.8" fill="#48dbfb" />
    <circle cx="21" cy="15" r="0.8" fill="#34d399" />

    {/* Featured star up high */}
    <path
      d="M17 2.5 L18 5 L20.5 5.3 L18.6 7 L19.2 9.5 L17 8.2 L14.8 9.5 L15.4 7 L13.5 5.3 L16 5 Z"
      fill="url(#celebration-icon-star)"
      stroke="#ff9f43"
      strokeWidth="0.4"
      strokeLinejoin="round"
    />

    {/* Sparkle glint */}
    <path
      d="M5 5 L5.5 7 L7.5 7.5 L5.5 8 L5 10 L4.5 8 L2.5 7.5 L4.5 7 Z"
      fill="#ff9ff3"
    />
  </svg>
);

export default CelebrationIcon;

import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * UnderwaterIcon — tropical fish in profile with a tiny rising bubble.
 *
 * Designed to read at 16-24px on the animation picker card. Uses `currentColor`
 * for the bubble outline so it inherits the surrounding text color when needed,
 * with cyan/teal underwater fills (#00bcd4 family) for the fish body.
 */
const UnderwaterIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Underwater"
  >
    {/* Fish body */}
    <ellipse cx="11" cy="13" rx="7" ry="4.5" fill="#00bcd4" />
    {/* Belly highlight */}
    <ellipse cx="11" cy="14.5" rx="5" ry="2" fill="#7fdfeb" opacity="0.85" />
    {/* Tail fin */}
    <path d="M18 13 L23 9 L22 13 L23 17 Z" fill="#0097a7" />
    {/* Top dorsal fin */}
    <path d="M9 9 L12 6 L14 9 Z" fill="#0097a7" />
    {/* Bottom fin */}
    <path d="M10 17 L12 19 L13 17 Z" fill="#0097a7" />
    {/* Gill curve */}
    <path d="M7 11 Q6 13 7 15" stroke="#0097a7" strokeWidth="0.6" strokeLinecap="round" />
    {/* Eye */}
    <circle cx="5.5" cy="12" r="1.1" fill="#fff" />
    <circle cx="5.3" cy="12" r="0.55" fill="#0d2c3a" />
    {/* Stripe detail */}
    <path d="M13 10 Q13.5 13 13 16" stroke="#0097a7" strokeWidth="0.5" strokeLinecap="round" opacity="0.7" />
    {/* Rising bubble (uses currentColor so it ties to surrounding text) */}
    <circle cx="3.5" cy="5" r="1.4" stroke="currentColor" strokeWidth="1" opacity="0.6" />
    <circle cx="2.2" cy="8.5" r="0.7" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
  </svg>
);

export default UnderwaterIcon;

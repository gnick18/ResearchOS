import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * Sports settings card icon — gold trophy cup with handles, base, and a
 * "#1" star on the cup face. Tuned to read clearly at small sizes (16-24px).
 * Uses inline gold gradient so the trophy keeps its identity even when the
 * surrounding text color (currentColor) is dark.
 */
const SportsIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="sports-icon-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="55%" stopColor="#facc15" />
        <stop offset="100%" stopColor="#b45309" />
      </linearGradient>
    </defs>

    {/* Side handles */}
    <path
      d="M7 5.5C4.5 5.5 3 7 3 9c0 2 1.5 3.5 4 3.5"
      stroke="url(#sports-icon-gold)"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M17 5.5c2.5 0 4 1.5 4 3.5 0 2-1.5 3.5-4 3.5"
      stroke="url(#sports-icon-gold)"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />

    {/* Cup body */}
    <path
      d="M6.5 3.5h11v6.25c0 3.04-2.46 5.5-5.5 5.5s-5.5-2.46-5.5-5.5V3.5Z"
      fill="url(#sports-icon-gold)"
      stroke="#7c2d12"
      strokeWidth="0.9"
      strokeLinejoin="round"
    />

    {/* Star on cup face — tells "winner" instantly */}
    <path
      d="M12 6.5l1.05 2.13 2.35.34-1.7 1.66.4 2.34L12 11.86l-2.1 1.11.4-2.34-1.7-1.66 2.35-.34L12 6.5Z"
      fill="#fff"
      stroke="#7c2d12"
      strokeWidth="0.4"
      strokeLinejoin="round"
    />

    {/* Stem */}
    <rect
      x="10.75"
      y="15.25"
      width="2.5"
      height="3"
      fill="url(#sports-icon-gold)"
      stroke="#7c2d12"
      strokeWidth="0.8"
    />

    {/* Base */}
    <rect
      x="7"
      y="18"
      width="10"
      height="2.75"
      rx="0.6"
      fill="url(#sports-icon-gold)"
      stroke="#7c2d12"
      strokeWidth="0.9"
    />
  </svg>
);

export default SportsIcon;

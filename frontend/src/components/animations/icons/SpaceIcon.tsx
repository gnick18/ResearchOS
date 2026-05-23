import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * SpaceIcon — cartoon rocket angled diagonally with flame trail and a
 * little ringed planet + sparkle star to sell the space theme small.
 *
 * viewBox 24×24. Uses currentColor on the rocket body stroke so the icon
 * picks up theme color, with purple/orange/yellow accents for wonder.
 */
const SpaceIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="space-icon-flame" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="60%" stopColor="#fb923c" />
        <stop offset="100%" stopColor="#ef4444" />
      </linearGradient>
      <linearGradient id="space-icon-body" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#cbd5e1" />
      </linearGradient>
      <radialGradient id="space-icon-planet" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#c084fc" />
        <stop offset="100%" stopColor="#6d28d9" />
      </radialGradient>
    </defs>

    {/* Tiny sparkle star */}
    <path
      d="M4 5 L4.6 6.4 L6 7 L4.6 7.6 L4 9 L3.4 7.6 L2 7 L3.4 6.4 Z"
      fill="#fde047"
    />

    {/* Little ringed planet in the corner */}
    <g transform="translate(18 18)">
      <ellipse cx="0" cy="0" rx="3.6" ry="1.1" fill="none" stroke="#a78bfa" strokeWidth="0.7" />
      <circle cx="0" cy="0" r="2" fill="url(#space-icon-planet)" />
      <circle cx="-0.6" cy="-0.6" r="0.4" fill="#fff" opacity="0.7" />
    </g>

    {/* Rocket — diagonal, angled up-right */}
    <g transform="rotate(-30 12 12)">
      {/* Flame trail */}
      <path
        d="M11 17 Q12 21 12 22 Q12 21 13 17 Q12 17.6 11 17 Z"
        fill="url(#space-icon-flame)"
      />
      <path
        d="M11.4 17 Q12 19.4 12 20.2 Q12 19.4 12.6 17 Q12 17.3 11.4 17 Z"
        fill="#fef3c7"
      />

      {/* Body */}
      <path
        d="M12 3 C14 6 15 10 15 13 L15 17 L9 17 L9 13 C9 10 10 6 12 3 Z"
        fill="url(#space-icon-body)"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />

      {/* Window */}
      <circle cx="12" cy="10" r="1.6" fill="#7dd3fc" stroke="#0c4a6e" strokeWidth="0.6" />
      <circle cx="11.5" cy="9.5" r="0.5" fill="#fff" opacity="0.9" />

      {/* Red stripe / nose accent */}
      <path d="M10.4 13.5 L13.6 13.5" stroke="#ef4444" strokeWidth="0.9" strokeLinecap="round" />

      {/* Fins */}
      <path d="M9 14 L7 17 L9 17 Z" fill="#ef4444" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M15 14 L17 17 L15 17 Z" fill="#ef4444" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
    </g>
  </svg>
);

export default SpaceIcon;

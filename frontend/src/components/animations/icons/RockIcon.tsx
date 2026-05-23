import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * RockIcon — flaming electric guitar with a lightning-bolt strap and a tiny
 * skull headstock. Built to read at both `w-7 h-7` (settings card) and
 * `w-5 h-5` (toolbar). Hardcoded rock-theme palette (red/orange/yellow/chrome
 * over a black silhouette) with one `currentColor` stroke on the lightning
 * bolt so the icon picks up the entry's `color: "#ff4500"` when needed.
 */
const RockIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="rockicon-flame" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#ff1a00" />
        <stop offset="55%" stopColor="#ff7a00" />
        <stop offset="100%" stopColor="#ffe600" />
      </linearGradient>
      <linearGradient id="rockicon-body" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a1a" />
        <stop offset="100%" stopColor="#3a0a0a" />
      </linearGradient>
    </defs>

    {/* Flame backdrop behind the guitar body */}
    <path
      d="M16 21c-1.6-1.2-2.5-2.7-2.5-4.2 0-1.1.5-2 1.2-3.2-.2 1.1 0 1.9.6 2.5.5-1.5 1-3 2.5-4.6.2 1.8.9 3.2 1.9 4.4 1 1.2 1.5 2.3 1.5 3.4 0 1.4-1.1 2.7-3.2 4 .2-1-.1-1.7-.8-2.3-.4.3-.7.8-1.2 2z"
      fill="url(#rockicon-flame)"
    />

    {/* Lightning-bolt strap, currentColor so it inherits #ff4500 */}
    <path
      d="M5 2l-2 7h3l-1 5 5-7H7l1.5-5z"
      fill="#ffe600"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />

    {/* Guitar neck */}
    <path
      d="M9.2 11.2L14.4 6l2 2-5.2 5.2z"
      fill="url(#rockicon-body)"
      stroke="#000"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />

    {/* Frets on neck */}
    <path
      d="M10.6 11.4l.7.7M12 10l.7.7M13.4 8.6l.7.7"
      stroke="#c0c0c0"
      strokeWidth="0.7"
      strokeLinecap="round"
    />

    {/* Skull headstock */}
    <g transform="translate(15 5)">
      <ellipse cx="1.6" cy="1.6" rx="1.8" ry="1.6" fill="#e8e8e8" stroke="#000" strokeWidth="0.5" />
      <circle cx="1" cy="1.4" r="0.45" fill="#000" />
      <circle cx="2.3" cy="1.4" r="0.45" fill="#000" />
      <path d="M.9 2.6l.4-.3.3.3.3-.3.3.3" stroke="#000" strokeWidth="0.35" fill="none" />
    </g>

    {/* Guitar body — angular flying-V style */}
    <path
      d="M8 13.5l-4.2 4.2c-1 1-1 2.5 0 3.5s2.5 1 3.5 0L11.5 17l3.8-2-1.5-1.5z"
      fill="url(#rockicon-body)"
      stroke="#ff1a00"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />

    {/* Pickup highlights */}
    <rect x="8.6" y="14.5" width="3.4" height="0.7" fill="#c0c0c0" transform="rotate(-45 10.3 14.85)" />

    {/* Sound hole / pickguard accent */}
    <circle cx="6.4" cy="18.4" r="1" fill="#ff1a00" stroke="#000" strokeWidth="0.4" />
    <circle cx="6.4" cy="18.4" r="0.35" fill="#000" />

    {/* Broken string flying off */}
    <path
      d="M14 6.5l3 -1.2M16 8l3 -0.7"
      stroke="#ffe600"
      strokeWidth="0.5"
      strokeLinecap="round"
    />
  </svg>
);

export default RockIcon;

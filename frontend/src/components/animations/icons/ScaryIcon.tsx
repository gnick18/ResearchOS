import type { FC } from "react";

interface IconProps {
  className?: string;
}

// Playful-spooky cartoon skull. Bone-white dome with cute black eye sockets,
// a little nose triangle, and a row of teeth. Reads well at small sizes.
const ScaryIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Skull dome */}
    <path
      d="M12 2.5C7.6 2.5 4 5.9 4 10.2c0 2.6 1.3 4.6 2.8 5.8.4.3.7.8.7 1.3v1.4c0 .9.7 1.6 1.6 1.6h.5v-1.9h1.4v1.9h2v-1.9h1.4v1.9h.5c.9 0 1.6-.7 1.6-1.6v-1.4c0-.5.3-1 .7-1.3 1.5-1.2 2.8-3.2 2.8-5.8C20 5.9 16.4 2.5 12 2.5Z"
      fill="#f4ede0"
      stroke="#1a1a1a"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    {/* Left eye socket */}
    <ellipse cx="9" cy="10.5" rx="1.9" ry="2.2" fill="#1a1a1a" />
    {/* Right eye socket */}
    <ellipse cx="15" cy="10.5" rx="1.9" ry="2.2" fill="#1a1a1a" />
    {/* Tiny glint in each eye for cute factor */}
    <circle cx="9.7" cy="9.9" r="0.4" fill="#f4ede0" />
    <circle cx="15.7" cy="9.9" r="0.4" fill="#f4ede0" />
    {/* Nose triangle */}
    <path d="M12 12.4 11.1 14.2h1.8L12 12.4Z" fill="#1a1a1a" />
    {/* Teeth grin */}
    <path
      d="M8.6 15.6h6.8"
      stroke="#1a1a1a"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <path
      d="M9.6 15.6v1.4M11 15.6v1.4M12.4 15.6v1.4M13.8 15.6v1.4"
      stroke="#1a1a1a"
      strokeWidth="0.9"
      strokeLinecap="round"
    />
  </svg>
);

export default ScaryIcon;

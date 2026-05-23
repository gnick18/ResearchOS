import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * ScienceIcon — atom with nucleus and three crossed electron orbits.
 * Reads clearly at small sizes; distinct from BeakerBot's chemistry-set icon.
 * Uses science teal (#009688) and electric blue (#2196f3) for the lab vibe.
 */
const ScienceIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Three crossed electron orbits */}
    <ellipse
      cx="12"
      cy="12"
      rx="9"
      ry="3.5"
      stroke="#009688"
      strokeWidth="1.4"
    />
    <ellipse
      cx="12"
      cy="12"
      rx="9"
      ry="3.5"
      stroke="#2196f3"
      strokeWidth="1.4"
      transform="rotate(60 12 12)"
    />
    <ellipse
      cx="12"
      cy="12"
      rx="9"
      ry="3.5"
      stroke="#4caf50"
      strokeWidth="1.4"
      transform="rotate(-60 12 12)"
    />

    {/* Electrons riding the orbits */}
    <circle cx="21" cy="12" r="1.1" fill="#009688" />
    <circle cx="7.5" cy="4.2" r="1.1" fill="#2196f3" />
    <circle cx="7.5" cy="19.8" r="1.1" fill="#4caf50" />

    {/* Nucleus (glowing center) */}
    <circle cx="12" cy="12" r="2.4" fill="#009688" />
    <circle cx="12" cy="12" r="1.2" fill="#80cbc4" />
  </svg>
);

export default ScienceIcon;

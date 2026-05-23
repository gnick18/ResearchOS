import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * Animals settings card icon. Paw print: main pad plus four toe pads.
 * Uses currentColor so it tints with the surrounding text color in the
 * settings UI. Designed to read clearly even at small sizes.
 */
const AnimalsIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="currentColor"
    aria-hidden="true"
  >
    {/* Main pad */}
    <ellipse cx="12" cy="16.5" rx="4.6" ry="3.8" />
    {/* Outer toe pads */}
    <circle cx="5.6" cy="11.2" r="2.2" />
    <circle cx="18.4" cy="11.2" r="2.2" />
    {/* Inner toe pads */}
    <circle cx="9" cy="6.8" r="2" />
    <circle cx="15" cy="6.8" r="2" />
  </svg>
);

export default AnimalsIcon;

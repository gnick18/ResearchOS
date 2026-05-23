import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * FungiIcon — classic red-cap amanita silhouette.
 *
 * Earthy + a touch magical: red dome with white spots, cream stem with a
 * small ring, two glowing spores drifting off the cap. Reads cleanly at
 * small sizes (16-20px) while still saying "fairy-ring mushroom" at a glance.
 */
const FungiIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Soft ground shadow */}
    <ellipse cx="12" cy="21" rx="5" ry="0.9" fill="#000" opacity="0.18" />

    {/* Stem (cream) */}
    <path
      d="M9.4 12.5 C9.2 16 9.4 18.6 10 20.2 C10.3 20.9 11.1 21.1 12 21.1 C12.9 21.1 13.7 20.9 14 20.2 C14.6 18.6 14.8 16 14.6 12.5 Z"
      fill="#F5E9D0"
      stroke="#8B6F47"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    {/* Stem ring (annulus) */}
    <path
      d="M9.1 13.4 C10.4 13.9 13.6 13.9 14.9 13.4 L14.7 14.6 C13.5 15.1 10.5 15.1 9.3 14.6 Z"
      fill="#E8D7B3"
      stroke="#8B6F47"
      strokeWidth="0.5"
      strokeLinejoin="round"
    />

    {/* Cap (red dome) */}
    <path
      d="M3.2 12.5 C3.2 7.4 7.1 4 12 4 C16.9 4 20.8 7.4 20.8 12.5 C20.8 13.2 20.3 13.6 19.5 13.6 L4.5 13.6 C3.7 13.6 3.2 13.2 3.2 12.5 Z"
      fill="#D7322B"
      stroke="#7A1F1A"
      strokeWidth="0.7"
      strokeLinejoin="round"
    />
    {/* Cap highlight */}
    <path
      d="M5.2 9.5 C6.5 6.8 9 5.4 11.6 5.3"
      stroke="#F26B5E"
      strokeWidth="1"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />

    {/* White spots on cap */}
    <circle cx="7.5" cy="10.5" r="1.1" fill="#FFFDF5" />
    <circle cx="11.7" cy="7.7" r="1.3" fill="#FFFDF5" />
    <circle cx="15.6" cy="10.9" r="1" fill="#FFFDF5" />
    <circle cx="13.4" cy="11.6" r="0.55" fill="#FFFDF5" />
    <circle cx="9.4" cy="8.4" r="0.5" fill="#FFFDF5" />
    <circle cx="17.8" cy="12.1" r="0.5" fill="#FFFDF5" />

    {/* Drifting glowing spores */}
    <circle cx="20" cy="6" r="0.9" fill="#7DD3FC" opacity="0.85" />
    <circle cx="20" cy="6" r="1.7" fill="#7DD3FC" opacity="0.25" />
    <circle cx="3.6" cy="7.6" r="0.6" fill="#7DD3FC" opacity="0.8" />
    <circle cx="3.6" cy="7.6" r="1.2" fill="#7DD3FC" opacity="0.22" />
  </svg>
);

export default FungiIcon;

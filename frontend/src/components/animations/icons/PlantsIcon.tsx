import type { FC } from "react";

interface IconProps {
  className?: string;
}

/**
 * PlantsIcon — a small sprouting plant: two emerald leaves on a slender stem
 * rising out of a soft pink-blossom bloom. Reads well at 16-32px in settings
 * cards and category pickers.
 */
const PlantsIcon: FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    {/* Stem */}
    <path
      d="M12 21 V11"
      stroke="#0f8a5f"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Left leaf */}
    <path
      d="M12 14 C8.5 13.6 6.5 11.5 6.4 8.6 C9.4 8.4 11.6 10.4 12 13.5 Z"
      fill="#10ac84"
    />
    <path
      d="M11.8 13.5 C9.7 12.3 8.2 10.8 7.2 9.4"
      stroke="#0d6e4d"
      strokeWidth="0.6"
      strokeLinecap="round"
    />
    {/* Right leaf */}
    <path
      d="M12 12 C15.5 11.5 17.6 9.3 17.6 6.3 C14.6 6.2 12.4 8.3 12 11.5 Z"
      fill="#3ec98a"
    />
    <path
      d="M12.2 11.5 C14.3 10.2 15.9 8.7 16.9 7.2"
      stroke="#0d6e4d"
      strokeWidth="0.6"
      strokeLinecap="round"
    />
    {/* Blossom petals around the base */}
    {[0, 72, 144, 216, 288].map((angle) => (
      <ellipse
        key={angle}
        cx="12"
        cy="20"
        rx="1.4"
        ry="2.4"
        fill="#f8a5c2"
        opacity="0.9"
        transform={`rotate(${angle} 12 20) translate(0 -2)`}
      />
    ))}
    {/* Flower center */}
    <circle cx="12" cy="20" r="1.1" fill="#fcd34d" />
  </svg>
);

export default PlantsIcon;

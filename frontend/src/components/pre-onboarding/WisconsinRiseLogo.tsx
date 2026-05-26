"use client";

/**
 * Wisconsin RISE Initiative logo — inline SVG reproduction.
 *
 * Used in the pre-onboarding credentials footer. Hand-drawn rather than
 * referencing a PNG file so the asset ships with the bundle (no extra
 * fetch, no missing-file fallback to worry about, resolution-independent
 * at any pre-onboarding viewport).
 *
 * Layout: UW shield on the left, two-line RISE Initiative wordmark on
 * the right. Colors match the official branding: Badger Red #C5050C for
 * the shield and headline, warm cream #D4B896 for the shield border,
 * neutral dark #2F2F2F for the subtitle.
 *
 * Approximation, not pixel-perfect to the official PNG. The shield
 * shape is a clean classic geometry rather than the more ornate
 * beaded-edge version on the original Wisconsin marketing asset. Good
 * enough for the footer trust signal; if Grant ever wants the exact
 * marketing asset he can swap in the official PNG.
 *
 * No em-dashes, no emojis. Sized to be roughly 280px wide x 64px tall
 * at the footer; scales fluidly via the SVG viewBox.
 */

export interface WisconsinRiseLogoProps {
  /** Optional className passthrough so the parent can tweak size. */
  className?: string;
}

const BADGER_RED = "#C5050C";
const SHIELD_BORDER = "#B89366";
const SUBTITLE = "#2F2F2F";

export default function WisconsinRiseLogo({
  className,
}: WisconsinRiseLogoProps) {
  return (
    <svg
      viewBox="0 0 480 110"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
      className={className}
    >
      {/* Shield. Classic outline (rounded top corners, tapered bottom
          point), filled Badger Red, with a thick cream border. */}
      <g transform="translate(8, 10)">
        {/* Outer border = cream colored shield silhouette */}
        <path
          d="M5,5 Q5,0 10,0 L60,0 Q65,0 65,5 L65,55 Q65,72 50,85 L35,98 L20,85 Q5,72 5,55 Z"
          fill={SHIELD_BORDER}
        />
        {/* Inner red field, inset by ~3px */}
        <path
          d="M9,8 Q9,4 13,4 L57,4 Q61,4 61,8 L61,55 Q61,69 49,80 L35,92 L21,80 Q9,69 9,55 Z"
          fill={BADGER_RED}
        />
        {/* The bold W. Hand-drawn as a path so we don't depend on a
            specific font being available. Two angled strokes meeting
            in a center peak, classic Wisconsin "W". */}
        <path
          d="M14,32 L21,68 L28,68 L33,45 L35,45 L40,68 L47,68 L54,32 L48,32 L44,58 L42,58 L37,32 L31,32 L26,58 L24,58 L20,32 Z"
          fill="white"
        />
      </g>

      {/* Wordmark. Two lines: bold red headline + lighter neutral
          subtitle. Inter / system sans-serif so it matches the rest
          of the app's typography. */}
      <text
        x="90"
        y="50"
        fill={BADGER_RED}
        fontSize="32"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      >
        Wisconsin RISE Initiative
      </text>
      <text
        x="91"
        y="78"
        fill={SUBTITLE}
        fontSize="16"
        fontWeight="500"
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      >
        Wisconsin Research, Innovation and Scholarly Excellence
      </text>
    </svg>
  );
}

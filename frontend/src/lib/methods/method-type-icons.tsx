/** Per-method-type inline SVG icons. Exported separately from the registry
 * (which is a plain `.ts` data module) so JSX stays in a `.tsx` file. */

interface MethodTypeIconProps {
  className?: string;
  size?: number;
}

export function MarkdownIcon({ className, size = 16 }: MethodTypeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function PdfIcon({ className, size = 16 }: MethodTypeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <text
        x="8"
        y="18"
        fontSize="6"
        fontWeight="bold"
        fill="currentColor"
        stroke="none"
      >
        PDF
      </text>
    </svg>
  );
}

export function LcGradientIcon({ className, size = 16 }: MethodTypeIconProps) {
  // Stylized gradient-over-time curve, alluding to the percent-A/B chart that
  // the LcGradientEditor draws. Anchored at left/right of the axis so it reads
  // as a sweep even at small sizes.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 20h18" />
      <path d="M3 20V4" />
      <path d="M3 17l5-1 4-8 5 4 4-7" />
    </svg>
  );
}

export function PlateIcon({ className, size = 16 }: MethodTypeIconProps) {
  // A 4×3 dot grid alluding to a microtiter plate (24-well shape — the most
  // recognizable). Reads cleanly at 16px.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="7" cy="9" r="1" fill="currentColor" />
      <circle cx="12" cy="9" r="1" fill="currentColor" />
      <circle cx="17" cy="9" r="1" fill="currentColor" />
      <circle cx="7" cy="15" r="1" fill="currentColor" />
      <circle cx="12" cy="15" r="1" fill="currentColor" />
      <circle cx="17" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}

export function CellCultureIcon({ className, size = 16 }: MethodTypeIconProps) {
  // Stylized flask + arrow — suggests culturing media + the M/W/F/split
  // cadence that drives the cell-culture passaging schedule. Reads cleanly
  // at small sizes alongside the LC gradient curve and PCR helix glyphs.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 3h6" />
      <path d="M10 3v6L5 19a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 19l-5-10V3" />
      <path d="M6.5 14h11" />
      <circle cx="10" cy="17" r="0.8" fill="currentColor" />
      <circle cx="14" cy="16" r="0.8" fill="currentColor" />
      <circle cx="12" cy="19" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function CompoundIcon({ className, size = 16 }: MethodTypeIconProps) {
  // Stacked-boxes glyph alluding to a "kit" — three small boxes layered
  // together. Reads cleanly at 16px alongside the other method-type icons.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <rect x="8" y="3" width="8" height="8" rx="1" />
    </svg>
  );
}

export function QpcrAnalysisIcon({ className, size = 16 }: MethodTypeIconProps) {
  // Stylized amplification curve — a sigmoid sweep up from baseline (alluding
  // to the Cq threshold-crossing shape seen on every qPCR readout). Reads
  // cleanly at 16px alongside the PCR helix and LC gradient glyphs.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 20h18" />
      <path d="M3 20V4" />
      <path d="M3 18c4 0 6 0 8-2s2-8 6-8 4 0 4 0" />
      <circle cx="13" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

export function PcrIcon({ className, size = 16 }: MethodTypeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 2v6a6 6 0 0 0 12 0V2" />
      <path d="M6 22v-6a6 6 0 0 1 12 0v6" />
      <line x1="6" y1="2" x2="18" y2="2" />
      <line x1="6" y1="22" x2="18" y2="22" />
    </svg>
  );
}

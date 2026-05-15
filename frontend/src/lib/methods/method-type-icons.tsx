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

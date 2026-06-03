/**
 * Amber pill matching the cfcc2c4a `Shared into <owner>'s project` pattern,
 * inverted for the "from" direction. Rendered in the top-right corner of any
 * Workbench card / row whose underlying task is shared into the current user.
 *
 * Originally lived inline in WorkbenchExperimentsPanel.tsx; lifted here when
 * the Lists tab landed so both the Experiments and Lists panels can consume
 * it from one place.
 */
export interface SharedFromPillProps {
  owner: string;
}

export default function SharedFromPill({ owner }: SharedFromPillProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-meta font-medium text-amber-700 shadow-sm">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="8 12 12 8 16 12" />
        <line x1="12" y1="8" x2="12" y2="21" />
      </svg>
      Shared by {owner}
    </span>
  );
}

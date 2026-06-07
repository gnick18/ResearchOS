import type { Status } from "@/lib/transparency/types";

/**
 * Pass / warn / fail badge. Inline SVG glyphs only (no icon library, no emoji),
 * per the house style. Greens read as "matches the reference", amber as "within
 * the explained ecosystem offset", red as "drifted".
 */

const STYLES: Record<Status, { bg: string; text: string; ring: string; label: string }> = {
  pass: {
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-200",
    label: "Within tolerance",
  },
  warn: {
    bg: "bg-amber-50 dark:bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-200",
    label: "Marginal",
  },
  fail: {
    bg: "bg-red-50 dark:bg-red-500/15",
    text: "text-red-700 dark:text-red-300",
    ring: "ring-red-200",
    label: "Out of tolerance",
  },
};

/** Calm styling for an expected (loose-tolerance) difference: no amber alarm. */
const EXPECTED_STYLE = {
  bg: "bg-slate-50",
  text: "text-slate-600",
  ring: "ring-slate-200",
  label: "Expected",
};

function Glyph({ status, expected }: { status: Status; expected?: boolean }) {
  if (expected) {
    // Approximately-equal glyph: this differs by design, it is not a warning.
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9c2-2 4-2 6 0s4 2 6 0M4 15c2-2 4-2 6 0s4 2 6 0" />
      </svg>
    );
  }
  if (status === "pass") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  }
  if (status === "warn") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 4.3 2.6 18a1.9 1.9 0 0 0 1.7 2.8h15.4a1.9 1.9 0 0 0 1.7-2.8L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function StatusPill({
  status,
  label,
  exact,
  kind,
}: {
  status: Status;
  label?: string;
  /** When true and the status is a pass, the pill reads "Exact" (delta is 0). */
  exact?: boolean;
  /**
   * Tolerance kind of the underlying comparison. A "loose" warn is an
   * approximate-by-design offset (expected), so it renders calm slate
   * "Expected" instead of the amber "Marginal" alarm reserved for a "tight"
   * port that actually drifted.
   */
  kind?: "tight" | "loose";
}) {
  const expected = status === "warn" && kind === "loose";
  const s = expected ? EXPECTED_STYLE : STYLES[status];
  const text = label ?? (exact && status === "pass" ? "Exact" : s.label);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-meta font-semibold ring-1 ring-inset ${s.bg} ${s.text} ${s.ring}`}
    >
      <Glyph status={status} expected={expected} />
      {text}
    </span>
  );
}

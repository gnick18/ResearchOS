import type { Status } from "@/lib/transparency/types";

/**
 * Pass / warn / fail badge. Inline SVG glyphs only (no icon library, no emoji),
 * per the house style. Greens read as "matches the reference", amber as "within
 * the explained ecosystem offset", red as "drifted".
 */

const STYLES: Record<Status, { bg: string; text: string; ring: string; label: string }> = {
  pass: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    label: "Matches",
  },
  warn: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    label: "Within offset",
  },
  fail: {
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    label: "Drifted",
  },
};

function Glyph({ status }: { status: Status }) {
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
}: {
  status: Status;
  label?: string;
}) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-meta font-semibold ring-1 ring-inset ${s.bg} ${s.text} ${s.ring}`}
    >
      <Glyph status={status} />
      {label ?? s.label}
    </span>
  );
}

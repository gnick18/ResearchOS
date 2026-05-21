"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * Collapsible entity-type group for the Phase 4 cleanup grid (L24).
 *
 * Header shape: "<label> (<count>)" with a chevron. Default-open when
 * `count > 0`. The brief says "collapsed if empty" — empty sections
 * still render (so the user sees that no artifacts of that type were
 * created) but start collapsed and show a small "(none)" indicator
 * inline so the chevron is meaningful even when there's nothing to
 * reveal.
 *
 * Voice rule (Grant standing): no em-dashes in display copy.
 */

interface CleanupSectionProps {
  label: string;
  count: number;
  children: ReactNode;
  /** Optional initial open state override (test affordance). Defaults
   *  to "open if count > 0". */
  defaultOpen?: boolean;
}

export default function CleanupSection({
  label,
  count,
  children,
  defaultOpen,
}: CleanupSectionProps) {
  const initial = defaultOpen ?? count > 0;
  const [open, setOpen] = useState(initial);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return (
    <section
      data-cleanup-section={label.toLowerCase().replace(/\s+/g, "-")}
      data-cleanup-section-open={open ? "true" : "false"}
      className="space-y-1"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <span
            data-cleanup-section-chevron=""
            className="inline-block w-3 transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden="true"
          >
            {">"}
          </span>
          <span>{label}</span>
          <span className="text-gray-400 font-normal normal-case">
            ({count})
          </span>
        </span>
        {count === 0 && (
          <span className="text-[10px] font-normal text-gray-400 normal-case">
            none
          </span>
        )}
      </button>
      {open && count > 0 && (
        <div className="pl-4">{children}</div>
      )}
    </section>
  );
}

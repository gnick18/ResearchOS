"use client";

/**
 * Small two-or-more-option SEGMENT control for the store rail header
 * (Extension Store Phase C, store-search bot, 2026-05-29).
 *
 * Rendered into StoreShell's `railHeaderSlot`. The method library uses it to
 * switch the rail's category set + the center list between Types and Templates;
 * the widget store has a single kind and renders no segment at all.
 *
 * House style: text-only segmented control, no emoji, no icon dependency. The
 * active option carries a white "pill" over a gray track, mirroring the
 * EnabledOnlyToggle / method-type switch aesthetic already in the shell.
 */

export interface StoreSegmentOption {
  id: string;
  label: string;
}

export function StoreSegment({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: StoreSegmentOption[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible group label (e.g. "Browse method types or templates"). */
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-lg bg-surface-sunken p-0.5 ros-seg-track border border-border"
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
              active
                ? "bg-surface-raised text-foreground ros-seg-active"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default StoreSegment;

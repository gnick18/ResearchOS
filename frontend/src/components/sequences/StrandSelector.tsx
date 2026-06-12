"use client";

// sequence feat-popup bot — SnapGene-style STRAND selector for the feature
// dialog: a row of icon-toggle buttons (no-direction, forward, reverse,
// bidirectional) replacing the old <select> dropdown. Each is a custom inline
// SVG (no emoji) wrapped in <Tooltip>, with the active one highlighted.
//
// STRAND-MODEL CAVEAT: the on-disk shape is standard GenBank, which only stores
// a +/- strand (FeatureDraft.strand is 1 | -1, and jsonToGenbank writes exactly
// that). There is no GenBank field for "no direction" or "bidirectional" on a
// single feature, so this selector keeps the persisted value at +1 / -1:
//   forward (->)       -> +1   (faithful)
//   reverse (<-)       -> -1   (faithful)
//   no-direction (|-|) -> +1   (closest faithful mapping; noted in the dialog)
//   bidirectional (<->)-> +1   (closest faithful mapping; noted in the dialog)
// The "display" choice is purely visual in this dialog and is reported back via
// onDisplayChange so the diagram can draw the matching arrowheads, but only the
// strand (+1/-1) round-trips to the .gb.

import Tooltip from "@/components/Tooltip";

export type StrandDisplay = "none" | "forward" | "reverse" | "both";

/** Map a display choice to the persisted GenBank strand (+1 / -1). */
export function displayToStrand(d: StrandDisplay): 1 | -1 {
  return d === "reverse" ? -1 : 1;
}

/** Best display choice for a feature loaded from disk (only knows +1 / -1). */
export function strandToDisplay(strand: 1 | -1): StrandDisplay {
  return strand === -1 ? "reverse" : "forward";
}

const OPTIONS: {
  value: StrandDisplay;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "none",
    label: "No direction",
    icon: (
      <svg viewBox="0 0 24 16" className="h-3.5 w-6" aria-hidden="true">
        <line x1="3" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1.6" />
        <line x1="3" y1="8" x2="21" y2="8" stroke="currentColor" strokeWidth="1.6" />
        <line x1="21" y1="3" x2="21" y2="13" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    value: "forward",
    label: "Forward (+)",
    icon: (
      <svg viewBox="0 0 24 16" className="h-3.5 w-6" aria-hidden="true">
        <line x1="3" y1="8" x2="19" y2="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M15 3 L21 8 L15 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    value: "reverse",
    label: "Reverse (-)",
    icon: (
      <svg viewBox="0 0 24 16" className="h-3.5 w-6" aria-hidden="true">
        <line x1="5" y1="8" x2="21" y2="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 3 L3 8 L9 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    value: "both",
    label: "Bidirectional",
    icon: (
      <svg viewBox="0 0 24 16" className="h-3.5 w-6" aria-hidden="true">
        <line x1="6" y1="8" x2="18" y2="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 3 L3 8 L9 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 3 L21 8 L15 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function StrandSelector({
  value,
  onChange,
}: {
  value: StrandDisplay;
  onChange: (next: StrandDisplay) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5" role="group" aria-label="Strand direction">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <Tooltip key={o.value} label={o.label}>
            <button
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              aria-label={o.label}
              className={`flex h-7 w-9 items-center justify-center rounded transition-colors ${
                active
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              }`}
            >
              {o.icon}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

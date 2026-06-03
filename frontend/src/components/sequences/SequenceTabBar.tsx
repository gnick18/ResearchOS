"use client";

// seq nav bot — the SnapGene-style BOTTOM TAB BAR: the primary view switcher.
//
// The #1 maintainer ask was "I don't see a map vs seq button anywhere". This is
// that switcher, promoted to a persistent bottom row exactly like SnapGene:
//   Map | Sequence | Features | Primers | History
//
// Restriction enzymes are NOT a tab: they are a toggleable LAYER on the rail
// (the "Restriction sites" toggle, whose flyout opens the full enzyme picker),
// so there is no redundant Enzymes tab here.
//
// It is a pure presentation control: it owns no view logic, just renders the
// tabs and reports the chosen `viewMode` up. Inline SVG icons only (no emoji /
// no icon library, per project convention); icon-only affordances are labelled.

import Tooltip from "@/components/Tooltip";

export type SequenceViewMode =
  | "map"
  | "sequence"
  | "features"
  | "primers"
  | "history";

// ── icons (inline SVG only) ──────────────────────────────────────────────────
function IconMap({ className }: { className?: string }) {
  // circular plasmid ring (the map view)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
    </svg>
  );
}
function IconSequence({ className }: { className?: string }) {
  // base letters on a strand
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="17" x2="21" y2="17" />
      <path d="M5 13V8M5 8h2.5a1.5 1.5 0 0 1 0 3H5" />
      <path d="M11 13V8l4 5V8" />
      <path d="M19 8h-2v5h2" />
    </svg>
  );
}
function IconFeatures({ className }: { className?: string }) {
  // tag / annotation
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
function IconPrimers({ className }: { className?: string }) {
  // short arrow over a baseline (primer binding)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="17" x2="21" y2="17" />
      <path d="M6 11h9l-2.5-2.5M6 11l2.5 2.5" />
    </svg>
  );
}
function IconHistory({ className }: { className?: string }) {
  // clock with a counter-clockwise arrow
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

interface TabDef {
  id: SequenceViewMode;
  label: string;
  hint: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Optional count badge (e.g. number of features / primers). */
  count?: number;
}

export interface SequenceTabBarProps {
  active: SequenceViewMode;
  onChange: (mode: SequenceViewMode) => void;
  featureCount: number;
  primerCount: number;
}

/** Normalize an arbitrary / restored view-mode string to a valid tab. The
 *  retired "enzymes" mode (now a rail layer, not a tab) folds back to "map" so
 *  an old saved state never tries to render the dead Enzymes tab. */
export function normalizeViewMode(mode: string | null | undefined): SequenceViewMode {
  switch (mode) {
    case "map":
    case "sequence":
    case "features":
    case "primers":
    case "history":
      return mode;
    // "enzymes" (retired tab) and anything unknown fall back to the map.
    default:
      return "map";
  }
}

export default function SequenceTabBar({
  active,
  onChange,
  featureCount,
  primerCount,
}: SequenceTabBarProps) {
  const tabs: TabDef[] = [
    { id: "map", label: "Map", hint: "Whole-molecule map view", Icon: IconMap },
    { id: "sequence", label: "Sequence", hint: "Base-level sequence view", Icon: IconSequence },
    { id: "features", label: "Features", hint: "Feature list and editing", Icon: IconFeatures, count: featureCount || undefined },
    { id: "primers", label: "Primers", hint: "Primer list and design", Icon: IconPrimers, count: primerCount || undefined },
    { id: "history", label: "History", hint: "Edit and version history", Icon: IconHistory },
  ];

  return (
    <div
      role="tablist"
      aria-label="Sequence view"
      className="flex shrink-0 items-stretch gap-0.5 border-t border-gray-200 bg-gray-50 px-1.5 py-0.5"
    >
      {tabs.map((t) => {
        const selected = active === t.id;
        return (
          <Tooltip key={t.id} label={t.hint}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.id)}
              className={`relative flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                selected
                  ? "bg-white text-sky-700 shadow-[inset_0_-2px_0_0_#0284c7]"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700"
              }`}
            >
              <t.Icon className="h-4 w-4" />
              <span>{t.label}</span>
              {typeof t.count === "number" ? (
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-4 ${
                    selected ? "bg-sky-100 text-sky-700" : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

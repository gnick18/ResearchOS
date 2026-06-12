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
// seq flyout bot — Map and Sequence are the real CANVAS view modes (radio,
// mutually exclusive, they swap the whole map). Features, Primers, and History
// no longer blank the canvas. They are TOGGLE buttons that pop a flyout panel up
// over the live map (a chevron on the button signals it pops up, and rotates
// when open). Clicking an open flyout's button closes it; only one flyout is
// ever open. The bar reports both the active canvas mode and which flyout (if
// any) is open up to the editor.
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
  // base letters A G C over the strand
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <text x="12" y="13" textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing="1" fill="currentColor" fontFamily="ui-monospace, Menlo, monospace">AGC</text>
      <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
function IconChevron({ className }: { className?: string }) {
  // seq flyout bot — the pop-up affordance on the flyout tabs (Features /
  // Primers / History). It points UP (the panel pops up from the button) and
  // rotates 180deg via a CSS class when its flyout is open.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

/** seq flyout bot — Map / Sequence swap the CANVAS (radio). Features / Primers /
 *  History pop a flyout panel over the canvas (toggle). */
export type SequenceTabKind = "canvas" | "flyout";

/** The flyout view modes (the ones that pop up over the canvas, not swap it). */
export type SequenceFlyoutMode = "features" | "primers" | "history";

/** The canvas view modes (the ones that genuinely swap the whole map). */
export type SequenceCanvasMode = "map" | "sequence";

interface TabDef {
  id: SequenceViewMode;
  kind: SequenceTabKind;
  label: string;
  hint: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Optional count badge (e.g. number of features / primers). */
  count?: number;
}

export interface SequenceTabBarProps {
  /** The active CANVAS mode (Map or Sequence). Always one of the two; flyouts do
   *  not change this. Drives the radio highlight on Map / Sequence. */
  active: SequenceCanvasMode;
  /** Which flyout panel is open over the canvas, or null when none is. Drives the
   *  toggled-on highlight + rotated chevron on Features / Primers / History. */
  openFlyout: SequenceFlyoutMode | null;
  /** Pick a canvas mode (Map / Sequence). Closes any open flyout up in the host. */
  onChange: (mode: SequenceCanvasMode) => void;
  /** Toggle a flyout panel open/closed (Features / Primers / History). */
  onToggleFlyout: (mode: SequenceFlyoutMode) => void;
  featureCount: number;
  primerCount: number;
  /** sequence editor master (redesign phase 2). Where the bar is anchored. The
   *  redesign moves the tabs to the TOP of the canvas head, so the hairline
   *  switches to a bottom border; the legacy bottom placement keeps the top
   *  border. The rounded-top + bottom-underline active style reads correctly in
   *  both spots. Defaults to "top". */
  position?: "top" | "bottom";
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
  openFlyout,
  onChange,
  onToggleFlyout,
  featureCount,
  primerCount,
  position = "top",
}: SequenceTabBarProps) {
  const tabs: TabDef[] = [
    { id: "map", kind: "canvas", label: "Map", hint: "Whole-molecule map view", Icon: IconMap },
    { id: "sequence", kind: "canvas", label: "Sequence", hint: "Base-level sequence view", Icon: IconSequence },
    { id: "features", kind: "flyout", label: "Features", hint: "Feature list and editing (pops up over the map)", Icon: IconFeatures, count: featureCount || undefined },
    { id: "primers", kind: "flyout", label: "Primers", hint: "Primer list and design (pops up over the map)", Icon: IconPrimers, count: primerCount || undefined },
    { id: "history", kind: "flyout", label: "History", hint: "Edit and version history (pops up over the map)", Icon: IconHistory },
  ];

  return (
    <div
      role="tablist"
      aria-label="Sequence view"
      className={`flex shrink-0 items-stretch gap-0.5 bg-surface-sunken px-1.5 ${
        position === "top"
          ? "border-b border-border pb-0 pt-0.5"
          : "border-t border-border py-0.5"
      }`}
    >
      {tabs.map((t) => {
        // seq flyout bot — a canvas tab is "selected" when it is the active canvas
        // mode; a flyout tab is "selected" when its panel is currently open over
        // the canvas. Both share the same active styling so the bar reads as one
        // row, but flyout tabs carry the up-chevron pop affordance + aria-expanded
        // and dispatch a TOGGLE instead of a radio change.
        const isFlyout = t.kind === "flyout";
        const selected = isFlyout
          ? openFlyout === (t.id as SequenceFlyoutMode)
          : active === (t.id as SequenceCanvasMode);
        return (
          <Tooltip key={t.id} label={t.hint}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-expanded={isFlyout ? selected : undefined}
              onClick={() =>
                isFlyout
                  ? onToggleFlyout(t.id as SequenceFlyoutMode)
                  : onChange(t.id as SequenceCanvasMode)
              }
              data-testid={`seq-tab-${t.id}`}
              className={`relative flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-meta font-medium transition-colors ${
                selected
                  ? "bg-surface text-sky-700 shadow-[inset_0_-2px_0_0_#0284c7] dark:text-sky-300"
                  : "text-foreground-muted hover:bg-surface/70 hover:text-foreground"
              }`}
            >
              <t.Icon className="h-4 w-4" />
              <span>{t.label}</span>
              {typeof t.count === "number" ? (
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-meta font-semibold leading-4 ${
                    selected ? "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {t.count}
                </span>
              ) : null}
              {isFlyout ? (
                <IconChevron
                  className={`ml-0.5 h-3 w-3 transition-transform ${
                    selected ? "rotate-180" : ""
                  }`}
                />
              ) : null}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

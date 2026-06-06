"use client";

// sequence editor master. The horizontal DISPLAY ("Show") strip (redesign
// phase 2). This RETIRES the vertical ViewControlRail and relocates the same
// "what is drawn" toggles into a thin pill-chip row that sits in the canvas
// head, above the viewer, matching the v2 mockup's .display-strip. It is a pure
// PRESENTATION relocation over the existing view-state booleans: each chip flips
// the SAME SequenceViewState flag the old rail toggle did, and the parent
// re-derives the SeqViz props exactly as before. No new filtering, no view-state
// shape change.
//
// Chip states. Active (the layer is drawn) reads filled / sky; inactive reads as
// a calm outline pill; a disabled chip (a toggle that is meaningless for the
// current molecule, e.g. topology on a genuinely-linear sequence) dims and stops
// responding. Inline-SVG icons or a tiny color swatch only (no emoji, no icon
// library, per project convention); every chip is wrapped in the shared Tooltip.

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { colorForType } from "@/lib/sequences/feature-colors";
import type { SequenceViewState } from "./sequence-view-state";

// ── icons (inline SVG only, no emoji / no icon library) ───────────────────────
function IconEnzymes({ className }: { className?: string }) {
  // scissors / cut site
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88" />
      <path d="M14.47 14.48L20 20" />
      <path d="M8.12 8.12L12 12" />
    </svg>
  );
}
function IconTranslation({ className }: { className?: string }) {
  // amino-acid "aa" glyph block
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 15l1.8-5 1.8 5" />
      <path d="M7.4 13.4h2.8" />
      <path d="M14 15l1.8-5 1.8 5" />
      <path d="M14.4 13.4h2.8" />
    </svg>
  );
}
function IconOrfs({ className }: { className?: string }) {
  // directional arrow run (reading frame)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 8h10l-3-3M3 8l3 3" />
      <path d="M21 16H11l3 3M21 16l-3-3" />
    </svg>
  );
}
function IconRuler({ className }: { className?: string }) {
  // ruler with ticks
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="9" width="20" height="6" rx="1" />
      <line x1="6" y1="9" x2="6" y2="12" />
      <line x1="10" y1="9" x2="10" y2="12" />
      <line x1="14" y1="9" x2="14" y2="12" />
      <line x1="18" y1="9" x2="18" y2="12" />
    </svg>
  );
}
function IconCircular({ className }: { className?: string }) {
  // ring (plasmid topology)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
function IconLinear({ className }: { className?: string }) {
  // straight strand (linear topology)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="9" x2="3" y2="15" />
      <line x1="21" y1="9" x2="21" y2="15" />
    </svg>
  );
}
function IconWrapped({ className }: { className?: string }) {
  // WRAPPED glyph: stacked rows (sequence chunked into rows, vertical scroll)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="14" y2="17" />
    </svg>
  );
}
function IconSingleLine({ className }: { className?: string }) {
  // SINGLE-LINE glyph: one row with a left-right arrow (horizontal scroll)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="8" x2="21" y2="8" />
      <polyline points="6 14 3 17 6 20" />
      <polyline points="18 14 21 17 18 20" />
      <line x1="3" y1="17" x2="21" y2="17" />
    </svg>
  );
}
// disclosure caret + eye glyphs for the per-feature-type show/hide flyout.
function IconCaret({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IconEye({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** A single display toggle chip. Active = filled / sky pill; inactive = calm
 *  outline pill; disabled dims + stops responding. Wrapped in the shared Tooltip
 *  naming the layer. Renders either a leading inline-SVG icon or a tiny color
 *  swatch (the mockup's .sw) for the colored layers (Features / Primers). */
function DisplayChip({
  active,
  onClick,
  label,
  tooltip,
  disabled,
  icon,
  swatch,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tooltip: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  swatch?: string;
}) {
  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
            : "border-border bg-surface text-foreground hover:bg-surface-sunken"
        }`}
      >
        {swatch ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/10"
            style={{ backgroundColor: swatch }}
            aria-hidden="true"
          />
        ) : null}
        {icon ? <span className="shrink-0" aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

export interface SequenceDisplayStripProps {
  view: SequenceViewState;
  onViewChange: (next: SequenceViewState) => void;
  /** When the molecule isn't a plasmid the topology toggle is meaningless. */
  circular: boolean;
  /** The distinct feature types present (lowercase keys), for the per-type
   *  show/hide flyout off the Features chip. Empty hides the caret. */
  featureTypes: string[];
}

/** The per-type show/hide FLYOUT, anchored off the Features chip. A labeled
 *  "Feature types" group with one eye toggle per present type; flipping a row
 *  toggles that type's membership in `view.hiddenTypes` (the existing annotation
 *  filtering does the rest). Behavior is preserved 1:1 from the old rail. */
function FeatureTypesFlyout({
  view,
  featureTypes,
  onToggleType,
  onClose,
}: {
  view: SequenceViewState;
  featureTypes: string[];
  onToggleType: (k: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click / Escape (calm, non-modal popover).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Show or hide feature types"
      className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg"
    >
      <p className="px-1 pb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Feature types
      </p>
      {featureTypes.length === 0 ? (
        <p className="px-1 py-2 text-meta text-foreground-muted">No features to show.</p>
      ) : (
        <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
          {featureTypes.map((k) => {
            const hidden = !!view.hiddenTypes[k];
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onToggleType(k)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-sunken"
                  aria-pressed={!hidden}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10"
                    style={{ backgroundColor: colorForType(k) }}
                  />
                  <span className={`flex-1 truncate text-body ${hidden ? "text-foreground-muted line-through" : "text-foreground"}`}>
                    {k}
                  </span>
                  {hidden ? (
                    <IconEyeOff className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                  ) : (
                    <IconEye className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The horizontal display ("Show") strip. A tiny uppercase "Show" label, then
 *  one pill chip per existing display toggle, each flipping the SAME view flag it
 *  did on the old rail. The Features chip carries a disclosure caret that opens
 *  the labeled per-feature-type show/hide flyout, plus an amber dot when some
 *  types are hidden. The topology + wrap chips disable for the molecule states
 *  where they are meaningless, exactly as the rail did. */
export default function SequenceDisplayStrip({
  view,
  onViewChange,
  circular,
  featureTypes,
}: SequenceDisplayStripProps) {
  const set = (patch: Partial<SequenceViewState>) => onViewChange({ ...view, ...patch });
  const [typesOpen, setTypesOpen] = useState(false);

  const toggleType = (k: string) =>
    set({ hiddenTypes: { ...view.hiddenTypes, [k]: !view.hiddenTypes[k] } });

  // How many types are currently hidden (drives a small "filtered" affordance on
  // the Features chip so a non-default visibility state is visible).
  const hiddenCount = featureTypes.filter((k) => view.hiddenTypes[k]).length;

  // The linear viewer is shown when the molecule is linear, or when a circular
  // molecule is forced linear. The wrap toggle is linear-only.
  const linearShown = !circular || view.forceLinear;
  const topologyCircular = circular && !view.forceLinear;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-sunken px-3.5 py-1.5"
      role="group"
      aria-label="Display"
    >
      <span className="text-meta font-bold uppercase tracking-wide text-foreground-muted">Show</span>

      {/* FEATURES chip + per-type show/hide flyout. The chip flips the whole
          annotation layer; the caret opens the labeled "Feature types" flyout.
          An amber dot marks a non-default (some-types-hidden) state. */}
      <div className="relative inline-flex items-center">
        <Tooltip label="Show or hide feature annotations">
          <button
            type="button"
            role="switch"
            aria-checked={view.showFeatures}
            aria-label="Features"
            onClick={() => set({ showFeatures: !view.showFeatures })}
            className={`relative inline-flex items-center gap-1.5 rounded-l-full border py-1 pl-2.5 pr-2 text-meta font-semibold transition-colors ${
              view.showFeatures
                ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                : "border-border bg-surface text-foreground hover:bg-surface-sunken"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/10"
              style={{ backgroundColor: colorForType("misc_feature") }}
              aria-hidden="true"
            />
            <span>Features</span>
            {hiddenCount > 0 ? (
              <span
                className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-surface"
                aria-hidden="true"
              />
            ) : null}
          </button>
        </Tooltip>
        <Tooltip label="Show or hide feature types">
          <button
            type="button"
            onClick={() => setTypesOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={typesOpen}
            aria-label="Show or hide feature types"
            disabled={!view.showFeatures || featureTypes.length === 0}
            className={`inline-flex items-center justify-center rounded-r-full border border-l-0 py-1 pl-1 pr-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              typesOpen
                ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                : view.showFeatures
                  ? "border-sky-200 bg-sky-100 text-sky-600 hover:text-sky-700 dark:border-sky-800 dark:bg-sky-900/40"
                  : "border-border bg-surface text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            <IconCaret className="h-3 w-3" />
          </button>
        </Tooltip>
        {typesOpen ? (
          <FeatureTypesFlyout
            view={view}
            featureTypes={featureTypes}
            onToggleType={toggleType}
            onClose={() => setTypesOpen(false)}
          />
        ) : null}
      </div>

      <DisplayChip
        label="Primers"
        tooltip="Show or hide primer-binding annotations"
        active={view.showPrimers}
        onClick={() => set({ showPrimers: !view.showPrimers })}
        swatch="#0284c7"
      />
      <DisplayChip
        label="Enzyme sites"
        tooltip="Show or hide restriction-enzyme cut sites"
        active={view.showEnzymes}
        onClick={() => set({ showEnzymes: !view.showEnzymes })}
        icon={<IconEnzymes className="h-3.5 w-3.5" />}
      />
      <DisplayChip
        label="Translation"
        tooltip="Show or hide the amino-acid translation of CDS features"
        active={view.showTranslation}
        onClick={() => set({ showTranslation: !view.showTranslation })}
        icon={<IconTranslation className="h-3.5 w-3.5" />}
      />
      <DisplayChip
        label="Open reading frames"
        tooltip="Open reading frames. Highlight ATG-to-stop runs (over 30 aa, both strands) that could be genes in unannotated DNA."
        active={view.showOrfs}
        onClick={() => set({ showOrfs: !view.showOrfs })}
        icon={<IconOrfs className="h-3.5 w-3.5" />}
      />
      <DisplayChip
        label="Ruler / index"
        tooltip="Show or hide the ruler / index row"
        active={view.showIndex}
        onClick={() => set({ showIndex: !view.showIndex })}
        icon={<IconRuler className="h-3.5 w-3.5" />}
      />

      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />

      <DisplayChip
        label={topologyCircular ? "Circular" : "Linear"}
        tooltip={
          !circular
            ? "Linear molecule"
            : view.forceLinear
              ? "Show as circular"
              : "Show as linear"
        }
        active={topologyCircular}
        disabled={!circular}
        onClick={() => set({ forceLinear: !view.forceLinear })}
        icon={topologyCircular ? <IconCircular className="h-3.5 w-3.5" /> : <IconLinear className="h-3.5 w-3.5" />}
      />
      <DisplayChip
        label={view.wrapSequence ? "Wrapped" : "Single line"}
        tooltip={view.wrapSequence ? "Switch to a single continuous line" : "Switch to wrapped rows"}
        active={!view.wrapSequence}
        disabled={!linearShown}
        onClick={() => set({ wrapSequence: !view.wrapSequence })}
        icon={view.wrapSequence ? <IconWrapped className="h-3.5 w-3.5" /> : <IconSingleLine className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

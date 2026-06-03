"use client";

// sequence 2c-polish bot — the VIEW-CONTROL ICON RAIL. 2c shipped the view
// controls as a collapsible "Display" checklist; this refines the PRESENTATION
// into a compact icon rail of toggle buttons (the SnapGene left-edge
// track-toolbar PATTERN Grant likes — our own custom inline-SVG icons, never
// emoji). Each toggle = a small button + our icon + a <Tooltip> naming the
// track, with a clear active / inactive visual state. The calm default is
// preserved: this is a pure PRESENTATION refactor over the existing 2c
// view-state + filtering logic, it adds no new filtering.

import Tooltip from "@/components/Tooltip";
import type { SequenceViewState } from "./sequence-view-state";

// ── icons (inline SVG only, no emoji / no icon library — project convention) ──
function IconFeatures({ className }: { className?: string }) {
  // tag / annotation
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
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
function IconPrimers({ className }: { className?: string }) {
  // short arrow over a baseline (primer binding)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="17" x2="21" y2="17" />
      <path d="M6 11h9l-2.5-2.5M6 11l2.5 2.5" />
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
  // wrap toggle bot — WRAPPED glyph: stacked rows (the sequence chunked into
  // rows that scroll vertically). Three short stacked lines.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="14" y2="17" />
    </svg>
  );
}
function IconSingleLine({ className }: { className?: string }) {
  // wrap toggle bot — SINGLE-LINE glyph: one row with a left-right arrow
  // (the whole sequence on one continuous line that scrolls horizontally).
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="8" x2="21" y2="8" />
      <polyline points="6 14 3 17 6 20" />
      <polyline points="18 14 21 17 18 20" />
      <line x1="3" y1="17" x2="21" y2="17" />
    </svg>
  );
}

/** A single rail toggle: an icon button with an active / inactive state, wrapped
 *  in the shared Tooltip naming the track. */
function RailToggle({
  active,
  onClick,
  label,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label} placement="right">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? "border-sky-200 bg-sky-50 text-sky-600"
            : "border-transparent text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface ViewControlRailProps {
  view: SequenceViewState;
  onViewChange: (next: SequenceViewState) => void;
  /** When the molecule isn't a plasmid the topology toggle is meaningless. */
  circular: boolean;
}

/** The compact vertical icon rail of view-control toggles. Reuses the 2c
 *  view-state booleans 1:1 — toggling a button just flips the corresponding
 *  flag, and the parent re-derives the SeqViz props exactly as before. Each
 *  button is a bare one-click layer on / off. The per-feature-type show/hide
 *  list and the enzyme picker now live in the toolbar's Feature / Enzyme
 *  dropdowns (top menus consolidation bot), so the rail carries no flyouts. */
export default function ViewControlRail({
  view,
  onViewChange,
  circular,
}: ViewControlRailProps) {
  const set = (patch: Partial<SequenceViewState>) => onViewChange({ ...view, ...patch });

  // wrap toggle bot — the linear viewer is shown when the molecule is linear, or
  // when a circular molecule is forced linear. The wrap toggle is linear-only.
  const linearShown = !circular || view.forceLinear;

  return (
    <div
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-gray-100 bg-white py-2"
      role="group"
      aria-label="View controls"
    >
      <RailToggle label="Features" active={view.showFeatures} onClick={() => set({ showFeatures: !view.showFeatures })}>
        <IconFeatures className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Restriction sites" active={view.showEnzymes} onClick={() => set({ showEnzymes: !view.showEnzymes })}>
        <IconEnzymes className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Translation (CDS)" active={view.showTranslation} onClick={() => set({ showTranslation: !view.showTranslation })}>
        <IconTranslation className="h-4 w-4" />
      </RailToggle>
      <RailToggle
        label="Open reading frames: highlight ATG-to-stop runs (>=30 aa, both strands) that could be genes in unannotated DNA."
        active={view.showOrfs}
        onClick={() => set({ showOrfs: !view.showOrfs })}
      >
        <IconOrfs className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Primers" active={view.showPrimers} onClick={() => set({ showPrimers: !view.showPrimers })}>
        <IconPrimers className="h-4 w-4" />
      </RailToggle>

      <div className="my-1 h-px w-6 bg-gray-100" />

      <RailToggle label="Ruler / index" active={view.showIndex} onClick={() => set({ showIndex: !view.showIndex })}>
        <IconRuler className="h-4 w-4" />
      </RailToggle>
      <RailToggle
        label={
          !circular
            ? "Linear molecule"
            : view.forceLinear
              ? "Show as circular"
              : "Show as linear"
        }
        active={circular && !view.forceLinear}
        disabled={!circular}
        onClick={() => set({ forceLinear: !view.forceLinear })}
      >
        {circular && !view.forceLinear ? <IconCircular className="h-4 w-4" /> : <IconLinear className="h-4 w-4" />}
      </RailToggle>

      {/* wrap toggle bot — WRAP MODE for the linear Sequence view: WRAPPED
          (stacked rows, vertical scroll) vs SINGLE-LINE (one continuous row,
          horizontal scroll). One button that flips between the two states; its
          icon + tooltip name the mode it will switch TO. Disabled while a
          circular molecule is shown as a ring (the toggle is linear-only). */}
      <RailToggle
        label={view.wrapSequence ? "Single-line view" : "Wrapped view"}
        active={!view.wrapSequence}
        disabled={linearShown ? false : true}
        onClick={() => set({ wrapSequence: !view.wrapSequence })}
      >
        {view.wrapSequence ? <IconSingleLine className="h-4 w-4" /> : <IconWrapped className="h-4 w-4" />}
      </RailToggle>
    </div>
  );
}

"use client";

// sequence 2c-polish bot — the VIEW-CONTROL ICON RAIL. 2c shipped the view
// controls as a collapsible "Display" checklist; this refines the PRESENTATION
// into a compact icon rail of toggle buttons (the SnapGene left-edge
// track-toolbar PATTERN Grant likes — our own custom inline-SVG icons, never
// emoji). Each toggle = a small button + our icon + a <Tooltip> naming the
// track, with a clear active / inactive visual state. The calm default is
// preserved: this is a pure PRESENTATION refactor over the existing 2c
// view-state + filtering logic, it adds no new filtering.

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { colorForType } from "@/lib/sequences/feature-colors";
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
function IconComplement({ className }: { className?: string }) {
  // two parallel strands
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="3" y1="16" x2="21" y2="16" />
      <line x1="8" y1="8" x2="8" y2="16" />
      <line x1="13" y1="8" x2="13" y2="16" />
      <line x1="18" y1="8" x2="18" y2="16" />
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
function IconCaret({ className }: { className?: string }) {
  // small disclosure caret marking the Features toggle as having a flyout
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
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
  /** The distinct feature types present (lowercase keys), for the per-type
   *  show/hide flyout off the Features toggle. */
  featureTypes: string[];
}

/** The per-type show/hide flyout, anchored off the Features rail toggle. Lists
 *  every feature type present with an eye toggle; flips `hiddenTypes` in the
 *  shared view-state (the existing filtering does the rest). This is the
 *  RELOCATED per-type visibility control (moved off the FeaturesPanel). */
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
      className="absolute left-10 top-0 z-30 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
    >
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        Feature types
      </p>
      {featureTypes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-gray-400">No features to show.</p>
      ) : (
        <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
          {featureTypes.map((k) => {
            const hidden = !!view.hiddenTypes[k];
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onToggleType(k)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-gray-50"
                  aria-pressed={!hidden}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10"
                    style={{ backgroundColor: colorForType(k) }}
                  />
                  <span className={`flex-1 truncate text-sm ${hidden ? "text-gray-400 line-through" : "text-gray-700"}`}>
                    {k}
                  </span>
                  {hidden ? (
                    <IconEyeOff className="h-3.5 w-3.5 shrink-0 text-gray-400" />
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

/** The compact vertical icon rail of view-control toggles. Reuses the 2c
 *  view-state booleans 1:1 — toggling a button just flips the corresponding
 *  flag, and the parent re-derives the SeqViz props exactly as before. The
 *  Features toggle now also opens a per-type show/hide flyout. */
export default function ViewControlRail({ view, onViewChange, circular, featureTypes }: ViewControlRailProps) {
  const set = (patch: Partial<SequenceViewState>) => onViewChange({ ...view, ...patch });
  const [typesOpen, setTypesOpen] = useState(false);

  const toggleType = (k: string) =>
    set({ hiddenTypes: { ...view.hiddenTypes, [k]: !view.hiddenTypes[k] } });

  // How many types are currently hidden (drives a small "filtered" affordance).
  const hiddenCount = featureTypes.filter((k) => view.hiddenTypes[k]).length;

  return (
    <div
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-gray-100 bg-white py-2"
      role="group"
      aria-label="View controls"
    >
      {/* FEATURES toggle + per-type show/hide flyout. The master button flips
          the whole annotation layer; the caret affordance opens the flyout. */}
      <div className="relative flex flex-col items-center">
        <div className="relative">
          <RailToggle label="Features" active={view.showFeatures} onClick={() => set({ showFeatures: !view.showFeatures })}>
            <IconFeatures className="h-4 w-4" />
          </RailToggle>
          {hiddenCount > 0 ? (
            <span
              className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <Tooltip label="Show or hide feature types" placement="right">
          <button
            type="button"
            onClick={() => setTypesOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={typesOpen}
            aria-label="Show or hide feature types"
            disabled={!view.showFeatures}
            className={`mt-0.5 flex h-4 w-8 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
              typesOpen ? "bg-sky-50 text-sky-600" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
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
      <RailToggle label="Restriction sites" active={view.showEnzymes} onClick={() => set({ showEnzymes: !view.showEnzymes })}>
        <IconEnzymes className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Translation (CDS)" active={view.showTranslation} onClick={() => set({ showTranslation: !view.showTranslation })}>
        <IconTranslation className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Open reading frames" active={view.showOrfs} onClick={() => set({ showOrfs: !view.showOrfs })}>
        <IconOrfs className="h-4 w-4" />
      </RailToggle>
      <RailToggle label="Primers" active={view.showPrimers} onClick={() => set({ showPrimers: !view.showPrimers })}>
        <IconPrimers className="h-4 w-4" />
      </RailToggle>

      <div className="my-1 h-px w-6 bg-gray-100" />

      <RailToggle label="Complement strand" active={view.showComplement} onClick={() => set({ showComplement: !view.showComplement })}>
        <IconComplement className="h-4 w-4" />
      </RailToggle>
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
    </div>
  );
}

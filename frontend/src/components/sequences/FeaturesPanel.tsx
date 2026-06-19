"use client";

// sequence Phase 2c bot — the FEATURES & DISPLAY panel (SnapGene / Benchling
// style). One cohesive right-hand surface with two calm sections:
//   1. FEATURES — a sortable list of every feature (name / type / range / strand),
//      with click-to-select-in-viewer, a click-to-recolor swatch, and per-row
//      edit / duplicate / delete. An "Add feature" affordance uses the current
//      drag-selection.
//   2. DISPLAY — view controls (the lever for the calm-by-default look): master
//      feature toggle, per-type visibility + per-type color, individual feature
//      visibility, and the layer switches (enzymes / translation / ORFs /
//      complement / ruler). Toggling filters what we feed SeqViz.
//
// No emojis (inline SVG only), no em-dashes. Uses the shared Tooltip.

import { useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import type { EditFeature } from "@/lib/sequences/edit-model";
import { featureLength } from "@/lib/sequences/feature-edit";
import {
  FEATURE_COLOR_SWATCHES,
  colorForType,
  resolveFeatureColor,
} from "@/lib/sequences/feature-colors";
import {
  type SequenceViewState,
  featureKey,
  typeKey,
} from "./sequence-view-state";

type SortKey = "order" | "name" | "type" | "start" | "length";

// ── icons (inline SVG, no emojis) ───────────────────────────────────────────
function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconEdit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IconDuplicate({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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
function IconX({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${className ?? ""} transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** A small popover-free inline color swatch row for picking a color. */
function ColorSwatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {FEATURE_COLOR_SWATCHES.map((sw) => {
        const active = value.toLowerCase() === sw.toLowerCase();
        return (
          <button
            key={sw}
            type="button"
            onClick={() => onPick(sw)}
            className={`h-5 w-5 rounded seq-swatch-border transition-transform hover:scale-110 ${
              active ? "ring-2 ring-sky-500 ring-offset-1" : ""
            }`}
            style={{ backgroundColor: sw }}
            aria-label={`Set color ${sw}`}
          />
        );
      })}
      <label className="relative ml-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded seq-swatch-border">
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          className="h-5 w-5 cursor-pointer opacity-0"
          aria-label="Custom color"
        />
        <span className="pointer-events-none absolute text-meta font-bold text-foreground-muted">+</span>
      </label>
    </div>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
  right,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-foreground-muted hover:text-foreground"
      >
        <IconChevron open={open} className="h-3.5 w-3.5" />
        {title}
      </button>
      {right}
    </div>
  );
}

export interface FeaturesPanelProps {
  features: EditFeature[];
  view: SequenceViewState;
  onViewChange: (next: SequenceViewState) => void;
  /** Click a feature row => select/zoom it in the viewer. */
  onSelectFeature: (index: number) => void;
  /** Index of the currently-selected/zoomed feature, if any. */
  selectedIndex: number | null;
  onAddFeature: () => void;
  /** true when there's a drag-selection to seed Add from. */
  canAdd: boolean;
  onEditFeature: (index: number) => void;
  onDuplicateFeature: (index: number) => void;
  onDeleteFeature: (index: number) => void;
  /** Set a per-feature color override. */
  onRecolorFeature: (index: number, color: string) => void;
  /** Set the default color for a whole type. */
  onRecolorType: (type: string, color: string) => void;
  /** Close the on-demand panel (omitted when the panel is always-on). */
  onClose?: () => void;
  /** Read-only surface: hide every mutating affordance (Add, recolor, duplicate,
   *  delete). The list stays selectable and the per-row "edit" button opens a
   *  read-only info popup (mapped by the parent). */
  readOnly?: boolean;
}

export default function FeaturesPanel({
  features,
  view,
  onViewChange,
  onSelectFeature,
  selectedIndex,
  onAddFeature,
  canAdd,
  onEditFeature,
  onDuplicateFeature,
  onDeleteFeature,
  onRecolorFeature,
  onRecolorType,
  onClose,
  readOnly = false,
}: FeaturesPanelProps) {
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [displayOpen, setDisplayOpen] = useState(false); // calm: collapsed
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [openColorIdx, setOpenColorIdx] = useState<number | null>(null);
  const [openTypeColor, setOpenTypeColor] = useState<string | null>(null);

  // Sort while keeping the original index (so callbacks reference the doc index).
  const ordered = useMemo(() => {
    const arr = features.map((f, index) => ({ f, index }));
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.f.name.localeCompare(b.f.name);
        case "type":
          return (a.f.type || "").localeCompare(b.f.type || "");
        case "start":
          return a.f.start - b.f.start;
        case "length":
          return featureLength(b.f) - featureLength(a.f);
        default:
          return a.index - b.index;
      }
    });
    return arr;
  }, [features, sortKey]);

  // Distinct types present (preserve a stable order: first-seen).
  const typesPresent = useMemo(() => {
    const seen: string[] = [];
    const set = new Set<string>();
    for (const f of features) {
      const k = typeKey(f.type);
      if (!set.has(k)) {
        set.add(k);
        seen.push(k);
      }
    }
    return seen.sort();
  }, [features]);

  const setView = (patch: Partial<SequenceViewState>) =>
    onViewChange({ ...view, ...patch });

  const toggleFeature = (f: EditFeature) => {
    const key = featureKey(f);
    setView({ hiddenFeatures: { ...view.hiddenFeatures, [key]: !view.hiddenFeatures[key] } });
  };

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-surface-raised">
      {/* On-demand drawer header with a close affordance. */}
      {onClose ? (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">Feature index</span>
          <Tooltip label="Hide the feature list">
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
              aria-label="Hide the feature list"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      ) : null}
      {/* FEATURES SECTION */}
      <SectionHeader
        title={`Features (${features.length})`}
        open={featuresOpen}
        onToggle={() => setFeaturesOpen((v) => !v)}
        right={
          readOnly ? null : (
            <Tooltip label={canAdd ? "Add a feature from the selected range" : "Select a range in the viewer first"}>
              <button
                type="button"
                data-tutor-target="sequence-annotate-button"
                onClick={onAddFeature}
                disabled={!canAdd}
                className="ros-btn-raise flex items-center gap-1 rounded-md bg-brand-action px-2 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconPlus className="h-3 w-3" />
                Add
              </button>
            </Tooltip>
          )
        }
      />

      {featuresOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto max-h-80">
          {/* sort header */}
          <div className="flex items-center gap-1 border-y border-border px-3 py-1 text-meta uppercase tracking-wide text-foreground-muted">
            <span className="mr-auto">Sort</span>
            {(["order", "name", "type", "start", "length"] as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortKey(k)}
                className={`rounded px-1.5 py-0.5 ${
                  sortKey === k ? "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "hover:bg-surface-sunken"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {features.length === 0 ? (
            <p className="px-3 py-6 text-center text-meta text-foreground-muted">
              {readOnly
                ? "This sequence has no features."
                : "No features yet. Select a range in the viewer and click Add."}
            </p>
          ) : (
            <ul>
              {ordered.map(({ f, index }) => {
                const color = resolveFeatureColor(f);
                const hidden = view.hiddenFeatures[featureKey(f)];
                const len = featureLength(f);
                const isSel = selectedIndex === index;
                return (
                  <li key={`${index}-${f.name}`} className={`border-b border-border ${isSel ? "bg-sky-50 dark:bg-sky-500/15" : ""}`}>
                    <div className="group flex items-center gap-2 px-3 py-1.5">
                      {/* color swatch (click to recolor; static in read-only) */}
                      <div className="relative">
                        {readOnly ? (
                          <span
                            className="block h-4 w-4 shrink-0 rounded-sm seq-swatch-border"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpenColorIdx(openColorIdx === index ? null : index)}
                            className="h-4 w-4 shrink-0 rounded-sm seq-swatch-border"
                            style={{ backgroundColor: color }}
                            aria-label={`Recolor ${f.name}`}
                          />
                        )}
                        {!readOnly && openColorIdx === index ? (
                          <div className="absolute left-0 top-5 z-20 rounded-lg border border-border bg-surface-raised p-2 shadow-lg">
                            <ColorSwatches
                              value={color}
                              onPick={(c) => {
                                onRecolorFeature(index, c);
                                setOpenColorIdx(null);
                              }}
                            />
                          </div>
                        ) : null}
                      </div>

                      {/* name + meta (click selects) */}
                      <button
                        type="button"
                        onClick={() => onSelectFeature(index)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className={`block truncate text-body ${hidden ? "text-foreground-muted line-through" : "text-foreground"}`}>
                          {f.name}
                        </span>
                        <span className="block text-meta text-foreground-muted">
                          {(f.type || "misc_feature")} · {(f.start + 1).toLocaleString()}..{f.end.toLocaleString()} ·{" "}
                          {len.toLocaleString()} bp · {f.strand === -1 ? "-" : "+"}
                          {f.locations && f.locations.length > 1 ? ` · ${f.locations.length} segments` : ""}
                        </span>
                      </button>

                      {/* row actions (appear on hover) */}
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Tooltip label={hidden ? "Show in viewer" : "Hide in viewer"}>
                          <button
                            type="button"
                            onClick={() => toggleFeature(f)}
                            aria-label={`${hidden ? "Show" : "Hide"} ${f.name} in viewer`}
                            className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground-muted"
                          >
                            {hidden ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                          </button>
                        </Tooltip>
                        <Tooltip label={readOnly ? "Feature details" : "Edit feature"}>
                          <button
                            type="button"
                            onClick={() => onEditFeature(index)}
                            aria-label={`${readOnly ? "Details for" : "Edit"} ${f.name}`}
                            className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground-muted"
                          >
                            <IconEdit className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        {!readOnly ? (
                          <>
                            <Tooltip label="Duplicate feature">
                              <button
                                type="button"
                                onClick={() => onDuplicateFeature(index)}
                                aria-label={`Duplicate ${f.name}`}
                                className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground-muted"
                              >
                                <IconDuplicate className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete feature">
                              <button
                                type="button"
                                onClick={() => onDeleteFeature(index)}
                                aria-label={`Delete ${f.name}`}
                                className="rounded p-1 text-foreground-muted hover:bg-rose-50 dark:hover:bg-rose-500/20 hover:text-rose-600"
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* TYPE COLORS SECTION. Per-type SHOW/HIDE has moved to the left icon rail
          (the flyout off the Features toggle); this section keeps only per-type
          COLOR, which is styling that belongs with feature management. */}
      {typesPresent.length > 0 ? (
        <div className="border-t border-border">
          <SectionHeader title="Type colors" open={displayOpen} onToggle={() => setDisplayOpen((v) => !v)} />
          {displayOpen ? (
            <div className="max-h-[55vh] overflow-y-auto px-3 pb-3">
              <ul className="space-y-0.5">
                {typesPresent.map((k) => {
                  const typeColor = colorForType(k);
                  return (
                    <li key={k}>
                      <div className="flex items-center gap-2 py-0.5">
                        <div className="relative">
                          {readOnly ? (
                            <span
                              className="block h-3.5 w-3.5 shrink-0 rounded-sm seq-swatch-border"
                              style={{ backgroundColor: typeColor }}
                              aria-hidden="true"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setOpenTypeColor(openTypeColor === k ? null : k)}
                              className="h-3.5 w-3.5 shrink-0 rounded-sm seq-swatch-border"
                              style={{ backgroundColor: typeColor }}
                              aria-label={`Set default color for ${k}`}
                            />
                          )}
                          {!readOnly && openTypeColor === k ? (
                            <div className="absolute left-0 top-5 z-20 rounded-lg border border-border bg-surface-raised p-2 shadow-lg">
                              <ColorSwatches
                                value={typeColor}
                                onPick={(c) => {
                                  onRecolorType(k, c);
                                  setOpenTypeColor(null);
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                        {readOnly ? (
                          <span className="flex-1 truncate text-left text-body text-foreground">{k}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpenTypeColor(openTypeColor === k ? null : k)}
                            className="flex-1 truncate text-left text-body text-foreground"
                          >
                            {k}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

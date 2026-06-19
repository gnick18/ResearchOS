"use client";

// seq-bottom-bar bot — The v2 consolidated bottom bar for the sequence editor.
// Collapses the previous three stacked rows (Display strip + coordinate cluster
// + tab spine) into ONE slim single row, flag-gated behind
// NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2.
//
// Layout (left to right in one row):
//   [Find icon] [Map | Sequence | Features (n) | Primers | History tabs]
//   [flexible space]
//   [Circular/Linear segmented toggle] [Display (n) popover] [zoom control]
//
// The Display popover holds the overlay toggles that used to be always-visible
// chips: Features, Primers, Enzyme sites, Translation, Open reading frames,
// Ruler/index, Wrapped. A badge on the button shows how many overlays are on.
// The per-type Features flyout is preserved inside the Display popover.
//
// Selection readout + Extract move OUT of the permanent footer: they appear as
// a contextual chip on the canvas (see SeqSelectionChip below) only when there
// is an active non-zero selection. When nothing is selected they are invisible.
//
// The floating "Search your work" BeakerSearchBottomBar is removed from the
// sequence editor route when this flag is on (done via prop in the parent;
// this file doesn't touch AppShell).
//
// House rules obeyed:
//  - No raw inline SVG. All icons use <Icon name="..." />.
//  - No emoji in UI.
//  - Sentence case on all labels.
//  - ros-popup-card-shadow / ros-popover-shadow classes for the Display popover.
//  - No em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { colorForType } from "@/lib/sequences/feature-colors";
import type { SequenceViewState } from "./sequence-view-state";
import type { SequenceCanvasMode, SequenceFlyoutMode } from "./SequenceTabBar";
import type { SelectionReadout } from "./SequenceSelectionReadout";
import { SelectionReadoutContent } from "./SequenceSelectionReadout";

// ── FeatureTypesFlyout (reused from SequenceDisplayStrip pattern) ─────────────
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
      className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-border bg-surface p-2 ros-popup-card-shadow"
    >
      <p className="px-1 pb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Feature types
      </p>
      {featureTypes.length === 0 ? (
        <p className="px-1 py-2 text-meta text-foreground-muted">No features to show.</p>
      ) : (
        <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto">
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
                    className="h-3 w-3 shrink-0 rounded-sm seq-swatch-border"
                    style={{ backgroundColor: colorForType(k) }}
                  />
                  <span
                    className={`flex-1 truncate text-body ${
                      hidden ? "text-foreground-muted line-through" : "text-foreground"
                    }`}
                  >
                    {k}
                  </span>
                  {hidden ? (
                    <Icon name="eyeOff" className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                  ) : (
                    <Icon name="eye" className="h-3.5 w-3.5 shrink-0 text-sky-600" />
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

// ── DisplayPopover ────────────────────────────────────────────────────────────
// The popover that opens from the "Display" button. Contains all overlay toggles
// that previously lived as always-visible chips in SequenceDisplayStrip. A
// checkmark icon marks each row that is currently enabled.

interface DisplayPopoverProps {
  view: SequenceViewState;
  onViewChange: (next: SequenceViewState) => void;
  featureTypes: string[];
  circular: boolean;
  onClose: () => void;
}

function DisplayPopover({
  view,
  onViewChange,
  featureTypes,
  circular,
  onClose,
}: DisplayPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);

  const set = (patch: Partial<SequenceViewState>) =>
    onViewChange({ ...view, ...patch });

  const toggleType = (k: string) =>
    set({ hiddenTypes: { ...view.hiddenTypes, [k]: !view.hiddenTypes[k] } });

  const linearShown = !circular || view.forceLinear;

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

  // Each overlay row: label, active flag, toggle handler, optional swatch color.
  const overlays: Array<{
    key: string;
    label: string;
    active: boolean;
    onToggle: () => void;
    swatch?: string;
    iconName?: string;
    disabled?: boolean;
  }> = [
    {
      key: "features",
      label: "Features",
      active: view.showFeatures,
      onToggle: () => set({ showFeatures: !view.showFeatures }),
      swatch: colorForType("misc_feature"),
    },
    {
      key: "primers",
      label: "Primers",
      active: view.showPrimers,
      onToggle: () => set({ showPrimers: !view.showPrimers }),
      swatch: "#0284c7",
    },
    {
      key: "enzymes",
      label: "Enzyme sites",
      active: view.showEnzymes,
      onToggle: () => set({ showEnzymes: !view.showEnzymes }),
      iconName: "cut",
    },
    {
      key: "translation",
      label: "Translation",
      active: view.showTranslation,
      onToggle: () => set({ showTranslation: !view.showTranslation }),
      iconName: "translation",
    },
    {
      key: "orfs",
      label: "Open reading frames",
      active: view.showOrfs,
      onToggle: () => set({ showOrfs: !view.showOrfs }),
      iconName: "orfs",
    },
    {
      key: "index",
      label: "Ruler / index",
      active: view.showIndex,
      onToggle: () => set({ showIndex: !view.showIndex }),
      iconName: "ruler",
    },
    {
      key: "wrap",
      label: "Wrapped",
      active: view.wrapSequence,
      onToggle: () => set({ wrapSequence: !view.wrapSequence }),
      iconName: view.wrapSequence ? "wrapped" : "singleLine",
      disabled: !linearShown,
    },
  ];

  // Hidden type count for the Features row sub-label.
  const hiddenTypeCount = featureTypes.filter((k) => view.hiddenTypes[k]).length;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Display overlays"
      className="absolute bottom-full right-0 z-40 mb-1.5 w-60 rounded-xl border border-border bg-surface p-2 ros-popup-card-shadow"
    >
      <p className="px-1.5 pb-1 pt-0.5 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Display overlays
      </p>
      <ul className="space-y-0.5">
        {overlays.map((ov) => (
          <li key={ov.key}>
            {ov.key === "features" ? (
              /* Features row has a sub-caret for the types flyout */
              <div className="relative">
                <div
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 ${
                    ov.disabled ? "opacity-40" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={ov.disabled ? undefined : ov.onToggle}
                    disabled={ov.disabled}
                    aria-pressed={ov.active}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    {ov.swatch ? (
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm seq-swatch-border"
                        style={{ backgroundColor: ov.swatch }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={`flex-1 truncate text-body ${
                        ov.active ? "text-foreground" : "text-foreground-muted"
                      }`}
                    >
                      {ov.label}
                    </span>
                    {ov.active ? (
                      <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    ) : null}
                    {hiddenTypeCount > 0 && ov.active ? (
                      <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">
                        {hiddenTypeCount}
                      </span>
                    ) : null}
                  </button>
                  {/* Caret to open the feature types flyout */}
                  {ov.active && featureTypes.length > 0 ? (
                    <Tooltip label="Show or hide feature types">
                      <button
                        type="button"
                        onClick={() => setTypesOpen((o) => !o)}
                        aria-haspopup="dialog"
                        aria-expanded={typesOpen}
                        aria-label="Show or hide feature types"
                        className="rounded p-0.5 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                      >
                        <Icon
                          name="caret"
                          className={`h-3 w-3 transition-transform ${
                            typesOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
                {typesOpen ? (
                  <FeatureTypesFlyout
                    view={view}
                    featureTypes={featureTypes}
                    onToggleType={toggleType}
                    onClose={() => setTypesOpen(false)}
                  />
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={ov.disabled ? undefined : ov.onToggle}
                disabled={ov.disabled}
                aria-pressed={ov.active}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left ${
                  ov.disabled
                    ? "cursor-not-allowed opacity-40"
                    : "hover:bg-surface-sunken"
                }`}
              >
                {ov.swatch ? (
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm seq-swatch-border"
                    style={{ backgroundColor: ov.swatch }}
                    aria-hidden="true"
                  />
                ) : ov.iconName ? (
                  <Icon
                    name={ov.iconName as Parameters<typeof Icon>[0]["name"]}
                    className="h-3.5 w-3.5 shrink-0 text-foreground-muted"
                  />
                ) : null}
                <span
                  className={`flex-1 truncate text-body ${
                    ov.active ? "text-foreground" : "text-foreground-muted"
                  }`}
                >
                  {ov.label}
                </span>
                {ov.active ? (
                  <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                ) : null}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── SequenceBottomBarV2 ───────────────────────────────────────────────────────

export interface SequenceBottomBarV2Props {
  // Tab bar state
  canvasMode: SequenceCanvasMode;
  openFlyout: SequenceFlyoutMode | null;
  onCanvasChange: (mode: SequenceCanvasMode) => void;
  onToggleFlyout: (mode: SequenceFlyoutMode) => void;
  featureCount: number;
  primerCount: number;
  // Display/view state
  view: SequenceViewState;
  onViewChange: (next: SequenceViewState) => void;
  circular: boolean;
  featureTypes: string[];
  // Find
  onFind: () => void;
  // Zoom control (passed as a render slot to avoid coupling zoom logic here)
  zoomSlot: React.ReactNode;
  // Topology toggle is in right cluster (Circular/Linear)
  // (already derivable from view + circular, toggled via onViewChange)
}

// A segmented 2-state toggle for Circular / Linear topology.
function TopologyToggle({
  circular,
  forceLinear,
  disabled,
  onToggle,
}: {
  circular: boolean;
  forceLinear: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const isCircular = circular && !forceLinear;
  return (
    <Tooltip
      label={
        !circular
          ? "Linear molecule"
          : isCircular
            ? "Switch to linear view"
            : "Switch to circular view"
      }
    >
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        aria-label={isCircular ? "Circular" : "Linear"}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-meta font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          isCircular
            ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
            : "border-border bg-surface-sunken text-foreground hover:bg-surface"
        }`}
      >
        <Icon
          name={isCircular ? "moleculeCircular" : "moleculeLinear"}
          className="h-3.5 w-3.5"
        />
        <span>{isCircular ? "Circular" : "Linear"}</span>
      </button>
    </Tooltip>
  );
}

// The tab definitions (same as SequenceTabBar but rendered inline here).
const TAB_DEFS: Array<{
  id: SequenceCanvasMode | SequenceFlyoutMode;
  kind: "canvas" | "flyout";
  label: string;
  hint: string;
  iconName: Parameters<typeof Icon>[0]["name"];
}> = [
  { id: "map", kind: "canvas", label: "Map", hint: "Whole-molecule map view", iconName: "map" },
  { id: "sequence", kind: "canvas", label: "Sequence", hint: "Base-level sequence view", iconName: "sequence" },
  { id: "features", kind: "flyout", label: "Features", hint: "Feature list (pops up over the map)", iconName: "features" },
  { id: "primers", kind: "flyout", label: "Primers", hint: "Primer list (pops up over the map)", iconName: "primers" },
  { id: "history", kind: "flyout", label: "History", hint: "Edit history (pops up over the map)", iconName: "history" },
];

export default function SequenceBottomBarV2({
  canvasMode,
  openFlyout,
  onCanvasChange,
  onToggleFlyout,
  featureCount,
  primerCount,
  view,
  onViewChange,
  circular,
  featureTypes,
  onFind,
  zoomSlot,
}: SequenceBottomBarV2Props) {
  const [displayOpen, setDisplayOpen] = useState(false);

  const set = (patch: Partial<SequenceViewState>) =>
    onViewChange({ ...view, ...patch });

  // Count how many display overlays are currently enabled (for the badge).
  const overlayCount = [
    view.showFeatures,
    view.showPrimers,
    view.showEnzymes,
    view.showTranslation,
    view.showOrfs,
    view.showIndex,
    view.wrapSequence,
  ].filter(Boolean).length;

  const linearShown = !circular || view.forceLinear;

  return (
    <div
      className="relative flex shrink-0 items-center gap-0.5 border-t border-border bg-surface px-1 py-0.5"
      role="toolbar"
      aria-label="Sequence editor controls"
    >
      {/* Left: Find icon button */}
      <Tooltip label="Find in this sequence (Cmd F)">
        <button
          type="button"
          onClick={onFind}
          aria-label="Find"
          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-meta text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      {/* Tabs: Map, Sequence, Features (n), Primers, History */}
      <div role="tablist" aria-label="Sequence view" className="flex items-stretch gap-0.5">
        {TAB_DEFS.map((t) => {
          const isFlyout = t.kind === "flyout";
          const selected = isFlyout
            ? openFlyout === (t.id as SequenceFlyoutMode)
            : canvasMode === (t.id as SequenceCanvasMode);
          const count =
            t.id === "features" ? (featureCount || undefined) : t.id === "primers" ? (primerCount || undefined) : undefined;
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
                    : onCanvasChange(t.id as SequenceCanvasMode)
                }
                data-testid={`seq-tab-${t.id}`}
                className={`relative flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-meta font-medium transition-colors ${
                  selected
                    ? "bg-surface text-sky-700 shadow-[inset_0_-2px_0_0_#0284c7] dark:text-sky-300"
                    : "text-foreground-muted hover:bg-surface/70 hover:text-foreground"
                }`}
              >
                <Icon name={t.iconName} className="h-3.5 w-3.5" />
                <span>{t.label}</span>
                {typeof count === "number" ? (
                  <span
                    className={`ml-0.5 rounded-full px-1.5 text-meta font-semibold leading-4 ${
                      selected
                        ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
                {isFlyout ? (
                  <Icon
                    name="chevronDown"
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right cluster: Circular/Linear toggle + Display popover + Zoom */}
      <div className="relative flex shrink-0 items-center gap-1.5 pr-1">
        {/* Topology toggle (Circular / Linear) */}
        <TopologyToggle
          circular={circular}
          forceLinear={view.forceLinear}
          disabled={!circular}
          onToggle={() => set({ forceLinear: !view.forceLinear })}
        />

        {/* Display button with badge */}
        <div className="relative">
          <Tooltip label="Display overlays">
            <button
              type="button"
              onClick={() => setDisplayOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={displayOpen}
              aria-label="Display overlays"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-meta font-semibold transition-colors ${
                displayOpen
                  ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                  : "border-border bg-surface-sunken text-foreground hover:bg-surface"
              }`}
            >
              <Icon name="eye" className="h-3.5 w-3.5" />
              <span>Display</span>
              {overlayCount > 0 ? (
                <span
                  className={`ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                    displayOpen
                      ? "bg-sky-200 text-sky-800 dark:bg-sky-700 dark:text-sky-100"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {overlayCount}
                </span>
              ) : null}
              <Icon
                name="caret"
                className={`h-3 w-3 transition-transform ${displayOpen ? "rotate-180" : ""}`}
              />
            </button>
          </Tooltip>
          {displayOpen ? (
            <DisplayPopover
              view={view}
              onViewChange={onViewChange}
              featureTypes={featureTypes}
              circular={circular}
              onClose={() => setDisplayOpen(false)}
            />
          ) : null}
        </div>

        {/* Zoom control slot */}
        {zoomSlot ? (
          <div className="flex items-center">{zoomSlot}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── SeqSelectionChip ──────────────────────────────────────────────────────────
// Contextual chip that appears on the canvas only when there is an active
// non-zero selection (range or caret). Shows the SelectionReadoutContent and,
// when extract is available, the Extract button. Positioned by the parent as an
// absolute overlay at the bottom-left of the canvas area.

export interface SeqSelectionChipProps {
  readout: SelectionReadout | null;
  canExtractRegion: boolean;
  onExtractRegion: (() => void) | null;
  readOnly: boolean;
}

export function SeqSelectionChip({
  readout,
  canExtractRegion,
  onExtractRegion,
  readOnly,
}: SeqSelectionChipProps) {
  // Only show when there is a meaningful selection (caret or range).
  if (readout == null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-meta text-foreground-muted shadow-sm ros-popover-shadow"
    >
      <span className="flex items-center gap-3 pointer-events-none">
        <SelectionReadoutContent readout={readout} />
      </span>
      {onExtractRegion && !readOnly ? (
        <Tooltip
          label={
            canExtractRegion
              ? "Make a new sequence from the selected feature or range"
              : "Select a feature or a range to extract it as a new sequence"
          }
        >
          <button
            type="button"
            data-testid="seq-extract-region-btn"
            onClick={onExtractRegion}
            disabled={!canExtractRegion}
            // pointer-events-auto re-enables clicks on just this button inside
            // the pointer-events-none chip shell.
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-sunken disabled:hover:text-foreground-muted"
          >
            <Icon name="cut" className="h-3.5 w-3.5" />
            <span>Extract</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

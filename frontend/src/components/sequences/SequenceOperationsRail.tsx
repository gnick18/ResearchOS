"use client";

// sequence editor master, the OPERATIONS RAIL + INSPECTOR (sequences redesign
// phase 1). A persistent thin strip on the right edge of the editor that makes
// the bioinformatics capability glanceable, grouped by intent (Design vs
// Analyze, then Export + More). Clicking a rail icon opens its INSPECTOR panel,
// a calm launcher of that operation's existing actions; clicking the active
// icon again collapses the inspector back to just the rail, reclaiming canvas
// width. This is the "unburial" of the old junk-drawer Analyze menu. Phase 1 is
// PURELY a discoverable launcher wired to the editor's existing handlers /
// dialogs; the selection-contextual inspector, the Cmd-K palette, and
// results-as-artifacts are later phases and are NOT built here.

import { type ReactNode } from "react";
import Tooltip from "@/components/Tooltip";

/** One launcher action inside an inspector panel: an icon tile, a label, an
 *  optional sub line, wired to an existing editor handler. Disabled actions
 *  render greyed and do nothing (used so read-only surfaces can hide edit ops
 *  by simply omitting them, never by disabling). */
export interface OperationAction {
  id: string;
  label: string;
  /** Optional one-line description under the label. */
  sub?: string;
  /** A short glyph (1 to 2 chars) OR an inline-SVG node for the action tile. */
  glyph?: ReactNode;
  /** Tailwind classes for the tile background / color, e.g. the calm tints from
   *  the mockup. Defaults to a neutral slate tile. */
  tileClass?: string;
  onRun: () => void;
}

/** One operation on the rail. `panel` is rendered in the inspector body when the
 *  operation is active. `groupLabel` (when set) prints a tiny uppercase group
 *  heading above this item; a `divider` flag draws a thin rule before it. */
export interface RailOperation {
  id: string;
  /** The tiny rail label + the tooltip text. */
  label: string;
  /** The inspector header title (defaults to `label`). */
  title?: string;
  /** The inspector header sub line. */
  sub?: string;
  /** Inline-SVG icon (no emoji, no lucide). */
  icon: ReactNode;
  /** Tiny uppercase group heading printed above this item on the rail. */
  groupLabel?: string;
  /** Draw a thin divider rule above this item. */
  divider?: boolean;
  /** A small glance badge. "dot" draws an amber dot (e.g. organism attached);
   *  a number draws a count pill. Absent = no badge. */
  badge?: number | "dot";
  /** The inspector body for this operation. */
  panel: ReactNode;
}

/** A tiny uppercase section heading inside an inspector panel. */
export function InspectorSection({ children }: { children: ReactNode }) {
  return (
    <h5 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-400 dark:text-foreground-muted">
      {children}
    </h5>
  );
}

/** A calm dashed cue used when an action depends on state the user has not set
 *  yet (e.g. select a CDS first). Pure teaching copy, no action. */
export function InspectorCue({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-3 text-center text-meta text-foreground-muted">
      {children}
    </div>
  );
}

/** The CONTEXT BAR that sits between the inspector header and its body (sequences
 *  redesign phase 3). It names what the operation will act on. A FILLED marker +
 *  amber tint when something is selected (acting on a selection); a HOLLOW marker
 *  + calm tint otherwise (whole-sequence scope). Markers are inline SVG, never
 *  emoji. */
export function InspectorContextBar({
  selected,
  text,
}: {
  selected: boolean;
  text: string;
}) {
  return (
    <div
      data-testid="inspector-context-bar"
      className={`flex items-center gap-2 border-b px-3.5 py-2 text-meta font-semibold ${
        selected
          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "border-border bg-surface-sunken text-foreground-muted"
      }`}
    >
      {selected ? (
        // Filled marker, a small solid disc.
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 flex-none" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
      ) : (
        // Hollow marker, a small empty square.
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5 flex-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
        </svg>
      )}
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

/** A vertical list of launcher actions for an inspector panel. */
export function ActionList({ actions }: { actions: OperationAction[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={a.onRun}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-body font-semibold text-foreground transition-colors hover:border-border hover:bg-surface-sunken"
        >
          {a.glyph != null ? (
            <span
              className={`flex h-6 w-6 flex-none items-center justify-center rounded-md text-[12px] ${
                a.tileClass ?? "bg-surface-sunken text-foreground-muted"
              }`}
            >
              {a.glyph}
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="block truncate">{a.label}</span>
            {a.sub ? (
              <span className="block truncate text-meta font-normal text-foreground-muted">
                {a.sub}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function Badge({ badge }: { badge: number | "dot" }) {
  if (badge === "dot") {
    return (
      <span
        className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-amber-500"
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[8px] font-extrabold text-white">
      {badge}
    </span>
  );
}

export function SequenceOperationsRail({
  operations,
  activeId,
  onPick,
  contextBar,
}: {
  operations: RailOperation[];
  /** The open operation, or null when the inspector is collapsed. */
  activeId: string | null;
  /** Toggle an operation. Picking the active one collapses the inspector. */
  onPick: (id: string) => void;
  /** The contextual bar shown between the header and the body when an op is
   *  open (sequences redesign phase 3). Absent = no bar (e.g. nothing to say). */
  contextBar?: { selected: boolean; text: string } | null;
}) {
  const active = operations.find((op) => op.id === activeId) ?? null;

  return (
    <div className="flex min-h-0" data-testid="sequence-operations">
      {/* INSPECTOR, docked to the LEFT of the rail, only when an op is open. */}
      {active ? (
        <div
          className="flex w-[348px] min-w-0 flex-col border-l border-border bg-surface"
          data-testid="sequence-inspector"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              {active.icon}
            </span>
            <div className="min-w-0">
              <h4 className="text-body font-semibold text-foreground">
                {active.title ?? active.label}
              </h4>
              {active.sub ? (
                <div className="text-meta text-foreground-muted">{active.sub}</div>
              ) : null}
            </div>
            <Tooltip label="Collapse the inspector">
              <button
                type="button"
                onClick={() => onPick(active.id)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                aria-label="Collapse the inspector"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </Tooltip>
          </div>
          {contextBar ? (
            <InspectorContextBar
              selected={contextBar.selected}
              text={contextBar.text}
            />
          ) : null}
          {/* pb clears the global BeakerSearch bottom-center ask bar (AppShell's
              BeakerSearchBottomBar, fixed bottom-5 ≈ 64px tall). Without it the
              last inspector control (e.g. Shape → Tree's "Rotate this clade")
              scrolls under the floating bar at short viewport heights and a
              click lands on the bar instead of the button. */}
          <div className="min-h-0 flex-1 overflow-auto px-3.5 pt-3.5 pb-24">{active.panel}</div>
        </div>
      ) : null}

      {/* RAIL, the always-visible icon strip. */}
      <div className="flex w-[60px] flex-none flex-col items-center gap-0.5 overflow-auto border-l border-border bg-surface py-1.5">
        {operations.map((op) => (
          <RailGroupAndButton
            key={op.id}
            op={op}
            active={op.id === activeId}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function RailGroupAndButton({
  op,
  active,
  onPick,
}: {
  op: RailOperation;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <>
      {op.divider ? <div className="my-1 h-px w-7 bg-border" /> : null}
      {op.groupLabel ? (
        <div className="mb-0.5 mt-1.5 text-[8px] font-extrabold uppercase tracking-wide text-foreground-muted">
          {op.groupLabel}
        </div>
      ) : null}
      <Tooltip label={op.label} placement="left">
        <button
          type="button"
          onClick={() => onPick(op.id)}
          aria-pressed={active}
          data-op={op.id}
          className={`relative flex h-[46px] w-12 flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors ${
            active
              ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
              : "border-transparent text-foreground-muted hover:bg-surface-sunken"
          }`}
        >
          {op.badge != null ? <Badge badge={op.badge} /> : null}
          {op.icon}
          <span className="text-[8px] font-semibold">{op.label}</span>
        </button>
      </Tooltip>
    </>
  );
}

export default SequenceOperationsRail;

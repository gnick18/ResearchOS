"use client";

// Collision-aware layout advisor — the GUI front door (phase 4).
//
// Detects overlapping elements in the OPEN figure (via the renderer's layout
// manifest + the pure engine), then offers fixes two ways, per Grant's spec:
//   - a one-click AUTO-FIX (magic-wand): applies the combined reversible fixes
//     and flips to "Undo" so a second click restores the prior settings;
//   - a REVIEW menu: each fix with a live preview thumbnail + its own Apply.
// Quiet + dismissable, silenced per-plot ("don't show again on this plot",
// persisted in localStorage keyed by the tree id). No soft-lock.
//
// The engine measures + names; this component only maps a fix to the existing
// figure toggles (column gap, label tilt/font, legend placement, drop overlay)
// and renders previews from the modified spec. See
// docs/proposals/2026-06-15-collision-aware-layout-advisor.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";

import {
  renderTreeSvg,
  renderTreeWithManifest,
  type RenderSpec,
} from "@/lib/phylo/render";
import {
  detectCollisions,
  suggestFixes,
  type Collision,
  type FixSuggestion,
  type FixId,
} from "@/lib/phylo/layout-collision";
import type { TreeNode } from "@/lib/phylo/parse";

/** The layout settings the advisor can change, applied by the host. */
export interface AdvisorDelta {
  columnGap?: number;
  legendPlacement?: "right" | "bottom";
  labelsTilt?: number;
  labelsFontSize?: number;
  dropPanelIds?: string[];
}

/** The host's CURRENT values, so a fix is relative and the wand can snapshot. */
export interface AdvisorState {
  columnGap: number;
  legendPlacement: "right" | "bottom";
  labelsTilt: number;
  labelsFontSize: number;
}

/** Apply a delta to a spec clone (for the preview render only). */
function applyDeltaToSpec(spec: RenderSpec, d: AdvisorDelta): RenderSpec {
  let panels = spec.panels;
  if (
    panels &&
    (d.labelsTilt !== undefined ||
      d.labelsFontSize !== undefined ||
      d.dropPanelIds?.length)
  ) {
    panels = panels.map((p) =>
      p.kind === "labels"
        ? {
            ...p,
            options: {
              ...p.options,
              ...(d.labelsTilt !== undefined ? { tilt: d.labelsTilt } : {}),
              ...(d.labelsFontSize !== undefined
                ? { fontSize: d.labelsFontSize }
                : {}),
            },
          }
        : p,
    );
    if (d.dropPanelIds?.length)
      panels = panels.filter((p) => !d.dropPanelIds!.includes(p.id));
  }
  return {
    ...spec,
    columnGap: d.columnGap ?? spec.columnGap,
    legendPlacement: d.legendPlacement ?? spec.legendPlacement,
    panels,
  };
}

/** The concrete setting change a fix maps to, given the current state. */
function deltaForFix(
  id: FixId,
  collisions: Collision[],
  st: AdvisorState,
): AdvisorDelta {
  switch (id) {
    case "increase-column-gap":
      return { columnGap: st.columnGap < 16 ? 16 : st.columnGap + 8 };
    case "tilt-tip-labels":
      return { labelsTilt: -45 };
    case "shrink-label-font":
      return { labelsFontSize: Math.max(7, st.labelsFontSize - 2) };
    case "relocate-legend":
      return { legendPlacement: "bottom" };
    case "drop-duplicate-overlay": {
      const drops: string[] = [];
      for (const c of collisions)
        if (c.kind === "duplicate-overlay") drops.push(...c.boxIds.slice(1));
      return { dropPanelIds: drops };
    }
    default:
      return {};
  }
}

function mergeDeltas(a: AdvisorDelta, b: AdvisorDelta): AdvisorDelta {
  return {
    columnGap: b.columnGap ?? a.columnGap,
    legendPlacement: b.legendPlacement ?? a.legendPlacement,
    labelsTilt: b.labelsTilt ?? a.labelsTilt,
    labelsFontSize: b.labelsFontSize ?? a.labelsFontSize,
    dropPanelIds: [...(a.dropPanelIds ?? []), ...(b.dropPanelIds ?? [])],
  };
}

const silKey = (plotId: string) => `ros:phylo:advisor-silenced:${plotId}`;

/** Detect layout collisions on the open figure and keep only the fixes that apply
 *  to a phylo tree (canvas height has no Studio control here; tilting does NOT
 *  de-collide a vertical tip-label stack -- it only helps a horizontal axis-label
 *  row, e.g. Data Hub). Runs on the fixed figure spec and is artboard- and
 *  zoom-independent: the artboard / zoom only UNIFORMLY scale the same figure SVG
 *  (viewBox), and uniform scaling preserves overlaps, so the verdict on the fixed
 *  spec matches the rendered figure at any size. Shared by the advisor card and the
 *  Shape-tab issue badge so the two never drift. */
export function phyloLayoutIssues(
  tree: TreeNode,
  spec: RenderSpec,
): { collisions: Collision[]; fixes: FixSuggestion[] } {
  let collisions: Collision[] = [];
  try {
    collisions = detectCollisions(renderTreeWithManifest(tree, spec).manifest);
  } catch {
    collisions = [];
  }
  const fixes = suggestFixes(collisions).filter(
    (f) =>
      f.available &&
      f.id !== "increase-canvas-height" &&
      f.id !== "tilt-tip-labels",
  );
  return { collisions, fixes };
}

/** Read the per-plot "don't show again" silence flag (shared by the advisor card
 *  and the Shape-tab badge). An unsaved tree (null id) is never silenced. */
export function readAdvisorSilenced(plotId: string | null): boolean {
  if (!plotId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(silKey(plotId)) === "1";
  } catch {
    return false;
  }
}

/** Persist the per-plot silence flag (best-effort). */
export function writeAdvisorSilenced(plotId: string | null): void {
  if (!plotId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(silKey(plotId), "1");
  } catch {
    // best-effort; the runtime dismissal still hides it this session.
  }
}

export interface PhyloLayoutAdvisorProps {
  tree: TreeNode;
  /** The live render spec for the open figure (preview base). */
  spec: RenderSpec;
  state: AdvisorState;
  /** Apply a delta to the host's figure state. */
  onApply: (delta: AdvisorDelta) => void;
  /** Detection results, computed once by the host (so the Shape-tab badge and this
   *  card agree). See `phyloLayoutIssues`. */
  collisions: Collision[];
  fixes: FixSuggestion[];
  /** Host-owned per-plot silence state (so the tab badge matches the card). */
  silenced: boolean;
  onSilence: () => void;
}

export function PhyloLayoutAdvisor({
  tree,
  spec,
  state,
  onApply,
  collisions,
  fixes,
  silenced,
  onSilence,
}: PhyloLayoutAdvisorProps) {
  // The wand applies only the REVERSIBLE fixes; dropping an overlay is
  // destructive, so it stays a deliberate menu action (keeps "undo" honest).
  const wandFixes = fixes.filter((f) => f.id !== "drop-duplicate-overlay");

  const [snapshot, setSnapshot] = useState<AdvisorState | null>(null);
  const [open, setOpen] = useState(false);

  if (silenced || collisions.length === 0 || fixes.length === 0) return null;

  const silence = onSilence;

  const wand = () => {
    if (snapshot) {
      // Revert to the pre-wand settings.
      onApply({
        columnGap: snapshot.columnGap,
        legendPlacement: snapshot.legendPlacement,
        labelsTilt: snapshot.labelsTilt,
        labelsFontSize: snapshot.labelsFontSize,
      });
      setSnapshot(null);
      return;
    }
    setSnapshot({ ...state });
    const merged = wandFixes
      .map((f) => deltaForFix(f.id, collisions, state))
      .reduce(mergeDeltas, {});
    onApply(merged);
  };

  const summary = collisions
    .map((c) => c.message)
    .slice(0, 2)
    .join(" ");

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold">
            {collisions.length} layout issue
            {collisions.length === 1 ? "" : "s"} in this figure
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-amber-800">
            {summary}
          </div>
        </div>
        <button
          type="button"
          onClick={silence}
          title="Don't show again on this plot"
          className="shrink-0 rounded px-1.5 text-amber-500 hover:text-amber-700"
          aria-label="Dismiss for this plot"
        >
          &times;
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={wand}
          className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-amber-600"
        >
          {snapshot ? "Undo auto-fix" : "Auto-fix layout"}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100"
        >
          {open ? "Hide fixes" : `Review ${fixes.length} fixes`}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {fixes.map((f) => {
            const delta = deltaForFix(f.id, collisions, state);
            const previewSvg = (() => {
              try {
                return renderTreeSvg(tree, applyDeltaToSpec(spec, delta));
              } catch {
                return "";
              }
            })();
            return (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white p-1.5"
              >
                <div
                  className="h-12 w-16 shrink-0 overflow-hidden rounded border border-border bg-white [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-foreground">
                    {f.title}
                  </div>
                  <div className="text-[10.5px] leading-snug text-foreground-muted">
                    {f.rationale}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onApply(delta)}
                  className="shrink-0 rounded-md border border-accent px-2 py-1 text-[11px] font-bold text-accent transition-colors hover:bg-accent-soft"
                >
                  Apply
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

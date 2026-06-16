"use client";

// Collision-aware layout advisor — the Data Hub GUI front door (Phase 5 part 2b).
//
// The same engine + UX as the phylo Tree Studio advisor (PhyloLayoutAdvisor),
// pointed at a Data Hub plot. It detects overlapping elements in the OPEN plot via
// the shared FigureSource manifest (plotLayoutManifest + the pure detector), then
// offers fixes two ways per Grant's spec:
//   - a one-click AUTO-FIX (magic-wand): applies the combined reversible fixes and
//     flips to "Undo" so a second click restores the prior style;
//   - a REVIEW menu: each fix with a live preview thumbnail + its own Apply.
// Quiet + dismissable, silenced per-plot ("don't show again on this plot",
// localStorage keyed by the plot id). No soft-lock.
//
// The engine measures + names; this maps a fix to the EXISTING plot-style levers
// (legend placement, axis font) and renders previews from the modified style. Only
// fixes that have a Data Hub lever are offered. See
// docs/proposals/2026-06-15-collision-aware-layout-advisor.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useState } from "react";

import {
  renderPlot,
  withStyle,
  readPlotStyle,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import { plotLayoutManifest } from "@/lib/datahub/plot-manifest";
import type {
  DataHubDocContent,
  AnalysisSpec,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  detectCollisions,
  suggestFixes,
  type Collision,
  type FixId,
} from "@/lib/figure/layout-collision";

/** The plot-style levers the advisor can move on a Data Hub plot. */
const DATAHUB_FIXES: ReadonlySet<FixId> = new Set<FixId>([
  "relocate-legend",
  "shrink-label-font",
  "tilt-tip-labels",
]);

/** The concrete style patch a fix maps to, given the live style. */
function patchForFix(id: FixId, style: PlotStyle): Partial<PlotStyle> {
  switch (id) {
    case "relocate-legend":
      // Reserve a gutter so the legend sits clear of the bars (the 2b-1 lever).
      return { legendPlacement: "right" };
    case "shrink-label-font":
      return { fontSize: Math.max(8, style.fontSize - 1) };
    case "tilt-tip-labels":
      // Angle the x-axis category labels so crowded level names stop colliding.
      return { xLabelMode: "angled" };
    default:
      return {};
  }
}

function mergePatches(a: Partial<PlotStyle>, b: Partial<PlotStyle>): Partial<PlotStyle> {
  return { ...a, ...b };
}

const silKey = (plotId: string) => `ros:datahub:advisor-silenced:${plotId}`;

export interface PlotLayoutAdvisorProps {
  /** The live plot spec for the open figure (detection + preview base). */
  spec: PlotSpec;
  content: DataHubDocContent;
  analysis: AnalysisSpec | null;
  /** Apply a style patch to the host's plot (same path the editor controls use). */
  onStyleChange: (patch: Partial<PlotStyle>) => void;
  /** The saved plot id, or null for an unsaved plot (no cross-reload silence). */
  plotId: string | null;
}

export function PlotLayoutAdvisor({
  spec,
  content,
  analysis,
  onStyleChange,
  plotId,
}: PlotLayoutAdvisorProps) {
  const style = useMemo(() => readPlotStyle(spec), [spec]);

  const collisions = useMemo(() => {
    try {
      const { geometry, style: s } = renderPlot(spec, content, analysis);
      return detectCollisions(plotLayoutManifest(geometry, s));
    } catch {
      return [];
    }
  }, [spec, content, analysis]);

  // Only offer fixes that have a Data Hub lever (others belong to other surfaces).
  const fixes = useMemo(
    () => suggestFixes(collisions).filter((f) => f.available && DATAHUB_FIXES.has(f.id)),
    [collisions],
  );

  const [silenced, setSilenced] = useState(() => {
    if (!plotId || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(silKey(plotId)) === "1";
    } catch {
      return false;
    }
  });
  const [snapshot, setSnapshot] = useState<Partial<PlotStyle> | null>(null);
  const [open, setOpen] = useState(false);

  if (silenced || collisions.length === 0 || fixes.length === 0) return null;

  const silence = () => {
    setSilenced(true);
    if (plotId && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(silKey(plotId), "1");
      } catch {
        // best-effort; the runtime dismissal still hides it this session.
      }
    }
  };

  const wand = () => {
    if (snapshot) {
      // Revert to the pre-wand style.
      onStyleChange(snapshot);
      setSnapshot(null);
      return;
    }
    // Snapshot ONLY the fields the wand touches, so undo restores exactly them.
    setSnapshot({
      legendPlacement: style.legendPlacement,
      fontSize: style.fontSize,
      xLabelMode: style.xLabelMode,
    });
    const merged = fixes
      .map((f) => patchForFix(f.id, style))
      .reduce(mergePatches, {});
    onStyleChange(merged);
  };

  const summary = collisions
    .map((c) => c.message)
    .slice(0, 2)
    .join(" ");

  return (
    <div className="mx-4 mt-2 shrink-0 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold">
            {collisions.length} layout issue
            {collisions.length === 1 ? "" : "s"} in this plot
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
          {open ? "Hide fixes" : `Review ${fixes.length} fix${fixes.length === 1 ? "" : "es"}`}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {fixes.map((f) => {
            const patch = patchForFix(f.id, style);
            const previewSvg = (() => {
              try {
                return renderPlot(withStyle(spec, patch), content, analysis).svg;
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
                  onClick={() => onStyleChange(patch)}
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

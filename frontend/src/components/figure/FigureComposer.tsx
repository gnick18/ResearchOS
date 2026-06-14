"use client";

// The Figure page composer surface. Arranges figures from any registered
// FigureSource onto one real publication page: drag to place, snap to a grid,
// auto labels (A/B/C), export one exact SVG. v1 covers panels + the add-figure
// picker + the inspector + snap-grid/undo + export; the annotation-placement UI
// is a fast follow (the model + compositor already support annotations).
//
// House style: <Icon> only, Tooltip on icon-only buttons, no emojis / em-dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  type FigurePage,
  type LabelStyle,
  pageSizeIn,
  assignLabels,
  addPanel,
  removePanel,
  snapToGrid,
} from "@/lib/figure/figure-page";
import {
  getFigureSource,
  listFigureSources,
  type FigureRef,
} from "@/lib/figure/figure-source";
import {
  readFigurePage,
  saveFigurePage,
} from "@/lib/figure/figure-page-store";
import { composeFigurePageSvg } from "@/lib/figure/figure-compose";
import { registerFigureSources } from "@/lib/figure/register-sources";
import { PAPER_PRESETS } from "@/lib/figure/artboard";

const SCREEN_DPI = 96;

/** A signature of what affects a panel's RENDER (ref + size, not position). */
function renderSignature(page: FigurePage): string {
  return page.panels
    .map((p) => `${p.panelId}:${p.ref.type}:${p.ref.id}:${p.wIn.toFixed(3)}x${p.hIn.toFixed(3)}`)
    .join("|");
}

export default function FigureComposer({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<FigurePage | null>(null);
  const [panelSvgs, setPanelSvgs] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<FigurePage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerFigureSources();
    let live = true;
    void readFigurePage(pageId).then((p) => {
      if (live) setPage(p);
    });
    return () => {
      live = false;
    };
  }, [pageId]);

  // Resolve each panel's SVG when a ref or size changes (not on a move).
  const sig = page ? renderSignature(page) : "";
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const p of page.panels) {
        const src = getFigureSource(p.ref.type);
        if (!src) continue;
        try {
          const r = await src.render(p.ref.id, {
            widthIn: p.wIn,
            heightIn: p.hIn,
            dpi: SCREEN_DPI,
            theme: "light",
          });
          next.set(p.panelId, r.svg);
        } catch {
          // leave it unrendered; the compositor draws the missing placeholder
        }
      }
      if (!cancelled) setPanelSvgs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const mutate = useCallback(
    (fn: (p: FigurePage) => FigurePage, recordUndo = false) => {
      setPage((prev) => {
        if (!prev) return prev;
        if (recordUndo) setUndo((u) => [...u.slice(-19), prev]);
        const nextPage = fn(prev);
        void saveFigurePage(nextPage);
        return nextPage;
      });
    },
    [],
  );

  const doUndo = useCallback(() => {
    setUndo((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      void saveFigurePage(prev);
      setPage(prev);
      return u.slice(0, -1);
    });
  }, []);

  // Pixel scale: fit the page into a ~560px tall stage.
  const scale = useMemo(() => {
    if (!page) return SCREEN_DPI;
    const { hIn } = pageSizeIn(page);
    return Math.min(SCREEN_DPI, 560 / hIn);
  }, [page]);

  // Drag / resize a panel.
  const drag = useRef<
    | null
    | { id: string; resize: boolean; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  const onPanelDown = (e: React.MouseEvent, id: string, resize: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    const p = page?.panels.find((x) => x.panelId === id);
    if (!p) return;
    drag.current = { id, resize, sx: e.clientX, sy: e.clientY, ox: p.xIn, oy: p.yIn, ow: p.wIn, oh: p.hIn };
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dxIn = (e.clientX - d.sx) / scale;
      const dyIn = (e.clientY - d.sy) / scale;
      mutate((prev) => ({
        ...prev,
        panels: prev.panels.map((p) =>
          p.panelId !== d.id
            ? p
            : d.resize
              ? { ...p, wIn: Math.max(0.6, d.ow + dxIn), hIn: Math.max(0.5, d.oh + dyIn) }
              : { ...p, xIn: Math.max(0, d.ox + dxIn), yIn: Math.max(0, d.oy + dyIn) },
        ),
      }));
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [scale, mutate]);

  const exportSvg = useCallback(() => {
    if (!page) return;
    const svg = composeFigurePageSvg(page, { pxPerInch: 300, panelSvgs });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.name || "figure"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [page, panelSvgs]);

  if (!page) {
    return <div className="p-8 text-body text-foreground-muted">Loading figure page...</div>;
  }

  const { wIn, hIn } = pageSizeIn(page);
  const labels = assignLabels(page);
  const pageW = wIn * scale;
  const pageH = hIn * scale;

  return (
    <div className="flex h-full gap-4 p-4" data-testid="figure-composer">
      <div
        className="flex flex-1 items-start justify-center overflow-auto rounded-2xl border border-border bg-surface-sunken p-8"
        onMouseDown={() => setSelected(null)}
      >
        <div
          ref={stageRef}
          className="relative bg-white shadow-lg"
          style={{ width: pageW, height: pageH }}
        >
          {page.panels.map((p) => {
            const sel = selected === p.panelId;
            const lab = labels.get(p.panelId);
            return (
              <div
                key={p.panelId}
                className={`absolute ${sel ? "outline outline-2 outline-brand-action" : "outline outline-1 outline-transparent hover:outline-border-strong"}`}
                style={{
                  left: p.xIn * scale,
                  top: p.yIn * scale,
                  width: p.wIn * scale,
                  height: p.hIn * scale,
                  cursor: "grab",
                }}
                onMouseDown={(e) => onPanelDown(e, p.panelId, false)}
                data-testid="figure-panel"
              >
                <div
                  className="pointer-events-none h-full w-full"
                  dangerouslySetInnerHTML={{
                    __html: panelSvgs.get(p.panelId) ?? "",
                  }}
                />
                {lab && (
                  <span
                    className="absolute left-1 top-0.5 rounded bg-white/70 px-1 font-bold text-foreground"
                    style={{ fontSize: Math.max(10, 0.16 * scale) }}
                  >
                    {lab}
                  </span>
                )}
                {sel && (
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border-2 border-brand-action bg-white"
                    style={{ cursor: "nwse-resize" }}
                    onMouseDown={(e) => onPanelDown(e, p.panelId, true)}
                  />
                )}
              </div>
            );
          })}
          {page.panels.length === 0 && (
            <div className="flex h-full items-center justify-center text-meta text-foreground-faint">
              Add a figure to start the page.
            </div>
          )}
        </div>
      </div>

      <div className="w-72 shrink-0 space-y-4 overflow-auto">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            data-testid="figure-add"
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add figure
          </button>
          <Tooltip label="Arrange every panel into a clean grid (undoable).">
            <button
              type="button"
              onClick={() => mutate((p) => snapToGrid(p, "align"), true)}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            >
              Snap to grid
            </button>
          </Tooltip>
          <Tooltip label="Undo the last layout change.">
            <button
              type="button"
              onClick={doUndo}
              disabled={undo.length === 0}
              className="rounded-lg border border-border-strong px-2.5 py-1.5 text-meta font-semibold hover:border-brand-action disabled:opacity-40"
            >
              <Icon name="undo" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">Page</h3>
          <label className="mb-2 flex items-center justify-between text-body">
            <span className="text-foreground-muted">Paper</span>
            <select
              value={page.paper.paperId}
              onChange={(e) => mutate((p) => ({ ...p, paper: { ...p.paper, paperId: e.target.value } }))}
              className="rounded-md border border-border bg-surface px-2 py-1 text-meta"
            >
              {PAPER_PRESETS.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {pp.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between text-body">
            <span className="text-foreground-muted">Labels</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
              {(["ABC", "abc", "123", "none"] as LabelStyle[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => mutate((p) => ({ ...p, labelStyle: s }))}
                  className={`px-2 py-1 text-meta ${page.labelStyle === s ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                >
                  {s === "none" ? "None" : s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {selected && (
          <div className="rounded-xl border border-border p-3">
            <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">Selected panel</h3>
            <button
              type="button"
              onClick={() => {
                mutate((p) => removePanel(p, selected), true);
                setSelected(null);
              }}
              className="text-meta font-medium text-pin hover:underline"
            >
              Remove from page
            </button>
          </div>
        )}

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">Export</h3>
          <button
            type="button"
            onClick={exportSvg}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            data-testid="figure-export"
          >
            <Icon name="download" className="h-3.5 w-3.5" /> Export page SVG
          </button>
          <p className="mt-2 text-meta text-foreground-faint">
            {page.panels.length} panel{page.panels.length === 1 ? "" : "s"} at {wIn} x {hIn} in, one vector SVG.
          </p>
        </div>
      </div>

      {pickerOpen && (
        <AddFigurePicker
          collectionId={page.collectionId}
          onClose={() => setPickerOpen(false)}
          onPick={(ref) => {
            const panelId = `p${page.id}-${Date.now().toString(36)}`;
            mutate((p) => addPanel(p, { type: ref.type, id: ref.id }, panelId), true);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddFigurePicker({
  collectionId,
  onClose,
  onPick,
}: {
  collectionId: string | null;
  onClose: () => void;
  onPick: (ref: FigureRef) => void;
}) {
  const [groups, setGroups] = useState<{ label: string; refs: FigureRef[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: { label: string; refs: FigureRef[] }[] = [];
      for (const src of listFigureSources()) {
        const refs = await src.list({ collectionId });
        if (refs.length > 0) out.push({ label: src.label, refs });
      }
      if (live) {
        setGroups(out);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [collectionId]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[80vh] w-[440px] overflow-auto rounded-2xl border border-border bg-surface-raised p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-body font-bold">Add a figure</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {loading && <p className="text-body text-foreground-muted">Loading figures...</p>}
        {!loading && groups.length === 0 && (
          <p className="text-body text-foreground-muted">
            No saved figures in this collection yet. Make a graph in the Data Hub first.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-faint">{g.label}</p>
            <div className="space-y-1">
              {g.refs.map((r) => (
                <button
                  key={`${r.type}:${r.id}`}
                  type="button"
                  onClick={() => onPick(r)}
                  className="block w-full rounded-lg border border-border px-3 py-2 text-left text-body hover:border-brand-action"
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

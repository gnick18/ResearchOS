"use client";

// The Figure page composer surface. Arranges figures from any registered
// FigureSource onto one real publication page: drag to place, snap to a grid,
// auto labels (A/B/C), export one exact SVG. v1 covers panels + the add-figure
// picker + the inspector + snap-grid/undo + export; the annotation-placement UI
// is a fast follow (the model + compositor already support annotations).
//
// House style: <Icon> only, Tooltip on icon-only buttons, no emojis / em-dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  type FigurePage,
  type LabelStyle,
  type Annotation,
  pageSizeIn,
  assignLabels,
  addPanel,
  removePanel,
  snapToGrid,
  fitPanelsToPage,
  addAnnotation,
  removeAnnotation,
  updateAnnotation,
  moveAnnotation,
  makeTextAnnotation,
  makeArrowAnnotation,
  makeBracketAnnotation,
  setPanelStyle,
  setPanelTarget,
} from "@/lib/figure/figure-page";
import {
  getFigureSource,
  listFigureSources,
  type FigureRef,
  type StyleTarget,
} from "@/lib/figure/figure-source";
import { buildPickerView, type GroupBy } from "@/lib/figure/picker-view";
import {
  readFigurePage,
  saveFigurePage,
  createFigurePageDoc,
} from "@/lib/figure/figure-page-store";
import {
  composeFigurePageSvg,
  annotationLayerSvg,
} from "@/lib/figure/figure-compose";
import { registerFigureSources } from "@/lib/figure/register-sources";
import { PAPER_PRESETS } from "@/lib/figure/artboard";

const SCREEN_DPI = 96;

/** A signature of what affects a panel's RENDER (ref + size + title, not position). */
function renderSignature(page: FigurePage): string {
  return page.panels
    .map(
      (p) =>
        `${p.panelId}:${p.ref.type}:${p.ref.id}:${p.wIn.toFixed(3)}x${p.hIn.toFixed(3)}:${p.overrides?.hideTitle ?? true}:${JSON.stringify(p.style ?? {})}`,
    )
    .join("|");
}

export default function FigureComposer({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<FigurePage | null>(null);
  const [panelSvgs, setPanelSvgs] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<FigurePage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");
  const [tool, setTool] = useState<null | "text" | "arrow" | "bracket">(null);
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [styleTargets, setStyleTargets] = useState<StyleTarget[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const annDrag = useRef<null | { id: string; sx: number; sy: number }>(null);
  const router = useRouter();

  useEffect(() => {
    registerFigureSources();
    let live = true;
    setLoadState("loading");
    readFigurePage(pageId)
      .then((p) => {
        if (!live) return;
        // A page can be absent if the link is stale or its data was cleared (e.g.
        // a demo re-seed). Show a recoverable not-found state, never spin forever.
        if (p) {
          setPage(p);
          setLoadState("ready");
        } else {
          setLoadState("missing");
        }
      })
      .catch(() => {
        if (live) setLoadState("missing");
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
            // Composed panels hide the plot's own title by default (per-panel toggle).
            overrides: { hideTitle: p.overrides?.hideTitle ?? true, hideLegend: p.overrides?.hideLegend },
            style: p.style,
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

  // Load the selected panel's styleable elements (features, ...) for the style inspector.
  const selectedRef = selected
    ? page?.panels.find((p) => p.panelId === selected)?.ref
    : undefined;
  useEffect(() => {
    if (!selectedRef) {
      setStyleTargets([]);
      return;
    }
    const src = getFigureSource(selectedRef.type);
    if (!src?.styleTargets) {
      setStyleTargets([]);
      return;
    }
    let live = true;
    void src.styleTargets(selectedRef.id).then((t) => {
      if (live) setStyleTargets(t);
    });
    return () => {
      live = false;
    };
  }, [selectedRef?.type, selectedRef?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Drag a selected annotation (translates all of its anchor points).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = annDrag.current;
      if (!d) return;
      const dxIn = (e.clientX - d.sx) / scale;
      const dyIn = (e.clientY - d.sy) / scale;
      if (dxIn === 0 && dyIn === 0) return;
      annDrag.current = { ...d, sx: e.clientX, sy: e.clientY };
      mutate((prev) => moveAnnotation(prev, d.id, dxIn, dyIn));
    };
    const up = () => {
      annDrag.current = null;
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

  if (loadState === "missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Icon name="alert" className="h-7 w-7 text-foreground-faint" />
        <div>
          <p className="text-body font-semibold text-foreground">This figure page could not be found.</p>
          <p className="mt-1 text-meta text-foreground-muted">
            It may have been deleted, or the link is out of date.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Link
            href="/figures"
            className="rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white"
          >
            Back to figures
          </Link>
          <button
            type="button"
            onClick={async () => {
              const created = await createFigurePageDoc("Untitled figure", null);
              router.push(`/figures/${created.id}`);
            }}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
          >
            New figure page
          </button>
        </div>
      </div>
    );
  }

  if (loadState === "loading" || !page) {
    return <div className="p-8 text-body text-foreground-muted">Loading figure page...</div>;
  }

  const { wIn, hIn } = pageSizeIn(page);
  const labels = assignLabels(page);
  const pageW = wIn * scale;
  const pageH = hIn * scale;

  const placeAnnotation = (xIn: number, yIn: number) => {
    if (!tool) return;
    const annId = `a${page.id}-${Date.now().toString(36)}`;
    const make =
      tool === "text"
        ? makeTextAnnotation
        : tool === "arrow"
          ? makeArrowAnnotation
          : makeBracketAnnotation;
    mutate((p) => addAnnotation(p, make(annId, xIn, yIn)), true);
    setSelected(null);
    setSelectedAnn(annId);
    setTool(null);
  };

  const onAnnDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(null);
    setSelectedAnn(id);
    annDrag.current = { id, sx: e.clientX, sy: e.clientY };
  };

  const selectedAnnotation = selectedAnn
    ? page.annotations.find((a) => a.annId === selectedAnn) ?? null
    : null;

  return (
    <div className="flex h-full gap-4 p-4" data-testid="figure-composer">
      <div
        className="flex flex-1 items-start justify-center overflow-auto rounded-2xl border border-border bg-surface-sunken p-8"
        onMouseDown={() => {
          setSelected(null);
          setSelectedAnn(null);
        }}
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
                className={`absolute overflow-hidden ${sel ? "outline outline-2 outline-brand-action" : "outline outline-1 outline-transparent hover:outline-border-strong"}`}
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
                  className="pointer-events-none h-full w-full [&>svg]:h-full [&>svg]:w-full"
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

          {/* Annotation layer, painted above the panels (one injected SVG string,
              so the component carries no inline SVG of its own). Click-through. */}
          <div
            className="pointer-events-none absolute inset-0"
            dangerouslySetInnerHTML={{ __html: annotationLayerSvg(page, scale) }}
          />

          {/* Interaction targets for select + drag (only when not placing). */}
          {!tool &&
            page.annotations.map((a) => {
              const b = annBox(a, scale);
              const sel = selectedAnn === a.annId;
              return (
                <div
                  key={a.annId}
                  onMouseDown={(e) => onAnnDown(e, a.annId)}
                  className="absolute"
                  style={{
                    left: b.x - 4,
                    top: b.y - 4,
                    width: b.w + 8,
                    height: b.h + 8,
                    cursor: "move",
                    borderRadius: 3,
                    border: sel ? "1px dashed #2563eb" : "1px solid transparent",
                  }}
                />
              );
            })}

          {/* Placement capture overlay (only while a tool is active). */}
          {tool && (
            <div
              className="absolute inset-0 z-10"
              style={{ cursor: "crosshair" }}
              onMouseDown={(e) => {
                e.stopPropagation();
                const rect = stageRef.current?.getBoundingClientRect();
                if (!rect) return;
                placeAnnotation((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
              }}
            />
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
              onChange={(e) =>
                mutate(
                  (p) => fitPanelsToPage({ ...p, paper: { ...p.paper, paperId: e.target.value } }),
                  true,
                )
              }
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

        <div className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-faint">
            Annotate
          </h3>
          <div className="flex gap-2">
            {(
              [
                ["text", "Text"],
                ["arrow", "Arrow"],
                ["bracket", "Bracket"],
              ] as const
            ).map(([t, lbl]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTool(tool === t ? null : t)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-meta font-medium ${tool === t ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {tool && (
            <p className="mt-2 text-meta text-foreground-faint">
              Click the page to place the {tool}.
            </p>
          )}
        </div>

        {selected &&
          (() => {
            const sp = page.panels.find((x) => x.panelId === selected);
            const titleShown = sp?.overrides?.hideTitle === false;
            return (
              <div className="space-y-2.5 rounded-xl border border-border p-3">
                <h3 className="text-meta font-bold uppercase tracking-wide text-foreground-faint">
                  Selected panel
                </h3>
                <label className="flex items-center gap-2 text-meta text-foreground-muted">
                  <input
                    type="checkbox"
                    checked={titleShown}
                    onChange={(e) => {
                      const show = e.target.checked;
                      mutate(
                        (pg) => ({
                          ...pg,
                          panels: pg.panels.map((pp) =>
                            pp.panelId === selected
                              ? { ...pp, overrides: { ...pp.overrides, hideTitle: !show } }
                              : pp,
                          ),
                        }),
                        true,
                      );
                    }}
                  />
                  Show plot title
                </label>

                {styleTargets.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-2.5">
                    <p className="text-meta font-semibold text-foreground-muted">Style</p>
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                      {styleTargets.map((t) => {
                        const ov = sp?.style?.targets?.[t.key];
                        const color = ov?.color ?? t.color ?? "#888888";
                        const hidden = ov?.hidden === true;
                        return (
                          <div key={t.key} className="flex items-center gap-2">
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888"}
                              onChange={(e) =>
                                mutate((p) => setPanelTarget(p, selected, t.key, { color: e.target.value }))
                              }
                              className="h-5 w-5 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                              aria-label={`Color of ${t.label}`}
                            />
                            <span
                              className={`flex-1 truncate text-meta ${hidden ? "text-foreground-faint line-through" : "text-foreground"}`}
                            >
                              {t.label}
                            </span>
                            <button
                              type="button"
                              aria-label={hidden ? `Show ${t.label}` : `Hide ${t.label}`}
                              onClick={() =>
                                mutate((p) => setPanelTarget(p, selected, t.key, { hidden: !hidden }), true)
                              }
                              className="shrink-0 text-foreground-faint hover:text-foreground"
                            >
                              <Icon name={hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {sp?.ref.type === "sequence" && (
                      <div className="space-y-1.5 pt-1">
                        <label className="flex items-center justify-between gap-2 text-meta text-foreground-muted">
                          <span>Thickness</span>
                          <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.1}
                            value={(sp?.style?.options?.featureScale as number) ?? 1}
                            onChange={(e) =>
                              mutate((p) =>
                                setPanelStyle(p, selected, { options: { featureScale: Number(e.target.value) } }),
                              )
                            }
                            className="w-28"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-meta text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={sp?.style?.options?.showTicks !== false}
                            onChange={(e) =>
                              mutate(
                                (p) => setPanelStyle(p, selected, { options: { showTicks: e.target.checked } }),
                                true,
                              )
                            }
                          />
                          Coordinate ruler
                        </label>
                        <label className="flex items-center gap-2 text-meta text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={sp?.style?.options?.showLabels !== false}
                            onChange={(e) =>
                              mutate(
                                (p) => setPanelStyle(p, selected, { options: { showLabels: e.target.checked } }),
                                true,
                              )
                            }
                          />
                          Feature labels
                        </label>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    mutate((p) => removePanel(p, selected), true);
                    setSelected(null);
                  }}
                  className="block text-meta font-medium text-pin hover:underline"
                >
                  Remove from page
                </button>
              </div>
            );
          })()}

        {selectedAnnotation && (
          <div className="space-y-2.5 rounded-xl border border-border p-3">
            <h3 className="text-meta font-bold uppercase tracking-wide text-foreground-faint">
              Annotation
            </h3>
            {selectedAnnotation.kind === "text" && (
              <input
                type="text"
                value={selectedAnnotation.text}
                onChange={(e) =>
                  mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { text: e.target.value }))
                }
                placeholder="Text"
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-meta"
              />
            )}
            {selectedAnnotation.kind === "arrow" && (
              <div className="flex items-center justify-between text-body">
                <span className="text-foreground-muted">Heads</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                  {(
                    [
                      [0, "Line"],
                      [1, "Arrow"],
                      [2, "Double"],
                    ] as const
                  ).map(([h, lbl]) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() =>
                        mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { heads: h }), true)
                      }
                      className={`px-2 py-1 text-meta ${selectedAnnotation.heads === h ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selectedAnnotation.kind === "bracket" && (
              <>
                <input
                  type="text"
                  value={selectedAnnotation.label ?? ""}
                  onChange={(e) =>
                    mutate((p) => updateAnnotation(p, selectedAnnotation.annId, { label: e.target.value }))
                  }
                  placeholder="Label (e.g. ** or p = 0.03)"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-meta"
                />
                <div className="flex items-center justify-between text-body">
                  <span className="text-foreground-muted">Orientation</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                    {(["horizontal", "vertical"] as const).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() =>
                          mutate(
                            (p) => updateAnnotation(p, selectedAnnotation.annId, { orientation: o }),
                            true,
                          )
                        }
                        className={`px-2 py-1 text-meta capitalize ${selectedAnnotation.orientation === o ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                mutate((p) => removeAnnotation(p, selectedAnnotation.annId), true);
                setSelectedAnn(null);
              }}
              className="block text-meta font-medium text-pin hover:underline"
            >
              Remove annotation
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
          onPickMany={(refs) => {
            if (refs.length === 0) {
              setPickerOpen(false);
              return;
            }
            const stamp = Date.now().toString(36);
            mutate((p) => {
              let next = p;
              refs.forEach((ref, i) => {
                next = addPanel(next, { type: ref.type, id: ref.id }, `p${page.id}-${stamp}-${i}`);
              });
              return next;
            }, true);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

const refKey = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
/** Size (inches) the source renders a picker thumbnail / preview at. */
const THUMB_IN = { widthIn: 1.4, heightIn: 1.05 };
const PREVIEW_IN = { widthIn: 4.4, heightIn: 3.3 };

function AddFigurePicker({
  collectionId,
  onClose,
  onPickMany,
}: {
  collectionId: string | null;
  onClose: () => void;
  onPickMany: (refs: FigureRef[]) => void;
}) {
  const [allRefs, setAllRefs] = useState<FigureRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [preview, setPreview] = useState<string | null>(null);
  const inflight = useRef<Set<string>>(new Set());

  // Load every source once, baking the source label as each ref's group fallback
  // so a ref with no group still lands in a sensible "Group by table" bucket.
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: FigureRef[] = [];
      for (const src of listFigureSources()) {
        const refs = await src.list({ collectionId });
        for (const r of refs) out.push({ ...r, group: r.group ?? src.label });
      }
      if (live) {
        setAllRefs(out);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [collectionId]);

  const view = useMemo(
    () => buildPickerView(allRefs, { kindFilter, groupBy, query, sourceLabel: "" }),
    [allRefs, kindFilter, groupBy, query],
  );

  const visibleRefs = useMemo(() => view.groups.flatMap((g) => g.refs), [view]);
  const visibleKeys = visibleRefs.map(refKey).join("|");

  // Keep a valid active selection as the filter/search changes.
  useEffect(() => {
    if (visibleRefs.length === 0) {
      setActive(null);
      return;
    }
    setActive((cur) => (cur && visibleRefs.some((r) => refKey(r) === cur) ? cur : refKey(visibleRefs[0])));
  }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazily render thumbnails for the visible rows (cached, never re-fetched).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const r of visibleRefs) {
        const key = refKey(r);
        if (thumbs.has(key) || inflight.current.has(key)) continue;
        const src = getFigureSource(r.type);
        if (!src) continue;
        inflight.current.add(key);
        try {
          const out = await src.render(r.id, {
            ...THUMB_IN,
            dpi: SCREEN_DPI,
            theme: "light",
            overrides: { hideTitle: true },
          });
          if (!cancelled) setThumbs((prev) => new Map(prev).set(key, out.svg));
        } catch {
          // leave it blank; the row shows a neutral placeholder
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the larger preview for the active figure.
  useEffect(() => {
    if (!active) {
      setPreview(null);
      return;
    }
    const r = allRefs.find((x) => refKey(x) === active);
    if (!r) return;
    const src = getFigureSource(r.type);
    if (!src) return;
    let cancelled = false;
    setPreview(null);
    void src
      .render(r.id, { ...PREVIEW_IN, dpi: SCREEN_DPI, theme: "light" })
      .then((out) => {
        if (!cancelled) setPreview(out.svg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, allRefs]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const activeRef = active ? allRefs.find((r) => refKey(r) === active) ?? null : null;
  const confirm = () => onPickMany(allRefs.filter((r) => selected.has(refKey(r))));

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add figures"
        className="flex h-[560px] max-h-[85vh] w-[760px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-body font-bold">Add figures</h2>
          <div className="flex items-center gap-3">
            <span className="text-meta text-foreground-muted">{selected.size} selected</span>
            <button type="button" onClick={onClose} aria-label="Close">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
          <div className="flex min-h-0 flex-col border-r border-border">
            <div className="space-y-2.5 p-3">
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-faint"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search figures"
                  aria-label="Search figures"
                  className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-2 text-meta"
                />
              </div>
              <div className="flex items-start gap-2">
                <Icon name="filter" className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" on={kindFilter === null} onClick={() => setKindFilter(null)} />
                  {view.kinds.map((k) => (
                    <FilterChip
                      key={k}
                      label={k}
                      on={kindFilter === k}
                      onClick={() => setKindFilter(kindFilter === k ? null : k)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta text-foreground-faint">Group by</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
                  {(["table", "type", "none"] as GroupBy[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupBy(g)}
                      className={`px-2.5 py-1 text-meta capitalize ${groupBy === g ? "bg-brand-action text-white" : "text-foreground-muted"}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {loading && <p className="px-2 py-3 text-meta text-foreground-muted">Loading figures...</p>}
              {!loading && allRefs.length === 0 && (
                <p className="px-2 py-3 text-meta text-foreground-muted">
                  No saved figures yet. Make a graph in the Data Hub first.
                </p>
              )}
              {!loading && allRefs.length > 0 && view.count === 0 && (
                <p className="px-2 py-3 text-meta text-foreground-muted">No figures match.</p>
              )}
              {view.groups.map((g) => (
                <div key={g.label || "_all"} className="mb-2">
                  {g.label && (
                    <p className="px-2 pb-1 pt-2 text-meta font-semibold uppercase tracking-wide text-foreground-faint">
                      {g.label}
                    </p>
                  )}
                  {g.refs.map((r) => {
                    const key = refKey(r);
                    const isSel = selected.has(key);
                    return (
                      <div
                        key={key}
                        onClick={() => setActive(key)}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-1.5 ${active === key ? "border-border-strong bg-surface" : "border-transparent hover:bg-surface"}`}
                        data-testid="picker-row"
                      >
                        <div
                          className="h-[30px] w-[42px] shrink-0 overflow-hidden rounded border border-border bg-white [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: thumbs.get(key) ?? "" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-meta text-foreground">{r.name}</div>
                          {groupBy !== "table" && r.group && (
                            <div className="truncate text-[11px] text-foreground-faint">{r.group}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={isSel ? "Deselect" : "Select"}
                          aria-pressed={isSel}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(key);
                          }}
                          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border ${isSel ? "border-brand-action bg-brand-action text-white" : "border-border-strong"}`}
                        >
                          {isSel && <Icon name="check" className="h-3 w-3" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-surface-sunken">
            <div className="flex min-h-0 flex-1 items-center justify-center p-5">
              {activeRef ? (
                preview ? (
                  <div
                    className="max-h-full max-w-full [&>svg]:max-h-full [&>svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                ) : (
                  <p className="text-meta text-foreground-faint">Rendering preview...</p>
                )
              ) : (
                <p className="text-meta text-foreground-faint">Select a figure to preview it.</p>
              )}
            </div>
            {activeRef && (
              <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
                {activeRef.kind && (
                  <span className="rounded-md bg-brand-action/10 px-2 py-0.5 text-[11px] text-brand-action">
                    {activeRef.kind}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-meta font-semibold text-foreground">{activeRef.name}</div>
                  {activeRef.group && (
                    <div className="truncate text-[11px] text-foreground-faint">{activeRef.group}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(active!)}
                  className={`rounded-lg border px-2.5 py-1 text-meta font-medium ${selected.has(active!) ? "border-brand-action text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                >
                  {selected.has(active!) ? "Selected" : "Select"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="text-meta font-medium text-foreground-muted hover:underline disabled:opacity-40"
          >
            Clear selection
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-meta font-semibold hover:border-brand-action"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={selected.size === 0}
              className="rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
              data-testid="picker-add"
            >
              Add {selected.size} figure{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border text-foreground-muted hover:border-border-strong"}`}
    >
      {label}
    </button>
  );
}

/** The screen-space bounding box (px) of an annotation, for hit + highlight. */
function annBox(a: Annotation, scale: number): { x: number; y: number; w: number; h: number } {
  if (a.kind === "text") {
    const fs = (a.fontPt * scale) / 72;
    return { x: a.xIn * scale, y: a.yIn * scale - fs, w: Math.max(30, a.text.length * fs * 0.6), h: fs * 1.3 };
  }
  if (a.kind === "arrow") {
    return {
      x: Math.min(a.x1In, a.x2In) * scale,
      y: Math.min(a.y1In, a.y2In) * scale,
      w: Math.abs(a.x2In - a.x1In) * scale,
      h: Math.abs(a.y2In - a.y1In) * scale,
    };
  }
  const tick = Math.max(4, 0.06 * scale);
  return a.orientation === "horizontal"
    ? { x: a.xIn * scale, y: a.yIn * scale - tick, w: a.spanIn * scale, h: tick * 2.5 }
    : { x: a.xIn * scale - tick, y: a.yIn * scale, w: tick * 2.5, h: a.spanIn * scale };
}

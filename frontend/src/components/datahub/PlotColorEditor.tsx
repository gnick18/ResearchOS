"use client";

// PlotColorEditor (Data Hub graphs slice). Wraps the live figure SVG and lets a
// researcher recolor a series by interacting with the plot directly, the way
// they would in a drawing tool, instead of hunting for the matching control in
// the side panel. The why: pointing at the bar you want to change is the fastest
// path, and it mirrors how Prism / Illustrator let you click an element.
//
// Each series' primary fill element carries data-series (set by plot-spec.ts), so
// a double-click or right-click hit-tests via closest('[data-series]') to find
// the series index, then a small color popover / context menu writes
// style.colorOverrides through onStyleChange.
//
// House style: <Icon> only (no inline svg in this component), no emojis /
// em-dashes / mid-sentence colons. The figure itself is our own serialized SVG
// (built from the table), so dangerouslySetInnerHTML is safe here.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { PlotStyle } from "@/lib/datahub/plot-spec";

type Popover =
  | { kind: "color"; series: number; x: number; y: number; value: string }
  | {
      kind: "menu";
      series: number;
      x: number;
      y: number;
      current: string;
    }
  | {
      // Naming the whole figure's colors as a reusable palette, reached from the
      // menu's "Save colors as palette" item.
      kind: "saveName";
      x: number;
      y: number;
      name: string;
    }
  | null;

/** Read the series index off the nearest data-series ancestor of an event target. */
function seriesFromEvent(e: { target: EventTarget | null }): number | null {
  const el = e.target as Element | null;
  if (!el || typeof el.closest !== "function") return null;
  const hit = el.closest("[data-series]");
  if (!hit) return null;
  const raw = hit.getAttribute("data-series");
  const idx = raw === null ? NaN : Number(raw);
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}

export default function PlotColorEditor({
  svg,
  style,
  resolvedColors,
  onStyleChange,
  onSaveColorsAsPalette,
}: {
  svg: string;
  style: PlotStyle;
  /** The colors the figure is drawing, so the menu can show / copy the real one. */
  resolvedColors: string[];
  onStyleChange: (patch: Partial<PlotStyle>) => void;
  /**
   * Save the figure's current effective colors as a named user palette. The
   * colors are the same resolvedColors the editor is drawing (resolved by the
   * plot-spec resolver up in GraphEditor), so the menu only has to hand back the
   * chosen name. Optional so the component still renders without the wiring.
   */
  onSaveColorsAsPalette?: (name: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  // A copied color, kept in component state so Paste works even when the OS
  // clipboard is not readable (a browser permission gate).
  const [clipColor, setClipColor] = useState<string | null>(null);

  // Close on Escape or a click outside the popover.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    const onDown = (e: MouseEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const pop = wrap.querySelector("[data-plot-popover]");
      if (pop && pop.contains(e.target as Node)) return;
      setPopover(null);
    };
    document.addEventListener("keydown", onKey);
    // A timeout so the opening click does not immediately close it.
    const t = setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, [popover]);

  const localPoint = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };
  };

  const setOverride = (series: number, hex: string) => {
    const next = { ...(style.colorOverrides ?? {}) };
    next[series] = hex;
    onStyleChange({ colorOverrides: next });
  };
  const clearOverride = (series: number) => {
    const next = { ...(style.colorOverrides ?? {}) };
    delete next[series];
    onStyleChange({ colorOverrides: next });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const series = seriesFromEvent(e);
    if (series === null) return;
    const { x, y } = localPoint(e.clientX, e.clientY);
    const value =
      style.colorOverrides?.[series] ?? resolvedColors[series] ?? "#888888";
    setPopover({ kind: "color", series, x, y, value });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const series = seriesFromEvent(e);
    if (series === null) return;
    e.preventDefault();
    const { x, y } = localPoint(e.clientX, e.clientY);
    const current =
      style.colorOverrides?.[series] ?? resolvedColors[series] ?? "#888888";
    setPopover({ kind: "menu", series, x, y, current });
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="overflow-hidden"
        data-testid="datahub-figure"
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        // The serialized SVG is our own, built from the table content; it is not
        // user free-text HTML, so rendering it here is safe.
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {popover?.kind === "color" && (
        <div
          data-plot-popover
          className="absolute z-20 flex items-center gap-2 rounded-md border border-border bg-surface-raised p-2 shadow-lg"
          style={{
            left: Math.min(popover.x, 320),
            top: Math.min(popover.y, 280),
          }}
        >
          <input
            type="color"
            autoFocus
            value={popover.value}
            onChange={(e) => {
              setOverride(popover.series, e.target.value);
              setPopover({ ...popover, value: e.target.value });
            }}
            className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
            aria-label="Series color"
          />
          <button
            type="button"
            onClick={() => {
              clearOverride(popover.series);
              setPopover(null);
            }}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[10px] font-medium text-foreground hover:bg-surface-sunken"
          >
            <Icon name="refresh" className="h-3 w-3" />
            Reset
          </button>
        </div>
      )}

      {popover?.kind === "menu" && (
        <div
          data-plot-popover
          className="absolute z-20 min-w-[150px] overflow-hidden rounded-md border border-border bg-surface-raised py-1 text-[12px] shadow-lg"
          style={{
            left: Math.min(popover.x, 300),
            top: Math.min(popover.y, 260),
          }}
        >
          <button
            type="button"
            onClick={() =>
              setPopover({
                kind: "color",
                series: popover.series,
                x: popover.x,
                y: popover.y,
                value: popover.current,
              })
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-surface-sunken"
          >
            <Icon name="pencil" className="h-3 w-3" />
            Change color
          </button>
          <button
            type="button"
            onClick={() => {
              clearOverride(popover.series);
              setPopover(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-surface-sunken"
          >
            <Icon name="refresh" className="h-3 w-3" />
            Reset to palette
          </button>
          <button
            type="button"
            onClick={() => {
              setClipColor(popover.current);
              void navigator.clipboard?.writeText(popover.current).catch(() => {});
              setPopover(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-surface-sunken"
          >
            <Icon name="copy" className="h-3 w-3" />
            Copy color
          </button>
          <button
            type="button"
            disabled={!clipColor}
            onClick={() => {
              if (clipColor) setOverride(popover.series, clipColor);
              setPopover(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-surface-sunken disabled:opacity-40"
          >
            <Icon name="paste" className="h-3 w-3" />
            Paste color
          </button>
          {onSaveColorsAsPalette && (
            <button
              type="button"
              onClick={() =>
                setPopover({
                  kind: "saveName",
                  x: popover.x,
                  y: popover.y,
                  name: "My palette",
                })
              }
              className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-foreground hover:bg-surface-sunken"
              data-testid="plot-save-colors"
            >
              <Icon name="save" className="h-3 w-3" />
              Save colors as palette
            </button>
          )}
        </div>
      )}

      {popover?.kind === "saveName" && (
        <div
          data-plot-popover
          className="absolute z-20 w-[200px] rounded-md border border-border bg-surface-raised p-2 shadow-lg"
          style={{
            left: Math.min(popover.x, 280),
            top: Math.min(popover.y, 260),
          }}
        >
          <p className="mb-1.5 text-[10px] font-semibold text-foreground-muted">
            Name this palette
          </p>
          <div className="flex items-center gap-1">
            <input
              type="text"
              autoFocus
              value={popover.name}
              placeholder="My palette"
              onChange={(e) => setPopover({ ...popover, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSaveColorsAsPalette?.(popover.name.trim() || "My palette");
                  setPopover(null);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setPopover(null);
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <Tooltip label="Save palette">
              <button
                type="button"
                onClick={() => {
                  onSaveColorsAsPalette?.(popover.name.trim() || "My palette");
                  setPopover(null);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-brand-action bg-brand-action text-white transition-colors hover:opacity-90"
                aria-label="Save palette"
              >
                <Icon name="check" className="h-3 w-3" />
              </button>
            </Tooltip>
            <Tooltip label="Cancel">
              <button
                type="button"
                onClick={() => setPopover(null)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:bg-surface-sunken"
                aria-label="Cancel"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

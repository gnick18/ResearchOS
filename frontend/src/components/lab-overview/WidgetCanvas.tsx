"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
// React-grid-layout v1.5.x bundles `Responsive` + `WidthProvider` as
// named exports under an `export = ReactGridLayout` namespace. A
// namespace import picks up both the class side and the namespace side
// of the declaration (`import RGL from …` alone only picks up the
// class, dropping the static helpers).
import { Responsive, WidthProvider } from "react-grid-layout";
import type { Layout, Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./grid-overrides.css";
import Widget from "./widgets/Widget";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import { visibleCatalog } from "./widgets/types";
import {
  addCanvasWidget,
  patchCanvasLayout,
  readResolvedLayout,
  removeCanvasWidget,
  resetLayout,
} from "@/lib/lab-overview/layout-persistence";
import type { AccountType, LabOverviewWidgetPosition } from "@/lib/settings/user-settings";
import Tooltip from "@/components/Tooltip";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * the Lab Overview free-grid canvas. Wraps `react-grid-layout`'s
 * Responsive + WidthProvider so the widget grid relayouts on viewport
 * resize without per-page math.
 *
 * Responsibilities:
 *   - read the current user's saved layout (or default for their
 *     account type) and feed it to `<ResponsiveGridLayout>`
 *   - render each catalog widget inside the canonical `<Widget>` frame
 *   - own the Edit-mode toggle (default off → drag/resize/remove
 *     handles hidden; on → handles visible, "+ Add widget" enabled)
 *   - own the Add-widget palette (popover with the catalog; toggle to
 *     mount/unmount)
 *   - persist changes via `layout-persistence` after every drag/resize
 *     commit + add/remove
 *
 * The 12-col `lg` grid + single-col `xs` fallback mirror proposal §3a
 * + §3f. Drag/resize are disabled at `xs` regardless of edit mode (mobile
 * touch + grid drag is a UX trap; we let the layout fall through to the
 * default y-order column on narrow viewports).
 */

const ResponsiveGridLayout = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 12, md: 12, sm: 6, xs: 1, xxs: 1 };
const ROW_HEIGHT = 56;

export interface WidgetCanvasProps {
  username: string;
  accountType: AccountType;
}

export default function WidgetCanvas({ username, accountType }: WidgetCanvasProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [canvas, setCanvas] = useState<Record<string, LabOverviewWidgetPosition> | null>(null);
  const [showPalette, setShowPalette] = useState(false);

  const catalog = useMemo(() => visibleCatalog(WIDGET_CATALOG, accountType), [accountType]);
  const canvasCatalog = useMemo(
    () => catalog.filter((w) => w.surface === "canvas" || w.surface === "both"),
    [catalog],
  );

  // ── Load initial layout ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await readResolvedLayout(username, catalog);
        if (!cancelled) setCanvas(resolved.canvas);
      } catch (err) {
        console.warn("[WidgetCanvas] failed to load layout", err);
        if (!cancelled) setCanvas({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, catalog]);

  // ── Convert canvas map → react-grid-layout's Layouts shape ─────────────
  // The library wants `{ [breakpoint]: Layout[] }`. We keep a single
  // canonical layout under `lg` and let the lib derive smaller-screen
  // layouts via its built-in `onBreakpointChange` reflow.
  const layouts = useMemo<Layouts>(() => {
    if (!canvas) return { lg: [] as Layout[] } as Layouts;
    const lgLayout: Layout[] = Object.entries(canvas).map(([id, pos]) => {
      const def = getWidget(id);
      const item: Layout = {
        i: id,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
      };
      if (def?.defaultLayout.minW !== undefined) item.minW = def.defaultLayout.minW;
      if (def?.defaultLayout.minH !== undefined) item.minH = def.defaultLayout.minH;
      return item;
    });
    return { lg: lgLayout, md: lgLayout, sm: lgLayout } as Layouts;
  }, [canvas]);

  // ── Persist drag / resize commits ──────────────────────────────────────
  //
  // Mira-Explorer P0 fix (2026-05-23): swapped from `onLayoutChange` to
  // `onDragStop` + `onResizeStop`. `onLayoutChange` fires on every
  // re-render of the grid (including mount, prop changes, breakpoint
  // reflows) AND on every drag/resize stop — that meant any unrelated
  // settings update (theme toggle, animation pick) that re-rendered
  // the canvas would also queue a layout write, racing with the
  // read-modify-write of `_user_settings.json`. The commit-only
  // handlers fire exactly once per user action, no extra writes on
  // mount or breakpoint changes.
  const persistCanvas = useCallback(
    (currentLayout: Layout[]) => {
      if (!canvas) return;
      // Only persist when the user is in edit mode; otherwise the
      // library's own reflow on breakpoint change would write back the
      // collapsed-column layout and overwrite the saved free-grid one.
      if (!isEditing) return;
      const nextCanvas: Record<string, LabOverviewWidgetPosition> = {};
      for (const item of currentLayout) {
        nextCanvas[item.i] = {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        };
      }
      // Local optimistic update — the disk write follows. With
      // dragStop/resizeStop semantics this fires once per committed
      // user action, not per-tick.
      setCanvas(nextCanvas);
      void patchCanvasLayout(username, nextCanvas);
    },
    [canvas, isEditing, username],
  );

  const handleDragStop = useCallback(
    (currentLayout: Layout[]) => {
      persistCanvas(currentLayout);
    },
    [persistCanvas],
  );

  const handleResizeStop = useCallback(
    (currentLayout: Layout[]) => {
      persistCanvas(currentLayout);
    },
    [persistCanvas],
  );

  // ── Add / remove from palette ──────────────────────────────────────────
  const handleAddWidget = useCallback(
    async (widgetId: string) => {
      const def = getWidget(widgetId);
      if (!def) return;
      await addCanvasWidget(username, def);
      const resolved = await readResolvedLayout(username, catalog);
      setCanvas(resolved.canvas);
    },
    [username, catalog],
  );

  const handleRemoveWidget = useCallback(
    async (widgetId: string) => {
      await removeCanvasWidget(username, widgetId);
      const resolved = await readResolvedLayout(username, catalog);
      setCanvas(resolved.canvas);
    },
    [username, catalog],
  );

  const handleReset = useCallback(async () => {
    if (
      !window.confirm(
        "Reset Lab Overview layout to default? This resets your widgets to the default layout. You can rebuild your customization at any time.",
      )
    ) {
      return;
    }
    await resetLayout(username);
    const resolved = await readResolvedLayout(username, catalog);
    setCanvas(resolved.canvas);
  }, [username, catalog]);

  if (canvas === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  const mountedIds = new Set(Object.keys(canvas));

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 relative">
        <Tooltip label="Add a widget to the canvas" placement="bottom">
          <button
            type="button"
            onClick={() => setShowPalette((p) => !p)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            + Add widget
          </button>
        </Tooltip>
        <Tooltip
          label={isEditing ? "Lock layout (saves automatically)" : "Drag, resize, and remove widgets"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => setIsEditing((e) => !e)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              isEditing
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isEditing ? "Done" : "Edit layout"}
          </button>
        </Tooltip>
        <Tooltip label="Reset to default layout" placement="bottom">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Reset
          </button>
        </Tooltip>

        {showPalette && (
          <div
            className="absolute top-full right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-2 max-h-96 overflow-auto"
            role="dialog"
            aria-label="Add widget palette"
          >
            <p className="text-[10px] uppercase tracking-wide text-gray-400 px-2 py-1">
              Canvas widgets
            </p>
            {canvasCatalog.length === 0 ? (
              <p className="text-xs text-gray-400 italic px-2 py-2">
                No widgets available for your account type.
              </p>
            ) : (
              canvasCatalog.map((widget) => {
                const isMounted = mountedIds.has(widget.id);
                return (
                  <button
                    key={widget.id}
                    type="button"
                    onClick={() =>
                      isMounted
                        ? handleRemoveWidget(widget.id)
                        : handleAddWidget(widget.id)
                    }
                    className="w-full text-left px-2 py-2 rounded hover:bg-gray-50 flex items-start gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded border ${
                        isMounted
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {isMounted ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {widget.title}
                      </p>
                      {widget.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {widget.description}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        isDraggable={isEditing}
        isResizable={isEditing}
        draggableHandle=".lab-widget-drag-handle"
        onDragStop={handleDragStop}
        onResizeStop={handleResizeStop}
        margin={[12, 12]}
        // Keep grid items from compacting upward when the user drags
        // one — they expect the dropped position to stick, not jump.
        compactType="vertical"
        preventCollision={false}
      >
        {Object.keys(canvas).map((id) => {
          const def = getWidget(id);
          if (!def) return null;
          const Body = def.Component;
          return (
            <div key={id}>
              <Widget
                id={id}
                title={def.title}
                isEditing={isEditing}
                onRemove={() => handleRemoveWidget(id)}
                surface="canvas"
              >
                <Body surface="canvas" isEditing={isEditing} />
              </Widget>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}

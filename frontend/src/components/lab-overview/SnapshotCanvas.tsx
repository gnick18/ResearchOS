"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Widget from "./widgets/Widget";
import SnapshotTilePopup from "./SnapshotTilePopup";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import { visibleCatalog } from "./widgets/types";
import {
  addCanvasWidget,
  patchCanvasOrder,
  readResolvedLayout,
  removeCanvasWidget,
  resetLayout,
} from "@/lib/lab-overview/layout-persistence";
import {
  resolveExpandedView,
  resolveToolTitle,
} from "@/lib/lab-overview/tool-registry";
import type { AccountType } from "@/lib/settings/user-settings";
import Tooltip from "@/components/Tooltip";

/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the Lab Overview snapshot canvas. Replaces the R2 react-grid-layout
 * free-grid with a 2-column CSS grid of snapshot tiles.
 *
 * Behavior:
 *   - render each catalog widget's `SnapshotTile` inside the standard
 *     `<Widget>` frame, in the saved order
 *   - click a tile → open a `<SnapshotTilePopup>` with the widget's
 *     `ExpandedView`
 *   - Edit mode (gear toggle) flips tiles to draggable; reorder is
 *     native HTML5 drag-and-drop, mirroring the project-card reorder
 *     in `app/page.tsx` (move dragged id to target position; persist
 *     once on drop)
 *   - "+ Add widget" palette + Reset behave the same as R2
 *
 * The free-grid is gone — Phase A trades x/y/w/h freedom for a
 * dashboard-like uniform grid that the eye can scan. Phase B adds
 * per-tile customization (sparkline, mini-feed, etc.) inside each
 * widget's `SnapshotTile` component, not on the canvas frame.
 */
export interface SnapshotCanvasProps {
  username: string;
  accountType: AccountType;
}

export default function SnapshotCanvas({
  username,
  accountType,
}: SnapshotCanvasProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [openWidgetId, setOpenWidgetId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const catalog = useMemo(
    () => visibleCatalog(WIDGET_CATALOG, accountType),
    [accountType],
  );
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
        if (!cancelled) setOrder(resolved.widgetOrder.canvas);
      } catch (err) {
        console.warn("[SnapshotCanvas] failed to load layout", err);
        if (!cancelled) setOrder([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, catalog]);

  // ── Native HTML5 drag-and-drop reorder ─────────────────────────────────
  // Pattern source: `app/page.tsx` project-card reorder. Same lifecycle:
  // setDraggedId on dragstart, preventDefault on dragover, splice on
  // drop, persist once.
  const handleDragStart = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      if (!isEditing) {
        e.preventDefault();
        return;
      }
      setDragId(widgetId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", widgetId);
    },
    [isEditing],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      if (!isEditing || !dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(widgetId);
    },
    [isEditing, dragId],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      setDragOverId(null);
      if (!order || !dragId || dragId === targetId) {
        setDragId(null);
        return;
      }
      const from = order.indexOf(dragId);
      const to = order.indexOf(targetId);
      if (from < 0 || to < 0) {
        setDragId(null);
        return;
      }
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      setOrder(next);
      setDragId(null);
      // Persist once per drop — no per-tick writes. Mirrors the
      // project-card reorder pattern.
      try {
        await patchCanvasOrder(username, next);
      } catch (err) {
        console.warn("[SnapshotCanvas] failed to persist canvas order", err);
      }
    },
    [order, dragId, username],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  // ── Add / remove from palette ──────────────────────────────────────────
  const handleAddWidget = useCallback(
    async (widgetId: string) => {
      const def = getWidget(widgetId);
      if (!def) return;
      await addCanvasWidget(username, def);
      const resolved = await readResolvedLayout(username, catalog);
      setOrder(resolved.widgetOrder.canvas);
    },
    [username, catalog],
  );

  const handleRemoveWidget = useCallback(
    async (widgetId: string) => {
      await removeCanvasWidget(username, widgetId);
      const resolved = await readResolvedLayout(username, catalog);
      setOrder(resolved.widgetOrder.canvas);
    },
    [username, catalog],
  );

  const handleReset = useCallback(async () => {
    if (
      !window.confirm(
        "Reset Lab Overview layout to default? Your widget order will be lost.",
      )
    ) {
      return;
    }
    await resetLayout(username);
    const resolved = await readResolvedLayout(username, catalog);
    setOrder(resolved.widgetOrder.canvas);
  }, [username, catalog]);

  if (order === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  const mountedIds = new Set(order);
  const openWidget = openWidgetId ? getWidget(openWidgetId) : null;

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
          label={
            isEditing
              ? "Lock layout (saves automatically)"
              : "Drag tiles to reorder"
          }
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
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          aria-hidden="true"
                        >
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

      {/* 2-column snapshot grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
        // The snapshot canvas is the surface that handles drop-outside-target
        // edge cases (drop on the gap between tiles). We don't wire a
        // catch-all drop handler at the grid level today; the per-tile drop
        // covers the canonical case and a missed drop just resets dragId on
        // the next dragend tick.
        onDragEnd={handleDragEnd}
      >
        {order.map((id) => {
          const def = getWidget(id);
          if (!def) return null;
          const Tile = def.SnapshotTile;
          const isDragOver = dragOverId === id && dragId && dragId !== id;
          const isDragging = dragId === id;
          return (
            <div
              key={id}
              draggable={isEditing}
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, id)}
              className={`h-44 transition-shadow ${
                isEditing ? "cursor-move" : "cursor-pointer"
              } ${isDragging ? "opacity-40" : ""} ${
                isDragOver
                  ? "ring-2 ring-blue-400 ring-offset-2 rounded-lg"
                  : ""
              }`}
              onClick={() => {
                // Edit mode swallows the click so drag-init isn't ambiguous.
                if (isEditing) return;
                setOpenWidgetId(id);
              }}
              role="button"
              tabIndex={isEditing ? -1 : 0}
              aria-label={`Open ${def.title}`}
              onKeyDown={(e) => {
                if (isEditing) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenWidgetId(id);
                }
              }}
            >
              <Widget
                id={id}
                title={def.title}
                isEditing={isEditing}
                onRemove={() => handleRemoveWidget(id)}
                surface="canvas"
              >
                <Tile surface="canvas" />
              </Widget>
            </div>
          );
        })}
      </div>

      {/* Popup: opens the clicked tile's ExpandedView. Phase C — the
          popup body is resolved via `resolveExpandedView` so every
          widget variant of a Tool opens the SAME popup (e.g. the three
          purchases variants all open the LabPurchases 4-tab popup). The
          popup header title comes from the Tool, not the widget, so all
          variants of one Tool share a popup chrome label. */}
      {openWidget &&
        (() => {
          const Expanded = resolveExpandedView(openWidget);
          return (
            <SnapshotTilePopup
              title={resolveToolTitle(openWidget)}
              onClose={() => setOpenWidgetId(null)}
            >
              <Expanded surface="canvas" isEditing={false} />
            </SnapshotTilePopup>
          );
        })()}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SnapshotTilePopup from "./SnapshotTilePopup";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import { visibleCatalog, widgetHasSurface } from "./widgets/types";
import {
  patchSidebarOrder,
  readResolvedLayout,
  toggleSidebarWidget,
} from "@/lib/lab-overview/layout-persistence";
import {
  resolveExpandedView,
  resolveToolTitle,
} from "@/lib/lab-overview/tool-registry";
import type { AccountType } from "@/lib/settings/user-settings";
import Tooltip from "@/components/Tooltip";

/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the customizable left sidebar widget rail — now a single-column
 * stack of the same snapshot tiles the canvas uses. Click a tile to
 * open the widget's `ExpandedView` in a popup.
 *
 * The visibility-toggle list in edit mode replaces the R2
 * order+hidden split: a widget is either in the sidebar order or
 * it's not. Toggle = add / remove.
 *
 * Reorder is native HTML5 drag-and-drop on the widget headers — same
 * pattern the snapshot canvas + the home page project cards use. One
 * persistence write per drop.
 *
 * Customizable PI sidebar (#146 customizable PI sidebar manager,
 * 2026-05-23): on `/lab-overview` this rail keeps rendering INSIDE
 * the page body (next to the canvas, not as the AppShell sidebar —
 * AppShell carves /lab-overview out so it never double-stacks). The
 * tiles now use each widget's `SidebarTile` component (slim
 * horizontal rows), not the canvas `SnapshotTile`. The AppShell-
 * level customizable sidebar for lab heads lives in
 * `<CustomizableSidebar>` — a separate consumer of the same
 * widgetOrder.sidebar list, so changes here propagate to both
 * surfaces.
 */
export interface SidebarWidgetRailProps {
  username: string;
  accountType: AccountType;
}

export default function SidebarWidgetRail({
  username,
  accountType,
}: SidebarWidgetRailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openWidgetId, setOpenWidgetId] = useState<string | null>(null);

  const catalog = useMemo(
    () => visibleCatalog(WIDGET_CATALOG, accountType),
    [accountType],
  );
  const sidebarCatalog = useMemo(
    () => catalog.filter((w) => widgetHasSurface(w, "sidebar")),
    [catalog],
  );

  // ── Load layout ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await readResolvedLayout(username, catalog);
        if (!cancelled) setOrder(resolved.widgetOrder.sidebar);
      } catch (err) {
        console.warn("[SidebarWidgetRail] failed to load layout", err);
        if (!cancelled) setOrder([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, catalog]);

  // ── Reorder via HTML5 drag-and-drop ────────────────────────────────────
  const handleDragStart = (id: string) => () => setDragId(id);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDrop = (targetId: string) => async () => {
    if (!order || !dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const next = [...order];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrder(next);
    setDragId(null);
    try {
      await patchSidebarOrder(username, next);
    } catch (err) {
      console.warn("[SidebarWidgetRail] failed to persist sidebar order", err);
    }
  };

  const handleToggle = useCallback(
    async (widgetId: string) => {
      const isShown = order?.includes(widgetId) ?? false;
      const nextOrder = isShown
        ? (order ?? []).filter((id) => id !== widgetId)
        : [...(order ?? []), widgetId];
      setOrder(nextOrder);
      await toggleSidebarWidget(username, widgetId);
    },
    [order, username],
  );

  if (order === null) {
    return (
      <aside className="w-64 border-r border-gray-200 bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
      </aside>
    );
  }

  // Visible widgets — order minus any ids that aren't in the catalog
  // (defense-in-depth; readResolvedLayout already filters).
  const visibleIds = order.filter((id) => getWidget(id));
  const openWidget = openWidgetId ? getWidget(openWidgetId) : null;

  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Sidebar
        </h2>
        <Tooltip
          label={isEditing ? "Done editing sidebar" : "Edit sidebar"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => setIsEditing((e) => !e)}
            aria-label={isEditing ? "Done editing sidebar" : "Edit sidebar"}
            className={`p-1 rounded transition-colors ${
              isEditing
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>
      </header>

      <div className="flex-1 p-2 space-y-2">
        {visibleIds.length === 0 && !isEditing && (
          <p className="text-xs text-gray-400 italic px-1">
            No sidebar widgets active. Click the gear to add some.
          </p>
        )}

        {visibleIds.map((id) => {
          const def = getWidget(id);
          if (!def) return null;
          // Customizable PI sidebar (#146, 2026-05-23): render the
          // widget's `SidebarTile` (slim horizontal row) instead of
          // the square `SnapshotTile`. The SidebarTile owns its own
          // click target via the `onClick` prop, so the wrapper's
          // role="button" is removed (avoids duplicate semantics —
          // the inner tile is the real button).
          const Tile = def.SidebarTile;
          return (
            <div
              key={id}
              draggable={isEditing}
              onDragStart={handleDragStart(id)}
              onDragOver={handleDragOver}
              onDrop={handleDrop(id)}
              className={`relative group rounded-md ${
                isEditing ? "cursor-move bg-white border border-gray-200" : ""
              } ${dragId === id ? "opacity-50" : ""}`}
            >
              {isEditing && (
                <Tooltip label={`Remove ${def.title}`} placement="left">
                  <button
                    type="button"
                    aria-label={`Remove ${def.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggle(id);
                    }}
                    className="absolute top-0.5 right-0.5 z-10 p-0.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 bg-white/80 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    data-force-hover-controls-target
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="6" y1="18" x2="18" y2="6" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tile
                widgetId={id}
                onClick={() => {
                  if (isEditing) return;
                  setOpenWidgetId(id);
                }}
              />
            </div>
          );
        })}

        {/* Edit-mode catalog drawer: lists every sidebar-eligible widget
            with a checkbox so the user can add ones they've removed. */}
        {isEditing && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 px-1 mb-1">
              Available widgets
            </p>
            <ul className="space-y-1">
              {sidebarCatalog.map((widget) => {
                const isShown = order.includes(widget.id);
                return (
                  <li key={widget.id}>
                    <button
                      type="button"
                      onClick={() => void handleToggle(widget.id)}
                      className="w-full text-left px-2 py-1.5 rounded text-xs flex items-start gap-2 hover:bg-white"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded border ${
                          isShown
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {isShown ? (
                          <svg
                            width="8"
                            height="8"
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
                      <span className="flex-1 min-w-0 truncate text-gray-700">
                        {widget.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Popup: opens the clicked tile's ExpandedView. Phase C — body
          + title both resolve via the Tool registry so variants of the
          same Tool share a popup chrome label. */}
      {openWidget &&
        (() => {
          const Expanded = resolveExpandedView(openWidget);
          return (
            <SnapshotTilePopup
              title={resolveToolTitle(openWidget)}
              onClose={() => setOpenWidgetId(null)}
            >
              <Expanded surface="sidebar" isEditing={false} />
            </SnapshotTilePopup>
          );
        })()}
    </aside>
  );
}

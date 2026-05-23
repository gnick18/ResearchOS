"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Widget from "./widgets/Widget";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import { visibleCatalog } from "./widgets/types";
import {
  patchSidebarLayout,
  readResolvedLayout,
  toggleSidebarWidget,
} from "@/lib/lab-overview/layout-persistence";
import type { AccountType } from "@/lib/settings/user-settings";
import Tooltip from "@/components/Tooltip";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * the customizable left sidebar widget rail (proposal §3g). Same
 * widget primitive as the canvas; vertical drag instead of free-grid.
 *
 * Reorder is implemented with native HTML5 drag-and-drop on the
 * widget headers. react-grid-layout isn't a great fit for a single-
 * column vertical sort (it's optimized for the 12-col free grid); a
 * dedicated DnD lib (react-beautiful-dnd / framer-motion-reorder)
 * would be heavier than R2 needs. The HTML5 path is sufficient for
 * the "vertical order in a list" case and ships with the platform.
 *
 * Edit mode is local-state (no separate route or modal). The gear
 * button in the rail header toggles between read mode (compact card
 * stack) and edit mode (drag handles + visibility checkboxes for
 * every catalog entry).
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  const catalog = useMemo(() => visibleCatalog(WIDGET_CATALOG, accountType), [accountType]);
  const sidebarCatalog = useMemo(
    () => catalog.filter((w) => w.surface === "sidebar" || w.surface === "both"),
    [catalog],
  );

  // ── Load layout ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await readResolvedLayout(username, catalog);
        if (!cancelled) {
          setOrder(resolved.sidebar.order);
          setHidden(new Set(resolved.sidebar.hidden));
        }
      } catch (err) {
        console.warn("[SidebarWidgetRail] failed to load layout", err);
        if (!cancelled) {
          setOrder([]);
          setHidden(new Set());
        }
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
  const handleDrop = (targetId: string) => () => {
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
    void patchSidebarLayout(username, { order: next, hidden: Array.from(hidden) });
  };

  const handleToggle = useCallback(
    async (widgetId: string) => {
      const next = new Set(hidden);
      let nextOrder = order ?? [];
      if (next.has(widgetId)) {
        next.delete(widgetId);
      } else {
        next.add(widgetId);
      }
      // If the user toggles ON a widget that's not yet in their order,
      // append it (toggleSidebarWidget already handles this disk-side;
      // mirror in local state).
      if (!nextOrder.includes(widgetId)) {
        nextOrder = [...nextOrder, widgetId];
        setOrder(nextOrder);
      }
      setHidden(next);
      await toggleSidebarWidget(username, widgetId);
    },
    [hidden, order, username],
  );

  if (order === null) {
    return (
      <aside className="w-64 border-r border-gray-200 bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
      </aside>
    );
  }

  // Visible widgets (those in `order` and not in `hidden`).
  const visibleIds = order.filter((id) => !hidden.has(id) && getWidget(id));

  return (
    <aside
      className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col"
      data-tour-target="lab-overview-sidebar"
    >
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
          const Body = def.Component;
          return (
            <div
              key={id}
              draggable={isEditing}
              onDragStart={handleDragStart(id)}
              onDragOver={handleDragOver}
              onDrop={handleDrop(id)}
              className={`${isEditing ? "cursor-move" : ""} ${
                dragId === id ? "opacity-50" : ""
              }`}
              style={{ minHeight: 120 }}
            >
              <Widget
                id={id}
                title={def.title}
                isEditing={isEditing}
                surface="sidebar"
                onRemove={() => void handleToggle(id)}
              >
                <Body surface="sidebar" isEditing={isEditing} />
              </Widget>
            </div>
          );
        })}

        {/* Edit-mode catalog drawer: lists every sidebar-eligible widget
            with a checkbox so the user can re-show ones they've hidden. */}
        {isEditing && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 px-1 mb-1">
              Available widgets
            </p>
            <ul className="space-y-1">
              {sidebarCatalog.map((widget) => {
                const isShown = !hidden.has(widget.id) && order.includes(widget.id);
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
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
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
    </aside>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SnapshotTilePopup from "./SnapshotTilePopup";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import { visibleCatalog, widgetHasSurface } from "./widgets/types";
import {
  patchSidebarOrder,
  readResolvedLayout,
  toggleSidebarWidget,
} from "@/lib/lab-overview/layout-persistence";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import {
  resolveExpandedView,
  resolveToolTitle,
} from "@/lib/lab-overview/tool-registry";
import Tooltip from "@/components/Tooltip";

/**
 * Customizable PI sidebar (#146 customizable PI sidebar manager,
 * 2026-05-23): the always-on AppShell sidebar for `account_type ===
 * "lab_head"`. Replaces `<DailyTasksSidebar>` for PIs (except on the
 * carved-out routes — `/calendar` keeps `<CalendarSidebar>`,
 * `/lab-overview` renders its own in-page rail).
 *
 * Behavior mirrors `<SnapshotCanvas>` + the existing
 * `<SidebarWidgetRail>`:
 *   - read sidebar widget order from
 *     `_user_settings.json:lab_overview_layout.widgetOrder.sidebar`
 *   - render each widget's `SidebarTile` in a vertical stack
 *   - click a tile → open `<SnapshotTilePopup>` with the widget's
 *     `ExpandedView` (and a fullscreen toggle in the popup header)
 *   - edit-mode gear toggle reveals drag handles + remove × on each
 *     tile and a "+ Add widget" affordance at the bottom
 *   - reorder via native HTML5 drag-and-drop (single-axis vertical),
 *     single persistence write per drop via `patchSidebarOrder`
 *   - add-widget popover lists every sidebar-eligible widget the
 *     viewer is allowed to see; click toggles add/remove
 *
 * Width is ~256px (matches `<DailyTasksSidebar>`'s width) so the
 * swap-in at the AppShell level is visually clean.
 *
 * Default sidebar widgets when the persisted `widgetOrder.sidebar` is
 * empty: `["sidebar-recent-activity", "sidebar-pi-actions",
 * "sidebar-member-workload"]` per the chip. The standard persistence
 * default in `layout-persistence.ts` already seeds four widgets for a
 * fresh lab head; the explicit fallback below kicks in only when the
 * user has actively emptied the sidebar through the edit gear.
 */
const EMPTY_SIDEBAR_FALLBACK = [
  "sidebar-recent-activity",
  "sidebar-pi-actions",
  "sidebar-member-workload",
] as const;

export default function CustomizableSidebar() {
  const { currentUser } = useCurrentUser();
  const username = currentUser ?? "";
  const accountType = useAccountType(currentUser);

  const [order, setOrder] = useState<string[] | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [openWidgetId, setOpenWidgetId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);

  // Visibility-filtered catalog. Falls back to "member" if account-type
  // is still loading so a brief render before login doesn't crash on a
  // null lookup. The AppShell-level gate ensures this component only
  // mounts when accountType === "lab_head", so the fallback is purely
  // defensive.
  const catalog = useMemo(
    () => visibleCatalog(WIDGET_CATALOG, accountType ?? "member"),
    [accountType],
  );
  const sidebarCatalog = useMemo(
    () => catalog.filter((w) => widgetHasSurface(w, "sidebar")),
    [catalog],
  );

  // ── Load layout ────────────────────────────────────────────────────────
  // Note: the effect deliberately bails out without touching state when
  // there's no signed-in user. The pre-login render path goes through
  // UserLoginScreen / DataSetupScreen and never mounts AppShell's
  // sidebar, so a username-less mount is a transient state that
  // settles within a tick. Calling setState synchronously from the
  // effect body (the previous shape) tripped the
  // `react-hooks/set-state-in-effect` rule for no behavioral benefit.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await readResolvedLayout(username, catalog);
        if (cancelled) return;
        const saved = resolved.widgetOrder.sidebar;
        // Empty-fallback per the chip: when the user has saved an empty
        // sidebar (actively removed everything), seed the three default
        // sidebar widgets. The standard fresh-user path goes through
        // `defaultLabHeadLayout()` which seeds four; this fallback only
        // catches the "actively emptied" case.
        if (saved.length === 0) {
          const fallback = EMPTY_SIDEBAR_FALLBACK.filter((id) =>
            sidebarCatalog.some((w) => w.id === id),
          );
          setOrder([...fallback]);
        } else {
          setOrder(saved);
        }
      } catch (err) {
        console.warn("[CustomizableSidebar] failed to load layout", err);
        if (!cancelled) setOrder([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, catalog, sidebarCatalog]);

  // Close the add-widget popover when the user clicks outside of it.
  useEffect(() => {
    if (!showPalette) return;
    function onDocClick(e: MouseEvent) {
      if (!paletteRef.current) return;
      if (paletteRef.current.contains(e.target as Node)) return;
      setShowPalette(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showPalette]);

  // ── Drag-and-drop reorder (single-axis vertical) ───────────────────────
  // Same pattern as `<SnapshotCanvas>`: setDraggedId on dragstart,
  // preventDefault on dragover, splice on drop, persist once.
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
      try {
        await patchSidebarOrder(username, next);
      } catch (err) {
        console.warn("[CustomizableSidebar] failed to persist sidebar order", err);
      }
    },
    [order, dragId, username],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  // ── Toggle (add / remove) from the palette ─────────────────────────────
  const handleToggle = useCallback(
    async (widgetId: string) => {
      const isShown = order?.includes(widgetId) ?? false;
      const nextOrder = isShown
        ? (order ?? []).filter((id) => id !== widgetId)
        : [...(order ?? []), widgetId];
      setOrder(nextOrder);
      try {
        await toggleSidebarWidget(username, widgetId);
      } catch (err) {
        console.warn("[CustomizableSidebar] failed to toggle widget", err);
      }
    },
    [order, username],
  );

  if (order === null) {
    return (
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
      </aside>
    );
  }

  // Defensive: drop any saved id that no longer exists in the catalog
  // (already filtered by `readResolvedLayout`, but the empty-fallback
  // path bypasses the resolver).
  const visibleIds = order.filter((id) => getWidget(id));
  const openWidget = openWidgetId ? getWidget(openWidgetId) : null;
  const mountedIds = new Set(visibleIds);

  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Sidebar
        </h2>
        <Tooltip
          label={isEditing ? "Done editing" : "Edit sidebar"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => {
              setIsEditing((e) => !e);
              setShowPalette(false);
            }}
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

      <div
        className="flex-1 overflow-y-auto py-2 px-1 space-y-1"
        onDragEnd={handleDragEnd}
      >
        {visibleIds.length === 0 && !isEditing && (
          <p className="text-xs text-gray-400 italic px-2 py-3">
            Your sidebar is empty. Click the gear to add widgets.
          </p>
        )}

        {visibleIds.map((id) => {
          const def = getWidget(id);
          if (!def) return null;
          const Tile = def.SidebarTile;
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
              className={`relative group ${isDragging ? "opacity-40" : ""} ${
                isDragOver ? "ring-2 ring-blue-400 rounded-md" : ""
              } ${isEditing ? "cursor-move" : ""}`}
            >
              {isEditing && (
                <>
                  {/* Drag grip glyph — visible affordance that the row
                      is draggable. Sits on the left edge, doesn't block
                      pointer events on the tile itself. */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs leading-none pl-0.5 pointer-events-none"
                  >
                    ⋮⋮
                  </span>
                  {/* Remove × — top-right, only in edit mode. */}
                  <Tooltip label={`Remove ${def.title}`} placement="left">
                    <button
                      type="button"
                      aria-label={`Remove ${def.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggle(id);
                      }}
                      className="absolute top-0.5 right-0.5 z-10 p-0.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 bg-white/80 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
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
                </>
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
      </div>

      {/* Add-widget affordance at the bottom of the sidebar. Only
          rendered in edit mode so the chrome stays quiet during normal
          use. */}
      {isEditing && (
        <div className="relative border-t border-gray-200 bg-white shrink-0 px-2 py-2">
          <button
            type="button"
            onClick={() => setShowPalette((p) => !p)}
            className="w-full text-left text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1"
            aria-haspopup="dialog"
            aria-expanded={showPalette}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add widget
          </button>

          {showPalette && (
            <div
              ref={paletteRef}
              role="dialog"
              aria-label="Add sidebar widget"
              className="absolute bottom-full left-2 right-2 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg p-1 max-h-72 overflow-auto z-30"
            >
              <p className="text-[10px] uppercase tracking-wide text-gray-400 px-2 py-1">
                Sidebar widgets
              </p>
              {sidebarCatalog.length === 0 ? (
                <p className="text-xs text-gray-400 italic px-2 py-2">
                  No widgets available for your account type.
                </p>
              ) : (
                sidebarCatalog.map((widget) => {
                  const isMounted = mountedIds.has(widget.id);
                  return (
                    <button
                      key={widget.id}
                      type="button"
                      onClick={() => void handleToggle(widget.id)}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 flex items-start gap-2"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded border flex-shrink-0 ${
                          isMounted
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {isMounted ? (
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
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {widget.title}
                        </p>
                        {widget.description && (
                          <p className="text-[10px] text-gray-500 line-clamp-2">
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
      )}

      {/* Popup: opens the clicked tile's ExpandedView. Reuses the same
          `<SnapshotTilePopup>` shell the canvas + lab-overview rail
          use — never duplicate. Phase C — body + title both resolve via
          the Tool registry so variants of the same Tool share a popup. */}
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

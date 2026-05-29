"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Widget from "./widgets/Widget";
import WidgetCard from "./WidgetCard";
import SnapshotTilePopup from "./SnapshotTilePopup";
import { WIDGET_CATALOG, getWidget } from "./widgets/registry";
import {
  visibleCatalog,
  widgetHasSurface,
  type WidgetDefinition,
} from "./widgets/types";
import {
  addCanvasWidget,
  addDashboardWidget,
  addHomeCanvasWidget,
  dashboardSurfaceFor,
  patchCanvasOrder,
  patchDashboardCanvasOrder,
  patchDashboardWidgetConfig,
  patchHomeCanvasOrder,
  patchHomeWidgetConfig,
  patchWidgetConfig,
  readResolvedDashboardLayout,
  readResolvedHomeLayout,
  readResolvedLayout,
  removeCanvasWidget,
  removeDashboardWidget,
  removeHomeCanvasWidget,
  resetDashboardLayout,
  resetHomeLayout,
  resetLayout,
} from "@/lib/lab-overview/layout-persistence";
import {
  resolveExpandedView,
  resolveToolTitle,
} from "@/lib/lab-overview/tool-registry";
import {
  isWidgetConfigEmpty,
  type LabOverviewLayout,
  type WidgetInstanceConfig,
} from "@/lib/settings/user-settings";
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
 *
 * Home canvas migration (Home canvas migration manager, 2026-05-23):
 * `SnapshotCanvas` is now reusable across pages via the `surface` prop.
 *   - `surface="canvas"` → /lab-overview, reads/writes `lab_overview_layout`
 *   - `surface="home"`   → /home,         reads/writes `home_layout`
 * Each surface has its own catalog filter, mutators, and default
 * layout — wired below via per-surface adapter objects so the
 * component body stays a single render path.
 */
export interface SnapshotCanvasProps {
  username: string;
  accountType: AccountType;
  /**
   * Which surface this canvas instance represents. Controls the catalog
   * filter (canvas-eligible vs home-eligible widgets), the persistence
   * field, and the default layout. Defaults to `"canvas"` for back-compat
   * with the existing /lab-overview mount.
   *
   * Dashboard unification (dashboard-unification build, 2026-05-29):
   * `"dashboard"` is the unified surface mounted at "/" for every account
   * type. It reads/writes the single `dashboard_layout` field and filters
   * the catalog by an ACCOUNT-AWARE surface key (lab_head → "canvas",
   * member/solo → "home"), so a PI keeps the dense lab widgets while a
   * member keeps the personal set. The legacy `"canvas"` / `"home"`
   * surfaces remain for any back-compat mount.
   */
  surface?: "canvas" | "home" | "dashboard";
  /** Reset-confirmation copy. Defaults to the lab-overview wording.
   *  Home uses a different label since the user perceives it as a
   *  different "page". */
  resetConfirmMessage?: string;
  /** Optional empty-state copy shown when the canvas has zero widgets.
   *  Defaults to a generic "no widgets pinned" message. */
  emptyStateMessage?: string;
  /** Optional content rendered at the LEFT of the toolbar row. Use for a
   *  section label or title so it sits on the same row as the action
   *  buttons instead of stacking above. */
  toolbarLeft?: React.ReactNode;
  /** Optional buttons rendered ALONGSIDE the built-in toolbar buttons
   *  (typically a `<ToolsLauncher>`). Lets the consumer fold its launcher
   *  into the same row as Add widget / Edit layout / Reset. */
  toolbarExtras?: React.ReactNode;
}

interface SurfaceAdapter {
  /** Read the resolved layout for this surface. */
  readResolvedLayout: (
    username: string,
    catalog: WidgetDefinition[],
  ) => Promise<LabOverviewLayout>;
  /** Persist a new canvas order. */
  patchCanvasOrder: (username: string, order: string[]) => Promise<void>;
  /** Add a widget. */
  addCanvasWidget: (username: string, w: WidgetDefinition) => Promise<void>;
  /** Remove a widget. */
  removeCanvasWidget: (username: string, id: string) => Promise<void>;
  /** Reset to default. */
  resetLayout: (username: string) => Promise<void>;
  /**
   * Persist a per-instance widget config to THIS surface's settings
   * field. Project-widgets family (2026-05-29): wired for both surfaces
   * now (canvas → `lab_overview_layout`, home → `home_layout`) so the
   * Projects Overview My/Lab toggle persists wherever it is changed.
   * Previously only the canvas had a config mutator.
   */
  patchWidgetConfig: (
    username: string,
    widgetId: string,
    config: WidgetInstanceConfig | null,
  ) => Promise<void>;
  /**
   * Which surface key to read from `visibleCatalog` / `widgetHasSurface`.
   * A function of the viewer's account type so the unified dashboard can
   * resolve an ACCOUNT-AWARE key (lab_head → "canvas", member/solo →
   * "home") while the legacy adapters return a constant.
   */
  surfaceKey: (accountType: AccountType) => "canvas" | "home";
}

const CANVAS_ADAPTER: SurfaceAdapter = {
  readResolvedLayout,
  patchCanvasOrder,
  addCanvasWidget,
  removeCanvasWidget,
  resetLayout,
  patchWidgetConfig,
  surfaceKey: () => "canvas",
};

const HOME_ADAPTER: SurfaceAdapter = {
  readResolvedLayout: readResolvedHomeLayout,
  patchCanvasOrder: patchHomeCanvasOrder,
  addCanvasWidget: addHomeCanvasWidget,
  removeCanvasWidget: removeHomeCanvasWidget,
  resetLayout: resetHomeLayout,
  patchWidgetConfig: patchHomeWidgetConfig,
  surfaceKey: () => "home",
};

// Dashboard unification (dashboard-unification build, 2026-05-29): the
// unified "/" surface. ONE persistence field (`dashboard_layout`); the
// catalog surface key is account-aware so a PI sees the dense lab widgets
// and a member sees the personal home set.
const DASHBOARD_ADAPTER: SurfaceAdapter = {
  readResolvedLayout: readResolvedDashboardLayout,
  patchCanvasOrder: patchDashboardCanvasOrder,
  addCanvasWidget: addDashboardWidget,
  removeCanvasWidget: removeDashboardWidget,
  resetLayout: resetDashboardLayout,
  patchWidgetConfig: patchDashboardWidgetConfig,
  surfaceKey: dashboardSurfaceFor,
};

/**
 * Widget selector redesign (widget-selector bot, 2026-05-29): group the
 * palette catalog by Tool family (`toolId`) so a flat 12-item scroll
 * becomes a handful of scannable clusters (the three `purchases` variants
 * cluster, the `daily-tasks` variants cluster, etc.). Presentation-only:
 * it reads `toolId` which already exists on every entry and never widens
 * visibility. Single-entry families render inside an "Other widgets"
 * catch-all so we don't print a one-card section header per standalone
 * widget. Group + within-group order follow first-appearance in the
 * (already account/surface-filtered) catalog so the layout is stable.
 */
interface WidgetGroup {
  toolId: string;
  label: string;
  widgets: WidgetDefinition[];
}

function groupCatalogByTool(catalog: WidgetDefinition[]): WidgetGroup[] {
  const byTool = new Map<string, WidgetDefinition[]>();
  for (const w of catalog) {
    const list = byTool.get(w.toolId);
    if (list) list.push(w);
    else byTool.set(w.toolId, [w]);
  }
  const multi: WidgetGroup[] = [];
  const singletons: WidgetDefinition[] = [];
  for (const [toolId, widgets] of byTool) {
    if (widgets.length > 1) {
      // A multi-variant family: header reads off the shared family. Use
      // the shortest title as the family label so "Lab purchases" labels
      // the purchases cluster rather than "Pending purchase approvals".
      const label = widgets
        .map((w) => w.title)
        .reduce((a, b) => (b.length < a.length ? b : a));
      multi.push({ toolId, label, widgets });
    } else {
      singletons.push(widgets[0]);
    }
  }
  if (singletons.length > 0) {
    multi.push({ toolId: "__other__", label: "Other widgets", widgets: singletons });
  }
  return multi;
}

export default function SnapshotCanvas({
  username,
  accountType,
  surface = "canvas",
  resetConfirmMessage,
  emptyStateMessage,
  toolbarLeft,
  toolbarExtras,
}: SnapshotCanvasProps) {
  const adapter =
    surface === "dashboard"
      ? DASHBOARD_ADAPTER
      : surface === "home"
        ? HOME_ADAPTER
        : CANVAS_ADAPTER;
  // The unified dashboard carries the same `home-widget-*` tour anchors
  // the §6.2b walkthrough phase targets (the tour was authored against
  // the old /home canvas; the unified dashboard inherits those steps).
  const usesHomeTourAnchors = surface === "home" || surface === "dashboard";
  // Catalog surface key for visibility filtering — account-aware for the
  // dashboard surface, constant for the legacy surfaces.
  const surfaceKey = adapter.surfaceKey(accountType);
  const [isEditing, setIsEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  // Per-instance widget config keyed by widget id (weekly-goals widget,
  // 2026-05-29). Loaded from the persisted layout; passed down to each
  // tile + the popup body. Only the /lab-overview canvas persists edits
  // today (the /home surface has no `patchWidgetConfig` variant), so the
  // single-member pin is a PI-dashboard feature.
  const [widgetConfig, setWidgetConfig] = useState<
    Record<string, WidgetInstanceConfig>
  >({});
  const [showPalette, setShowPalette] = useState(false);
  const [openWidgetId, setOpenWidgetId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Widget per-surface visibility manager (2026-05-25): pass the canvas
  // adapter's surface key so per-surface lab-head carve-outs resolve
  // for /lab-overview canvas vs /home canvas independently (e.g.
  // sidebar-upcoming opts into the home canvas for lab heads but is
  // sidebar-carved-out elsewhere).
  const catalog = useMemo(
    () => visibleCatalog(WIDGET_CATALOG, accountType, surfaceKey),
    [accountType, surfaceKey],
  );
  const canvasCatalog = useMemo(
    () => catalog.filter((w) => widgetHasSurface(w, surfaceKey)),
    [catalog, surfaceKey],
  );
  // Widget selector redesign (widget-selector bot, 2026-05-29): the card
  // grid is grouped by Tool family. Derived from `canvasCatalog` so the
  // account/surface gating is inherited verbatim (no separate visibility
  // path).
  const catalogGroups = useMemo(
    () => groupCatalogByTool(canvasCatalog),
    [canvasCatalog],
  );

  // Esc closes the palette (SELECTOR_REDESIGN §5 accessibility; the old
  // palette relied on outside-click only). Only bound while open.
  useEffect(() => {
    if (!showPalette) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPalette]);

  // ── Load initial layout ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await adapter.readResolvedLayout(username, catalog);
        if (!cancelled) {
          setOrder(resolved.widgetOrder.canvas);
          setWidgetConfig(resolved.widgetConfig ?? {});
        }
      } catch (err) {
        console.warn("[SnapshotCanvas] failed to load layout", err);
        if (!cancelled) {
          setOrder([]);
          setWidgetConfig({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, catalog, adapter]);

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
        await adapter.patchCanvasOrder(username, next);
      } catch (err) {
        console.warn("[SnapshotCanvas] failed to persist canvas order", err);
      }
    },
    [order, dragId, username, adapter],
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
      await adapter.addCanvasWidget(username, def);
      const resolved = await adapter.readResolvedLayout(username, catalog);
      setOrder(resolved.widgetOrder.canvas);
      setWidgetConfig(resolved.widgetConfig ?? {});
    },
    [username, catalog, adapter],
  );

  const handleRemoveWidget = useCallback(
    async (widgetId: string) => {
      await adapter.removeCanvasWidget(username, widgetId);
      const resolved = await adapter.readResolvedLayout(username, catalog);
      setOrder(resolved.widgetOrder.canvas);
      setWidgetConfig(resolved.widgetConfig ?? {});
    },
    [username, catalog, adapter],
  );

  // Persist a per-instance config change for a placed widget (weekly-goals
  // widget, 2026-05-29). Project-widgets family (2026-05-29): now wired on
  // BOTH surfaces via `adapter.patchWidgetConfig` (canvas →
  // lab_overview_layout, home → home_layout) so the Projects Overview
  // My/Lab toggle persists on /home too. The single-member pin
  // (TraineeNotes) remains a PI-dashboard affordance because that widget
  // is canvas-only. Optimistically updates local state so the popup
  // reflects the new mode without a re-read.
  const handleConfigChange = useCallback(
    async (widgetId: string, config: WidgetInstanceConfig | null) => {
      setWidgetConfig((prev) => {
        const next = { ...prev };
        if (isWidgetConfigEmpty(config)) delete next[widgetId];
        else next[widgetId] = config as WidgetInstanceConfig;
        return next;
      });
      try {
        await adapter.patchWidgetConfig(username, widgetId, config);
      } catch (err) {
        console.warn("[SnapshotCanvas] failed to persist widget config", err);
      }
    },
    [username, adapter],
  );

  const defaultResetMsg =
    surface === "dashboard"
      ? "Reset your dashboard to default? Your widget order will be lost."
      : surface === "home"
        ? "Reset Home layout to default? Your widget order will be lost."
        : "Reset Lab Overview layout to default? Your widget order will be lost.";
  const resetMsg = resetConfirmMessage ?? defaultResetMsg;

  const handleReset = useCallback(async () => {
    if (!window.confirm(resetMsg)) {
      return;
    }
    await adapter.resetLayout(username);
    const resolved = await adapter.readResolvedLayout(username, catalog);
    setOrder(resolved.widgetOrder.canvas);
    setWidgetConfig(resolved.widgetConfig ?? {});
  }, [username, catalog, adapter, resetMsg]);

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
      {/* Toolbar. `toolbarLeft` slot lets the consumer drop a section title
          on the same row as the action buttons so we don't stack two
          headers (the awkward shape Grant flagged 2026-05-24). */}
      <div className="flex items-center justify-between gap-2 relative flex-wrap">
        <div className="flex items-center gap-2 min-w-0">{toolbarLeft}</div>
        <div className="flex items-center gap-2 flex-wrap">
        {toolbarExtras}
        <Tooltip label="Add a widget to the canvas" placement="bottom">
          <button
            type="button"
            onClick={() => {
              // UI affordance fix (break-bot Bug 3, 2026-05-25): clicking
              // "+ Add widget" while the canvas is locked auto-enters edit
              // mode FIRST so the button never silently no-ops. Literal
              // Reader flagged the prior behavior as a broken-affordance
              // bug ("button promises action, does nothing").
              if (!isEditing) setIsEditing(true);
              setShowPalette((p) => !p);
            }}
            // §6.2b Home widgets walkthrough anchor (home widgets
            // surface-prep manager, 2026-05-25). Stamps only on the
            // /home mount so the /lab-overview canvas isn't affected.
            // See targets.ts `homeWidgetAddButton`.
            data-tour-target={
              usesHomeTourAnchors ? "home-widget-add-button" : undefined
            }
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
            // §6.2b Home widgets walkthrough anchor (§6.2b R3 fix
            // manager, 2026-05-25). Stamps only on the /home mount so
            // the §6.2b exit step's onEnter can find this button and
            // click it when the canvas is still in edit mode (Step 4
            // left it on). Lab-overview canvas keeps the unattributed
            // shape so its onboarding paths aren't affected.
            data-tour-target={
              usesHomeTourAnchors ? "home-widget-edit-toggle" : undefined
            }
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
        </div>

        {showPalette && (
          // Widget selector redesign (widget-selector bot, 2026-05-29):
          // the flat title + checkbox dropdown is replaced by a rich card
          // grid (SELECTOR_REDESIGN §3). Each card carries a live
          // SnapshotTile preview (lazily mounted, static fallback). The
          // popover grows from 288px to a wider 2-column grid, anchored to
          // the button and capped to 70vh scroll, still a popup, not a
          // route. Account/surface gating is inherited verbatim from
          // `canvasCatalog`; grouping is presentation-only.
          <div
            // §6.2b Home widgets walkthrough anchor (home widgets
            // surface-prep manager, 2026-05-25). Catalog root stamps
            // only on the /home mount.
            data-tour-target={
              usesHomeTourAnchors ? "home-widget-catalog" : undefined
            }
            className="absolute top-full right-0 mt-2 w-[min(40rem,calc(100vw-2rem))] bg-white border border-gray-200 rounded-xl shadow-lg z-30 max-h-[70vh] overflow-auto"
            role="dialog"
            aria-label="Add widget palette"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-100 bg-white/95 px-3 py-2 backdrop-blur">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Add a widget
              </p>
              <Tooltip label="Close" placement="left">
                <button
                  type="button"
                  aria-label="Close add widget palette"
                  onClick={() => setShowPalette(false)}
                  className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="6" y1="18" x2="18" y2="6" />
                  </svg>
                </button>
              </Tooltip>
            </div>

            {canvasCatalog.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs italic text-gray-400">
                No widgets available for your account type.
              </p>
            ) : (
              <div className="space-y-4 bg-gray-50/40 p-3">
                {catalogGroups.map((group) => (
                  <section key={group.toolId}>
                    {catalogGroups.length > 1 && (
                      <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        {group.label}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {group.widgets.map((widget) => (
                        <WidgetCard
                          key={widget.id}
                          widget={widget}
                          isMounted={mountedIds.has(widget.id)}
                          onToggle={() =>
                            mountedIds.has(widget.id)
                              ? handleRemoveWidget(widget.id)
                              : handleAddWidget(widget.id)
                          }
                          // §6.2b Home widgets walkthrough anchor (home
                          // widgets surface-prep manager, 2026-05-25).
                          // Stamped on the card root so the step body's
                          // prefix / exact-id selectors still resolve to
                          // the equivalent new node. Stamps only on the
                          // /home (and unified dashboard) mount.
                          tourTarget={
                            usesHomeTourAnchors
                              ? `home-widget-catalog-item-${widget.id}`
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty-state copy when the user has removed every widget.
          Home canvas migration (2026-05-23): a brand-new home user
          starts with the 4 default widgets and can remove them — if
          they remove all four, this hint replaces the empty grid so
          the page doesn't read as broken. */}
      {order.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">
            {emptyStateMessage ??
              "No widgets pinned. Use Add widget to bring some back."}
          </p>
        </div>
      )}

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
          // §6.2b Home widgets walkthrough anchor (home widgets
          // surface-prep manager, 2026-05-25). On /home the tile root
          // absorbs the click-to-expand (no dedicated expand-button
          // affordance exists), so the per-tile `home-widget-tile-<id>`
          // attribute IS the click target for both the tile-anatomy
          // demo (click to expand) and the reorder demo (drag-handle
          // grab via its child header). Step bodies select via
          // `[data-tour-target^='home-widget-tile-']` for the prefix
          // case, or the exact id when they need a specific widget.
          // The `homeWidgetExpandButton` constant in targets.ts is
          // documented as resolving to the SAME node (no separate
          // attribute, single-source-of-truth selector per node).
          const tourTileTarget =
            usesHomeTourAnchors ? `home-widget-tile-${id}` : undefined;
          return (
            <div
              key={id}
              draggable={isEditing}
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, id)}
              data-tour-target={tourTileTarget}
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
                tourSurface={usesHomeTourAnchors ? "home" : undefined}
                // Lab overview PI tooltips (Chip B, 2026-05-25): the
                // help-badge copy is a PI-dashboard affordance. On the
                // unified dashboard (dashboard-unification build,
                // 2026-05-29) show it for the lab_head canvas surface and
                // skip it for the personal home surface, preserving the
                // original "/lab-overview only" scoping. The legacy /home
                // mount stays badge-free.
                helpText={surfaceKey === "canvas" ? def.helpText : undefined}
              >
                <Tile surface="canvas" config={widgetConfig[id]} />
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
          // Per-instance config (weekly-goals widget, 2026-05-29): pass the
          // placed widget's config + a persist callback to the popup body.
          // Project-widgets family (2026-05-29): `onConfigChange` is now
          // wired on BOTH surfaces (each adapter has its own
          // `patchWidgetConfig`), so the Projects Overview My/Lab toggle
          // persists on /home as well as /lab-overview.
          const openId = openWidget.id;
          return (
            <SnapshotTilePopup
              title={resolveToolTitle(openWidget)}
              onClose={() => setOpenWidgetId(null)}
            >
              <Expanded
                surface="canvas"
                isEditing={false}
                config={widgetConfig[openId]}
                onConfigChange={(cfg) => handleConfigChange(openId, cfg)}
              />
            </SnapshotTilePopup>
          );
        })()}
    </div>
  );
}

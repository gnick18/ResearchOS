/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * widget-catalog types. Every widget on the Lab Overview canvas (and
 * customizable sidebar) is described by one `WidgetDefinition`. The
 * canvas and the sidebar both consume the same catalog — the `surface`
 * field gates which area a given widget can mount into.
 *
 * The catalog is intentionally data-shaped (an array of definitions),
 * not a class hierarchy: a new widget is one entry in
 * `frontend/src/components/lab-overview/widgets/registry.ts`. The
 * registry is a single source of truth for IDs (used as layout keys in
 * `_user_settings.json:lab_overview_layout`) and visibility rules.
 *
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * a widget definition now ships TWO components, not one:
 *   - `SnapshotTile`: the small placeholder rendered on the snapshot
 *     canvas (and inside the sidebar rail). Tiny, low-info-density,
 *     designed to read at a glance. Click → popup with the expanded
 *     view. Phase B replaces each tile with a unique design; Phase A
 *     uses the shared `<StatTile>` template (icon + label + headline
 *     stat).
 *   - `ExpandedView`: the rich widget body that previously rendered
 *     directly on the canvas. Now lives behind the popup, opened from
 *     the snapshot tile.
 *
 * Customizable PI sidebar (#146 customizable PI sidebar manager,
 * 2026-05-23): a widget definition now ships a THIRD component, the
 * `SidebarTile`. The customizable sidebar (for lab_head accounts) is a
 * narrow vertical column (~256px wide) — a different shape than the
 * square snapshot canvas tile — so each widget gets a dedicated
 * `SidebarTile` that can show different info than its `SnapshotTile`.
 *   - `SnapshotTile`: square card on the canvas. Icon, label, headline
 *     stat stacked vertically (the `<StatTile>` template).
 *   - `SidebarTile`: narrow horizontal row in the sidebar. Icon, label,
 *     stat aligned in a single slim band (the `<SidebarStatTile>`
 *     template). Phase B redesigns each per-widget if a unique layout
 *     is desired.
 *   - `ExpandedView`: unchanged — the rich body that opens in the
 *     popup from either tile.
 *
 * The two tile views can share per-widget data because React Query
 * dedupes by query key — both SnapshotTile and SidebarTile call the
 * widget's existing data hooks and the cache delivers one fetch.
 *
 * Visibility model:
 *   - `memberVisible: false` → the widget is hidden from the catalog
 *     and from rendered layouts when the active user is NOT a lab_head.
 *     A non-PI's saved layout that somehow references this id is
 *     dropped at read time (the persistence reader filters by catalog).
 *   - `memberVisible: true`  → every lab member can mount it.
 *   - PIs always see every catalog entry (no separate `piVisible` field).
 */
import type { ComponentType } from "react";
import type { AccountType } from "@/lib/settings/user-settings";

/** Which area(s) a widget can mount into. Most widgets pick exactly
 *  one; sidebar widgets are vertical-only by design, canvas widgets
 *  free-grid. A widget marked `"both"` is allowed in either surface
 *  but its default-layout entry still goes through the area-specific
 *  default-layout config (see `defaults.ts`). */
export type WidgetSurface = "canvas" | "sidebar" | "both";

/** Props passed to a widget's `SnapshotTile`. Snapshot tiles are
 *  click-to-open: they don't get edit-mode chrome (the canvas owns
 *  drag handles + the remove button on the wrapper). They DO need to
 *  know their surface so a wider canvas tile can show a slightly
 *  richer headline than the narrow sidebar variant. */
export interface SnapshotTileProps {
  surface: "canvas" | "sidebar";
}

/** Props passed to a widget's `SidebarTile`. The sidebar tile is the
 *  customizable-sidebar (lab_head only) variant of a widget. It lives
 *  in a narrow vertical column and click-opens the same popup the
 *  snapshot tile does. The prop shape is intentionally distinct from
 *  `SnapshotTileProps` so the two surfaces can evolve independently
 *  (Phase B may add sidebar-specific props like a density hint without
 *  perturbing snapshot tiles). For Phase A, both surfaces share their
 *  per-widget data hooks via React Query dedupe. */
export interface SidebarTileProps {
  /** Stable widget id from the registry. Used for telemetry, drag
   *  keys, and click targets. */
  widgetId: string;
  /** Called when the tile is clicked. The sidebar surface owns the
   *  popup that mounts the widget's `ExpandedView`; the tile just
   *  signals user intent to open. */
  onClick: () => void;
}

/** Props passed to a widget's `ExpandedView`. The expanded view is the
 *  same body that previously rendered directly on the canvas — every
 *  widget already takes the same shape; we keep the prop signature
 *  identical so widgets can re-export their existing default export
 *  as `ExpandedView` without code change. */
export interface ExpandedViewProps {
  /** True while the user is in Edit-layout mode for the widget's
   *  surface. Widgets typically only need this to suppress in-widget
   *  interactions that would conflict with drag. The popup itself
   *  isn't part of the canvas drag flow (it opens on top), so this
   *  is effectively always `false` for expanded-view consumers, but
   *  we keep the prop in the signature for forward-compat with any
   *  pre-Phase-A widget body that already wired it in. */
  isEditing?: boolean;
  /** The surface this widget is currently mounted in. Useful for
   *  layout-aware bodies (a sidebar variant might suppress whitespace
   *  the canvas variant uses). */
  surface: "canvas" | "sidebar";
}

/** Back-compat type alias: existing widget bodies are typed against
 *  the original `WidgetProps`. Kept so the existing `ExpandedView`
 *  exports type-check without changing every widget's signature. */
export type WidgetProps = ExpandedViewProps;

export interface WidgetDefaultLayout {
  /** Default canvas size in grid units (12-col lg grid). Ignored for
   *  sidebar-only widgets.
   *
   *  Phase A snapshot canvas: the canvas is a 2-column CSS grid of
   *  snapshot tiles, not a free-grid. `w`/`h` are kept on the
   *  definition for two reasons:
   *    1. they still seed the layout migration's append-at-bottom
   *       logic (sort y ASC, x ASC) so existing user layouts upgrade
   *       cleanly without losing widget visibility,
   *    2. Phase B may surface per-widget tile sizing (single-col vs
   *       double-col span); leaving the fields in the type keeps the
   *       upgrade path open without a registry-shape change. */
  w: number;
  h: number;
  /** Optional minimum size guard. Unused on the snapshot canvas but
   *  retained for the same forward-compat reason as `w`/`h`. */
  minW?: number;
  minH?: number;
}

export interface WidgetDefinition {
  /** Canonical id. Used as layout map key + telemetry. Stable across
   *  catalog churn — renaming a widget requires migration code, not a
   *  silent id swap. */
  id: string;
  /** Human label shown in the catalog drawer + the widget header. */
  title: string;
  /** One-line description shown in the "+ Add widget" catalog drawer. */
  description?: string;
  /**
   * Phase C (Tools refactor manager, 2026-05-23): the Tool this widget
   * is a tile-variant of. The popup body is looked up via the Tool
   * registry by this id, so multiple widget variants of the same tool
   * open the SAME popup.
   *
   * Example: `lab-purchases`, `lab-purchases-burn-rate`, and
   * `lab-purchases-pending-count` are three widget variants whose
   * `toolId` is all `"purchases"`. Click any of them, the LabPurchases
   * 4-tab popup opens.
   *
   * Required. A catalog entry whose `toolId` doesn't match a registered
   * Tool is a registry-shape bug: `resolveExpandedView` renders a clear
   * diagnostic placeholder rather than crashing the surface.
   * (Back-compat removal manager, 2026-05-23: dropped the per-widget
   * `ExpandedView` fallback field; the Tool registry is now the single
   * source of truth.)
   */
  toolId: string;
  /**
   * Phase C: the variant slug within a Tool. Used for telemetry +
   * launcher tile chrome. Defaults to the widget's `id` if omitted (so
   * single-variant tools don't need to repeat themselves). Two widget
   * entries with the same toolId MUST have different variantIds.
   */
  variantId?: string;
  /** The snapshot-tile component. Renders inside the snapshot canvas
   *  and the sidebar rail. Click opens the popup with the Tool's
   *  ExpandedView (resolved by `toolId`). */
  SnapshotTile: ComponentType<SnapshotTileProps>;
  /** The sidebar-tile component. Renders inside the lab_head
   *  `CustomizableSidebar` (and any other narrow vertical rail). Shape
   *  is distinct from `SnapshotTile`, slim horizontal row vs square
   *  card. Click opens the same popup the snapshot tile does. Added
   *  2026-05-23 by #146 customizable PI sidebar manager; the registry
   *  will eventually require this for every entry once Phase B
   *  per-widget designs land. */
  SidebarTile: ComponentType<SidebarTileProps>;
  /** Default sizing on the free-grid canvas, retained for the layout
   *  migration's append-at-bottom logic + Phase B forward-compat. */
  defaultLayout: WidgetDefaultLayout;
  /** Which surface(s) the widget is allowed to mount on. */
  surface: WidgetSurface;
  /** Allow this widget into a regular member's catalog? `false` → PI only. */
  memberVisible: boolean;
  /**
   * Allow this widget into a lab_head's catalog? Default `true`.
   *
   * `false` is the carve-out for widgets that are technically functional
   * for a PI but actively unwanted in the PI surface (e.g. the
   * sidebar-overdue / sidebar-today / sidebar-upcoming task list
   * widgets — they show the PI's personal task counts, but on the PI
   * sidebar they read as a "what does the lab still have open" prompt
   * that nudges micromanagement. PIs get personal task signals via
   * DailyTasksWidget instead). Grant 2026-05-23 feedback.
   *
   * The filter is enforced by `visibleCatalog`, so both the add-widget
   * palette + any persisted layout pointing at the widget gets silently
   * dropped from the PI surface. Member surface unaffected.
   */
  labHeadVisible?: boolean;
}

/**
 * Pure helper: filter a catalog to the entries a given account type is
 * allowed to see. Used by both the catalog drawer (so non-PI users
 * never see lab-head-only entries) and the persistence reader (so a
 * non-PI's stored layout pointing at a PI widget is silently dropped).
 *
 * `labHeadVisible: false` is the opposite carve-out: a member-pinned
 * widget that should NOT auto-bleed into a PI surface when the user
 * upgrades to lab_head.
 */
export function visibleCatalog(
  catalog: WidgetDefinition[],
  accountType: AccountType,
): WidgetDefinition[] {
  if (accountType === "lab_head") {
    return catalog.filter((w) => w.labHeadVisible !== false);
  }
  return catalog.filter((w) => w.memberVisible);
}

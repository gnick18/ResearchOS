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
  /** The snapshot-tile component. Renders inside the snapshot canvas
   *  and the sidebar rail. Click opens the popup with `ExpandedView`. */
  SnapshotTile: ComponentType<SnapshotTileProps>;
  /** The expanded-view component. Renders inside the popup shell. */
  ExpandedView: ComponentType<ExpandedViewProps>;
  /** Default sizing on the free-grid canvas — retained for the layout
   *  migration's append-at-bottom logic + Phase B forward-compat. */
  defaultLayout: WidgetDefaultLayout;
  /** Which surface(s) the widget is allowed to mount on. */
  surface: WidgetSurface;
  /** Allow this widget into a regular member's catalog? `false` → PI only. */
  memberVisible: boolean;
}

/**
 * Pure helper: filter a catalog to the entries a given account type is
 * allowed to see. Used by both the catalog drawer (so non-PI users
 * never see lab-head-only entries) and the persistence reader (so a
 * non-PI's stored layout pointing at a PI widget is silently dropped).
 */
export function visibleCatalog(
  catalog: WidgetDefinition[],
  accountType: AccountType,
): WidgetDefinition[] {
  if (accountType === "lab_head") return catalog;
  return catalog.filter((w) => w.memberVisible);
}

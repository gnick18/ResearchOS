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

export interface WidgetProps {
  /** True while the user is in Edit-layout mode for the widget's
   *  surface. Widgets typically only need this to suppress in-widget
   *  interactions that would conflict with drag (e.g. a comment row
   *  shouldn't navigate when the user is mid-drag). The frame already
   *  shows the drag handle + remove button itself; widget bodies don't
   *  need to re-render those affordances. */
  isEditing?: boolean;
  /** The surface this widget is currently mounted in. Useful for
   *  layout-aware bodies (a sidebar variant might suppress whitespace
   *  the canvas variant uses). */
  surface: "canvas" | "sidebar";
}

export interface WidgetDefaultLayout {
  /** Default canvas size in grid units (12-col lg grid). Ignored for
   *  sidebar-only widgets. */
  w: number;
  h: number;
  /** Optional minimum size guard so a widget body doesn't break when
   *  the user drags a corner inward. */
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
  /** The widget body. Mounted inside the standard `<Widget>` frame. */
  Component: ComponentType<WidgetProps>;
  /** Default sizing on the free-grid canvas. */
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

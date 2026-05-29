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
import type {
  AccountType,
  WidgetInstanceConfig,
} from "@/lib/settings/user-settings";

/** Legacy single-surface field (kept for back-compat — see `surfaces`
 *  below for the new model). Pre-home-canvas migration, every widget
 *  declared exactly one surface or `"both"`. Home canvas migration
 *  (2026-05-23): replaced by the multi-surface `surfaces` map; the
 *  `surface` field is kept on the type so older catalog entries
 *  type-check while the migration rolls out. Consumers should read
 *  `widget.surfaces.canvas|sidebar|home` (via `widgetHasSurface`) — the
 *  legacy `surface` field is translated by the helper for any entry
 *  that hasn't been ported yet. */
export type WidgetSurface = "canvas" | "sidebar" | "both";

/** Which surface(s) a widget is allowed to mount on. Home canvas
 *  migration (Home canvas migration manager, 2026-05-23): decoupled
 *  surface from a single-string enum so a widget can independently
 *  opt into the lab-overview canvas, the sidebar rail, AND the new
 *  home canvas without needing a `"canvas-or-sidebar-or-home"` cartesian
 *  product enum.
 *
 *  Conceptual model:
 *    - `canvas`  → the /lab-overview snapshot canvas (PI dashboard)
 *    - `sidebar` → the customizable sidebar rail (in-page on
 *      /lab-overview, AppShell-level for lab heads on other routes)
 *    - `home`    → the new /home widget canvas (every user)
 *
 *  Existing widgets that haven't migrated still carry the legacy
 *  `surface` field. The `widgetHasSurface` helper translates either
 *  shape, so consumers don't need to care which one the catalog
 *  entry uses. */
export interface WidgetSurfaces {
  canvas?: boolean;
  sidebar?: boolean;
  /** Home canvas migration (2026-05-23): widgets that should appear
   *  in the /home page's customizable canvas. Independent from
   *  `canvas` (which targets /lab-overview only) so a PI dashboard
   *  widget like Metrics can stay lab-overview-only while
   *  announcements / comments / lab-activity opt into both. */
  home?: boolean;
}

/** Pure helper: does this widget definition allow `target` as a mount
 *  surface? Reads the new `surfaces` map first; falls back to the
 *  legacy `surface` string for catalog entries that haven't been
 *  ported. The legacy `"both"` value maps to canvas + sidebar (its
 *  original meaning) but NOT home (home is opt-in via the new
 *  `surfaces.home` field — never auto-inferred from `"both"`).
 *
 *  This is the canonical way for consumers (canvas / sidebar / home
 *  filters, palette renderers, etc.) to check surface eligibility.
 *  Direct reads of `widget.surface` or `widget.surfaces` break the
 *  back-compat path. */
export function widgetHasSurface(
  widget: { surface?: WidgetSurface; surfaces?: WidgetSurfaces },
  target: "canvas" | "sidebar" | "home",
): boolean {
  if (widget.surfaces) {
    return widget.surfaces[target] === true;
  }
  if (!widget.surface) return false;
  if (target === "home") {
    // The legacy `surface` field never described /home eligibility;
    // home is opt-in via the new `surfaces.home` field only.
    return false;
  }
  if (widget.surface === target) return true;
  if (widget.surface === "both" && (target === "canvas" || target === "sidebar")) {
    return true;
  }
  return false;
}

/** Props passed to a widget's `SnapshotTile`. Snapshot tiles are
 *  click-to-open: they don't get edit-mode chrome (the canvas owns
 *  drag handles + the remove button on the wrapper). They DO need to
 *  know their surface so a wider canvas tile can show a slightly
 *  richer headline than the narrow sidebar variant.
 *
 *  Home canvas migration (2026-05-23): home tiles render with the same
 *  "canvas" shape (they live in the /home widget grid which mirrors
 *  the /lab-overview snapshot canvas), so we keep the prop union at
 *  `"canvas" | "sidebar"` and pass `"canvas"` when mounted on /home.
 *  If a per-surface tile design ever forks (e.g. home wants narrower
 *  tiles than lab-overview), widen this union then. */
export interface SnapshotTileProps {
  surface: "canvas" | "sidebar";
  /**
   * Per-instance config for this placed widget (weekly-goals widget,
   * 2026-05-29). Optional + additive — widgets that don't support
   * per-instance config ignore it. The canvas reads it from the persisted
   * `lab_overview_layout.widgetConfig[widgetId]` and passes it down. A
   * single-member-pinned widget reads `config.pinnedMember` to show a
   * focused tile.
   */
  config?: WidgetInstanceConfig;
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
  /**
   * Per-instance config for this placed widget (weekly-goals widget,
   * 2026-05-29). Optional + additive. A configurable widget reads
   * `config.pinnedMember` to switch into single-member mode.
   */
  config?: WidgetInstanceConfig;
  /**
   * Persist a new per-instance config for this widget (or clear it with
   * `null`). Supplied by the canvas; a configurable widget calls it from
   * its in-popup config control. Undefined on surfaces that don't support
   * editing config (e.g. the read-only Tools launcher popup).
   */
  onConfigChange?: (config: WidgetInstanceConfig | null) => void;
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
  /**
   * Per-widget popup-header override (widget popup-title manager,
   * 2026-05-25). When set, the popup launched from this widget's tile
   * uses this string as its header instead of the parent Tool's title.
   * Lets tile-variants of a shared Tool present a focused header that
   * matches the tile label the user clicked (e.g. clicking the
   * "Upcoming tasks" tile opens a popup titled "Upcoming tasks", not
   * the daily-tasks Tool's umbrella "Today's tasks" title).
   *
   * Unset = fall back to the Tool's title (the original behavior),
   * which is correct for single-variant Tools and for variants whose
   * tile label already matches the Tool title.
   *
   * Wired through `resolveToolTitle(widget)` so every popup-mounting
   * surface (snapshot canvas, lab-overview sidebar rail, customizable
   * sidebar) picks the override up uniformly.
   */
  popupTitle?: string;
  /** One-line description shown in the "+ Add widget" catalog drawer. */
  description?: string;
  /**
   * Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
   * 2026-05-25): the 1-2 sentence explanatory copy surfaced by the
   * widget's tile-header "?" badge on /lab-overview. Answers "What is
   * this widget? Who can see it? What is the main action?"
   *
   * Per-widget files export their own `HELP_TEXT` constant so the copy
   * lives next to the widget body it explains; the registry references
   * those exports instead of inlining sentences here. When unset, the
   * widget tile renders without a help badge.
   */
  helpText?: string;
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
  /**
   * Legacy single-surface field. Pre-home-canvas, every widget declared
   * exactly one surface (or `"both"` for the rare two-surface case).
   * Home canvas migration (Home canvas migration manager, 2026-05-23)
   * replaced this with the multi-surface `surfaces` map below; this
   * field is kept on the type as a back-compat fallback for catalog
   * entries that haven't been ported. Consumers read surface eligibility
   * via `widgetHasSurface(widget, "canvas" | "sidebar" | "home")`, which
   * checks `surfaces` first and falls back to this field.
   *
   * Optional after the migration — new entries should set `surfaces`
   * directly and leave `surface` undefined.
   */
  surface?: WidgetSurface;
  /**
   * Home canvas migration (Home canvas migration manager, 2026-05-23):
   * the canonical surface eligibility map. Set `canvas: true` for the
   * /lab-overview snapshot canvas, `sidebar: true` for the customizable
   * sidebar rail, `home: true` for the new /home widget canvas. A
   * widget can opt into any combination — Announcements / Comments /
   * LabActivity / TodaysAnnouncements set both `canvas` and `home` so
   * they surface on both PI dashboard AND member home. PI-only widgets
   * (Metrics, PI actions, purchases) keep `canvas: true` only — they
   * stay on /lab-overview where lab heads expect them. Lab heads CAN
   * still pin them on /home manually via the catalog drawer, but the
   * default Home canvas stays clean.
   *
   * If both `surface` and `surfaces` are present, `surfaces` wins.
   * If neither is present, the widget is hidden from every surface.
   */
  surfaces?: WidgetSurfaces;
  /** Allow this widget into a regular member's catalog? `false` → PI only. */
  memberVisible: boolean;
  /**
   * Allow this widget into a lab_head's catalog? Default `true`.
   *
   * `false` is the carve-out for widgets that are technically functional
   * for a PI but actively unwanted in the PI surface (e.g. the
   * sidebar-overdue / sidebar-today / sidebar-upcoming task list
   * widgets, they show the PI's personal task counts, but on the PI
   * sidebar they read as a "what does the lab still have open" prompt
   * that nudges micromanagement. PIs get personal task signals via
   * DailyTasksWidget instead). Grant 2026-05-23 feedback.
   *
   * The filter is enforced by `visibleCatalog`, so both the add-widget
   * palette + any persisted layout pointing at the widget gets silently
   * dropped from the PI surface. Member surface unaffected.
   *
   * Back-compat note: if `labHeadVisibleOn` (per-surface map) is set,
   * it takes precedence over this field. Existing entries continue to
   * work unchanged.
   */
  labHeadVisible?: boolean;
  /**
   * Per-surface lab-head visibility refinement (widget per-surface
   * visibility manager, 2026-05-25). Some widgets are home-eligible for
   * lab heads but sidebar-carved-out (e.g. `sidebar-upcoming`: lab heads
   * should be able to pin Upcoming Tasks on /home, but the PI
   * customizable-sidebar palette stays carved out for the
   * "micromanagement nudge" reason).
   *
   * Visibility resolution per surface:
   *   `labHeadVisibleOn?.<surface> ?? labHeadVisible ?? true`
   *
   * If both `labHeadVisibleOn.<surface>` and `labHeadVisible` are set,
   * the per-surface entry wins. If neither is set, the widget is visible
   * to lab heads on that surface (back-compat default).
   *
   * See `isWidgetVisibleForLabHead(widget, surface)`.
   */
  labHeadVisibleOn?: {
    /** PI customizable-sidebar palette eligibility (lab-overview rail
     *  and AppShell sidebar). */
    sidebar?: boolean;
    /** /home canvas palette eligibility. */
    home?: boolean;
    /** /lab-overview snapshot-canvas palette eligibility. Falls through
     *  to `labHeadVisible` when unset. */
    canvas?: boolean;
  };
}

/**
 * Pure helper: should this widget appear in a LAB HEAD's catalog for
 * the given surface? Returns the per-surface entry when set, otherwise
 * the legacy single `labHeadVisible` field, otherwise the default
 * `true`. Not meaningful for members (use `memberVisible` instead).
 *
 * Lives next to `visibleCatalog` so both filters read the same way.
 */
export function isWidgetVisibleForLabHead(
  widget: {
    labHeadVisible?: boolean;
    labHeadVisibleOn?: { sidebar?: boolean; home?: boolean; canvas?: boolean };
  },
  surface: "canvas" | "sidebar" | "home",
): boolean {
  const perSurface = widget.labHeadVisibleOn?.[surface];
  if (perSurface !== undefined) return perSurface;
  return widget.labHeadVisible ?? true;
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
 *
 * Per-surface refinement (widget per-surface visibility manager,
 * 2026-05-25): pass `surface` to scope the lab-head carve-out to that
 * surface only. Reads `labHeadVisibleOn?.<surface>` first, falling back
 * to the legacy `labHeadVisible` field. Without a `surface` arg the
 * caller gets the union of every surface: a widget is included iff its
 * legacy `labHeadVisible` is not explicitly `false`. This preserves the
 * pre-refinement behavior for callsites that filter further downstream.
 */
export function visibleCatalog(
  catalog: WidgetDefinition[],
  accountType: AccountType,
  surface?: "canvas" | "sidebar" | "home",
): WidgetDefinition[] {
  if (accountType === "lab_head") {
    if (surface) {
      return catalog.filter((w) => isWidgetVisibleForLabHead(w, surface));
    }
    return catalog.filter((w) => w.labHeadVisible !== false);
  }
  return catalog.filter((w) => w.memberVisible);
}

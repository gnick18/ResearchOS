/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * read / write helpers for the persisted Lab Overview layout
 * (`users/<u>/settings.json:lab_overview_layout`).
 *
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the shape switched from the R2 free-grid map to a simple ordered
 * list of widget IDs per surface. The new shape is:
 *
 *     {
 *       version: 2,
 *       widgetOrder: {
 *         canvas:  WidgetId[],
 *         sidebar: WidgetId[],
 *       },
 *     }
 *
 * The R2 free-grid shape (`canvas: {[id]: {x,y,w,h}}` +
 * `sidebar: {order, hidden}`) is migrated at read time:
 *   - canvas: sort entries by y ASC, then x ASC, then take the IDs
 *     → that becomes the new top-down canvas order.
 *   - sidebar: take `order` minus `hidden` → the new sidebar order.
 *
 * The migration is idempotent: if the read payload already carries
 * `widgetOrder` (v2), it's passed through with no transformation.
 *
 * Unknown IDs are still dropped silently with a `console.warn` in
 * dev so the user sees what got pruned. Catalog widgets not in the
 * stored order are still appended at the end so a new catalog
 * addition shows up automatically the next time the user visits.
 *
 * See proposal §3 (snapshot canvas) and §3g (vertical sidebar).
 */
import {
  isWidgetConfigEmpty,
  patchUserSettings,
  readUserSettings,
  type AccountType,
  type LabOverviewLayout,
  type LabOverviewLayoutV1,
  type WidgetInstanceConfig,
} from "@/lib/settings/user-settings";
import {
  widgetHasSurface,
  type WidgetDefinition,
} from "@/components/lab-overview/widgets/types";
import {
  baseWidgetId,
  singleProjectInstanceId,
} from "@/components/lab-overview/widgets/registry";

/** Current shape version. v1 = R2 free-grid; v2 = Phase A snapshot
 *  canvas order list. Bumped only on schema-changing shape
 *  migrations — adding new widgets to the catalog does NOT bump this. */
export const LAB_OVERVIEW_LAYOUT_VERSION = 2 as const;

/**
 * Phase C (Tools refactor manager, 2026-05-23): if a future refactor
 * renames a widget id, add the mapping here so old saved layouts get
 * rewritten transparently at read time. The current Phase C refactor
 * kept every existing widget id (the 3 purchases variants share the
 * `purchases` Tool by adding NEW ids, not by renaming the existing one)
 * so the map starts empty.
 *
 * Shape: `{ [old id]: new id }`. The migration runs over both canvas
 * and sidebar saved orders, rewriting any old id it sees.
 */
export const WIDGET_ID_RENAMES: Record<string, string> = {
  // No renames yet. Example for the future:
  //   "old-widget-id": "new-widget-id",
};

function applyIdRenames(ids: string[]): string[] {
  if (Object.keys(WIDGET_ID_RENAMES).length === 0) return ids;
  return ids.map((id) => WIDGET_ID_RENAMES[id] ?? id);
}

// ── Default layouts ──────────────────────────────────────────────────────

/**
 * Default order for a fresh lab_head user. Expanded 2026-05-23 to
 * surface every lab-head canvas widget by default, so a fresh PI sees
 * the full feature set on first load (purchases, activity, experiments,
 * notes). Existing users with an explicit saved order keep it; the
 * "append on new catalog entry" path in `resolveLayout` covers any
 * widget the saved layout doesn't list.
 *
 * The lab-purchases burn-rate and pending-count variant tiles are NOT in
 * the default (opt-in via Add widget for PIs who want them); the burn-rate
 * chart already lives as a tab inside the main lab-purchases widget.
 *
 * Canvas order: announcements, lab-purchases (the PI's main daily
 * triage), metrics, lab-activity, lab-experiments, lab-notes,
 * comment-feed. Sidebar: recent-activity, pi-actions, member-workload.
 */
function defaultLabHeadLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      // New-account default-set change (dashboard-newproject-tour bot,
      // 2026-05-29, FLAG): the multi-project "Projects Overview" widget is
      // NO LONGER seeded by default. Grant's decided model makes the
      // top-level "+ New Project" toolbar button + the auto-created Single
      // Project widgets the dashboard's project surface, so a fresh PI does
      // not get the Projects Overview tile pre-pinned. It stays available via
      // "+ Add widget". EXISTING accounts are untouched: their saved layout
      // (or the migration injection in `seedDashboardLayout`) is unchanged.
      canvas: [
        "announcements",
        "lab-purchases",
        "metrics",
        "lab-activity",
        "lab-experiments",
        "lab-notes",
        "comment-feed",
      ],
      sidebar: [
        "sidebar-recent-activity",
        "sidebar-pi-actions",
        "sidebar-member-workload",
      ],
    },
  };
}

/** Default for a fresh member user. */
function defaultMemberLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      // New-account default-set change (dashboard-newproject-tour bot,
      // 2026-05-29, FLAG): Projects Overview removed from the default; the
      // top-level New Project button + auto Single Project widgets are the
      // project surface now. Still addable via "+ Add widget".
      canvas: ["announcements", "comment-feed"],
      // Member sidebar default is empty: members always have the permanent
      // DailyTasksSidebar (overdue / today / upcoming), so the sidebar-overdue
      // / sidebar-today / sidebar-upcoming widgets duplicated it. Those widgets
      // stay in the catalog (a lab head with a customizable rail can add them).
      sidebar: [],
    },
  };
}

export function defaultLayoutFor(accountType: AccountType): LabOverviewLayout {
  return accountType === "lab_head" ? defaultLabHeadLayout() : defaultMemberLayout();
}

// ── Migration: v1 free-grid → v2 ordered lists ───────────────────────────

/**
 * Pure migration. Returns the v2-shaped layout. Idempotent: when the
 * input already looks like v2 (has `widgetOrder`), it's returned
 * unchanged (apart from version-stamp normalization).
 */
export function migrateLayoutToV2(
  saved: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
): LabOverviewLayout | undefined {
  if (!saved) return undefined;
  // Already v2: idempotent pass-through. The per-instance `widgetConfig`
  // map (weekly-goals widget, 2026-05-29) is carried through untouched so
  // a single-member pin survives a re-read; v1 payloads never had it, so
  // it stays undefined on the upgrade path.
  if ("widgetOrder" in saved && saved.widgetOrder) {
    return {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...saved.widgetOrder.canvas],
        sidebar: [...saved.widgetOrder.sidebar],
      },
      ...(saved.widgetConfig ? { widgetConfig: { ...saved.widgetConfig } } : {}),
    };
  }
  // v1 → v2:
  //   - canvas: sort entries by y ASC, x ASC; flatten to id list.
  //   - sidebar: order minus hidden (preserves the user's saved
  //     sequence; hidden ids drop out entirely under the new shape).
  const v1 = saved as LabOverviewLayoutV1;
  const canvasEntries = Object.entries(v1.canvas ?? {});
  canvasEntries.sort(([, a], [, b]) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
  const canvasOrder = canvasEntries.map(([id]) => id);

  const hiddenSet = new Set(v1.sidebar?.hidden ?? []);
  const sidebarOrder = (v1.sidebar?.order ?? []).filter((id) => !hiddenSet.has(id));

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: canvasOrder,
      sidebar: sidebarOrder,
    },
  };
}

// ── Read / normalize ─────────────────────────────────────────────────────

/**
 * Resolve a saved layout against the current catalog + viewer.
 *
 * `catalog` is already filtered for visibility (members never get a
 * lab_head-only catalog); ids referenced by the saved layout but not
 * present in `catalog` are dropped. New catalog ids that don't appear
 * in the saved layout get appended (canvas → end; sidebar → end).
 *
 * Pure: takes the layout + catalog by value, returns a normalized
 * layout. No I/O. The caller does its own read first.
 */
export function resolveLayout(
  saved: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  accountType: AccountType,
  catalog: WidgetDefinition[],
): LabOverviewLayout {
  const migrated = migrateLayoutToV2(saved) ?? defaultLayoutFor(accountType);

  // Split catalog by surface for the append-at-end rules. Home canvas
  // migration (2026-05-23): surface check goes through `widgetHasSurface`
  // so both the new `surfaces` map and the legacy `surface` string
  // resolve to the same eligibility decision.
  const canvasIds = new Set(
    catalog.filter((w) => widgetHasSurface(w, "canvas")).map((w) => w.id),
  );
  const sidebarIds = new Set(
    catalog.filter((w) => widgetHasSurface(w, "sidebar")).map((w) => w.id),
  );

  function normalizeOrder(
    saved: string[],
    eligible: Set<string>,
    catalogForAppend: WidgetDefinition[],
    surfaceCheck: (w: WidgetDefinition) => boolean,
  ): string[] {
    // Phase C: apply id renames BEFORE eligibility check so an old id
    // that's been renamed survives instead of being dropped as "unknown".
    const renamed = applyIdRenames(saved);
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of renamed) {
      // Instance-id tolerant (dashboard-newproject-tour bot, 2026-05-29):
      // eligibility is checked against the BASE catalog id so a pinned
      // instance like `single-project#alex:5` survives as long as its base
      // `single-project` is catalog-eligible. The full instance id is what
      // de-dups + keys widgetConfig.
      if (!eligible.has(baseWidgetId(id))) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[lab-overview/layout] Dropping unknown widget id "${id}" from saved layout.`,
          );
        }
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    for (const widget of catalogForAppend) {
      if (!surfaceCheck(widget)) continue;
      if (seen.has(widget.id)) continue;
      next.push(widget.id);
    }
    return next;
  }

  const canvas = normalizeOrder(
    migrated.widgetOrder.canvas,
    canvasIds,
    catalog,
    (w) => widgetHasSurface(w, "canvas"),
  );
  const sidebar = normalizeOrder(
    migrated.widgetOrder.sidebar,
    sidebarIds,
    catalog,
    (w) => widgetHasSurface(w, "sidebar"),
  );

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: { canvas, sidebar },
    // Carry the per-instance config through, pruning entries whose widget
    // id is no longer mounted on either surface (weekly-goals widget,
    // 2026-05-29). Keeps the config map from accumulating stale pins.
    ...pruneWidgetConfig(migrated.widgetConfig, [...canvas, ...sidebar]),
  };
}

/**
 * Prune a `widgetConfig` map to the set of currently-mounted widget ids.
 * Returns `{}` (no key) when there's nothing to carry, so callers can
 * spread it conditionally and old layouts stay shape-stable.
 */
function pruneWidgetConfig(
  config: Record<string, { pinnedMember?: string }> | undefined,
  mountedIds: string[],
): { widgetConfig?: Record<string, { pinnedMember?: string }> } {
  if (!config) return {};
  const mounted = new Set(mountedIds);
  const next: Record<string, { pinnedMember?: string }> = {};
  for (const [id, cfg] of Object.entries(config)) {
    if (mounted.has(id)) next[id] = cfg;
  }
  return Object.keys(next).length > 0 ? { widgetConfig: next } : {};
}

/** Convenience: read settings + return the resolved layout in one call. */
export async function readResolvedLayout(
  username: string,
  catalog: WidgetDefinition[],
): Promise<LabOverviewLayout> {
  const settings = await readUserSettings(username);
  return resolveLayout(
    settings.lab_overview_layout,
    settings.account_type,
    catalog,
  );
}

// ── Mutators ─────────────────────────────────────────────────────────────

/** Replace the entire layout. Used by Reset layout. */
export async function writeLayout(
  username: string,
  layout: LabOverviewLayout,
): Promise<void> {
  await patchUserSettings(username, { lab_overview_layout: layout });
}

/**
 * Patch the canvas order. Called once per drop from the HTML5 DnD
 * reorder handler in `SnapshotCanvas`. The sidebar order is left
 * untouched.
 */
export async function patchCanvasOrder(
  username: string,
  nextCanvasOrder: string[],
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: nextCanvasOrder,
        sidebar: existing.widgetOrder.sidebar,
      },
      // Preserve per-instance config across reorders (weekly-goals
      // widget, 2026-05-29).
      ...(existing.widgetConfig
        ? { widgetConfig: existing.widgetConfig }
        : {}),
    },
  });
}

/**
 * Set or clear the per-instance config for a placed widget id on the
 * /lab-overview canvas (weekly-goals widget, 2026-05-29). Passing an
 * empty/undefined config removes the entry so the widget reverts to its
 * default mode. Persisted-LAYOUT-shape mutator — additive, no-ops for old
 * layouts that never had a `widgetConfig` map.
 */
export async function patchWidgetConfig(
  username: string,
  widgetId: string,
  config: WidgetInstanceConfig | null,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  const nextConfig: Record<string, WidgetInstanceConfig> = {
    ...(existing.widgetConfig ?? {}),
  };
  // A null/empty config (no meaningful fields) clears the entry. Project-
  // widgets family (2026-05-29): generalized past the original
  // pinnedMember-only test so `{ projectScope }` / `{ pinnedProject }`
  // configs persist instead of being discarded.
  if (isWidgetConfigEmpty(config)) {
    delete nextConfig[widgetId];
  } else {
    nextConfig[widgetId] = config as WidgetInstanceConfig;
  }
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: existing.widgetOrder,
      ...(Object.keys(nextConfig).length > 0
        ? { widgetConfig: nextConfig }
        : {}),
    },
  });
}

/**
 * Project-widgets family (project-widgets, 2026-05-29): the /home-surface
 * variant of `patchWidgetConfig`. Writes to `home_layout` instead of
 * `lab_overview_layout` so a per-instance config edited on the Home
 * canvas (e.g. the Projects Overview My/Lab toggle) persists to the
 * surface it was changed on.
 *
 * Preserves `widgetOrder` (both canvas + sidebar). Note the sibling home
 * order mutators (`patchHomeCanvasOrder` etc.) currently DROP
 * `widgetConfig`; this mutator is the one place home config is written,
 * and it keeps the order intact, so a config change does not clobber the
 * order. (The order mutators dropping config on reorder is a pre-existing
 * home-surface gap, out of scope here.)
 */
export async function patchHomeWidgetConfig(
  username: string,
  widgetId: string,
  config: WidgetInstanceConfig | null,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.home_layout) ??
    defaultHomeLayoutFor(current.account_type);
  const nextConfig: Record<string, WidgetInstanceConfig> = {
    ...(existing.widgetConfig ?? {}),
  };
  if (isWidgetConfigEmpty(config)) {
    delete nextConfig[widgetId];
  } else {
    nextConfig[widgetId] = config as WidgetInstanceConfig;
  }
  await patchUserSettings(username, {
    home_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: existing.widgetOrder,
      ...(Object.keys(nextConfig).length > 0
        ? { widgetConfig: nextConfig }
        : {}),
    },
  });
}

/** Patch the sidebar order. Called once per drop from the sidebar
 *  reorder handler. */
export async function patchSidebarOrder(
  username: string,
  nextSidebarOrder: string[],
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas,
        sidebar: nextSidebarOrder,
      },
    },
  });
}

/** Add a canvas widget at the end. No-op if already present. */
export async function addCanvasWidget(
  username: string,
  widget: WidgetDefinition,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  if (existing.widgetOrder.canvas.includes(widget.id)) return;
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...existing.widgetOrder.canvas, widget.id],
        sidebar: existing.widgetOrder.sidebar,
      },
      ...(existing.widgetConfig
        ? { widgetConfig: existing.widgetConfig }
        : {}),
    },
  });
}

/** Remove a canvas widget. No-op if absent. */
export async function removeCanvasWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  if (!existing.widgetOrder.canvas.includes(widgetId)) return;
  // Drop the removed widget's per-instance config too (weekly-goals
  // widget, 2026-05-29) so a re-add starts fresh in default mode.
  const nextConfig = { ...(existing.widgetConfig ?? {}) };
  delete nextConfig[widgetId];
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas.filter((id) => id !== widgetId),
        sidebar: existing.widgetOrder.sidebar,
      },
      ...(Object.keys(nextConfig).length > 0
        ? { widgetConfig: nextConfig }
        : {}),
    },
  });
}

/** Toggle a sidebar widget: add if absent, remove if present. The R2
 *  hidden-list is gone in v2 (an absent id is the same as hidden), so
 *  "toggle" means "add or remove from `widgetOrder.sidebar`". */
export async function toggleSidebarWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  const sidebar = existing.widgetOrder.sidebar.includes(widgetId)
    ? existing.widgetOrder.sidebar.filter((id) => id !== widgetId)
    : [...existing.widgetOrder.sidebar, widgetId];
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas,
        sidebar,
      },
    },
  });
}

/** Reset the layout to the account-type default. */
export async function resetLayout(username: string): Promise<void> {
  const current = await readUserSettings(username);
  await patchUserSettings(username, {
    lab_overview_layout: defaultLayoutFor(current.account_type),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Home canvas (Home canvas migration, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────
//
// The /home page now has its own customizable widget canvas, scoped to
// widgets that opt into the `home` surface (see `WIDGET_CATALOG`).
// Lives in a separate `_user_settings.json:home_layout` field so the
// /home customization is independent of /lab-overview customization
// (a lab head can have a dense PI dashboard on /lab-overview AND a
// quieter personal home canvas).
//
// The home layout shape mirrors the lab-overview shape (v2 ordered
// list per surface) so the same `SnapshotCanvas`-style mechanics can
// be reused. The "sidebar" axis is currently UNUSED on /home —
// /home keeps its existing AppShell sidebar (DailyTasksSidebar /
// CustomizableSidebar) untouched. We allocate the slot in the shape
// anyway so a future "customizable home sidebar" chip doesn't need a
// schema migration.

/**
 * Home canvas default for a fresh member.
 *
 * Home widgets surface-prep manager (2026-05-25): pre-seed shrunk from
 * 4 widgets to 2 — one project-aware (Upcoming tasks) and one
 * calendar-aware (Today's events). This matches the §6.2b walkthrough
 * proposal §9 question 4: "Pre-seed the canvas with 1-2 default
 * widgets before the tour starts so the canvas isn't empty when
 * §6.2b-canvas-intro fires." Grant green-lit 2.
 *
 *   - `sidebar-upcoming` → "Upcoming tasks" snapshot tile (project-aware:
 *     it reads the user's own tasks across their projects). The widget
 *     is opted into the `home` surface as part of this change.
 *   - `calendar-events-today` → "Today's events" tile (calendar-aware:
 *     reads the user's subscribed calendar feeds).
 *
 * Existing users who already have a saved `home_layout` keep it
 * untouched: the change lives entirely in the default-initializer
 * code path, not in a migration. `resolveHomeLayout` only consults
 * this default when `saved` is undefined.
 *
 * Pre-2026-05-25 the default was 4 widgets (announcements + comments +
 * lab-activity + calendar-events-today). The lab-overview/index of
 * lab-activity + announcements + comments still lives in the catalog
 * and can be pinned via the Add widget palette, but starting blank-
 * adjacent (2 tiles) matches Grant's user-curated home thesis better.
 */
function defaultMemberHomeLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      // New-account default-set change (dashboard-newproject-tour bot,
      // 2026-05-29, FLAG): Projects Overview removed from the default member
      // dashboard. The top-level New Project button + auto Single Project
      // widgets are the project surface; Projects Overview stays addable via
      // "+ Add widget".
      // Lean member home default: just the today's-events tile. The
      // sidebar-upcoming widget was removed (the permanent DailyTasksSidebar
      // already shows upcoming tasks); it stays addable via "+ Add widget".
      canvas: ["calendar-events-today"],
      // Home sidebar is unused today (see note above). Leave empty so
      // the home canvas reader has a stable shape to read.
      sidebar: [],
    },
  };
}

/**
 * Home canvas default for a fresh lab head. Grant's brief: "Lab heads
 * ALSO get the Home canvas (they can pin personal widgets there
 * alongside their projects)." Lab heads get the same 2 default home
 * signals as members — they can extend per taste, and they still have
 * /lab-overview for the dense PI dashboard.
 *
 * Home widgets surface-prep manager (2026-05-25): mirrored the member
 * default shrink to 2 widgets so the walkthrough's §6.2b canvas-intro
 * step shows the same shape regardless of account type.
 */
function defaultLabHeadHomeLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      // New-account default-set change (dashboard-newproject-tour bot,
      // 2026-05-29, FLAG): Projects Overview removed from the default,
      // matching the member home default. (Lab heads resolve their dashboard
      // from `defaultLabHeadLayout` via the canvas surface; this home default
      // is retained for back-compat with the legacy `home_layout` read/seed
      // path.)
      canvas: ["sidebar-upcoming", "calendar-events-today"],
      sidebar: [],
    },
  };
}

/** Account-type-aware home canvas default. */
export function defaultHomeLayoutFor(
  accountType: AccountType,
): LabOverviewLayout {
  return accountType === "lab_head"
    ? defaultLabHeadHomeLayout()
    : defaultMemberHomeLayout();
}

/**
 * Resolve a saved home layout against the current catalog + viewer.
 * Mirrors `resolveLayout` for /lab-overview but reads from the `home`
 * surface eligibility (not `canvas`) and the `home_layout` settings
 * field (not `lab_overview_layout`).
 */
export function resolveHomeLayout(
  saved: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  accountType: AccountType,
  catalog: WidgetDefinition[],
): LabOverviewLayout {
  const migrated = migrateLayoutToV2(saved) ?? defaultHomeLayoutFor(accountType);

  const homeIds = new Set(
    catalog.filter((w) => widgetHasSurface(w, "home")).map((w) => w.id),
  );

  function normalizeOrder(
    saved: string[],
    eligible: Set<string>,
    catalogForAppend: WidgetDefinition[],
    surfaceCheck: (w: WidgetDefinition) => boolean,
  ): string[] {
    const renamed = applyIdRenames(saved);
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of renamed) {
      // Instance-id tolerant (dashboard-newproject-tour bot, 2026-05-29):
      // see resolveLayout. Check base catalog id so pinned single-project
      // instances survive the home-surface eligibility filter.
      if (!eligible.has(baseWidgetId(id))) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[home-canvas/layout] Dropping unknown widget id "${id}" from saved home layout.`,
          );
        }
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    // Home canvas migration choice: do NOT auto-append every home-eligible
    // widget to a user's saved layout. The default seeds 4 widgets; if
    // the catalog later adds a 5th home-eligible widget, the user can
    // add it via the palette but their existing saved order isn't
    // perturbed by an automatic insert. This is a softer contract than
    // /lab-overview (which appends every new catalog widget): home is
    // user-curated, lab-overview is a dashboard.
    void catalogForAppend;
    void surfaceCheck;
    return next;
  }

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: normalizeOrder(
        migrated.widgetOrder.canvas,
        homeIds,
        catalog,
        (w) => widgetHasSurface(w, "home"),
      ),
      // Home sidebar is allocated in the shape but unused today.
      sidebar: [],
    },
  };
}

/** Convenience: read settings + return the resolved home layout in one call. */
export async function readResolvedHomeLayout(
  username: string,
  catalog: WidgetDefinition[],
): Promise<LabOverviewLayout> {
  const settings = await readUserSettings(username);
  return resolveHomeLayout(
    settings.home_layout,
    settings.account_type,
    catalog,
  );
}

/** Replace the entire home layout. Used by Reset on /home. */
export async function writeHomeLayout(
  username: string,
  layout: LabOverviewLayout,
): Promise<void> {
  await patchUserSettings(username, { home_layout: layout });
}

/** Patch the home canvas order. Called once per drop. */
export async function patchHomeCanvasOrder(
  username: string,
  nextCanvasOrder: string[],
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.home_layout) ??
    defaultHomeLayoutFor(current.account_type);
  await patchUserSettings(username, {
    home_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: nextCanvasOrder,
        sidebar: existing.widgetOrder.sidebar,
      },
    },
  });
}

/** Add a home canvas widget at the end. No-op if already present. */
export async function addHomeCanvasWidget(
  username: string,
  widget: WidgetDefinition,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.home_layout) ??
    defaultHomeLayoutFor(current.account_type);
  if (existing.widgetOrder.canvas.includes(widget.id)) return;
  await patchUserSettings(username, {
    home_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...existing.widgetOrder.canvas, widget.id],
        sidebar: existing.widgetOrder.sidebar,
      },
    },
  });
}

/** Remove a home canvas widget. No-op if absent. */
export async function removeHomeCanvasWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.home_layout) ??
    defaultHomeLayoutFor(current.account_type);
  if (!existing.widgetOrder.canvas.includes(widgetId)) return;
  await patchUserSettings(username, {
    home_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas.filter((id) => id !== widgetId),
        sidebar: existing.widgetOrder.sidebar,
      },
    },
  });
}

/** Reset the home layout to the account-type default. */
export async function resetHomeLayout(username: string): Promise<void> {
  const current = await readUserSettings(username);
  await patchUserSettings(username, {
    home_layout: defaultHomeLayoutFor(current.account_type),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Unified dashboard (dashboard-unification build, 2026-05-29)
// ─────────────────────────────────────────────────────────────────────────
//
// DATA-SHAPE CHANGE (FLAG). Home (route "/") and Lab Overview (route
// "/lab-overview", now a redirect to "/") collapse into ONE per-user
// widget dashboard. Both surfaces previously had their own persistence
// field (`home_layout` / `lab_overview_layout`); they now share
// `dashboard_layout`.
//
// The catalog surface key stays ACCOUNT-AWARE so the existing
// per-surface catalog gating (lab-aggregation widgets are `canvas`-only;
// the personal home defaults are `home`-eligible) keeps working without
// touching the registry:
//   - lab_head → the "canvas" surface (the dense PI widget set)
//   - member / solo → the "home" surface (the personal widget set)
// Both write to the SAME `dashboard_layout` field. A user who changes
// account type later re-resolves against the new surface; unknown ids for
// that surface drop at read time exactly as before.
//
// ONE-TIME MIGRATION: when `dashboard_layout` is absent, seed it from the
// account-appropriate LEGACY field (lab_head ← `lab_overview_layout`,
// everyone else ← `home_layout`), then inject a Projects Overview
// instance at the TOP if the seeded layout lacks one — so no existing
// user opens the unified dashboard to a missing project view. The legacy
// fields stay readable for one release (see `user-settings.ts`); they are
// never written by these dashboard mutators.

/** The Projects Overview widget id, seeded/injected at the top of every
 *  dashboard. Kept as a named constant so the seed default + the
 *  migration injection + tests reference one source of truth. */
export const PROJECTS_OVERVIEW_WIDGET_ID = "projects-overview";

/** Which catalog surface a given account type's dashboard reads from. */
export function dashboardSurfaceFor(
  accountType: AccountType,
): "canvas" | "home" {
  return accountType === "lab_head" ? "canvas" : "home";
}

/** Account-type-aware unified dashboard default. lab_head gets the dense
 *  PI canvas default; everyone else gets the personal home default. Both
 *  already seed Projects Overview at the top (see the default builders). */
export function defaultDashboardLayoutFor(
  accountType: AccountType,
): LabOverviewLayout {
  return accountType === "lab_head"
    ? defaultLabHeadLayout()
    : defaultHomeLayoutFor(accountType);
}

/**
 * Inject a Projects Overview instance at the TOP of a canvas order if it
 * is not already present. Pure; returns the same reference shape. Used by
 * the one-time migration so an existing saved layout that predates the
 * unified dashboard still opens to a project view.
 */
function injectProjectsOverviewAtTop(canvas: string[]): string[] {
  if (canvas.includes(PROJECTS_OVERVIEW_WIDGET_ID)) return canvas;
  return [PROJECTS_OVERVIEW_WIDGET_ID, ...canvas];
}

/**
 * Seed the unified `dashboard_layout` from the legacy fields when it is
 * absent. Pure: takes the settings-shaped legacy fields by value, returns
 * the layout to use as the dashboard's saved layout (still subject to
 * `resolveLayout`-style catalog normalization downstream).
 *
 * Precedence:
 *   1. `dashboard_layout` present → use it as-is (migrate v1→v2).
 *   2. absent → seed from the account-appropriate legacy field
 *      (lab_head ← `lab_overview_layout`, else ← `home_layout`), inject
 *      Projects Overview at the top if missing.
 *   3. neither legacy field present → the account-type default (which
 *      already includes Projects Overview at the top).
 */
export function seedDashboardLayout(
  dashboardLayout: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  legacyLabOverview: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  legacyHome: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  accountType: AccountType,
): LabOverviewLayout {
  const existing = migrateLayoutToV2(dashboardLayout);
  if (existing) return existing;

  const legacy = migrateLayoutToV2(
    accountType === "lab_head" ? legacyLabOverview : legacyHome,
  );
  if (!legacy) return defaultDashboardLayoutFor(accountType);

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: injectProjectsOverviewAtTop(legacy.widgetOrder.canvas),
      sidebar: legacy.widgetOrder.sidebar,
    },
    ...(legacy.widgetConfig ? { widgetConfig: { ...legacy.widgetConfig } } : {}),
  };
}

/**
 * Resolve the unified dashboard layout against the current catalog +
 * viewer. Mirrors `resolveLayout` / `resolveHomeLayout` but reads from the
 * account-aware dashboard surface (`canvas` for lab_head, `home`
 * otherwise) and seeds from the legacy fields on first read.
 *
 * Pure (no I/O). The caller reads settings first and passes the three
 * layout fields in.
 */
export function resolveDashboardLayout(
  dashboardLayout: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  legacyLabOverview: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  legacyHome: LabOverviewLayout | LabOverviewLayoutV1 | undefined,
  accountType: AccountType,
  catalog: WidgetDefinition[],
): LabOverviewLayout {
  const seeded = seedDashboardLayout(
    dashboardLayout,
    legacyLabOverview,
    legacyHome,
    accountType,
  );
  const surfaceKey = dashboardSurfaceFor(accountType);

  const eligible = new Set(
    catalog.filter((w) => widgetHasSurface(w, surfaceKey)).map((w) => w.id),
  );

  const renamed = applyIdRenames(seeded.widgetOrder.canvas);
  const seen = new Set<string>();
  const canvas: string[] = [];
  for (const id of renamed) {
    // Instance-id tolerant (dashboard-newproject-tour bot, 2026-05-29):
    // a pinned `single-project#owner:id` instance survives as long as its
    // base `single-project` is eligible on the account's dashboard surface
    // (both canvas + home opt it in). The full instance id keys widgetConfig.
    if (!eligible.has(baseWidgetId(id))) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[dashboard/layout] Dropping unknown widget id "${id}" from saved dashboard layout.`,
        );
      }
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    canvas.push(id);
  }

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas,
      // The dashboard surface does not use the in-page sidebar axis
      // (mirrors the prior home surface). Keep an empty list for shape
      // stability.
      sidebar: [],
    },
    ...pruneWidgetConfig(seeded.widgetConfig, canvas),
  };
}

/** Convenience: read settings + return the resolved dashboard layout. */
export async function readResolvedDashboardLayout(
  username: string,
  catalog: WidgetDefinition[],
): Promise<LabOverviewLayout> {
  const settings = await readUserSettings(username);
  return resolveDashboardLayout(
    settings.dashboard_layout,
    settings.lab_overview_layout,
    settings.home_layout,
    settings.account_type,
    catalog,
  );
}

/**
 * Read the current persisted dashboard layout (seeded from legacy on
 * first read), in the raw v2 shape WITHOUT catalog normalization. Used by
 * the mutators below so a write preserves any widget id the current
 * catalog filter might not list (mirrors the prior surface mutators that
 * read `migrateLayoutToV2(field) ?? default`).
 */
async function readDashboardLayoutRaw(
  username: string,
): Promise<LabOverviewLayout> {
  const settings = await readUserSettings(username);
  return seedDashboardLayout(
    settings.dashboard_layout,
    settings.lab_overview_layout,
    settings.home_layout,
    settings.account_type,
  );
}

/** Replace the entire dashboard layout. Used by Reset. */
export async function writeDashboardLayout(
  username: string,
  layout: LabOverviewLayout,
): Promise<void> {
  await patchUserSettings(username, { dashboard_layout: layout });
}

/** Patch the dashboard canvas order. Called once per drop. */
export async function patchDashboardCanvasOrder(
  username: string,
  nextCanvasOrder: string[],
): Promise<void> {
  const existing = await readDashboardLayoutRaw(username);
  await patchUserSettings(username, {
    dashboard_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: nextCanvasOrder,
        sidebar: existing.widgetOrder.sidebar,
      },
      ...(existing.widgetConfig
        ? { widgetConfig: existing.widgetConfig }
        : {}),
    },
  });
}

/** Add a dashboard canvas widget at the end. No-op if already present. */
export async function addDashboardWidget(
  username: string,
  widget: WidgetDefinition,
): Promise<void> {
  const existing = await readDashboardLayoutRaw(username);
  if (existing.widgetOrder.canvas.includes(widget.id)) return;
  await patchUserSettings(username, {
    dashboard_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...existing.widgetOrder.canvas, widget.id],
        sidebar: existing.widgetOrder.sidebar,
      },
      ...(existing.widgetConfig
        ? { widgetConfig: existing.widgetConfig }
        : {}),
    },
  });
}

/** Remove a dashboard canvas widget. No-op if absent. */
export async function removeDashboardWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const existing = await readDashboardLayoutRaw(username);
  if (!existing.widgetOrder.canvas.includes(widgetId)) return;
  // Drop the removed widget's per-instance config too so a re-add starts
  // fresh in default mode.
  const nextConfig = { ...(existing.widgetConfig ?? {}) };
  delete nextConfig[widgetId];
  await patchUserSettings(username, {
    dashboard_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas.filter((id) => id !== widgetId),
        sidebar: existing.widgetOrder.sidebar,
      },
      ...(Object.keys(nextConfig).length > 0
        ? { widgetConfig: nextConfig }
        : {}),
    },
  });
}

/** Set or clear a per-instance widget config on the dashboard. Passing an
 *  empty/undefined config removes the entry. */
export async function patchDashboardWidgetConfig(
  username: string,
  widgetId: string,
  config: WidgetInstanceConfig | null,
): Promise<void> {
  const existing = await readDashboardLayoutRaw(username);
  const nextConfig: Record<string, WidgetInstanceConfig> = {
    ...(existing.widgetConfig ?? {}),
  };
  if (isWidgetConfigEmpty(config)) {
    delete nextConfig[widgetId];
  } else {
    nextConfig[widgetId] = config as WidgetInstanceConfig;
  }
  await patchUserSettings(username, {
    dashboard_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: existing.widgetOrder,
      ...(Object.keys(nextConfig).length > 0
        ? { widgetConfig: nextConfig }
        : {}),
    },
  });
}

/** Reset the dashboard layout to the account-type default. */
export async function resetDashboardLayout(username: string): Promise<void> {
  const current = await readUserSettings(username);
  await patchUserSettings(username, {
    dashboard_layout: defaultDashboardLayoutFor(current.account_type),
  });
}

/**
 * Auto-add a Single Project widget pinned to a freshly created project
 * (dashboard-newproject-tour bot, 2026-05-29).
 *
 * Grant's decided model: every project creation appends a `single-project`
 * widget instance to the user's dashboard, pinned to the new project, so the
 * dashboard always SHOWS the project (and the §6.1 tour can click through to
 * it). The widget renders the project's color + progress live from
 * `getProjectsWithProgress`, so we only persist the pin (id + owner); no color
 * is stored on the layout.
 *
 * DE-DUP: the instance id is deterministic (`single-project#<owner>:<id>`), so
 * a project that already has its auto-widget is a no-op — we never add a second
 * widget for the same project. (A user who manually removes the widget and then
 * the project is re-created with the same id would re-add it; that is fine.)
 *
 * EMPTY-WIDGET REUSE (single-project-tour-collision fix bot, 2026-05-29): if the
 * dashboard already carries an UNPINNED bare `single-project` widget (no
 * resolvable `pinnedProject`, e.g. one added from the palette or a prior tour
 * run), we PIN THAT INSTANCE IN PLACE rather than appending a second widget. We
 * rename its canvas entry to the deterministic `single-project#<owner>:<id>` id
 * and move its `widgetConfig` over, so the dashboard shows exactly ONE Single
 * Project widget for the new project with no stray empty leftover. The renamed,
 * now-pinned tile resolves `pinned`, so it carries the §6.1 tour target the
 * `project-overview-nav` beat clicks. An empty tile never carried that target
 * (the widget only stamps it when pinned), so the prefix selector can no longer
 * resolve to a picker-opening empty tile.
 *
 * LIFECYCLE (chosen, see report FLAG): if the project is later deleted, this
 * instance stays on the dashboard and the widget falls back to its empty
 * "pick a project" state (its `findPinned` gate returns undefined for a project
 * the viewer can no longer read). We do NOT auto-remove it; that would require
 * a project-delete hook reaching into every user's layout, out of scope here.
 *
 * Returns the instance id (the same value the tour uses to find + click the
 * tile): the deterministic pinned id whether we appended fresh or reused an
 * empty instance, or the existing one when the widget was already present.
 *
 * DATA-SHAPE: additive + migration-safe. It either appends one v2
 * `widgetOrder.canvas` entry + one `widgetConfig` entry, OR renames an existing
 * bare `single-project` entry to the pinned id in place; old layouts that never
 * had instance ids or a `widgetConfig` map upgrade cleanly via
 * `readDashboardLayoutRaw` -> `seedDashboardLayout`.
 */
export async function addSingleProjectWidgetForProject(
  username: string,
  project: { id: number; owner: string },
): Promise<string> {
  const instanceId = singleProjectInstanceId(project.owner, project.id);
  const base = baseWidgetId(instanceId);
  const existing = await readDashboardLayoutRaw(username);
  if (existing.widgetOrder.canvas.includes(instanceId)) {
    // Already present: de-dup no-op. Still ensure the pin config is set in
    // case a prior write dropped it (belt-and-suspenders; cheap).
    return instanceId;
  }
  const config = existing.widgetConfig ?? {};
  // Reuse an EMPTY bare single-project instance if one exists: a canvas entry
  // whose base id is `single-project` AND that carries no resolvable
  // `pinnedProject`. We pin the FIRST such instance in place. (Other pinned
  // `single-project#…` instances are skipped because their config has a
  // pinnedProject; the bare `single-project` id is the empty/picker tile.)
  const emptyIndex = existing.widgetOrder.canvas.findIndex((id) => {
    if (baseWidgetId(id) !== base) return false;
    const pinned = config[id]?.pinnedProject;
    return !(pinned && typeof pinned.id === "number");
  });
  if (emptyIndex !== -1) {
    const reusedId = existing.widgetOrder.canvas[emptyIndex];
    const nextCanvas = [...existing.widgetOrder.canvas];
    nextCanvas[emptyIndex] = instanceId;
    // Move the config entry from the old (bare) id to the pinned id and set
    // the pin. Drop the old key so no stale empty-instance config lingers.
    const nextConfig: Record<string, WidgetInstanceConfig> = { ...config };
    delete nextConfig[reusedId];
    nextConfig[instanceId] = {
      ...(config[reusedId] ?? {}),
      pinnedProject: { id: project.id, owner: project.owner },
    };
    await patchUserSettings(username, {
      dashboard_layout: {
        version: LAB_OVERVIEW_LAYOUT_VERSION,
        widgetOrder: {
          canvas: nextCanvas,
          sidebar: existing.widgetOrder.sidebar,
        },
        widgetConfig: nextConfig,
      },
    });
    return instanceId;
  }
  const nextConfig: Record<string, WidgetInstanceConfig> = {
    ...config,
    [instanceId]: { pinnedProject: { id: project.id, owner: project.owner } },
  };
  await patchUserSettings(username, {
    dashboard_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...existing.widgetOrder.canvas, instanceId],
        sidebar: existing.widgetOrder.sidebar,
      },
      widgetConfig: nextConfig,
    },
  });
  return instanceId;
}

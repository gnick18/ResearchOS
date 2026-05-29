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
  patchUserSettings,
  readUserSettings,
  type AccountType,
  type LabOverviewLayout,
  type LabOverviewLayoutV1,
} from "@/lib/settings/user-settings";
import {
  widgetHasSurface,
  type WidgetDefinition,
} from "@/components/lab-overview/widgets/types";

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
 * Burn-rate default (burn-rate range manager, 2026-05-23): the burn-rate
 * variant tile is included next to lab-purchases so fresh lab heads see
 * the spend chart day-one. The pending-count variant is NOT in the
 * default (opt-in for PIs who want a compact status pill).
 *
 * Canvas order: announcements, lab-purchases (the PI's main daily
 * triage), lab-purchases-burn-rate (spend trend, sits next to its
 * purchases sibling), metrics, lab-activity, lab-experiments, lab-notes,
 * comment-feed. Sidebar default unchanged.
 */
function defaultLabHeadLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: [
        "announcements",
        "lab-purchases",
        "lab-purchases-burn-rate",
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
        "sidebar-todays-announcements",
      ],
    },
  };
}

/** Default for a fresh member user. */
function defaultMemberLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: ["announcements", "comment-feed"],
      sidebar: ["sidebar-overdue", "sidebar-today", "sidebar-upcoming"],
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
      if (!eligible.has(id)) {
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
  config: import("@/lib/settings/user-settings").WidgetInstanceConfig | null,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing =
    migrateLayoutToV2(current.lab_overview_layout) ??
    defaultLayoutFor(current.account_type);
  const nextConfig: Record<
    string,
    import("@/lib/settings/user-settings").WidgetInstanceConfig
  > = { ...(existing.widgetConfig ?? {}) };
  // A null/empty config (no meaningful fields) clears the entry.
  const isEmpty =
    !config || (config.pinnedMember === undefined || config.pinnedMember === "");
  if (isEmpty) {
    delete nextConfig[widgetId];
  } else {
    nextConfig[widgetId] = config;
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
      canvas: ["sidebar-upcoming", "calendar-events-today"],
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
      if (!eligible.has(id)) {
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

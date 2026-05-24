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
import type { WidgetDefinition } from "@/components/lab-overview/widgets/types";

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
  // Already v2: idempotent pass-through.
  if ("widgetOrder" in saved && saved.widgetOrder) {
    return {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: [...saved.widgetOrder.canvas],
        sidebar: [...saved.widgetOrder.sidebar],
      },
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

  // Split catalog by surface for the append-at-end rules.
  const canvasIds = new Set(
    catalog
      .filter((w) => w.surface === "canvas" || w.surface === "both")
      .map((w) => w.id),
  );
  const sidebarIds = new Set(
    catalog
      .filter((w) => w.surface === "sidebar" || w.surface === "both")
      .map((w) => w.id),
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

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    widgetOrder: {
      canvas: normalizeOrder(
        migrated.widgetOrder.canvas,
        canvasIds,
        catalog,
        (w) => w.surface === "canvas" || w.surface === "both",
      ),
      sidebar: normalizeOrder(
        migrated.widgetOrder.sidebar,
        sidebarIds,
        catalog,
        (w) => w.surface === "sidebar" || w.surface === "both",
      ),
    },
  };
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
  await patchUserSettings(username, {
    lab_overview_layout: {
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: existing.widgetOrder.canvas.filter((id) => id !== widgetId),
        sidebar: existing.widgetOrder.sidebar,
      },
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

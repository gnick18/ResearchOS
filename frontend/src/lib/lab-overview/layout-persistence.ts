/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * read / write helpers for the persisted Lab Overview layout
 * (`users/<u>/settings.json:lab_overview_layout`).
 *
 * Two surfaces, one blob:
 *   - `canvas`: a free-grid map of widget id → `{x, y, w, h}`. The
 *     `react-grid-layout` canvas consumes this directly.
 *   - `sidebar`: `{ order: string[], hidden: string[] }`. The
 *     SidebarWidgetRail renders `order` top-down, skipping anything in
 *     `hidden`. Hidden ids stay in `order` so re-showing puts the
 *     widget back where it was.
 *
 * The reader is forgiving:
 *   - missing payload → default layout for the account type
 *   - unknown widget id (e.g. catalog churn) → drop silently with a
 *     `console.warn` so the user sees in dev which entries were lost
 *   - catalog widget that's not in the saved layout → APPEND at the
 *     bottom of canvas (or end of `sidebar.order`) so new catalog
 *     additions never require explicit user action to mount
 *
 * The writer is plain `patchUserSettings`. Layout changes don't bump
 * `schemaVersion` (they're additive); the layout's own `version` field
 * is reserved for future shape migrations.
 *
 * See proposal §3 (free-grid canvas) and §3g (vertical sidebar).
 */
import {
  patchUserSettings,
  readUserSettings,
  type AccountType,
  type LabOverviewLayout,
  type LabOverviewWidgetPosition,
} from "@/lib/settings/user-settings";
import type { WidgetDefinition } from "@/components/lab-overview/widgets/types";

/** Current shape version. Bumped only on schema-changing shape
 *  migrations — adding new widgets to the catalog does NOT bump this. */
export const LAB_OVERVIEW_LAYOUT_VERSION = 1;

// ── Default layouts ──────────────────────────────────────────────────────

/**
 * Default canvas + sidebar for a fresh lab_head user. Mirrors the
 * current Lab Overview vertical stack so the rename + widget conversion
 * is visually a no-op on first run (proposal §3c).
 *
 * Sidebar default for PIs (proposal §3g): Recent lab activity → Pending
 * lab head actions → Member workload → Today's announcements. The
 * existing task widgets (Overdue / Today / Upcoming) stay in the
 * catalog but are NOT in the default order — the PI can toggle them on
 * if they still run their own experiments.
 */
function defaultLabHeadLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    canvas: {
      // Announcements: full-width top row.
      announcements: { x: 0, y: 0, w: 12, h: 3 },
      // Comment feed: left two-thirds, second row.
      "comment-feed": { x: 0, y: 3, w: 8, h: 6 },
      // Metrics: right one-third, second row (lab_head only).
      metrics: { x: 8, y: 3, w: 4, h: 6 },
    },
    sidebar: {
      order: [
        "sidebar-recent-activity",
        "sidebar-pi-actions",
        "sidebar-member-workload",
        "sidebar-todays-announcements",
        // Task widgets still available — PIs who run experiments can
        // turn them on. Off by default for the PI persona.
        "sidebar-overdue",
        "sidebar-today",
        "sidebar-upcoming",
      ],
      hidden: ["sidebar-overdue", "sidebar-today", "sidebar-upcoming"],
    },
  };
}

/** Default canvas + sidebar for a fresh member user. */
function defaultMemberLayout(): LabOverviewLayout {
  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    canvas: {
      // Announcements: full-width top row (read-only for members).
      announcements: { x: 0, y: 0, w: 12, h: 3 },
      // Comment feed: full-width second row.
      "comment-feed": { x: 0, y: 3, w: 12, h: 6 },
      // No metrics widget — PIs only.
    },
    sidebar: {
      order: ["sidebar-overdue", "sidebar-today", "sidebar-upcoming"],
      hidden: [],
    },
  };
}

export function defaultLayoutFor(accountType: AccountType): LabOverviewLayout {
  return accountType === "lab_head" ? defaultLabHeadLayout() : defaultMemberLayout();
}

// ── Read / normalize ─────────────────────────────────────────────────────

/**
 * Resolve a saved layout against the current catalog + viewer.
 *
 * `catalog` is already filtered for visibility (members never get a
 * lab_head-only catalog); ids referenced by the saved layout but not
 * present in `catalog` are dropped. New catalog ids that don't appear
 * in the saved layout get appended (canvas → bottom; sidebar →
 * `order` end, with `hidden` left alone).
 *
 * Pure: takes the layout + catalog by value, returns a normalized
 * layout. No I/O. The caller does its own read first.
 */
export function resolveLayout(
  saved: LabOverviewLayout | undefined,
  accountType: AccountType,
  catalog: WidgetDefinition[],
): LabOverviewLayout {
  const base = saved ?? defaultLayoutFor(accountType);

  // Split catalog by surface for the append rules.
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

  // Canvas: drop unknowns, append missing.
  const nextCanvas: Record<string, LabOverviewWidgetPosition> = {};
  for (const [id, pos] of Object.entries(base.canvas)) {
    if (canvasIds.has(id)) {
      nextCanvas[id] = pos;
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[lab-overview/layout] Dropping unknown canvas widget id "${id}" from saved layout.`,
      );
    }
  }
  // Append catalog entries not yet in the layout at the next free row.
  let maxBottom = 0;
  for (const pos of Object.values(nextCanvas)) {
    maxBottom = Math.max(maxBottom, pos.y + pos.h);
  }
  let appendY = maxBottom;
  for (const widget of catalog) {
    if (widget.surface !== "canvas" && widget.surface !== "both") continue;
    if (nextCanvas[widget.id]) continue;
    // Filter against visibility — a non-PI catalog won't include PI-only
    // widgets, so we never append them into a non-PI layout. But if the
    // catalog DOES include the widget here it's allowed.
    const w = Math.min(widget.defaultLayout.w, 12);
    nextCanvas[widget.id] = { x: 0, y: appendY, w, h: widget.defaultLayout.h };
    appendY += widget.defaultLayout.h;
  }

  // Sidebar: drop unknowns from order/hidden, append missing to order.
  const seen = new Set<string>();
  const nextOrder: string[] = [];
  for (const id of base.sidebar.order) {
    if (!sidebarIds.has(id)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[lab-overview/layout] Dropping unknown sidebar widget id "${id}" from saved layout.`,
        );
      }
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    nextOrder.push(id);
  }
  const nextHidden = base.sidebar.hidden.filter(
    (id) => sidebarIds.has(id) && seen.has(id),
  );
  for (const widget of catalog) {
    if (widget.surface !== "sidebar" && widget.surface !== "both") continue;
    if (seen.has(widget.id)) continue;
    nextOrder.push(widget.id);
    // A brand-new widget shows up un-hidden by default.
  }

  return {
    version: LAB_OVERVIEW_LAYOUT_VERSION,
    canvas: nextCanvas,
    sidebar: { order: nextOrder, hidden: nextHidden },
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

/** Replace the entire layout (canvas + sidebar). Used by Reset layout. */
export async function writeLayout(
  username: string,
  layout: LabOverviewLayout,
): Promise<void> {
  await patchUserSettings(username, { lab_overview_layout: layout });
}

/** Patch the canvas map only. Used after a drag/resize commit. */
export async function patchCanvasLayout(
  username: string,
  nextCanvas: Record<string, LabOverviewWidgetPosition>,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing = current.lab_overview_layout ?? defaultLayoutFor(current.account_type);
  await patchUserSettings(username, {
    lab_overview_layout: { ...existing, canvas: nextCanvas },
  });
}

/** Patch the sidebar order/hidden only. Used after sidebar reorder + toggle. */
export async function patchSidebarLayout(
  username: string,
  nextSidebar: { order: string[]; hidden: string[] },
): Promise<void> {
  const current = await readUserSettings(username);
  const existing = current.lab_overview_layout ?? defaultLayoutFor(current.account_type);
  await patchUserSettings(username, {
    lab_overview_layout: { ...existing, sidebar: nextSidebar },
  });
}

/** Add a canvas widget at the next free row. No-op if already present. */
export async function addCanvasWidget(
  username: string,
  widget: WidgetDefinition,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing = current.lab_overview_layout ?? defaultLayoutFor(current.account_type);
  if (existing.canvas[widget.id]) return;
  let bottom = 0;
  for (const pos of Object.values(existing.canvas)) {
    bottom = Math.max(bottom, pos.y + pos.h);
  }
  const nextCanvas = {
    ...existing.canvas,
    [widget.id]: {
      x: 0,
      y: bottom,
      w: Math.min(widget.defaultLayout.w, 12),
      h: widget.defaultLayout.h,
    },
  };
  await patchUserSettings(username, {
    lab_overview_layout: { ...existing, canvas: nextCanvas },
  });
}

/** Remove a canvas widget. No-op if absent. */
export async function removeCanvasWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing = current.lab_overview_layout ?? defaultLayoutFor(current.account_type);
  if (!existing.canvas[widgetId]) return;
  const nextCanvas = { ...existing.canvas };
  delete nextCanvas[widgetId];
  await patchUserSettings(username, {
    lab_overview_layout: { ...existing, canvas: nextCanvas },
  });
}

/** Toggle a sidebar widget's hidden state. Adds to `order` if missing. */
export async function toggleSidebarWidget(
  username: string,
  widgetId: string,
): Promise<void> {
  const current = await readUserSettings(username);
  const existing = current.lab_overview_layout ?? defaultLayoutFor(current.account_type);
  const order = existing.sidebar.order.includes(widgetId)
    ? existing.sidebar.order
    : [...existing.sidebar.order, widgetId];
  const hiddenSet = new Set(existing.sidebar.hidden);
  if (hiddenSet.has(widgetId)) {
    hiddenSet.delete(widgetId);
  } else {
    hiddenSet.add(widgetId);
  }
  await patchUserSettings(username, {
    lab_overview_layout: {
      ...existing,
      sidebar: { order, hidden: Array.from(hiddenSet) },
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

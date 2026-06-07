// chunk-5 bot (2026-06-07): version-control wiring for inventory items and
// stocks. Mirrors sequences-history.ts (the most recent greenfield pattern).
//
// Each explicit create/update on an InventoryItem or InventoryStock now records
// a permanent, restorable version into the shared delta store.
//
// ENGINE MODEL FIT: inventory records are structured JSON objects with a clear
// key set, so the tracked state is a PROJECTION of the named fields rather than
// the raw on-disk blob. This gives a deterministic canonical (same record ->
// same string) and carries every field the version summary needs.
//
// ADDITIVE ONLY: this touches no existing history and migrates no existing
// files. A record whose .json predates this simply starts versioning from its
// next create or update. Gated behind HISTORY_ENGINE_ENABLED -- if the flag is
// off, every recorder call is a no-op.

import type { EntityViewerAdapter } from "./entity-viewer";
import { historyEngine } from "./engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "./notes-history";
import type { HistoryEditKind } from "./types";
import type { InventoryItem, InventoryStock } from "@/lib/types";

// Re-export the SHARED flags so inventory call sites read them from one place.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/** History-file namespace for inventory items: users/<owner>/_history/inventory_items/<id>.jsonl */
export const INVENTORY_ITEM_ENTITY_TYPE = "inventory_items";

/** History-file namespace for inventory stocks: users/<owner>/_history/inventory_stocks/<id>.jsonl */
export const INVENTORY_STOCK_ENTITY_TYPE = "inventory_stocks";

// ── InventoryItem tracked state ──────────────────────────────────────────────

/**
 * The slice of the InventoryItem the engine versions. Covers the fields a
 * researcher recognizes and edits (identity, sourcing, policy, notes), dropping
 * volatile read-time overlays (is_shared_with_me, shared_permission) so a
 * re-read round-trip does not churn the diff on a no-op edit.
 */
export interface InventoryItemTrackedState {
  name: string;
  category: string;
  catalog_number: string | null;
  vendor: string | null;
  cas: string | null;
  notes: string | null;
  low_at_count: number | null;
}

function projectItem(item: InventoryItem): InventoryItemTrackedState {
  return {
    name: item.name,
    category: item.category,
    catalog_number: item.catalog_number ?? null,
    vendor: item.vendor ?? null,
    cas: item.cas ?? null,
    notes: item.notes ?? null,
    low_at_count: item.low_at_count ?? null,
  };
}

/**
 * Best-effort: append an inventory item create/update to the delta store. A
 * history-write failure must NEVER throw into the user's save path (PROPOSAL.md
 * 3j), so this swallows every error after logging. The .json file has already
 * been written by the time this runs; history is a side-channel.
 *
 * No-op when the flag is off.
 */
export async function recordInventoryItemVersion(
  item: InventoryItem,
  actor: string,
): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: "update",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: item.id,
      owner: item.owner,
      actor,
      prevState: null,
      nextState: projectItem(item),
    });
  } catch (err) {
    console.warn(
      `[history] recordInventoryItemVersion failed for ${INVENTORY_ITEM_ENTITY_TYPE}/${item.id} (item saved, history skipped):`,
      err,
    );
  }
}

// ── InventoryStock tracked state ─────────────────────────────────────────────

/**
 * The slice of the InventoryStock the engine versions. Covers the fields a
 * researcher edits on a physical container set. Drops volatile overlays.
 */
export interface InventoryStockTrackedState {
  container_count: number;
  status: string;
  lot_number: string | null;
  received_date: string | null;
  expiration_date: string | null;
  location_text: string | null;
  amount_per_container: number | null;
  unit: string | null;
  notes: string | null;
}

function projectStock(stock: InventoryStock): InventoryStockTrackedState {
  return {
    container_count: stock.container_count,
    status: stock.status,
    lot_number: stock.lot_number ?? null,
    received_date: stock.received_date ?? null,
    expiration_date: stock.expiration_date ?? null,
    location_text: stock.location_text ?? null,
    amount_per_container: stock.amount_per_container ?? null,
    unit: stock.unit ?? null,
    notes: stock.notes ?? null,
  };
}

/**
 * Best-effort: append an inventory stock create/update to the delta store.
 * Swallows errors so a history failure never propagates into the save path.
 * No-op when the flag is off.
 */
export async function recordInventoryStockVersion(
  stock: InventoryStock,
  actor: string,
): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: "update",
      entityType: INVENTORY_STOCK_ENTITY_TYPE,
      id: stock.id,
      owner: stock.owner,
      actor,
      prevState: null,
      nextState: projectStock(stock),
    });
  } catch (err) {
    console.warn(
      `[history] recordInventoryStockVersion failed for ${INVENTORY_STOCK_ENTITY_TYPE}/${stock.id} (stock saved, history skipped):`,
      err,
    );
  }
}

// ── Viewer adapters ──────────────────────────────────────────────────────────

/** The projection the version viewer summarizes for an inventory item. */
export interface InventoryItemProjection {
  /** Compact digest satisfying EntityProjection.body. */
  body: string;
  name: string;
  category: string;
  vendor: string | null;
}

const EMPTY_ITEM_PROJECTION: InventoryItemProjection = {
  body: "",
  name: "",
  category: "",
  vendor: null,
};

/** Parse a reconstructed canonical state string into an InventoryItemProjection. */
export function projectInventoryItemState(
  canonical: string | null | undefined,
): InventoryItemProjection {
  if (!canonical || canonical.trim().length === 0) return EMPTY_ITEM_PROJECTION;
  let parsed: InventoryItemTrackedState;
  try {
    parsed = JSON.parse(canonical) as InventoryItemTrackedState;
  } catch {
    return EMPTY_ITEM_PROJECTION;
  }
  const vendor = parsed.vendor ?? null;
  const body = [parsed.name, parsed.category, vendor].filter(Boolean).join(", ");
  return { body, name: parsed.name ?? "", category: parsed.category ?? "", vendor };
}

/** One-line change summary for an inventory item version. */
export function summarizeInventoryItemChange(
  before: InventoryItemProjection | null,
  after: InventoryItemProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";
  if (before === null) return "created item";
  if (before.name !== after.name) {
    return after.name ? `renamed to ${after.name}` : "cleared name";
  }
  return "edited item";
}

export const inventoryItemAdapter: EntityViewerAdapter<InventoryItemProjection> = {
  projectBody: projectInventoryItemState,
  summarize: summarizeInventoryItemChange,
};

// ── Stock viewer ─────────────────────────────────────────────────────────────

/** The projection the version viewer summarizes for an inventory stock. */
export interface InventoryStockProjection {
  body: string;
  containerCount: number;
  status: string;
}

const EMPTY_STOCK_PROJECTION: InventoryStockProjection = {
  body: "",
  containerCount: 0,
  status: "",
};

/** Parse a reconstructed canonical state string into an InventoryStockProjection. */
export function projectInventoryStockState(
  canonical: string | null | undefined,
): InventoryStockProjection {
  if (!canonical || canonical.trim().length === 0) return EMPTY_STOCK_PROJECTION;
  let parsed: InventoryStockTrackedState;
  try {
    parsed = JSON.parse(canonical) as InventoryStockTrackedState;
  } catch {
    return EMPTY_STOCK_PROJECTION;
  }
  const count = typeof parsed.container_count === "number" ? parsed.container_count : 0;
  const status = parsed.status ?? "";
  const body = `${count} containers, ${status}`;
  return { body, containerCount: count, status };
}

/** One-line change summary for an inventory stock version. */
export function summarizeInventoryStockChange(
  before: InventoryStockProjection | null,
  after: InventoryStockProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";
  if (before === null) return "added stock";
  const delta = after.containerCount - before.containerCount;
  if (delta !== 0) {
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta} container${Math.abs(delta) !== 1 ? "s" : ""}`;
  }
  if (before.status !== after.status) return `status changed to ${after.status}`;
  return "edited stock";
}

export const inventoryStockAdapter: EntityViewerAdapter<InventoryStockProjection> = {
  projectBody: projectInventoryStockState,
  summarize: summarizeInventoryStockChange,
};

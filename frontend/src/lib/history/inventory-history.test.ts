// chunk-5 bot (2026-06-07): coverage for the inventory history wiring.
// Locks:
//   - the additive on-disk namespaces ("inventory_items", "inventory_stocks"),
//   - the structured-projection payload round-trip through the engine (genesis
//     + deltas),
//   - the viewer adapter's projection + one-line change summaries,
//   - the no-op short-circuit (re-saving an unchanged record mints no version).

import { describe, expect, it } from "vitest";
import { HistoryEngine } from "./engine";
import { canonicalize } from "./canonicalize";
import { historyFilePath } from "./storage";
import { isGenesisRow } from "./types";
import { MemoryStorage, makeClock } from "./test-utils";
import {
  INVENTORY_ITEM_ENTITY_TYPE,
  INVENTORY_STOCK_ENTITY_TYPE,
  projectInventoryItemState,
  projectInventoryStockState,
  summarizeInventoryItemChange,
  summarizeInventoryStockChange,
  inventoryItemAdapter,
  inventoryStockAdapter,
  type InventoryItemTrackedState,
  type InventoryStockTrackedState,
} from "./inventory-history";

const OWNER = "alex";
const ITEM_ID = 3;
const STOCK_ID = 11;

function makeItemEngine() {
  const storage = new MemoryStorage();
  const engine = new HistoryEngine({ storage, clock: makeClock() });
  return { engine, storage };
}

function itemState(over: Partial<InventoryItemTrackedState> = {}): InventoryItemTrackedState {
  return {
    name: "Q5 Polymerase",
    category: "enzyme",
    catalog_number: "M0491S",
    vendor: "NEB",
    cas: null,
    notes: null,
    low_at_count: 2,
    ...over,
  };
}

function stockState(over: Partial<InventoryStockTrackedState> = {}): InventoryStockTrackedState {
  return {
    container_count: 3,
    status: "in_stock",
    lot_number: "LOT001",
    received_date: "2026-01-15",
    expiration_date: "2028-01-15",
    location_text: "-80 top shelf",
    amount_per_container: null,
    unit: null,
    notes: null,
    ...over,
  };
}

// ── Entity type constants + path tests ──────────────────────────────────────

describe("inventory entity types + paths", () => {
  it("uses the additive namespaces from the design", () => {
    expect(INVENTORY_ITEM_ENTITY_TYPE).toBe("inventory_items");
    expect(INVENTORY_STOCK_ENTITY_TYPE).toBe("inventory_stocks");
  });

  it("resolves the documented on-disk history paths", () => {
    expect(historyFilePath(OWNER, INVENTORY_ITEM_ENTITY_TYPE, ITEM_ID)).toBe(
      "users/alex/_history/inventory_items/3.jsonl",
    );
    expect(historyFilePath(OWNER, INVENTORY_STOCK_ENTITY_TYPE, STOCK_ID)).toBe(
      "users/alex/_history/inventory_stocks/11.jsonl",
    );
  });
});

// ── InventoryItem history round-trip ────────────────────────────────────────

describe("inventory item history", () => {
  it("records a create row then an update delta", async () => {
    const { engine } = makeItemEngine();

    await engine.appendEdit({
      type: "create",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: itemState(),
    });

    await engine.appendEdit({
      type: "update",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: itemState(),
      nextState: itemState({ name: "Q5 High-Fidelity Polymerase" }),
    });

    const rows = await engine.readHistory(INVENTORY_ITEM_ENTITY_TYPE, OWNER, ITEM_ID);
    expect(rows).toHaveLength(3); // genesis + 2 deltas
    expect(isGenesisRow(rows[0])).toBe(true);
  });

  it("short-circuits a no-op save once history exists", async () => {
    const { engine } = makeItemEngine();
    const state = itemState();

    await engine.appendEdit({
      type: "create",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: state,
    });
    const before = await engine.readHistory(INVENTORY_ITEM_ENTITY_TYPE, OWNER, ITEM_ID);

    // Re-save identical state: the empty-delta short-circuit drops it.
    await engine.appendEdit({
      type: "update",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: state,
      nextState: state,
    });
    const after = await engine.readHistory(INVENTORY_ITEM_ENTITY_TYPE, OWNER, ITEM_ID);
    expect(after).toHaveLength(before.length);
  });

  it("reverse-walks to an earlier version for restore", async () => {
    const { engine } = makeItemEngine();
    const v1 = itemState({ name: "Q5" });
    const v2 = itemState({ name: "Q5 High-Fidelity" });
    const v3 = itemState({ name: "Q5 High-Fidelity Polymerase" });

    await engine.appendEdit({
      type: "create",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: v1,
    });
    await engine.appendEdit({
      type: "update",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: v1,
      nextState: v2,
    });
    await engine.appendEdit({
      type: "update",
      entityType: INVENTORY_ITEM_ENTITY_TYPE,
      id: ITEM_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: v2,
      nextState: v3,
    });

    const rows = await engine.readHistory(INVENTORY_ITEM_ENTITY_TYPE, OWNER, ITEM_ID);
    const headCanonical = canonicalize(v3);
    const restored = engine.reverseWalkTo(rows, 1, headCanonical);
    const proj = projectInventoryItemState(restored);
    expect(proj.name).toBe("Q5");
  });
});

// ── InventoryStock history round-trip ────────────────────────────────────────

describe("inventory stock history", () => {
  it("records create + update deltas for a stock", async () => {
    const { engine } = makeItemEngine();
    const s1 = stockState();
    const s2 = stockState({ container_count: 2, status: "low" });

    await engine.appendEdit({
      type: "create",
      entityType: INVENTORY_STOCK_ENTITY_TYPE,
      id: STOCK_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: s1,
    });
    await engine.appendEdit({
      type: "update",
      entityType: INVENTORY_STOCK_ENTITY_TYPE,
      id: STOCK_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: s1,
      nextState: s2,
    });

    const rows = await engine.readHistory(INVENTORY_STOCK_ENTITY_TYPE, OWNER, STOCK_ID);
    expect(rows).toHaveLength(3);
    expect(isGenesisRow(rows[0])).toBe(true);
  });
});

// ── Viewer adapter projection + summaries ────────────────────────────────────

describe("inventoryItemAdapter projection + summaries", () => {
  it("projects a malformed/empty canonical to the empty shape", () => {
    expect(projectInventoryItemState(null).name).toBe("");
    expect(projectInventoryItemState("").body).toBe("");
    expect(projectInventoryItemState("not json").name).toBe("");
  });

  it("builds the compact body from name, category, vendor", () => {
    const canonical = canonicalize(itemState());
    const proj = projectInventoryItemState(canonical);
    expect(proj.name).toBe("Q5 Polymerase");
    expect(proj.category).toBe("enzyme");
    expect(proj.vendor).toBe("NEB");
    expect(proj.body).toContain("Q5 Polymerase");
    expect(proj.body).toContain("enzyme");
  });

  it("summarizes created / renamed / edited rows", () => {
    const proj = projectInventoryItemState(canonicalize(itemState()));
    expect(summarizeInventoryItemChange(null, proj)).toBe("created item");
    const renamed = projectInventoryItemState(
      canonicalize(itemState({ name: "Q5 Plus" })),
    );
    expect(summarizeInventoryItemChange(proj, renamed)).toBe("renamed to Q5 Plus");
    expect(summarizeInventoryItemChange(proj, proj)).toBe("edited item");
  });

  it("labels restore / undo rows specially", () => {
    const proj = projectInventoryItemState(canonicalize(itemState()));
    expect(summarizeInventoryItemChange(proj, proj, "revert")).toBe(
      "Restored an earlier version",
    );
    expect(summarizeInventoryItemChange(proj, proj, "undo-revert")).toBe(
      "Undid a restore",
    );
  });

  it("exposes the adapter shape the panel consumes", () => {
    expect(inventoryItemAdapter.projectBody("bad").body).toBe("");
    const proj = projectInventoryItemState(canonicalize(itemState()));
    expect(inventoryItemAdapter.summarize(null, proj)).toBe("created item");
  });
});

describe("inventoryStockAdapter projection + summaries", () => {
  it("projects a malformed/empty canonical to the empty shape", () => {
    expect(projectInventoryStockState(null).containerCount).toBe(0);
    expect(projectInventoryStockState("").body).toBe("");
  });

  it("builds the compact body from container_count + status", () => {
    const canonical = canonicalize(stockState());
    const proj = projectInventoryStockState(canonical);
    expect(proj.containerCount).toBe(3);
    expect(proj.status).toBe("in_stock");
    expect(proj.body).toContain("3 containers");
    expect(proj.body).toContain("in_stock");
  });

  it("summarizes added / count-delta / status-change / edited rows", () => {
    const proj = projectInventoryStockState(canonicalize(stockState()));
    expect(summarizeInventoryStockChange(null, proj)).toBe("added stock");

    const fewer = projectInventoryStockState(canonicalize(stockState({ container_count: 1 })));
    expect(summarizeInventoryStockChange(proj, fewer)).toBe("-2 containers");

    const more = projectInventoryStockState(canonicalize(stockState({ container_count: 4 })));
    expect(summarizeInventoryStockChange(proj, more)).toBe("+1 container");

    const statusChange = projectInventoryStockState(
      canonicalize(stockState({ status: "empty" })),
    );
    expect(summarizeInventoryStockChange(proj, statusChange)).toBe(
      "status changed to empty",
    );

    expect(summarizeInventoryStockChange(proj, proj)).toBe("edited stock");
  });

  it("exposes the adapter shape the panel consumes", () => {
    expect(inventoryStockAdapter.projectBody("bad").body).toBe("");
    const proj = projectInventoryStockState(canonicalize(stockState()));
    expect(inventoryStockAdapter.summarize(null, proj)).toBe("added stock");
  });
});

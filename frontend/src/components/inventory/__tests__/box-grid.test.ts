// Box-finder map helper tests (box-finder map UI). All pure, no React renderer:
// occupancy maps stocks to the right cells by (location_node_id, position),
// tones cells by status, excludes unplaced stocks; the breadcrumb path walks
// parent_id (and tolerates a broken/cyclic tree); the location-display helper
// prefers the node breadcrumb and falls back to the v1 free-text note.

import { describe, expect, it } from "vitest";

import {
  boxCellToneForStock,
  buildBoxOccupancy,
  buildLocationBreadcrumb,
  buildNodePath,
  descendantBoxes,
  stockLocationDisplay,
} from "../inventory-ui";
import type { InventoryItem, InventoryStock, StorageNode } from "@/lib/types";

const NOW = new Date("2026-06-07T12:00:00.000Z");

function isoDaysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makeItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    name: "Q5 Polymerase",
    category: "enzyme",
    catalog_number: null,
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: "vial",
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: null,
    track_consumption: false,
    product_barcode: null,
    registry: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

function makeStock(over: Partial<InventoryStock> = {}): InventoryStock {
  return {
    id: 1,
    item_id: 1,
    lot_number: null,
    container_count: 3,
    status: "in_stock",
    received_date: null,
    expiration_date: null,
    opened_date: null,
    last_touched_at: null,
    amount_per_container: null,
    unit: null,
    concentration: null,
    location_text: null,
    location_node_id: null,
    position: null,
    purchase_item_id: null,
    container_code: null,
    notes: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

function makeNode(over: Partial<StorageNode> = {}): StorageNode {
  return {
    id: 1,
    name: "Node",
    kind: "other",
    parent_id: null,
    temperature: null,
    box_rows: null,
    box_cols: null,
    notes: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

// A small tree: -80 #2 (freezer) > Rack 3 (rack) > Box: Enzymes (box 9x9).
const freezer = makeNode({ id: 10, name: "-80 #2", kind: "freezer" });
const rack = makeNode({ id: 11, name: "Rack 3", kind: "rack", parent_id: 10 });
const box = makeNode({
  id: 12,
  name: "Box: Enzymes",
  kind: "box",
  parent_id: 11,
  box_rows: 9,
  box_cols: 9,
});
const otherBox = makeNode({
  id: 99,
  name: "Box: Primers",
  kind: "box",
  parent_id: 11,
  box_rows: 9,
  box_cols: 9,
});

const nodesById = new Map<number, StorageNode>(
  [freezer, rack, box, otherBox].map((n) => [n.id, n]),
);

describe("buildBoxOccupancy", () => {
  // Keyed `${owner}:${item_id}` (default owner "me", id 1 -> "me:1") so a
  // shared-in stock cannot collide with a local item of the same numeric id.
  const items = new Map<string, InventoryItem>([["me:1", makeItem()]]);

  it("resolves each occupant to its own owner's item by composite key", () => {
    const mixed = new Map<string, InventoryItem>([
      ["alex:1", makeItem({ id: 1, owner: "alex", name: "Alex enzyme" })],
      ["mira:1", makeItem({ id: 1, owner: "mira", name: "Mira enzyme" })],
    ]);
    const stocks = [
      makeStock({ id: 1, owner: "alex", item_id: 1, location_node_id: 12, position: "A1" }),
      makeStock({ id: 2, owner: "mira", item_id: 1, location_node_id: 12, position: "A2" }),
    ];
    const occ = buildBoxOccupancy(12, stocks, mixed, NOW);
    expect(occ.get("A1")?.item?.name).toBe("Alex enzyme");
    expect(occ.get("A2")?.item?.name).toBe("Mira enzyme");
  });

  it("maps stocks to cells by (location_node_id, position)", () => {
    const stocks = [
      makeStock({ id: 1, location_node_id: 12, position: "B4" }),
      makeStock({ id: 2, location_node_id: 12, position: "A1" }),
    ];
    const occ = buildBoxOccupancy(12, stocks, items, NOW);
    expect([...occ.keys()].sort()).toEqual(["A1", "B4"]);
    expect(occ.get("B4")?.stock.id).toBe(1);
    expect(occ.get("A1")?.stock.id).toBe(2);
  });

  it("excludes unplaced stocks (no node, or node without a position)", () => {
    const stocks = [
      makeStock({ id: 1, location_node_id: null, position: null }),
      makeStock({ id: 2, location_node_id: 12, position: null }),
      makeStock({ id: 3, location_node_id: 12, position: "C3" }),
    ];
    const occ = buildBoxOccupancy(12, stocks, items, NOW);
    expect([...occ.keys()]).toEqual(["C3"]);
  });

  it("excludes stocks placed in a DIFFERENT box", () => {
    const stocks = [
      makeStock({ id: 1, location_node_id: 99, position: "B4" }),
      makeStock({ id: 2, location_node_id: 12, position: "B4" }),
    ];
    const occ = buildBoxOccupancy(12, stocks, items, NOW);
    expect(occ.size).toBe(1);
    expect(occ.get("B4")?.stock.id).toBe(2);
  });

  it("keeps the first stock when two claim the same cell (deterministic)", () => {
    const stocks = [
      makeStock({ id: 1, location_node_id: 12, position: "B4" }),
      makeStock({ id: 2, location_node_id: 12, position: "B4" }),
    ];
    const occ = buildBoxOccupancy(12, stocks, items, NOW);
    expect(occ.get("B4")?.stock.id).toBe(1);
  });

  it("tones each occupant by status / expiry", () => {
    const stocks = [
      makeStock({ id: 1, location_node_id: 12, position: "A1", status: "in_stock" }),
      makeStock({ id: 2, location_node_id: 12, position: "A2", status: "low" }),
      makeStock({ id: 3, location_node_id: 12, position: "A3", status: "empty" }),
      makeStock({ id: 4, location_node_id: 12, position: "A4", status: "expired" }),
      makeStock({
        id: 5,
        location_node_id: 12,
        position: "A5",
        status: "in_stock",
        expiration_date: isoDaysFromNow(10),
      }),
    ];
    const occ = buildBoxOccupancy(12, stocks, items, NOW);
    expect(occ.get("A1")?.tone).toBe("in");
    expect(occ.get("A2")?.tone).toBe("low");
    expect(occ.get("A3")?.tone).toBe("low");
    expect(occ.get("A4")?.tone).toBe("exp");
    // Within the 30-day expiring window -> rose, even though status is in_stock.
    expect(occ.get("A5")?.tone).toBe("exp");
  });
});

describe("boxCellToneForStock", () => {
  it("in_stock with a far expiry stays in", () => {
    expect(
      boxCellToneForStock(
        makeStock({ status: "in_stock", expiration_date: isoDaysFromNow(120) }),
        NOW,
      ),
    ).toBe("in");
  });
  it("expired status overrides everything", () => {
    expect(boxCellToneForStock(makeStock({ status: "expired" }), NOW)).toBe(
      "exp",
    );
  });
});

describe("buildNodePath / buildLocationBreadcrumb", () => {
  it("walks parent_id root-first", () => {
    const path = buildNodePath(12, nodesById);
    expect(path.map((n) => n.id)).toEqual([10, 11, 12]);
  });

  it("builds the breadcrumb with the position appended, Box: prefix stripped", () => {
    expect(buildLocationBreadcrumb(12, "B4", nodesById)).toBe(
      "-80 #2 / Rack 3 / Enzymes / B4",
    );
  });

  it("omits the position when absent", () => {
    expect(buildLocationBreadcrumb(12, null, nodesById)).toBe(
      "-80 #2 / Rack 3 / Enzymes",
    );
  });

  it("returns null for an unknown node id", () => {
    expect(buildLocationBreadcrumb(123456, "A1", nodesById)).toBeNull();
    expect(buildLocationBreadcrumb(null, "A1", nodesById)).toBeNull();
  });

  it("stops at a missing ancestor instead of looping", () => {
    // Box whose parent was deleted: the path is just the box itself.
    const orphan = makeNode({ id: 30, name: "Box: Lost", kind: "box", parent_id: 777 });
    const m = new Map(nodesById);
    m.set(30, orphan);
    expect(buildNodePath(30, m).map((n) => n.id)).toEqual([30]);
  });

  it("guards against a parent_id cycle", () => {
    const a = makeNode({ id: 40, parent_id: 41 });
    const b = makeNode({ id: 41, parent_id: 40 });
    const m = new Map<number, StorageNode>([
      [40, a],
      [41, b],
    ]);
    const path = buildNodePath(40, m);
    // Two distinct nodes, no infinite loop.
    expect(path.length).toBe(2);
  });
});

describe("stockLocationDisplay", () => {
  it("prefers the node breadcrumb when a box + position are set", () => {
    const disp = stockLocationDisplay(
      makeStock({ location_node_id: 12, position: "B4", location_text: "ignored" }),
      nodesById,
    );
    expect(disp).toEqual({
      text: "-80 #2 / Rack 3 / Enzymes / B4",
      kind: "node",
      nodeId: 12,
      position: "B4",
    });
  });

  it("falls back to the free-text note when no node is set", () => {
    const disp = stockLocationDisplay(
      makeStock({ location_node_id: null, location_text: "-80 door, left" }),
      nodesById,
    );
    expect(disp).toEqual({
      text: "-80 door, left",
      kind: "text",
      nodeId: null,
      position: null,
    });
  });

  it("falls back to free-text when the node id is unknown (deleted box)", () => {
    const disp = stockLocationDisplay(
      makeStock({ location_node_id: 999999, position: "A1", location_text: "fridge" }),
      nodesById,
    );
    expect(disp?.kind).toBe("text");
    expect(disp?.text).toBe("fridge");
  });

  it("returns null when neither location is set", () => {
    expect(stockLocationDisplay(makeStock(), nodesById)).toBeNull();
  });
});

describe("descendantBoxes", () => {
  it("returns every box under an ancestor", () => {
    const boxes = descendantBoxes(10, [freezer, rack, box, otherBox]);
    expect(boxes.map((b) => b.id).sort()).toEqual([12, 99]);
  });
  it("returns the boxes directly under a rack", () => {
    const boxes = descendantBoxes(11, [freezer, rack, box, otherBox]);
    expect(boxes.map((b) => b.id).sort()).toEqual([12, 99]);
  });
});

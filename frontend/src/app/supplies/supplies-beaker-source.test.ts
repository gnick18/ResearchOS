// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 6. Tests for the PURE
// Supplies BeakerSearch source builder, mirroring purchases-beaker-source.test.ts.
// They cover the context-card copy (scope + selection + lab-head approval chip;
// member omits it), the command set (ids + groups + enabled gating, incl. the
// set-status single-stock + edit gating, the approve-only-with-confirm rule, the
// greyed reason for a lab head without a confirm, and the OMISSION of approval
// rows for members), the Suggested ordering per context, the inline set-status
// sub-flow, and the nav groups, all without a DOM or a store.

import { describe, it, expect } from "vitest";
import type {
  EditorCommand,
  PaletteSubflow,
} from "@/components/sequences/editor-commands";
import type { PurchaseItem } from "@/lib/types";
import type { Supply } from "@/lib/supplies/supply-model";
import {
  buildSuppliesSource,
  type SuppliesSourceData,
  type SuppliesSourceHandlers,
} from "./supplies-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

let lineSeq = 0;
function makeLine(over: Partial<PurchaseItem> & { owner?: string } = {}): PurchaseItem {
  lineSeq += 1;
  return {
    id: lineSeq,
    task_id: 1,
    item_name: `Line ${lineSeq}`,
    quantity: 1,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 10,
    vendor: "NEB",
    category: null,
    funding_string: null,
    order_status: "needs_ordering",
    approved: false,
    declined_at: null,
    owner: "self",
    ...over,
  } as PurchaseItem & { owner: string };
}

function makeSupply(over: Partial<Supply> = {}): Supply {
  const onHand = over.onHand ?? {
    itemIds: [1],
    totalCount: 3,
    stockCount: 1,
    worstStatus: "in_stock" as const,
    soonestExpiry: null,
  };
  const ordering = over.ordering ?? null;
  return {
    key: over.key ?? "vc:neb|m0491s",
    identity: over.identity ?? {
      name: "Q5 Polymerase",
      vendor: "NEB",
      catalogNumber: "M0491S",
      cas: null,
      category: "enzyme",
    },
    onHand,
    ordering,
    kind: over.kind ?? (onHand && ordering ? "both" : onHand ? "onHand" : "order"),
  };
}

const noopHandlers: SuppliesSourceHandlers = {
  setSelectedKey: () => {},
  openAddItem: () => {},
  openScan: () => {},
  openImport: () => {},
  reorderSupply: () => {},
  setFilter: () => {},
  setStockStatus: () => {},
  approveLine: () => {},
  declineLine: () => {},
  openSpending: () => {},
};

function makeData(over: Partial<SuppliesSourceData> = {}): SuppliesSourceData {
  const supplies = over.supplies ?? [];
  return {
    supplies,
    visible: over.visible ?? supplies,
    counts: over.counts ?? {
      all: supplies.length,
      attention: 0,
      onorder: 0,
    },
    filter: over.filter ?? "all",
    selectedSupply: over.selectedSupply ?? null,
    hoveredSupply: over.hoveredSupply ?? null,
    currentUser: over.currentUser ?? "self",
    isLabHead: over.isLabHead ?? false,
    hasLiveSession: over.hasLiveSession ?? false,
    labPendingApprovalCount: over.labPendingApprovalCount ?? 0,
    categoryLabelOf: over.categoryLabelOf ?? ((c) => c ?? ""),
    canEdit: over.canEdit ?? (() => true),
    isInCart: over.isInCart ?? (() => false),
  };
}

function cmdById(cmds: EditorCommand[], id: string): EditorCommand | undefined {
  return cmds.find((c) => c.id === id);
}

// ── Context card ─────────────────────────────────────────────────────────────

describe("buildSuppliesSource context card", () => {
  it("an unfiltered card mirrors the supply count", () => {
    const supplies = [makeSupply({ key: "a" }), makeSupply({ key: "b" })];
    const src = buildSuppliesSource(
      makeData({ supplies, counts: { all: 2, attention: 0, onorder: 0 } }),
      noopHandlers,
    );
    expect(src.contextCard?.title).toBe("Supplies");
    expect(src.contextCard?.meta).toBe("2 supplies");
    expect(src.contextCard?.selection).toBeUndefined();
  });

  it("singularizes one supply", () => {
    const supplies = [makeSupply({ key: "a" })];
    const src = buildSuppliesSource(
      makeData({ supplies, counts: { all: 1, attention: 0, onorder: 0 } }),
      noopHandlers,
    );
    expect(src.contextCard?.meta).toBe("1 supply");
  });

  it("a filtered card leads with the filter scope + the window count", () => {
    const supplies = [makeSupply({ key: "a" }), makeSupply({ key: "b" })];
    const src = buildSuppliesSource(
      makeData({
        supplies,
        visible: [supplies[0]],
        filter: "attention",
        counts: { all: 2, attention: 1, onorder: 0 },
      }),
      noopHandlers,
    );
    expect(src.contextCard?.meta).toBe("needs attention, 1 shown");
  });

  it("the selection line names the supply + its on-hand / on-order summary", () => {
    const supply = makeSupply({
      onHand: {
        itemIds: [1],
        totalCount: 2,
        stockCount: 1,
        worstStatus: "low",
        soonestExpiry: null,
      },
      ordering: { openLines: [makeLine()], needsOrderingCount: 1, orderedCount: 0 },
    });
    const src = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply] }),
      noopHandlers,
    );
    expect(src.contextCard?.selection?.text).toBe(
      'Selected, "Q5 Polymerase", 2 on hand, needs ordering',
    );
  });

  it("a hover softens the selection line", () => {
    const supply = makeSupply();
    const src = buildSuppliesSource(
      makeData({ hoveredSupply: supply, supplies: [supply] }),
      noopHandlers,
    );
    expect(src.contextCard?.selection?.text).toBe('Pointing at "Q5 Polymerase"');
  });

  it("shows the lab-head approval chip ONLY for a lab head with a queue", () => {
    const labCard = buildSuppliesSource(
      makeData({ isLabHead: true, labPendingApprovalCount: 4 }),
      noopHandlers,
    ).contextCard;
    expect(labCard?.chips?.[0]?.label).toBe("4 items await your approval");

    const memberCard = buildSuppliesSource(
      makeData({ isLabHead: false, labPendingApprovalCount: 4 }),
      noopHandlers,
    ).contextCard;
    expect(memberCard?.chips).toBeUndefined();

    const emptyQueue = buildSuppliesSource(
      makeData({ isLabHead: true, labPendingApprovalCount: 0 }),
      noopHandlers,
    ).contextCard;
    expect(emptyQueue?.chips).toBeUndefined();
  });
});

// ── Command set: the always-present long tail ────────────────────────────────

describe("buildSuppliesSource command set", () => {
  it("always offers Add / Filters / Tools (scan + import)", () => {
    const cmds = buildSuppliesSource(makeData(), noopHandlers).commands;
    expect(cmdById(cmds, "supplies-add")?.group).toBe("Create");
    expect(cmdById(cmds, "supplies-filter-attention")?.group).toBe("Filters");
    expect(cmdById(cmds, "supplies-scan")?.group).toBe("Tools");
    expect(cmdById(cmds, "supplies-import")?.group).toBe("Tools");
  });

  it("disables the active filter row", () => {
    const cmds = buildSuppliesSource(
      makeData({ filter: "onorder" }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-filter-onorder")?.enabled).toBe(false);
    expect(cmdById(cmds, "supplies-filter-all")?.enabled).not.toBe(false);
  });

  it("shows the awaiting-approval filter + spending command for a lab head only", () => {
    const labCmds = buildSuppliesSource(
      makeData({ isLabHead: true }),
      noopHandlers,
    ).commands;
    expect(cmdById(labCmds, "supplies-filter-awaiting_approval")).toBeDefined();
    expect(cmdById(labCmds, "supplies-open-spending")?.group).toBe("Spending");

    const memberCmds = buildSuppliesSource(
      makeData({ isLabHead: false }),
      noopHandlers,
    ).commands;
    expect(cmdById(memberCmds, "supplies-filter-awaiting_approval")).toBeUndefined();
    expect(cmdById(memberCmds, "supplies-open-spending")).toBeUndefined();
  });
});

// ── Selected supply: reorder + set-status ────────────────────────────────────

describe("buildSuppliesSource selected supply", () => {
  it("offers open + reorder + set-status for a selected editable single-stock supply", () => {
    const supply = makeSupply();
    const cmds = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply] }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-open-supply")).toBeDefined();
    expect(cmdById(cmds, "supplies-reorder")?.enabled).not.toBe(false);
    expect(cmdById(cmds, "supplies-set-status")?.enabled).toBe(true);
  });

  it("softens reorder when the supply is already in the cart", () => {
    const supply = makeSupply();
    const cmds = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        isInCart: (k) => k === supply.key,
      }),
      noopHandlers,
    ).commands;
    const reorder = cmdById(cmds, "supplies-reorder");
    expect(reorder?.enabled).toBe(false);
    expect(reorder?.detail).toBe("already in the reorder cart");
  });

  it("greys set-status when the backing item is not editable", () => {
    const supply = makeSupply();
    const cmds = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        canEdit: () => false,
      }),
      noopHandlers,
    ).commands;
    const set = cmdById(cmds, "supplies-set-status");
    expect(set?.enabled).toBe(false);
    expect(set?.detail).toBe("you cannot edit this supply");
  });

  it("greys set-status when the supply has more than one stock", () => {
    const supply = makeSupply({
      onHand: {
        itemIds: [1],
        totalCount: 5,
        stockCount: 2,
        worstStatus: "in_stock",
        soonestExpiry: null,
      },
    });
    const cmds = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply] }),
      noopHandlers,
    ).commands;
    const set = cmdById(cmds, "supplies-set-status");
    expect(set?.enabled).toBe(false);
    expect(set?.detail).toBe("open the supply to set a specific stock");
  });

  it("greys set-status for an order-only supply (no on-hand stock)", () => {
    const supply = makeSupply({
      key: "n:flight",
      identity: { name: "Flight", vendor: null, catalogNumber: null, cas: null, category: null },
      onHand: null,
      ordering: { openLines: [makeLine()], needsOrderingCount: 1, orderedCount: 0 },
    });
    const cmds = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply], canEdit: () => false }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-set-status")?.enabled).toBe(false);
  });

  it("runs reorder + the set-status sub-flow through the real handlers", () => {
    const reordered: string[] = [];
    const statusSet: Array<[string, string]> = [];
    const handlers: SuppliesSourceHandlers = {
      ...noopHandlers,
      reorderSupply: (s) => reordered.push(s.key),
      setStockStatus: (s, status) => statusSet.push([s.key, status]),
    };
    const supply = makeSupply();
    const cmds = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply] }),
      handlers,
    ).commands;
    cmdById(cmds, "supplies-reorder")!.run();
    expect(reordered).toEqual([supply.key]);

    const sf = cmdById(cmds, "supplies-set-status")!.subflow!();
    // Single stage, renders inline by inference.
    expect(sf.presentation).toBeUndefined();
    expect(sf.items.map((i) => i.label)).toEqual(["In stock", "Low", "Empty"]);
    // The supply's current status is offered but disabled.
    expect(sf.items[0].enabled).toBe(false); // in_stock is the worstStatus here
    const next = sf.onPick(sf.items[1]);
    expect(next).toBeUndefined();
    expect(statusSet).toEqual([[supply.key, "low"]]);
    // Type-only assert so the PaletteSubflow import is exercised.
    const typed: PaletteSubflow = sf;
    expect(typed.title).toContain("Q5 Polymerase");
  });
});

// ── Approval gating ──────────────────────────────────────────────────────────

describe("buildSuppliesSource approval gating", () => {
  function pendingMemberSupply(): Supply {
    return makeSupply({
      ordering: {
        openLines: [makeLine({ owner: "alex", approved: false })],
        needsOrderingCount: 1,
        orderedCount: 0,
      },
    });
  }

  it("OMITS approve / decline rows entirely for a member", () => {
    const supply = pendingMemberSupply();
    const cmds = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply], isLabHead: false }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-approve-line")).toBeUndefined();
    expect(cmdById(cmds, "supplies-decline-line")).toBeUndefined();
  });

  it("greys approve / decline for a lab head WITHOUT a confirm, with the reason", () => {
    const supply = pendingMemberSupply();
    const cmds = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        isLabHead: true,
        hasLiveSession: false,
      }),
      noopHandlers,
    ).commands;
    const approve = cmdById(cmds, "supplies-approve-line");
    expect(approve?.enabled).toBe(false);
    expect(approve?.detail).toBe(
      "Confirm 'Edit as lab head' on the line to approve",
    );
    expect(cmdById(cmds, "supplies-decline-line")?.enabled).toBe(false);
  });

  it("enables approve / decline ONLY with isLabHead && hasLiveSession", () => {
    const supply = pendingMemberSupply();
    const cmds = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        isLabHead: true,
        hasLiveSession: true,
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-approve-line")?.enabled).toBe(true);
    expect(cmdById(cmds, "supplies-decline-line")?.enabled).toBe(true);
  });

  it("omits approval when the supply has no pending line", () => {
    const supply = makeSupply({
      ordering: {
        openLines: [makeLine({ owner: "alex", approved: true })],
        needsOrderingCount: 0,
        orderedCount: 1,
      },
    });
    const cmds = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        isLabHead: true,
        hasLiveSession: true,
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "supplies-approve-line")).toBeUndefined();
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildSuppliesSource suggested ids", () => {
  it("a selected supply leads with open + reorder + set-status", () => {
    const supply = makeSupply();
    const src = buildSuppliesSource(
      makeData({ selectedSupply: supply, supplies: [supply] }),
      noopHandlers,
    );
    expect(src.suggestedIds?.[0]).toBe("supplies-open-supply");
    expect(src.suggestedIds).toContain("supplies-reorder");
    expect(src.suggestedIds).toContain("supplies-set-status");
    expect(src.suggestedHint).toBe("for the selected supply");
  });

  it("a selected supply with a pending line (lab head) appends approve / decline", () => {
    const supply = makeSupply({
      ordering: {
        openLines: [makeLine({ owner: "alex", approved: false })],
        needsOrderingCount: 1,
        orderedCount: 0,
      },
    });
    const src = buildSuppliesSource(
      makeData({
        selectedSupply: supply,
        supplies: [supply],
        isLabHead: true,
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("supplies-approve-line");
    expect(src.suggestedIds).toContain("supplies-decline-line");
  });

  it("a hover softens the suggested hint", () => {
    const supply = makeSupply();
    const src = buildSuppliesSource(
      makeData({ hoveredSupply: supply, supplies: [supply] }),
      noopHandlers,
    );
    expect(src.suggestedHint).toBe("for the supply under your cursor");
  });

  it("the awaiting-approval filter (lab head) suggests the lens + spending set", () => {
    const src = buildSuppliesSource(
      makeData({ filter: "awaiting_approval", isLabHead: true }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "supplies-filter-all",
      "supplies-open-spending",
    ]);
    expect(src.suggestedHint).toBe("for the approval queue");
  });

  it("nothing selected suggests add / scan / import (+ spending for a lab head)", () => {
    const member = buildSuppliesSource(makeData(), noopHandlers);
    expect(member.suggestedIds).toEqual([
      "supplies-add",
      "supplies-scan",
      "supplies-import",
    ]);
    expect(member.suggestedHint).toBeUndefined();

    const lab = buildSuppliesSource(makeData({ isLabHead: true }), noopHandlers);
    expect(lab.suggestedIds).toEqual([
      "supplies-add",
      "supplies-scan",
      "supplies-import",
      "supplies-open-spending",
    ]);
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildSuppliesSource nav groups", () => {
  it("jump-to-a-supply uses the inventory tone + the on-screen window", () => {
    const supplies = [makeSupply({ key: "a" }), makeSupply({ key: "b" })];
    const src = buildSuppliesSource(
      makeData({ supplies, visible: supplies }),
      noopHandlers,
    );
    const jump = src.navGroups?.find((g) => g.title === "Jump to a supply");
    expect(jump?.items.length).toBe(2);
    expect(jump?.items[0].tone).toBe("inventory");
    expect(jump?.items[0].label).toBe("Q5 Polymerase");
  });

  it("widens the jump list to all supplies when the visible window is empty", () => {
    const supplies = [makeSupply({ key: "a" }), makeSupply({ key: "b" })];
    const src = buildSuppliesSource(
      makeData({ supplies, visible: [] }),
      noopHandlers,
    );
    const jump = src.navGroups?.find((g) => g.title === "Jump to a supply");
    expect(jump?.items.length).toBe(2);
  });
});

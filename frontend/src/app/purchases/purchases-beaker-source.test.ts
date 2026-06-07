// sequence editor master (Purchases source sub-bot). Tests for the PURE
// Purchases BeakerSearch source builder. These cover the context-card copy
// (scope + selection + lab-head approval line; member omits it), the command set
// (ids + groups + enabled gating, incl. the approve-only-with-confirm rule, the
// greyed reason for a lab head without a confirm, the OMISSION of approval rows
// for members, and the shared-order write greying), the Suggested ordering per
// context (selected order / awaiting-approval filter / nothing), the nav groups
// (purchases task tone + funding tone), and the > 4 items bulk-collapse, all
// without a DOM or a store, mirroring gantt-beaker-source.test.ts.

import { describe, it, expect } from "vitest";
import type {
  EditorCommand,
  PaletteNavItem,
} from "@/components/sequences/editor-commands";
import type { FundingAccount, Project, PurchaseItem, Task } from "@/lib/types";
import {
  buildPurchasesSource,
  type PurchasesSourceData,
  type PurchasesSourceHandlers,
  type SpendingExportDescriptor,
} from "./purchases-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 10,
    owner: "self",
    name: "qPCR reagents",
    start_date: "2026-06-01",
    duration_days: 1,
    end_date: "2026-06-01",
    is_high_level: false,
    is_complete: false,
    task_type: "purchase",
    is_shared_with_me: false,
    tags: [],
    ...over,
  } as Task;
}

let itemSeq = 0;
function makeItem(
  over: Partial<PurchaseItem> & { owner?: string } = {},
): PurchaseItem {
  itemSeq += 1;
  return {
    id: itemSeq,
    task_id: 1,
    item_name: `Item ${itemSeq}`,
    quantity: 1,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 10,
    vendor: "Acme",
    category: null,
    funding_string: null,
    assigned_to: null,
    order_status: "needs_ordering",
    approved: false,
    declined_at: null,
    owner: "self",
    ...over,
  } as PurchaseItem & { owner: string };
}

function makeFunding(over: Partial<FundingAccount> = {}): FundingAccount {
  return {
    id: 1,
    name: "NIH R01",
    description: null,
    total_budget: 20000,
    spent: 4120,
    remaining: 15880,
    award_number: "R01-12345",
    funder_name: "National Institutes of Health",
    ...over,
  } as FundingAccount;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 10,
    owner: "self",
    name: "Project Alpha",
    color: "#3b82f6",
    is_archived: false,
    tags: [],
    ...over,
  } as Project;
}

const noopHandlers: PurchasesSourceHandlers = {
  setSelectedTask: () => {},
  setShowNewPurchase: () => {},
  setShowFundingManager: () => {},
  setCategoryFilter: () => {},
  setOrderStatusFilter: () => {},
  setItemStatus: () => {},
  setOrderComplete: () => {},
  deleteOrder: () => {},
  approveItem: () => {},
  declineItem: () => {},
  exportSpendingCsv: () => {},
  focusDashboard: () => {},
  openLabOverview: () => {},
};

/** A baseline data snapshot. Pass an order + its items + role flags via over. */
function makeData(over: Partial<PurchasesSourceData> = {}): PurchasesSourceData {
  const task = over.selectedTask ?? null;
  const projects = over.projects ?? [makeProject()];
  return {
    purchaseTasks: over.purchaseTasks ?? (task ? [task] : []),
    purchasesByTask: over.purchasesByTask ?? {},
    projects,
    fundingAccounts: over.fundingAccounts ?? [],
    sortedTasks: over.sortedTasks ?? (task ? [task] : []),
    grandTotal: over.grandTotal ?? 0,
    categoryFilter: over.categoryFilter ?? "all",
    orderStatusFilter: over.orderStatusFilter ?? "any",
    visibleTotal: over.visibleTotal ?? 0,
    hasExportableItems: over.hasExportableItems ?? true,
    selectedTask: task,
    hoveredTask: over.hoveredTask ?? null,
    currentUser: over.currentUser ?? "self",
    isLabHead: over.isLabHead ?? false,
    hasLiveSession: over.hasLiveSession ?? false,
    sessionId: over.sessionId,
    labPendingApprovalCount: over.labPendingApprovalCount ?? 0,
    projectNameOf:
      over.projectNameOf ??
      ((t: Task) => projects.find((p) => p.id === t.project_id)?.name ?? null),
    taskKeyOf: over.taskKeyOf ?? ((t: Task) => `${t.is_shared_with_me ? t.owner : "self"}:${t.id}`),
  };
}

function cmdById(cmds: EditorCommand[], id: string): EditorCommand | undefined {
  return cmds.find((c) => c.id === id);
}

// ── Context card (spec 2.5) ──────────────────────────────────────────────────

describe("buildPurchasesSource context card", () => {
  it("an unfiltered card mirrors the page subhead (orders + grand total)", () => {
    const orders = [makeTask({ id: 1 }), makeTask({ id: 2 })];
    const src = buildPurchasesSource(
      makeData({ purchaseTasks: orders, sortedTasks: orders, grandTotal: 9140 }),
      noopHandlers,
    );
    expect(src.contextCard?.title).toBe("Purchases");
    expect(src.contextCard?.meta).toBe("2 orders, $9,140.00 total");
    expect(src.contextCard?.selection).toBeUndefined();
  });

  it("a filtered card leads with the status-filter scope + window snapshot", () => {
    const orders = [makeTask({ id: 1 }), makeTask({ id: 2 })];
    const src = buildPurchasesSource(
      makeData({
        purchaseTasks: orders,
        sortedTasks: [orders[0]],
        orderStatusFilter: "needs_ordering",
        visibleTotal: 320,
      }),
      noopHandlers,
    );
    expect(src.contextCard?.meta).toBe("needs ordering, 1 order, $320.00");
  });

  it("the selection line names the order, project, item count, total", () => {
    const task = makeTask({ id: 1, name: "qPCR reagents" });
    const items = [
      makeItem({ task_id: 1, total_price: 600 }),
      makeItem({ task_id: 1, total_price: 12.4 }),
    ];
    const src = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchasesByTask: { "self:1": items },
      }),
      noopHandlers,
    );
    expect(src.contextCard?.selection?.text).toBe(
      'Selected, "qPCR reagents", Project Alpha, 2 items, $612.40',
    );
  });

  it("shows the lab-head approval line ONLY for a lab head with a queue", () => {
    const labCard = buildPurchasesSource(
      makeData({ isLabHead: true, labPendingApprovalCount: 8 }),
      noopHandlers,
    ).contextCard;
    expect(labCard?.chips?.[0]?.label).toBe("8 items await your approval");

    const memberCard = buildPurchasesSource(
      makeData({ isLabHead: false, labPendingApprovalCount: 8 }),
      noopHandlers,
    ).contextCard;
    expect(memberCard?.chips).toBeUndefined();

    const emptyQueue = buildPurchasesSource(
      makeData({ isLabHead: true, labPendingApprovalCount: 0 }),
      noopHandlers,
    ).contextCard;
    expect(emptyQueue?.chips).toBeUndefined();
  });
});

// ── Commands: approval gating (spec 3.1) ─────────────────────────────────────

describe("buildPurchasesSource approval gating", () => {
  it("OMITS approve / decline rows entirely for a member", () => {
    const task = makeTask({ id: 1, owner: "alex", is_shared_with_me: true });
    const items = [makeItem({ task_id: 1, owner: "alex", approved: false })];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "alex:1": items },
        isLabHead: false,
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "purchases-approve-item")).toBeUndefined();
    expect(cmdById(cmds, "purchases-decline-item")).toBeUndefined();
  });

  it("greys approve for a lab head WITHOUT a confirm, with the reason", () => {
    const task = makeTask({ id: 1, owner: "alex", is_shared_with_me: true });
    const items = [makeItem({ task_id: 1, owner: "alex", approved: false })];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "alex:1": items },
        isLabHead: true,
        hasLiveSession: false,
      }),
      noopHandlers,
    ).commands;
    const approve = cmdById(cmds, "purchases-approve-item");
    expect(approve).toBeDefined();
    expect(approve?.enabled).toBe(false);
    expect(approve?.detail).toBe(
      "Confirm 'Edit as lab head' on the order to approve",
    );
    const decline = cmdById(cmds, "purchases-decline-item");
    expect(decline?.enabled).toBe(false);
  });

  it("enables approve / decline ONLY with isLabHead && hasLiveSession", () => {
    const task = makeTask({ id: 1, owner: "alex", is_shared_with_me: true });
    const items = [makeItem({ task_id: 1, owner: "alex", approved: false })];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "alex:1": items },
        isLabHead: true,
        hasLiveSession: true,
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "purchases-approve-item")?.enabled).toBe(true);
    expect(cmdById(cmds, "purchases-decline-item")?.enabled).toBe(true);
  });
});

// ── Commands: shared-order write greying (spec 3.1) ──────────────────────────

describe("buildPurchasesSource shared-order writes", () => {
  it("greys writes on a shared order with the owner reason, read stays open", () => {
    const task = makeTask({ id: 5, owner: "alex", is_shared_with_me: true });
    const items = [
      makeItem({ task_id: 5, owner: "alex", order_status: "needs_ordering" }),
    ];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "alex:5": items },
      }),
      noopHandlers,
    ).commands;
    // Open is always runnable (read allowed).
    expect(cmdById(cmds, "purchases-open-order")?.enabled).not.toBe(false);
    // Writes are greyed with the owner reason.
    const markOrdered = cmdById(cmds, "purchases-mark-ordered");
    expect(markOrdered?.enabled).toBe(false);
    expect(markOrdered?.detail).toBe("Only the owner (alex) can change this");
    expect(cmdById(cmds, "purchases-toggle-complete")?.enabled).toBe(false);
    expect(cmdById(cmds, "purchases-delete-order")?.enabled).toBe(false);
  });

  it("leaves writes enabled on an own order", () => {
    const task = makeTask({ id: 1, owner: "self", is_shared_with_me: false });
    const items = [makeItem({ task_id: 1, order_status: "needs_ordering" })];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "self:1": items },
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "purchases-mark-ordered")?.enabled).not.toBe(false);
    expect(cmdById(cmds, "purchases-delete-order")?.enabled).not.toBe(false);
  });
});

// ── Commands: groups + the always-present long tail ──────────────────────────

describe("buildPurchasesSource command set", () => {
  it("always offers Create / Filters / Funding / Spending", () => {
    const cmds = buildPurchasesSource(makeData(), noopHandlers).commands;
    expect(cmdById(cmds, "purchases-new")?.group).toBe("Create");
    expect(cmdById(cmds, "purchases-filter-misc")?.group).toBe("Filters");
    expect(cmdById(cmds, "purchases-ordering-received")?.group).toBe("Filters");
    expect(cmdById(cmds, "purchases-manage-funding")?.group).toBe("Funding");
    expect(cmdById(cmds, "purchases-export-csv")?.group).toBe("Spending");
  });

  it("disables the active filter rows and export when the window is empty", () => {
    const cmds = buildPurchasesSource(
      makeData({ categoryFilter: "misc", hasExportableItems: false }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "purchases-filter-misc")?.enabled).toBe(false);
    expect(cmdById(cmds, "purchases-filter-all")?.enabled).not.toBe(false);
    expect(cmdById(cmds, "purchases-export-csv")?.enabled).toBe(false);
  });

  it("shows the lab-queue command for a lab head only", () => {
    const labCmds = buildPurchasesSource(
      makeData({ isLabHead: true }),
      noopHandlers,
    ).commands;
    expect(cmdById(labCmds, "purchases-open-lab-queue")).toBeDefined();
    const memberCmds = buildPurchasesSource(
      makeData({ isLabHead: false }),
      noopHandlers,
    ).commands;
    expect(cmdById(memberCmds, "purchases-open-lab-queue")).toBeUndefined();
  });
});

// ── Suggested (spec 3) ───────────────────────────────────────────────────────

describe("buildPurchasesSource suggested ids", () => {
  it("a selected own order leads with open + status + complete + delete", () => {
    const task = makeTask({ id: 1 });
    const items = [makeItem({ task_id: 1, order_status: "needs_ordering" })];
    const src = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "self:1": items },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds?.[0]).toBe("purchases-open-order");
    expect(src.suggestedIds).toContain("purchases-mark-ordered");
    expect(src.suggestedIds).toContain("purchases-toggle-complete");
    expect(src.suggestedIds).toContain("purchases-delete-order");
    expect(src.suggestedHint).toBe("for the selected order");
  });

  it("the awaiting-approval filter (lab head) suggests the bulk + queue set", () => {
    const task = makeTask({ id: 1 });
    const items = [makeItem({ task_id: 1, approved: false })];
    const src = buildPurchasesSource(
      makeData({
        categoryFilter: "awaiting_approval",
        isLabHead: true,
        purchaseTasks: [task],
        sortedTasks: [task],
        purchasesByTask: { "self:1": items },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "purchases-approve-all-page",
      "purchases-open-lab-queue",
      "purchases-filter-all",
    ]);
    expect(src.suggestedHint).toBe("for the approval queue");
  });

  it("nothing selected suggests new / funding / export / dashboard", () => {
    const src = buildPurchasesSource(makeData(), noopHandlers);
    expect(src.suggestedIds).toEqual([
      "purchases-new",
      "purchases-manage-funding",
      "purchases-export-csv",
      "purchases-open-dashboard",
    ]);
    expect(src.suggestedHint).toBeUndefined();
  });
});

// ── Nav groups (spec 4) ──────────────────────────────────────────────────────

describe("buildPurchasesSource nav groups", () => {
  it("jump-to-a-purchase uses the task amber tone, funding uses green", () => {
    const task = makeTask({ id: 1, name: "qPCR reagents" });
    const items = [makeItem({ task_id: 1, total_price: 100 })];
    const src = buildPurchasesSource(
      makeData({
        purchaseTasks: [task],
        sortedTasks: [task],
        purchasesByTask: { "self:1": items },
        fundingAccounts: [makeFunding()],
      }),
      noopHandlers,
    );
    const jump = src.navGroups?.find((g) => g.title === "Jump to a purchase");
    expect(jump?.items[0].tone).toBe("task");
    expect(jump?.items[0].label).toBe("qPCR reagents");
    const funding = src.navGroups?.find((g) => g.title === "Funding accounts");
    const row = funding?.items[0] as PaletteNavItem;
    expect(row.tone).toBe("funding");
    expect(row.detail).toBe("$4,120.00 of $20,000.00 spent");
  });

  it("widens the jump list to all orders when the visible filter is empty", () => {
    const a = makeTask({ id: 1 });
    const b = makeTask({ id: 2 });
    const src = buildPurchasesSource(
      makeData({ purchaseTasks: [a, b], sortedTasks: [] }),
      noopHandlers,
    );
    const jump = src.navGroups?.find((g) => g.title === "Jump to a purchase");
    expect(jump?.items.length).toBe(2);
  });
});

// ── Results (spec 5) ─────────────────────────────────────────────────────────

describe("buildPurchasesSource recent results", () => {
  it("adds a reopenable spending-export row from a captured descriptor", () => {
    const exp: SpendingExportDescriptor = {
      id: "1",
      rangeLabel: "last 12 months",
      itemCount: 142,
      total: 9140,
    };
    const src = buildPurchasesSource(makeData(), noopHandlers, [exp]);
    const recent = src.navGroups?.find((g) => g.title === "Recent results");
    expect(recent?.items[0].label).toBe("Spending export");
    expect(recent?.items[0].detail).toBe(
      "last 12 months, 142 items, $9,140.00",
    );
  });

  it("omits Recent results when there is no captured export", () => {
    const src = buildPurchasesSource(makeData(), noopHandlers, []);
    expect(
      src.navGroups?.find((g) => g.title === "Recent results"),
    ).toBeUndefined();
  });
});

// ── Bulk-collapse (spec 3.2 note) ────────────────────────────────────────────

describe("buildPurchasesSource bulk collapse", () => {
  it("collapses per-item rows into bulk variants past 4 items", () => {
    const task = makeTask({ id: 1 });
    const items = [
      makeItem({ task_id: 1, order_status: "needs_ordering", approved: false }),
      makeItem({ task_id: 1, order_status: "ordered", approved: false }),
      makeItem({ task_id: 1, order_status: "needs_ordering", approved: false }),
      makeItem({ task_id: 1, order_status: "ordered", approved: false }),
      makeItem({ task_id: 1, order_status: "needs_ordering", approved: false }),
    ];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "self:1": items },
        isLabHead: true,
        hasLiveSession: true,
      }),
      noopHandlers,
    ).commands;
    // Per-item rows are gone, bulk rows remain.
    expect(cmdById(cmds, "purchases-mark-ordered")).toBeUndefined();
    expect(cmdById(cmds, "purchases-mark-received")).toBeUndefined();
    expect(cmdById(cmds, "purchases-approve-item")).toBeUndefined();
    expect(cmdById(cmds, "purchases-mark-order-received")).toBeDefined();
    expect(cmdById(cmds, "purchases-approve-all-in-order")).toBeDefined();
  });

  it("keeps per-item rows at 4 items or fewer", () => {
    const task = makeTask({ id: 1 });
    const items = [
      makeItem({ task_id: 1, order_status: "needs_ordering" }),
      makeItem({ task_id: 1, order_status: "ordered" }),
    ];
    const cmds = buildPurchasesSource(
      makeData({
        selectedTask: task,
        purchaseTasks: [task],
        purchasesByTask: { "self:1": items },
      }),
      noopHandlers,
    ).commands;
    expect(cmdById(cmds, "purchases-mark-ordered")).toBeDefined();
    expect(cmdById(cmds, "purchases-mark-received")).toBeDefined();
  });
});

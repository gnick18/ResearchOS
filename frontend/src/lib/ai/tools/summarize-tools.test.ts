// Unit tests for the summary suite Layer-2 tools (summarize_experiments and
// summarize_purchases). The WHOLE point of these tests is to assert that the
// TOOL computes the counts, the status tally, and the money totals correctly
// and DETERMINISTICALLY from a fixture, never the model. We pin "today" for the
// experiment status math, stub the loaders via the injectable deps seam, and
// check every aggregate field plus the no-match and truncation paths.

import { describe, it, expect, afterEach } from "vitest";
import {
  aggregateExperiments,
  summarizeExperimentsTool,
  summarizeExperimentsDeps,
  type SummarizeExperimentsDeps,
} from "./summarize-experiments";
import {
  aggregatePurchases,
  summarizePurchasesTool,
  summarizePurchasesDeps,
  type SummarizePurchasesDeps,
} from "./summarize-purchases";
import type { Task, PurchaseItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeExperiment(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 4,
    name: "Colony PCR screen",
    start_date: "2026-06-10",
    duration_days: 1,
    end_date: "2026-06-10",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: ["pcr"],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

type OwnedPurchase = PurchaseItem & { owner: string };

function makePurchase(overrides: Partial<OwnedPurchase> = {}): OwnedPurchase {
  return {
    id: 1,
    task_id: 10,
    item_name: "Gibson Assembly Master Mix",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 95,
    shipping_fees: 0,
    total_price: 95,
    notes: null,
    funding_string: null,
    vendor: "NEB",
    catalog_number: null,
    category: "reagents",
    order_status: "needs_ordering",
    owner: "grant",
    ...overrides,
  };
}

// A frozen "today" so the overdue / upcoming / this-week derivation is stable.
const TODAY = "2026-06-12";

// ---------------------------------------------------------------------------
// aggregateExperiments: deterministic counts + status + timeline
// ---------------------------------------------------------------------------

describe("aggregateExperiments (deterministic counts)", () => {
  function experimentSet(): Task[] {
    return [
      // complete
      makeExperiment({ id: 1, name: "Done run", is_complete: true, start_date: "2026-06-01", end_date: "2026-06-03", owner: "grant", project_id: 4 }),
      // overdue: not complete, end before today
      makeExperiment({ id: 2, name: "Late run", is_complete: false, start_date: "2026-06-05", end_date: "2026-06-08", owner: "grant", project_id: 4 }),
      // active: not complete, spans today
      makeExperiment({ id: 3, name: "Ongoing run", is_complete: false, start_date: "2026-06-10", end_date: "2026-06-15", owner: "alice", project_id: 9 }),
      // upcoming: not complete, starts after today
      makeExperiment({ id: 4, name: "Future run", is_complete: false, start_date: "2026-06-20", end_date: "2026-06-22", owner: "alice", project_id: 9 }),
      // finishing this week: not complete, ends within 7 days of today
      makeExperiment({ id: 5, name: "Wraps soon", is_complete: false, start_date: "2026-06-09", end_date: "2026-06-14", owner: "grant", project_id: 4 }),
    ];
  }

  it("counts the total matched", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    expect(s.total).toBe(5);
  });

  it("derives the status tally against the frozen today", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    // id1 complete; id2 overdue; id3 active (spans today); id4 upcoming; id5
    // active (start 06-09 <= today, not complete, end in future).
    expect(s.byStatus).toEqual({ complete: 1, active: 2, overdue: 1, upcoming: 1 });
  });

  it("counts by project and by owner", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    expect(s.byProject).toEqual({ "4": 3, "9": 2 });
    expect(s.byOwner).toEqual({ grant: 3, alice: 2 });
  });

  it("builds a month histogram by start date, sorted ascending", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    // All five start in 2026-06.
    expect(s.byMonth).toEqual([{ month: "2026-06", count: 5 }]);
  });

  it("counts experiments finishing this week", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    // id3 ends 06-15 (>= 06-19? no, week end is 06-19, 06-15 < 06-19 -> in),
    // id5 ends 06-14 (in). id2 is overdue (06-08 < today, excluded). id1 complete.
    // id4 ends 06-22 (after week end). So 2.
    expect(s.finishingThisWeek).toBe(2);
  });

  it("echoes the filter and reports asOf", () => {
    const filter = { types: ["experiment"], owners: ["grant"] };
    const s = aggregateExperiments(experimentSet(), filter, TODAY);
    expect(s.filter).toEqual(filter);
    expect(s.asOf).toBe(TODAY);
  });

  it("respects the owners filter (whose)", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"], owners: ["alice"] }, TODAY);
    expect(s.total).toBe(2);
    expect(s.byOwner).toEqual({ alice: 2 });
  });

  it("returns a clean zero on no match", () => {
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"], owners: ["nobody"] }, TODAY);
    expect(s.total).toBe(0);
    expect(s.byStatus).toEqual({ complete: 0, active: 0, overdue: 0, upcoming: 0 });
    expect(s.byMonth).toEqual([]);
    expect(s.items).toEqual([]);
    expect(s.truncated).toBe(false);
  });

  it("caps the items list and flags truncation", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeExperiment({ id: i + 1, name: `Run ${i + 1}`, start_date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const s = aggregateExperiments(many, { types: ["experiment"] }, TODAY, 15);
    expect(s.total).toBe(20);
    expect(s.items).toHaveLength(15);
    expect(s.truncated).toBe(true);
  });

  it("ignores non-experiment tasks defensively", () => {
    const tasks = [makeExperiment({ id: 1 }), makeExperiment({ id: 2, task_type: "list" })];
    const s = aggregateExperiments(tasks, { types: ["experiment"] }, TODAY);
    expect(s.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// aggregatePurchases: the money totals are the critical case
// ---------------------------------------------------------------------------

describe("aggregatePurchases (deterministic money)", () => {
  function purchaseSet(): OwnedPurchase[] {
    return [
      makePurchase({ id: 1, item_name: "Gibson mix", vendor: "NEB", category: "reagents", total_price: 95, order_status: "received", last_edited_at: "2026-06-01T10:00:00Z", owner: "grant" }),
      makePurchase({ id: 2, item_name: "Primers", vendor: "IDT", category: "oligos", total_price: 42.5, order_status: "ordered", last_edited_at: "2026-06-05T10:00:00Z", owner: "grant" }),
      makePurchase({ id: 3, item_name: "Taq polymerase", vendor: "NEB", category: "reagents", total_price: 120.25, order_status: "needs_ordering", last_edited_at: "2026-05-20T10:00:00Z", owner: "alice" }),
      makePurchase({ id: 4, item_name: "Pipette tips", vendor: null, category: null, total_price: 30, order_status: "received", last_edited_at: "2026-06-07T10:00:00Z", owner: "alice" }),
    ];
  }

  it("computes the total spend deterministically", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    // 95 + 42.5 + 120.25 + 30 = 287.75
    expect(s.count).toBe(4);
    expect(s.totalSpend).toBe(287.75);
  });

  it("computes spend by vendor, descending, with an Unknown bucket", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byVendor).toEqual([
      { key: "NEB", count: 2, spend: 215.25 },
      { key: "IDT", count: 1, spend: 42.5 },
      { key: "Unknown vendor", count: 1, spend: 30 },
    ]);
  });

  it("computes spend by category with an Uncategorized bucket", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byCategory).toEqual([
      { key: "reagents", count: 2, spend: 215.25 },
      { key: "oligos", count: 1, spend: 42.5 },
      { key: "Uncategorized", count: 1, spend: 30 },
    ]);
  });

  it("computes spend by month from last_edited_at, ascending", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byMonth).toEqual([
      { key: "2026-05", count: 1, spend: 120.25 },
      { key: "2026-06", count: 3, spend: 167.5 },
    ]);
  });

  it("tallies status and the pending vs received split", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byStatus).toEqual({ needs_ordering: 1, ordered: 1, received: 2 });
    // pending = needs_ordering + ordered = 2; received = 2.
    expect(s.pendingVsReceived).toEqual({ pending: 2, received: 2 });
  });

  it("lists the largest items by total price, capped", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] }, 2);
    expect(s.largestItems.map((i) => i.id)).toEqual(["3", "1"]);
    expect(s.largestItems[0].totalPrice).toBe(120.25);
    expect(s.truncated).toBe(true);
  });

  it("respects the owners filter (whose)", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"], owners: ["alice"] });
    expect(s.count).toBe(2);
    // Taq 120.25 + tips 30 = 150.25
    expect(s.totalSpend).toBe(150.25);
  });

  it("scopes the spend total to a date window", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"], since: "2026-06-01" });
    // Drops the 2026-05-20 Taq (120.25). 95 + 42.5 + 30 = 167.5.
    expect(s.count).toBe(3);
    expect(s.totalSpend).toBe(167.5);
  });

  it("scopes by keyword", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"], keywords: "primers" });
    expect(s.count).toBe(1);
    expect(s.totalSpend).toBe(42.5);
  });

  it("returns a clean zero on no match", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"], owners: ["nobody"] });
    expect(s.count).toBe(0);
    expect(s.totalSpend).toBe(0);
    expect(s.byVendor).toEqual([]);
    expect(s.largestItems).toEqual([]);
    expect(s.truncated).toBe(false);
  });

  it("falls back to component math when total_price is missing, never reporting 0 for a real spend", () => {
    const item = makePurchase({ id: 9, price_per_unit: 10, quantity: 3, shipping_fees: 5 });
    // Force total_price undefined to exercise the fallback.
    delete (item as { total_price?: number }).total_price;
    const s = aggregatePurchases([item], { types: ["purchase"] });
    expect(s.totalSpend).toBe(35);
  });

  it("rounds accumulated cents cleanly", () => {
    const items = [
      makePurchase({ id: 1, total_price: 0.1, vendor: "A", category: "x" }),
      makePurchase({ id: 2, total_price: 0.2, vendor: "A", category: "x" }),
    ];
    const s = aggregatePurchases(items, { types: ["purchase"] });
    expect(s.totalSpend).toBe(0.3);
    expect(s.byVendor[0].spend).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Tool execute paths through the injectable deps seam (no real folder).
// ---------------------------------------------------------------------------

const realExpLister = summarizeExperimentsDeps.listExperiments;
const realPurchaseLister = summarizePurchasesDeps.listPurchases;

function stubExperiments(overrides: Partial<SummarizeExperimentsDeps>): void {
  Object.assign(summarizeExperimentsDeps, overrides);
}
function stubPurchases(overrides: Partial<SummarizePurchasesDeps>): void {
  Object.assign(summarizePurchasesDeps, overrides);
}

afterEach(() => {
  summarizeExperimentsDeps.listExperiments = realExpLister;
  summarizePurchasesDeps.listPurchases = realPurchaseLister;
});

describe("summarizeExperimentsTool.execute", () => {
  it("loads, filters, and returns a summary", async () => {
    stubExperiments({
      listExperiments: async () => [
        makeExperiment({ id: 1, owner: "grant", is_complete: true }),
        makeExperiment({ id: 2, owner: "alice", is_complete: false }),
      ],
    });
    const out = (await summarizeExperimentsTool.execute({ owners: ["grant"] })) as {
      ok: true;
      summary: { total: number; byOwner: Record<string, number>; filter: unknown };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.total).toBe(1);
    expect(out.summary.byOwner).toEqual({ grant: 1 });
    // The filter is echoed back with the experiment type pinned.
    expect(out.summary.filter).toMatchObject({ types: ["experiment"], owners: ["grant"] });
  });
});

describe("summarizePurchasesTool.execute", () => {
  it("loads, filters, and returns a money summary", async () => {
    stubPurchases({
      listPurchases: async () => [
        makePurchase({ id: 1, total_price: 100, owner: "grant" }),
        makePurchase({ id: 2, total_price: 50, owner: "alice" }),
      ],
    });
    const out = (await summarizePurchasesTool.execute({})) as {
      ok: true;
      summary: { count: number; totalSpend: number; filter: unknown };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.count).toBe(2);
    expect(out.summary.totalSpend).toBe(150);
    expect(out.summary.filter).toMatchObject({ types: ["purchase"] });
  });
});

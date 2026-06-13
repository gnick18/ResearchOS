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

  it("counts by project (resolved name) and by owner", () => {
    // Without a projectNames map the fallback is the id string.
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY);
    // byProject is now an array of { projectId, projectName, count }.
    // Sorted order is insertion order of the Map (first seen).
    const byProjectMap = Object.fromEntries(s.byProject.map((b) => [b.projectId, b.count]));
    expect(byProjectMap).toEqual({ "4": 3, "9": 2 });
    // Without a names map the projectName falls back to the id string.
    const names = Object.fromEntries(s.byProject.map((b) => [b.projectId, b.projectName]));
    expect(names).toEqual({ "4": "4", "9": "9" });
    expect(s.byOwner).toEqual({ grant: 3, alice: 2 });
  });

  it("resolves project ids to names when a projectNames map is provided", () => {
    const nameMap = new Map([["4", "cyp51A"], ["9", "abc1"]]);
    const s = aggregateExperiments(experimentSet(), { types: ["experiment"] }, TODAY, 15, nameMap);
    const names = Object.fromEntries(s.byProject.map((b) => [b.projectId, b.projectName]));
    expect(names).toEqual({ "4": "cyp51A", "9": "abc1" });
    // Items also carry the resolved name.
    const itemWithProject = s.items.find((i) => i.projectId === "4");
    expect(itemWithProject?.projectName).toBe("cyp51A");
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

  it("does not collide experiments from different owners sharing a numeric id", () => {
    // grant's experiment id 1 and alice's experiment id 1 are distinct records
    // that share the same per-user numeric id. A plain-id map double-counted one
    // and dropped the other in the breakdowns; the compound owner:id key keeps
    // both. The total was always right, the breakdowns were not.
    const tasks = [
      makeExperiment({ id: 1, owner: "grant", project_id: 4, is_complete: true }),
      makeExperiment({ id: 1, owner: "alice", project_id: 9, is_complete: false, start_date: "2026-06-20", end_date: "2026-06-22" }),
    ];
    const s = aggregateExperiments(tasks, { types: ["experiment"] }, TODAY);
    expect(s.total).toBe(2);
    expect(s.byOwner).toEqual({ grant: 1, alice: 1 });
    const projCounts = Object.fromEntries(s.byProject.map((b) => [b.projectId, b.count]));
    expect(projCounts).toEqual({ "4": 1, "9": 1 });
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
    // Check the numeric and key fields; spendDisplay is checked separately.
    expect(s.byVendor.map(({ key, count, spend }) => ({ key, count, spend }))).toEqual([
      { key: "NEB", count: 2, spend: 215.25 },
      { key: "IDT", count: 1, spend: 42.5 },
      { key: "Unknown vendor", count: 1, spend: 30 },
    ]);
    // Each bucket must carry a pre-formatted spendDisplay string.
    expect(s.byVendor[0].spendDisplay).toBe("$215.25");
    expect(s.byVendor[1].spendDisplay).toBe("$42.50");
    expect(s.byVendor[2].spendDisplay).toBe("$30.00");
  });

  it("computes spend by category with an Uncategorized bucket", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byCategory.map(({ key, count, spend }) => ({ key, count, spend }))).toEqual([
      { key: "reagents", count: 2, spend: 215.25 },
      { key: "oligos", count: 1, spend: 42.5 },
      { key: "Uncategorized", count: 1, spend: 30 },
    ]);
    expect(s.byCategory[0].spendDisplay).toBe("$215.25");
  });

  it("computes spend by month from last_edited_at, ascending", () => {
    const s = aggregatePurchases(purchaseSet(), { types: ["purchase"] });
    expect(s.byMonth.map(({ key, count, spend }) => ({ key, count, spend }))).toEqual([
      { key: "2026-05", count: 1, spend: 120.25 },
      { key: "2026-06", count: 3, spend: 167.5 },
    ]);
    expect(s.byMonth[0].spendDisplay).toBe("$120.25");
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
const realExpProjLister = summarizeExperimentsDeps.listProjects;
const realPurchaseLister = summarizePurchasesDeps.listPurchases;

function stubExperiments(overrides: Partial<SummarizeExperimentsDeps>): void {
  Object.assign(summarizeExperimentsDeps, overrides);
}
function stubPurchases(overrides: Partial<SummarizePurchasesDeps>): void {
  Object.assign(summarizePurchasesDeps, overrides);
}

afterEach(() => {
  summarizeExperimentsDeps.listExperiments = realExpLister;
  summarizeExperimentsDeps.listProjects = realExpProjLister;
  summarizePurchasesDeps.listPurchases = realPurchaseLister;
});

describe("summarizeExperimentsTool.execute", () => {
  it("loads, filters, and returns a summary with resolved project names", async () => {
    stubExperiments({
      listExperiments: async () => [
        makeExperiment({ id: 1, owner: "grant", is_complete: true, project_id: 4 }),
        makeExperiment({ id: 2, owner: "alice", is_complete: false, project_id: 9 }),
      ],
      listProjects: async () => [
        { id: 4, name: "cyp51A", owner: "grant", weekend_active: false, tags: null, color: null, created_at: "2026-01-01T00:00:00Z", sort_order: 0, is_archived: false, archived_at: null, shared_with: [] },
        { id: 9, name: "abc1", owner: "grant", weekend_active: false, tags: null, color: null, created_at: "2026-01-01T00:00:00Z", sort_order: 0, is_archived: false, archived_at: null, shared_with: [] },
      ],
    });
    const out = (await summarizeExperimentsTool.execute({ owners: ["grant"] })) as {
      ok: true;
      summary: {
        total: number;
        byOwner: Record<string, number>;
        byProject: Array<{ projectId: string; projectName: string; count: number }>;
        filter: unknown;
      };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.total).toBe(1);
    expect(out.summary.byOwner).toEqual({ grant: 1 });
    // byProject resolves the name even though alice's experiment is filtered out.
    expect(out.summary.byProject).toEqual([{ projectId: "4", projectName: "cyp51A", count: 1 }]);
    // The filter is echoed back with the experiment type pinned.
    expect(out.summary.filter).toMatchObject({ types: ["experiment"], owners: ["grant"] });
  });
});

describe("summarizePurchasesTool.execute", () => {
  it("loads, filters, and returns a money summary with display strings", async () => {
    stubPurchases({
      listPurchases: async () => [
        makePurchase({ id: 1, total_price: 100, owner: "grant" }),
        makePurchase({ id: 2, total_price: 50, owner: "alice" }),
      ],
    });
    const out = (await summarizePurchasesTool.execute({})) as {
      ok: true;
      summary: {
        count: number;
        totalSpend: number;
        totalSpendDisplay: string;
        filter: unknown;
        byVendor: Array<{ key: string; spendDisplay: string }>;
        largestItems: Array<{ totalPriceDisplay: string }>;
      };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.count).toBe(2);
    expect(out.summary.totalSpend).toBe(150);
    // The display string must be pre-formatted and match the numeric total.
    expect(out.summary.totalSpendDisplay).toBe("$150.00");
    // Each vendor bucket carries a spendDisplay.
    expect(out.summary.byVendor[0].spendDisplay).toMatch(/^\$[\d,]+\.\d{2}$/);
    // Each largestItems entry carries a totalPriceDisplay.
    expect(out.summary.largestItems[0].totalPriceDisplay).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(out.summary.filter).toMatchObject({ types: ["purchase"] });
  });
});

// ---------------------------------------------------------------------------
// Demo fixture ground-truth test. Verifies the tool's aggregation against the
// known demo purchase set so the test fails the moment the aggregation drifts
// from the real numbers the Purchases dashboard displays.
//
// Ground truth: the demo session visible to "alex" (own 22 items + 14 shared
// via morgan's project 1 and two direct task shares) totals 36 items at
// $6,966.00. All total_price values here are taken verbatim from the fixture
// JSON files under frontend/public/demo-data/users/{alex,morgan}/purchase_items/.
// ---------------------------------------------------------------------------

describe("aggregatePurchases (demo fixture ground truth)", () => {
  // Alex's own 22 items. total_price copied verbatim from fixture JSON.
  const ALEX_ITEMS: OwnedPurchase[] = [
    makePurchase({ id: 1, task_id: 7, item_name: "DemoStrain DADE2 (fake yeast collection)", quantity: 1, price_per_unit: 220, shipping_fees: 25, total_price: 245, vendor: null, category: null, order_status: "received", owner: "alex" }),
    makePurchase({ id: 2, task_id: 7, item_name: "FakeYeast genotyping primers (IDT)", quantity: 4, price_per_unit: 14, shipping_fees: 5, total_price: 61, vendor: "IDT", category: "Reagents", order_status: "received", owner: "alex" }),
    makePurchase({ id: 3, task_id: 7, item_name: "Phusion polymerase (demo)", quantity: 1, price_per_unit: 285, shipping_fees: 0, total_price: 285, vendor: "NEB", category: "Reagents", order_status: "received", owner: "alex" }),
    makePurchase({ id: 4, task_id: 15, item_name: "LC-MS grade acetonitrile (demo)", quantity: 2, price_per_unit: 95, shipping_fees: 10, total_price: 200, vendor: "Sigma-Aldrich", category: "Reagents", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 5, task_id: 24, item_name: "SD-Ura selection plates", quantity: 5, price_per_unit: 40, shipping_fees: 0, total_price: 200, vendor: "Internal supply", category: "Plasticware", order_status: "received", owner: "alex" }),
    makePurchase({ id: 6, task_id: 24, item_name: "Restriction enzyme set", quantity: 1, price_per_unit: 295, shipping_fees: 20, total_price: 315, vendor: "NEB", category: "Reagents", order_status: "received", owner: "alex" }),
    makePurchase({ id: 7, task_id: 24, item_name: "pYES2 backbone vector (demo)", quantity: 1, price_per_unit: 180, shipping_fees: 0, total_price: 180, vendor: null, category: "Reagents", order_status: "received", owner: "alex" }),
    makePurchase({ id: 8, task_id: 25, item_name: "Gibson assembly master mix", quantity: 2, price_per_unit: 245, shipping_fees: 20, total_price: 510, vendor: "NEB", category: "Reagents", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 9, task_id: 25, item_name: "96-well PCR plates", quantity: 5, price_per_unit: 48, shipping_fees: 15, total_price: 255, vendor: "Thermo", category: "Plasticware", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 10, task_id: 25, item_name: "Filter pipette tips (P200, racked)", quantity: 10, price_per_unit: 32, shipping_fees: 0, total_price: 320, vendor: "Sigma-Aldrich", category: "Consumables", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 11, task_id: 26, item_name: "Sorbitol (1 kg, biology-grade)", quantity: 2, price_per_unit: 58, shipping_fees: 0, total_price: 116, vendor: "Sigma-Aldrich", category: "Reagents", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 12, task_id: 26, item_name: "NaCl (1 kg, ACS-grade)", quantity: 1, price_per_unit: 32, shipping_fees: 0, total_price: 32, vendor: "Sigma-Aldrich", category: "Reagents", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 13, task_id: 26, item_name: "384-well clear-bottom assay plates", quantity: 4, price_per_unit: 76, shipping_fees: 12, total_price: 316, vendor: "Thermo", category: "Plasticware", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 14, task_id: 26, item_name: "gBlocks for stress-response reporters", quantity: 8, price_per_unit: 32, shipping_fees: 0, total_price: 256, vendor: "IDT", category: "Reagents", order_status: "ordered", owner: "alex" }),
    makePurchase({ id: 15, task_id: 27, item_name: "Sequencing-screen primer set", quantity: 6, price_per_unit: 14, shipping_fees: 5, total_price: 89, vendor: "IDT", category: "Reagents", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 16, task_id: 27, item_name: "T7 RNA polymerase (demo)", quantity: 1, price_per_unit: 172, shipping_fees: 0, total_price: 172, vendor: "Thermo", category: "Reagents", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 17, task_id: 27, item_name: "50 mL conical tubes (sleeve)", quantity: 4, price_per_unit: 24, shipping_fees: 0, total_price: 96, vendor: "Sigma-Aldrich", category: "Consumables", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 18, task_id: 15, item_name: "LC-MS column hardware service kit", quantity: 1, price_per_unit: 450, shipping_fees: 25, total_price: 475, vendor: "Thermo", category: "Service", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 19, task_id: 15, item_name: "Solvent waste disposal bottles", quantity: 6, price_per_unit: 18, shipping_fees: 0, total_price: 108, vendor: "Sigma-Aldrich", category: "Consumables", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 20, task_id: 11, item_name: "Pipette tip refills (P1000)", quantity: 2, price_per_unit: 48, shipping_fees: 0, total_price: 96, vendor: null, category: "Consumables", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 21, task_id: 31, item_name: "Conference registration", quantity: 1, price_per_unit: 450, shipping_fees: 0, total_price: 450, vendor: null, category: "Miscellaneous", order_status: "needs_ordering", owner: "alex" }),
    makePurchase({ id: 22, task_id: 31, item_name: "Lab coffee + whiteboard markers", quantity: 1, price_per_unit: 38, shipping_fees: 0, total_price: 38, vendor: null, category: "Miscellaneous", order_status: "received", owner: "alex" }),
  ];

  // Morgan's 14 items visible to alex via project 1 and direct task shares.
  // task ids 1-12 covered by morgan's project 1 tasks that alex can see.
  const MORGAN_SHARED_ITEMS: OwnedPurchase[] = [
    makePurchase({ id: 1, task_id: 1, item_name: "96-well black-walled plates (demo)", quantity: 2, price_per_unit: 48, shipping_fees: 8, total_price: 104, vendor: "Thermo", category: "Plasticware", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 2, task_id: 2, item_name: "GFP recombinant standard (demo)", quantity: 1, price_per_unit: 175, shipping_fees: 0, total_price: 175, vendor: "Sigma-Aldrich", category: "Reagents", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 3, task_id: 6, item_name: "GFP fluorescence calibration kit (demo)", quantity: 1, price_per_unit: 320, shipping_fees: 12, total_price: 332, vendor: "Thermo", category: "Reagents", order_status: "received", owner: "morgan" }),
    makePurchase({ id: 4, task_id: 6, item_name: "384-well black-walled plates", quantity: 1, price_per_unit: 98, shipping_fees: 0, total_price: 98, vendor: "Sigma-Aldrich", category: "Plasticware", order_status: "received", owner: "morgan" }),
    makePurchase({ id: 5, task_id: 6, item_name: "HEPES buffer (1 L, lab-prepared)", quantity: 2, price_per_unit: 42, shipping_fees: 0, total_price: 84, vendor: "Internal supply", category: "Reagents", order_status: "received", owner: "morgan" }),
    makePurchase({ id: 6, task_id: 10, item_name: "Reading-buffer custom mix", quantity: 2, price_per_unit: 58, shipping_fees: 0, total_price: 116, vendor: null, category: null, order_status: "ordered", owner: "morgan" }),
    makePurchase({ id: 7, task_id: 10, item_name: "Sterile reservoir basins", quantity: 6, price_per_unit: 14, shipping_fees: 0, total_price: 84, vendor: "Sigma-Aldrich", category: "Plasticware", order_status: "ordered", owner: "morgan" }),
    makePurchase({ id: 8, task_id: 10, item_name: "Multichannel pipette calibration service", quantity: 1, price_per_unit: 215, shipping_fees: 0, total_price: 215, vendor: null, category: "Service", order_status: "ordered", owner: "morgan" }),
    makePurchase({ id: 9, task_id: 10, item_name: "Filter pipette tips (P10, racked)", quantity: 6, price_per_unit: 34, shipping_fees: 0, total_price: 204, vendor: "Thermo", category: "Consumables", order_status: "ordered", owner: "morgan" }),
    makePurchase({ id: 13, task_id: 12, item_name: "PCR primers gal80 verification set", quantity: 8, price_per_unit: 14, shipping_fees: 5, total_price: 117, vendor: "IDT", category: "Reagents", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 14, task_id: 12, item_name: "Reverse-transcription kit (24 rxns)", quantity: 1, price_per_unit: 185, shipping_fees: 0, total_price: 185, vendor: "NEB", category: "Reagents", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 15, task_id: 12, item_name: "SYBR qPCR master mix (2x, 5 mL)", quantity: 1, price_per_unit: 245, shipping_fees: 0, total_price: 245, vendor: "Thermo", category: "Reagents", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 16, task_id: 12, item_name: "Falcon tubes (15 mL, sleeve of 50)", quantity: 4, price_per_unit: 22, shipping_fees: 0, total_price: 88, vendor: "Thermo", category: "Consumables", order_status: "needs_ordering", owner: "morgan" }),
    makePurchase({ id: 17, task_id: 12, item_name: "96-well qPCR plates (skirted)", quantity: 2, price_per_unit: 52, shipping_fees: 0, total_price: 104, vendor: "IDT", category: "Plasticware", order_status: "needs_ordering", owner: "morgan" }),
  ];

  it("aggregates 36 items to exactly $6,966.00 (demo session ground truth)", () => {
    const allItems = [...ALEX_ITEMS, ...MORGAN_SHARED_ITEMS];
    expect(allItems).toHaveLength(36);

    const s = aggregatePurchases(allItems, { types: ["purchase"] });

    // Ground truth: the Purchases dashboard shows $6,966.00 across 36 items.
    // All prices derive verbatim from fixture JSON files.
    expect(s.count).toBe(36);
    expect(s.totalSpend).toBe(6966.00);
    // The pre-formatted display string must match exactly.
    expect(s.totalSpendDisplay).toBe("$6,966.00");
    // The byVendor bucket spends must also carry correctly formatted display strings.
    for (const bucket of s.byVendor) {
      expect(bucket.spendDisplay).toMatch(/^\$[\d,]+\.\d{2}$/);
    }
    // The byVendor buckets must sum to the same total (no rounding drift).
    const vendorSum = s.byVendor.reduce((acc, b) => acc + b.spend, 0);
    expect(Math.round(vendorSum * 100) / 100).toBe(6966.00);
  });
});

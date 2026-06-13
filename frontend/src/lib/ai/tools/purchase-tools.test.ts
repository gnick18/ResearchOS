// Unit tests for the create_purchase tool.
//
// Every test uses the injectable deps seam so no real folder is touched. The
// assertions cover:
//   - the right PurchaseItemCreate payload is built from the tool args
//   - a project name (case-insensitive) resolves to its numeric id
//   - a numeric project id resolves correctly
//   - an unknown project reference returns a clear error with no write
//   - describeAction produces a readable preview with vendor, price, and project
//   - money Display strings pass through verbatim and are never recomputed by
//     the caller (the test pins the values and checks the returned display string)
//   - missing required fields return an error without writing
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createPurchaseTool,
  purchaseToolsDeps,
  computeTotal,
  formatUsd,
  type PurchaseToolsDeps,
} from "./purchase-tools";
import type { Project, Task, PurchaseItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 7,
    name: "cyp51A",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-01T10:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 42,
    project_id: 7,
    name: "P1000 pipette tips",
    start_date: "2026-06-13",
    duration_days: 1,
    end_date: "2026-06-13",
    is_high_level: false,
    is_complete: false,
    task_type: "purchase",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makePurchaseItem(overrides: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 99,
    task_id: 42,
    item_name: "P1000 pipette tips",
    quantity: 2,
    link: null,
    cas: null,
    price_per_unit: 45.00,
    shipping_fees: 0,
    total_price: 90.00,
    notes: null,
    funding_string: null,
    vendor: "Fisher",
    catalog_number: null,
    category: null,
    order_status: "needs_ordering",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<PurchaseToolsDeps> = {}): PurchaseToolsDeps {
  return {
    listProjects: vi.fn().mockResolvedValue([makeProject()]),
    createTask: vi.fn().mockResolvedValue(makeTask()),
    createPurchaseItem: vi.fn().mockResolvedValue(makePurchaseItem()),
    navigate: vi.fn(),
    ...overrides,
  };
}

/** Temporarily replace purchaseToolsDeps with a stub, restore on cleanup. */
function withDeps(
  deps: PurchaseToolsDeps,
  fn: () => Promise<void>,
): Promise<void> {
  const original = { ...purchaseToolsDeps };
  Object.assign(purchaseToolsDeps, deps);
  return fn().finally(() => Object.assign(purchaseToolsDeps, original));
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("computeTotal", () => {
  it("multiplies price by quantity and adds shipping", () => {
    expect(computeTotal(45, 2, 0)).toBe(90);
    expect(computeTotal(10, 3, 5)).toBe(35);
    expect(computeTotal(0, 1, 0)).toBe(0);
  });

  it("rounds to two decimal places", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004; the function rounds.
    expect(computeTotal(0.1, 1, 0.2)).toBe(0.3);
  });
});

describe("formatUsd", () => {
  it("formats zero as $0.00", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("formats a whole dollar amount", () => {
    expect(formatUsd(90)).toBe("$90.00");
  });

  it("formats a larger amount with comma separator", () => {
    expect(formatUsd(1234.56)).toBe("$1,234.56");
  });
});

// ---------------------------------------------------------------------------
// describeAction preview
// ---------------------------------------------------------------------------

describe("createPurchaseTool describeAction", () => {
  it("includes the item name in the summary", () => {
    const result = createPurchaseTool.describeAction!({
      itemName: "P1000 pipette tips",
      quantity: 2,
      vendor: "Fisher",
    });
    expect(result.summary).toContain("P1000 pipette tips");
  });

  it("includes the vendor in the summary", () => {
    const result = createPurchaseTool.describeAction!({
      itemName: "Ethanol",
      quantity: 1,
      vendor: "Sigma-Aldrich",
    });
    expect(result.summary).toContain("Sigma-Aldrich");
  });

  it("includes quantity and a formatted total when price is given", () => {
    const result = createPurchaseTool.describeAction!({
      itemName: "Tips",
      quantity: 2,
      vendor: "Fisher",
      pricePerUnit: 45,
    });
    // The total for 2 @ $45 = $90.00
    expect(result.summary).toContain("$90.00");
    expect(result.summary).toContain("qty 2");
  });

  it("includes the project name when given", () => {
    const result = createPurchaseTool.describeAction!({
      itemName: "Tips",
      quantity: 1,
      project: "cyp51A",
    });
    expect(result.summary).toContain("cyp51A");
  });

  it("says project is unassigned when no project is given", () => {
    const result = createPurchaseTool.describeAction!({
      itemName: "Tips",
      quantity: 1,
    });
    expect(result.summary).toContain("unassigned");
  });
});

// ---------------------------------------------------------------------------
// execute: project name resolution
// ---------------------------------------------------------------------------

describe("createPurchaseTool execute: project resolution", () => {
  it("resolves a project name (case-insensitive) to its id", async () => {
    const deps = makeDeps({
      listProjects: vi.fn().mockResolvedValue([
        makeProject({ id: 7, name: "cyp51A" }),
      ]),
    });

    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({
        itemName: "P1000 tips",
        quantity: 2,
        vendor: "Fisher",
        project: "CYP51A",
      });
      expect(result).toMatchObject({ ok: true });
      // The createTask call should carry project_id 7.
      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 7 }),
      );
    });
  });

  it("resolves a project by numeric id", async () => {
    const deps = makeDeps({
      listProjects: vi.fn().mockResolvedValue([
        makeProject({ id: 7, name: "cyp51A" }),
      ]),
    });

    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 1,
        project: 7,
      });
      expect(result).toMatchObject({ ok: true });
      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 7 }),
      );
    });
  });

  it("returns an error without writing when the project is not found", async () => {
    const deps = makeDeps({
      listProjects: vi.fn().mockResolvedValue([
        makeProject({ id: 7, name: "cyp51A" }),
      ]),
    });

    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 1,
        project: "does not exist",
      });
      expect(result).toMatchObject({ ok: false });
      // No task or item should have been created.
      expect(deps.createTask).not.toHaveBeenCalled();
      expect(deps.createPurchaseItem).not.toHaveBeenCalled();
    });
  });

  it("leaves project_id null when no project is specified", async () => {
    const deps = makeDeps();

    await withDeps(deps, async () => {
      await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 1,
      });
      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: null }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// execute: PurchaseItemCreate payload
// ---------------------------------------------------------------------------

describe("createPurchaseTool execute: payload shape", () => {
  it("passes the right fields to createPurchaseItem", async () => {
    const deps = makeDeps();

    await withDeps(deps, async () => {
      await createPurchaseTool.execute({
        itemName: "P1000 pipette tips",
        quantity: 2,
        vendor: "Fisher",
        pricePerUnit: 45,
        shippingFees: 5,
        catalogNumber: "02-707-504",
        notes: "order extra",
        link: "https://fishersci.com/tips",
      });
      expect(deps.createPurchaseItem).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 42, // the id the makeTask stub returns
          item_name: "P1000 pipette tips",
          quantity: 2,
          price_per_unit: 45,
          shipping_fees: 5,
          vendor: "Fisher",
          catalog_number: "02-707-504",
          notes: "order extra",
          link: "https://fishersci.com/tips",
        }),
      );
    });
  });

  it("creates a purchase task with task_type purchase", async () => {
    const deps = makeDeps();

    await withDeps(deps, async () => {
      await createPurchaseTool.execute({ itemName: "Tips", quantity: 1 });
      expect(deps.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_type: "purchase" }),
      );
    });
  });

  it("defaults price and shipping to 0 when omitted", async () => {
    const deps = makeDeps({
      createPurchaseItem: vi.fn().mockResolvedValue(
        makePurchaseItem({ price_per_unit: 0, shipping_fees: 0, total_price: 0 }),
      ),
    });

    await withDeps(deps, async () => {
      await createPurchaseTool.execute({ itemName: "Tips", quantity: 1 });
      expect(deps.createPurchaseItem).toHaveBeenCalledWith(
        expect.objectContaining({ price_per_unit: 0, shipping_fees: 0 }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// execute: money verbatim rule
// ---------------------------------------------------------------------------

describe("createPurchaseTool execute: money Display string is verbatim", () => {
  it("returns a pre-formatted totalPriceDisplay the model must echo verbatim", async () => {
    const deps = makeDeps({
      createPurchaseItem: vi.fn().mockResolvedValue(
        makePurchaseItem({
          price_per_unit: 45,
          shipping_fees: 5,
          total_price: 95,
        }),
      ),
    });

    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 2,
        pricePerUnit: 45,
        shippingFees: 5,
      });
      // 2 * 45 + 5 = $95.00
      expect(result).toMatchObject({
        ok: true,
        totalPriceDisplay: "$95.00",
      });
    });
  });

  it("formats zero spend as $0.00", async () => {
    const deps = makeDeps({
      createPurchaseItem: vi.fn().mockResolvedValue(
        makePurchaseItem({ price_per_unit: 0, shipping_fees: 0, total_price: 0 }),
      ),
    });

    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 1,
      });
      expect(result).toMatchObject({ ok: true, totalPriceDisplay: "$0.00" });
    });
  });
});

// ---------------------------------------------------------------------------
// execute: validation
// ---------------------------------------------------------------------------

describe("createPurchaseTool execute: validation", () => {
  it("returns an error when itemName is missing", async () => {
    const deps = makeDeps();
    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({ quantity: 1 });
      expect(result).toMatchObject({ ok: false });
      expect(deps.createTask).not.toHaveBeenCalled();
    });
  });

  it("returns an error when itemName is empty", async () => {
    const deps = makeDeps();
    await withDeps(deps, async () => {
      const result = await createPurchaseTool.execute({ itemName: "  ", quantity: 1 });
      expect(result).toMatchObject({ ok: false });
    });
  });
});

// ---------------------------------------------------------------------------
// execute: navigation
// ---------------------------------------------------------------------------

describe("createPurchaseTool execute: navigation", () => {
  it("navigates to /purchases after a successful write", async () => {
    const deps = makeDeps();
    await withDeps(deps, async () => {
      await createPurchaseTool.execute({ itemName: "Tips", quantity: 1 });
      expect(deps.navigate).toHaveBeenCalledWith("/purchases");
    });
  });

  it("does not navigate when the project is not found", async () => {
    const deps = makeDeps({
      listProjects: vi.fn().mockResolvedValue([]),
    });
    await withDeps(deps, async () => {
      await createPurchaseTool.execute({
        itemName: "Tips",
        quantity: 1,
        project: "ghost",
      });
      expect(deps.navigate).not.toHaveBeenCalled();
    });
  });
});

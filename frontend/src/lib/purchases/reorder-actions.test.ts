// Supplies v2 chunk 4: the reorder WRITE path. Pins that a reorder stamps
// inventory_item_id onto the new PurchaseItem (the redundancy killer of section
// 4.1) and that submitDraftOrder batches the lines into ONE purchase task with
// ONE funding context (decision 2, keep the order/cart batch).

import { describe, it, expect, vi, beforeEach } from "vitest";

const tasksCreate = vi.fn();
const purchasesCreate = vi.fn();
const ensureMiscProject = vi.fn();

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: (...a: unknown[]) => tasksCreate(...a) },
  purchasesApi: { create: (...a: unknown[]) => purchasesCreate(...a) },
}));

vi.mock("@/lib/purchases/misc-project", () => ({
  ensureMiscProject: (...a: unknown[]) => ensureMiscProject(...a),
  MISC_CATEGORY_LABEL: "Miscellaneous",
}));

import { createReorderPurchase, submitDraftOrder } from "./reorder-actions";

beforeEach(() => {
  tasksCreate.mockReset();
  purchasesCreate.mockReset();
  ensureMiscProject.mockReset();
  tasksCreate.mockResolvedValue({ id: 100 });
  purchasesCreate.mockImplementation(async (data: Record<string, unknown>) => ({
    id: 1,
    ...data,
  }));
  ensureMiscProject.mockResolvedValue({ id: 42 });
});

describe("createReorderPurchase", () => {
  it("stamps inventory_item_id and routes to an explicit project", async () => {
    await createReorderPurchase(
      { item_name: "Taq polymerase", vendor: "NEB", inventory_item_id: 7, quantity: 4 },
      { projectId: 5 },
    );

    expect(tasksCreate).toHaveBeenCalledTimes(1);
    expect(tasksCreate.mock.calls[0][0]).toMatchObject({
      name: "Taq polymerase",
      task_type: "purchase",
      project_id: 5,
    });
    expect(purchasesCreate).toHaveBeenCalledTimes(1);
    const line = purchasesCreate.mock.calls[0][0];
    expect(line).toMatchObject({
      task_id: 100,
      item_name: "Taq polymerase",
      quantity: 4,
      inventory_item_id: 7,
      category: null, // explicit project -> no misc marker
      order_status: "needs_ordering",
    });
  });
});

describe("submitDraftOrder", () => {
  it("batches lines into one task with one funding context", async () => {
    const result = await submitDraftOrder(
      [
        { item_name: "Taq polymerase", inventory_item_id: 7, quantity: 4 },
        { item_name: "dNTP mix", inventory_item_id: 9, quantity: 2 },
      ],
      {
        currentUser: "alex",
        funding: { funding_account_id: 3, funding_string: "R01 GM123" },
      },
    );

    // One parent task for the whole batch, routed to the misc bucket.
    expect(ensureMiscProject).toHaveBeenCalledWith("alex");
    expect(tasksCreate).toHaveBeenCalledTimes(1);
    expect(tasksCreate.mock.calls[0][0]).toMatchObject({
      task_type: "purchase",
      project_id: 42,
    });

    // Two line items, both under that task, both with the shared funding.
    expect(purchasesCreate).toHaveBeenCalledTimes(2);
    for (const call of purchasesCreate.mock.calls) {
      expect(call[0]).toMatchObject({
        task_id: 100,
        funding_account_id: 3,
        funding_string: "R01 GM123",
        category: "Miscellaneous",
        order_status: "needs_ordering",
      });
    }
    expect(purchasesCreate.mock.calls[0][0]).toMatchObject({ inventory_item_id: 7, quantity: 4 });
    expect(purchasesCreate.mock.calls[1][0]).toMatchObject({ inventory_item_id: 9, quantity: 2 });
    expect(result.items).toHaveLength(2);
  });

  it("rejects an empty batch", async () => {
    await expect(submitDraftOrder([], { currentUser: "alex" })).rejects.toThrow(
      /at least one item/i,
    );
  });
});

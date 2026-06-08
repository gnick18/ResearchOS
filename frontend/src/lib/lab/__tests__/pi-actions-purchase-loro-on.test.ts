// Companion to pi-actions-purchase-loro.test.ts: the flag-ON routing case.
// Split into its own file so PURCHASE_LORO_ENABLED can be pinned true for the
// whole module (the flag is a module const read at import time).

import { describe, it, expect, vi, beforeEach } from "vitest";

const rawPurchasesUpdate = vi.fn(
  async (..._a: unknown[]) => ({ id: 7, item_name: "Taq", approved: true }),
);
const writeThroughLoro = vi.fn(
  async (..._a: unknown[]) => ({ id: 7, item_name: "Taq", approved: true }),
);

vi.mock("@/lib/loro/config", () => ({ PURCHASE_LORO_ENABLED: true }));

vi.mock("@/lib/local-api", () => ({
  // ACL hardening (2026-06-08): pi-actions now gates on a lab-head viewer.
  buildCurrentViewer: vi.fn(async () => ({ username: "pi", account_type: "lab_head" })),
  tasksApi: { get: vi.fn(), update: vi.fn() },
  notesApi: { get: vi.fn(), update: vi.fn() },
  purchasesApi: { update: (...a: unknown[]) => rawPurchasesUpdate(...a) },
}));

vi.mock("@/lib/loro/purchase-write-through", () => ({
  writePurchaseUpdateThroughLoro: (...a: unknown[]) => writeThroughLoro(...a),
}));

vi.mock("../pi-audit", () => ({ appendAuditEntries: vi.fn(async () => {}) }));
vi.mock("../user-archive", () => ({ readArchivedSet: vi.fn(async () => new Set()) }));

const jsons = new Map<string, unknown>();
vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => (jsons.has(path) ? jsons.get(path) : null)),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      jsons.set(path, data);
    }),
    listDirectories: vi.fn(async () => []),
  },
}));

const ITEM_PATH = "users/manny/purchase_items/7.json";

describe("pi-actions purchase write routing (flag ON)", () => {
  beforeEach(() => {
    rawPurchasesUpdate.mockClear();
    writeThroughLoro.mockClear();
    jsons.clear();
    jsons.set(ITEM_PATH, { approved: false, item_name: "Taq" });
  });

  it("setPurchaseApproval routes through the Loro write-through", async () => {
    const { setPurchaseApproval } = await import("../pi-actions");
    const result = await setPurchaseApproval({
      actor: "pi",
      targetOwner: "manny",
      purchaseItemId: 7,
      approved: true,
    });
    expect(result.ok).toBe(true);
    expect(writeThroughLoro).toHaveBeenCalledTimes(1);
    // (owner, id, patch) contract.
    expect(writeThroughLoro.mock.calls[0][0]).toBe("manny");
    expect(writeThroughLoro.mock.calls[0][1]).toBe(7);
    expect(rawPurchasesUpdate).not.toHaveBeenCalled();
  });

  it("the pre-read gate still runs BEFORE the doc write (missing item -> data-write failure)", async () => {
    jsons.clear(); // no item on disk
    const { setPurchaseApproval } = await import("../pi-actions");
    const result = await setPurchaseApproval({
      actor: "pi",
      targetOwner: "manny",
      purchaseItemId: 7,
      approved: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("data-write");
    // The authorization / existence gate failed, so NO write of either kind ran.
    expect(writeThroughLoro).not.toHaveBeenCalled();
    expect(rawPurchasesUpdate).not.toHaveBeenCalled();
  });
});

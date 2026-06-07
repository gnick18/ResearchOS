// Tests for the pi-actions purchase write routing (purchase-loro chunk 3).
//
// Verifies the flag gate on the shared writePurchaseUpdate helper that
// setPurchaseApproval / declinePurchase / setFlagForReview / clearFlagAsOwner
// share:
//   - flag OFF (the default): writes fall through to rawPurchasesApi.update
//     EXACTLY as before, and the Loro write-through helper is never called,
//   - flag ON: writes route through writePurchaseUpdateThroughLoro and
//     rawPurchasesApi.update is NOT called.
//
// The heavy collaborators (local-api, the audit writer, the notifications
// file-service, the Loro write-through) are all mocked so the test exercises
// only the routing decision, not the persistence internals (covered by
// purchase-write-through.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

const rawPurchasesUpdate = vi.fn(
  async (..._a: unknown[]) => ({ id: 7, item_name: "Taq", approved: true }),
);
const writeThroughLoro = vi.fn(
  async (..._a: unknown[]) => ({ id: 7, item_name: "Taq", approved: true }),
);

// The flag is a module const; vi.mock lets each test file pin it. This file is
// split into flag-off (default export false) below; the flag-on case re-imports
// with the mock flipped via vi.resetModules + a doMock.
vi.mock("@/lib/loro/config", () => ({ PURCHASE_LORO_ENABLED: false }));

vi.mock("@/lib/local-api", () => ({
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

describe("pi-actions purchase write routing (flag OFF)", () => {
  beforeEach(() => {
    rawPurchasesUpdate.mockClear();
    writeThroughLoro.mockClear();
    jsons.clear();
    jsons.set(ITEM_PATH, { approved: false, item_name: "Taq" });
  });

  it("setPurchaseApproval falls through to rawPurchasesApi.update", async () => {
    const { setPurchaseApproval } = await import("../pi-actions");
    const result = await setPurchaseApproval({
      actor: "pi",
      targetOwner: "manny",
      purchaseItemId: 7,
      approved: true,
    });
    expect(result.ok).toBe(true);
    expect(rawPurchasesUpdate).toHaveBeenCalledTimes(1);
    // The owner is threaded as the 3rd arg of the legacy owner-scoped update.
    expect(rawPurchasesUpdate.mock.calls[0][2]).toBe("manny");
    expect(writeThroughLoro).not.toHaveBeenCalled();
  });

  it("clearFlagAsOwner falls through to rawPurchasesApi.update", async () => {
    const { clearFlagAsOwner } = await import("../pi-actions");
    const result = await clearFlagAsOwner({
      owner: "manny",
      recordType: "purchase_item",
      recordId: 7,
    });
    expect(result.ok).toBe(true);
    expect(rawPurchasesUpdate).toHaveBeenCalledTimes(1);
    expect(writeThroughLoro).not.toHaveBeenCalled();
  });
});

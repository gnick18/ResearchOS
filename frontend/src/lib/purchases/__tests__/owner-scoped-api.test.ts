// Tests for the owner-scoped purchases API wrapper.
//
// The PI edit-session audited soft-write branch was removed with the PI
// edit-mode feature, so the wrapper is now a thin passthrough to the raw
// purchasesApi (current-user folder, no audit). These tests pin that
// passthrough behavior.

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeFiles: Record<string, unknown> = {};

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    ensureDir: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "mira"),
}));

let uuidCounter = 0;
const realCrypto = globalThis.crypto;
Object.defineProperty(globalThis, "crypto", {
  value: {
    ...realCrypto,
    randomUUID: () => `test-uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`,
  },
  configurable: true,
});

import { ownerScopedPurchasesApi } from "../owner-scoped-api";
import type { PurchaseItem } from "@/lib/types";

function seedPurchaseItem(
  owner: string,
  overrides: Partial<PurchaseItem> = {},
): PurchaseItem {
  const item: PurchaseItem = {
    id: 5,
    task_id: 100,
    item_name: "Pipette tips",
    quantity: 10,
    link: null,
    cas: null,
    price_per_unit: 5,
    shipping_fees: 2,
    total_price: 52,
    notes: null,
    funding_string: null,
    vendor: "VWR",
    category: "Consumables",
    ...overrides,
  };
  fakeFiles[`users/${owner}/purchase_items/${item.id}.json`] = item;
  return item;
}

beforeEach(() => {
  for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  uuidCounter = 0;
});

describe("ownerScopedPurchasesApi (passthrough)", () => {
  it("update writes to the current user's folder, no audit", async () => {
    seedPurchaseItem("mira"); // current user
    const api = ownerScopedPurchasesApi();
    await api.update(5, { quantity: 99 });

    expect(fakeFiles["users/mira/purchase_items/5.json"]).toMatchObject({
      quantity: 99,
    });
    expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
  });

  it("ignores deprecated args and never routes cross-owner or writes audit", async () => {
    seedPurchaseItem("mira");
    const api = ownerScopedPurchasesApi({
      targetOwner: "alex",
      actor: "mira",
      sessionId: "session-1",
    });
    await api.update(5, { quantity: 50 });

    // Wrote to current user's (mira's) folder, NOT alex's.
    expect(fakeFiles["users/mira/purchase_items/5.json"]).toMatchObject({
      quantity: 50,
    });
    expect(fakeFiles["users/alex/purchase_items/5.json"]).toBeUndefined();
    expect(fakeFiles["users/alex/_pi_audit.json"]).toBeUndefined();
    expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
  });

  it("delete removes from the current user's folder, no audit", async () => {
    seedPurchaseItem("mira");
    const api = ownerScopedPurchasesApi();
    await api.delete(5);

    expect(fakeFiles["users/mira/purchase_items/5.json"]).toBeUndefined();
    expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
  });
});

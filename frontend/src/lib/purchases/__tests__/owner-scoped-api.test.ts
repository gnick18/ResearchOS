// Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): tests for
// the owner-scoped purchases API wrapper.
//
// Coverage:
//   - Owner-scoped create writes to target owner's purchase_items folder
//     AND uses the target owner's counter for the new id.
//   - Owner-scoped update writes to target owner's folder + emits per-
//     field audit entries (including the derived total_price).
//   - Owner-scoped delete removes from the target owner's folder + emits
//     an audit entry capturing the pre-delete record.
//   - Multi-field updates produce multi-entry audit logs.
//   - No-op updates (no actually-changed fields) produce no audit entries.
//   - When session args are missing, the wrapper falls through to the
//     unwrapped purchasesApi (no owner routing, no audit).

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

describe("ownerScopedPurchasesApi", () => {
  describe("active session (owner-routed + audit)", () => {
    const args = {
      targetOwner: "alex",
      actor: "mira",
      sessionId: "session-1",
    };

    it("create writes to target owner's purchase_items folder", async () => {
      // Seed alex's counter so the new id is predictable.
      fakeFiles["users/alex/_counters.json"] = { purchase_items: 0 };

      const api = ownerScopedPurchasesApi(args);
      const created = await api.create({
        task_id: 100,
        item_name: "Gloves",
        quantity: 1,
        link: null,
        cas: null,
        price_per_unit: 10,
        shipping_fees: 0,
        notes: null,
        funding_string: null,
        vendor: null,
        category: null,
      });

      expect(created.id).toBe(1);
      // Wrote to alex's folder.
      expect(fakeFiles[`users/alex/purchase_items/${created.id}.json`]).toMatchObject({
        item_name: "Gloves",
      });
      // Did NOT write to mira's folder.
      expect(fakeFiles[`users/mira/purchase_items/${created.id}.json`]).toBeUndefined();
      // Counter bumped on ALEX's _counters, not mira's.
      expect(fakeFiles["users/alex/_counters.json"]).toMatchObject({
        purchase_items: 1,
      });
      expect(fakeFiles["users/mira/_counters.json"]).toBeUndefined();
    });

    it("create emits an audit entry tagged target_user: <owner>, _new field_path", async () => {
      fakeFiles["users/alex/_counters.json"] = { purchase_items: 0 };
      const api = ownerScopedPurchasesApi(args);
      const created = await api.create({
        task_id: 100,
        item_name: "Gloves",
        quantity: 1,
        link: null,
        cas: null,
        price_per_unit: 10,
        shipping_fees: 0,
        notes: null,
        funding_string: null,
        vendor: null,
        category: null,
      });

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; record_id: number; actor: string; target_user: string }>;
      };
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].field_path).toBe("_new");
      expect(audit.entries[0].record_id).toBe(created.id);
      expect(audit.entries[0].actor).toBe("mira");
      expect(audit.entries[0].target_user).toBe("alex");
    });

    it("update writes to target owner's folder + emits per-field diff entries", async () => {
      seedPurchaseItem("alex");
      const api = ownerScopedPurchasesApi(args);
      await api.update(5, { quantity: 20, price_per_unit: 6 });

      // Wrote to alex's folder.
      const alexItem = fakeFiles["users/alex/purchase_items/5.json"] as PurchaseItem;
      expect(alexItem.quantity).toBe(20);
      expect(alexItem.price_per_unit).toBe(6);
      // total_price recomputed: 20 * 6 + 2 = 122
      expect(alexItem.total_price).toBe(122);
      // Did NOT write to mira's folder.
      expect(fakeFiles["users/mira/purchase_items/5.json"]).toBeUndefined();

      // Audit log shows quantity + price_per_unit + total_price entries.
      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; old_value: unknown; new_value: unknown }>;
      };
      const paths = audit.entries.map((e) => e.field_path).sort();
      expect(paths).toEqual(["price_per_unit", "quantity", "total_price"]);
    });

    it("update with no actually-changed fields produces no audit entries", async () => {
      seedPurchaseItem("alex", { quantity: 10, price_per_unit: 5, shipping_fees: 2 });
      const api = ownerScopedPurchasesApi(args);
      // Same values back.
      await api.update(5, { quantity: 10, price_per_unit: 5 });

      // No audit file written.
      expect(fakeFiles["users/alex/_pi_audit.json"]).toBeUndefined();
    });

    it("delete removes from target owner's folder + emits a _deleted audit entry", async () => {
      seedPurchaseItem("alex");
      const api = ownerScopedPurchasesApi(args);
      await api.delete(5);

      // File gone from alex's folder.
      expect(fakeFiles["users/alex/purchase_items/5.json"]).toBeUndefined();
      // Audit captures the pre-delete record.
      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; old_value: unknown; new_value: unknown; record_id: number }>;
      };
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].field_path).toBe("_deleted");
      expect(audit.entries[0].record_id).toBe(5);
      expect(audit.entries[0].new_value).toBeNull();
      expect(audit.entries[0].old_value).toMatchObject({
        item_name: "Pipette tips",
        quantity: 10,
      });
    });

    it("multi-call same-session audit log is append-only", async () => {
      seedPurchaseItem("alex");
      const api = ownerScopedPurchasesApi(args);
      await api.update(5, { quantity: 15 });
      await api.update(5, { vendor: "Sigma" });

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string }>;
      };
      // First call: quantity + total_price (2 entries). Second: vendor (1).
      expect(audit.entries.length).toBeGreaterThanOrEqual(3);
      const paths = audit.entries.map((e) => e.field_path);
      expect(paths).toContain("quantity");
      expect(paths).toContain("total_price");
      expect(paths).toContain("vendor");
    });
  });

  describe("inactive session (falls through to raw purchasesApi)", () => {
    it("missing targetOwner: writes go to current user's folder, no audit", async () => {
      seedPurchaseItem("mira"); // current user
      const api = ownerScopedPurchasesApi({
        targetOwner: undefined,
        actor: "mira",
        sessionId: "session-1",
      });
      await api.update(5, { quantity: 99 });

      expect(fakeFiles["users/mira/purchase_items/5.json"]).toMatchObject({
        quantity: 99,
      });
      expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
    });

    it("missing sessionId: writes route through current user, no audit", async () => {
      seedPurchaseItem("mira");
      const api = ownerScopedPurchasesApi({
        targetOwner: "alex",
        actor: "mira",
        sessionId: undefined,
      });
      await api.update(5, { quantity: 50 });

      // Wrote to current user's (mira's) folder, NOT alex's.
      expect(fakeFiles["users/mira/purchase_items/5.json"]).toMatchObject({
        quantity: 50,
      });
      expect(fakeFiles["users/alex/purchase_items/5.json"]).toBeUndefined();
      // No audit emitted.
      expect(fakeFiles["users/alex/_pi_audit.json"]).toBeUndefined();
    });
  });
});

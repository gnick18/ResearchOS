// Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4: the flag-ON
// routing case for purchasesApi.setOrderStatus, the companion to the flag-OFF
// behavior already covered in purchase-assignee-notifications.test.ts (which
// runs with the default PURCHASE_LORO_ENABLED=false and exercises the
// fall-through to purchasesApi.update plus the full bell gating).
//
// Split into its own file so PURCHASE_LORO_ENABLED can be pinned true for the
// whole module (the flag is a module const read at import time, mirroring the
// pi-actions-purchase-loro-on.test.ts split).
//
// Asserts three things when the flag is on:
//   - setOrderStatus routes the persistence through writePurchaseUpdateThroughLoro
//     (not purchasesApi.update), passing the resolved owner + the order_status
//     partial, and the helper's projected item lands the new order_status.
//   - the entering-ordered notification gating still fires the requester bell on
//     the needs_ordering -> ordered transition for a handed-off item, driven by
//     the helper's projected item (so the gating is unchanged by the routing).
//   - re-affirming an already-ordered item stays silent.

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { PurchaseItem } from "./types";

const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix) && key.endsWith(".json")) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    }),
    listDirectories: vi.fn(async () => ["alex", "morgan", "mira"]),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "morgan", "mira"]),
}));

// Pin the chunk-4 flag ON for this module.
vi.mock("./loro/config", () => ({
  LORO_PILOT_ENABLED: true,
  PURCHASE_LORO_ENABLED: true,
}));

// Stand in for the real Loro write seam. It mirrors the on-disk item file so
// later reads (the prior-status read on the next setOrderStatus call) see the
// landed order_status, and returns the projected PurchaseItem the caller's
// bell-gating reads.
const writeThroughLoro = vi.fn(
  async (
    owner: string,
    id: number,
    partial: Record<string, unknown>,
    _actor?: string,
  ) => {
    const path = `users/${owner}/purchase_items/${id}.json`;
    const existing = (memFs.get(path) ?? {}) as Record<string, unknown>;
    const merged = { ...existing, ...partial };
    memFs.set(path, merged);
    return merged as unknown as PurchaseItem;
  },
);

vi.mock("./loro/purchase-write-through", () => ({
  writePurchaseUpdateThroughLoro: (...a: unknown[]) =>
    (writeThroughLoro as unknown as (...args: unknown[]) => unknown)(...a),
}));

import { purchasesApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

interface NotifFile {
  version: number;
  notifications: Array<{
    type: string;
    from_user: string;
    owner_username?: string;
    purchase_item_id?: number;
  }>;
}

function seedItem(
  item: Partial<PurchaseItem> & {
    id: number;
    task_id: number;
    item_name: string;
  },
  owner = "alex",
) {
  const full: PurchaseItem = {
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 10,
    notes: null,
    funding_string: null,
    vendor: null,
    catalog_number: null,
    category: null,
    assigned_to: null,
    order_status: "needs_ordering",
    ...item,
  };
  memFs.set(`users/${owner}/purchase_items/${item.id}.json`, full);
  return full;
}

function getNotifs(username: string): NotifFile["notifications"] {
  const file = memFs.get(`users/${username}/_notifications.json`) as
    | NotifFile
    | undefined;
  return file?.notifications ?? [];
}

function getItem(id: number, owner = "alex"): PurchaseItem | undefined {
  return memFs.get(`users/${owner}/purchase_items/${id}.json`) as
    | PurchaseItem
    | undefined;
}

beforeEach(() => {
  memFs.clear();
  writeThroughLoro.mockClear();
  clearCurrentUserCache();
});

describe("purchasesApi.setOrderStatus routing (PURCHASE_LORO_ENABLED on)", () => {
  it("routes the order_status write through writePurchaseUpdateThroughLoro and lands the new status", async () => {
    seedItem({
      id: 50,
      task_id: 8,
      item_name: "Falcon tubes",
      assigned_to: null,
      order_status: "needs_ordering",
    });

    const result = await purchasesApi.setOrderStatus(50, "ordered", {
      owner: "alex",
      actor: "alex",
    });

    // The Loro seam ran exactly once with the resolved owner, id, and the
    // order_status partial (only the changed field).
    expect(writeThroughLoro).toHaveBeenCalledTimes(1);
    expect(writeThroughLoro.mock.calls[0][0]).toBe("alex");
    expect(writeThroughLoro.mock.calls[0][1]).toBe(50);
    expect(writeThroughLoro.mock.calls[0][2]).toEqual({
      order_status: "ordered",
    });

    // The projected item carries the new status, and the mirror landed it.
    expect(result.item?.order_status).toBe("ordered");
    expect(getItem(50)?.order_status).toBe("ordered");
  });

  it("keeps the entering-ordered bell gating on the Loro path", async () => {
    // alex requested the item and handed it to morgan; morgan places it.
    seedItem({
      id: 51,
      task_id: 5,
      item_name: "Taq polymerase",
      assigned_to: "morgan",
      order_status: "needs_ordering",
    });

    const result = await purchasesApi.setOrderStatus(51, "ordered", {
      owner: "alex",
      actor: "morgan",
    });

    // Persistence went through the Loro seam.
    expect(writeThroughLoro).toHaveBeenCalledTimes(1);

    // The requester (item owner) bell fired off the projected item, unchanged
    // from the legacy persistence path.
    expect(result.notified).toBe(true);
    const alexNotifs = getNotifs("alex");
    expect(alexNotifs).toHaveLength(1);
    expect(alexNotifs[0].type).toBe("purchase_ordered");
    expect(alexNotifs[0].from_user).toBe("morgan");
    expect(alexNotifs[0].owner_username).toBe("alex");
    expect(alexNotifs[0].purchase_item_id).toBe(51);
  });

  it("stays silent when re-affirming an already-ordered item", async () => {
    seedItem({
      id: 52,
      task_id: 5,
      item_name: "dNTP mix",
      assigned_to: "morgan",
      order_status: "ordered",
    });

    const result = await purchasesApi.setOrderStatus(52, "ordered", {
      owner: "alex",
      actor: "morgan",
    });

    // The write still routed through the Loro seam (persistence is unconditional
    // on the flag), but the transition guard suppresses the bell.
    expect(writeThroughLoro).toHaveBeenCalledTimes(1);
    expect(result.notified).toBe(false);
    expect(getNotifs("alex")).toHaveLength(0);
  });
});

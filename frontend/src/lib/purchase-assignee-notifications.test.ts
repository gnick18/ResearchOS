// Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29) +
// per-item ordering status (purchases-ordered-stage, 2026-05-29).
//
// Exercises the two halves of the trainee -> lab-member ordering handoff:
//   - `purchasesApi.assign` persists `assigned_to` AND posts a
//     `purchase_assignment` bell to the assignee (skipping self-assign and
//     non-lab-member targets).
//   - `purchasesApi.setOrderStatus` persists `order_status` and, ONLY on the
//     transition INTO "ordered", posts a `purchase_ordered` bell to the
//     requester (item owner) for an item handed off to someone else
//     (skipping the requester-marks-own-order case, re-affirming "ordered",
//     and the ordered -> received step). This REPLACES the old
//     complete-toggle-driven `notifyOrdered`.
//
// Mocks the file system so we can assert what landed in each user's
// `_notifications.json` and on each purchase item file.

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
    // `listFiles` returns the .json file names under a purchase_items dir.
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

// Lab folder members — the cross-user membership guard in
// `appendPurchaseNotification` only writes for discovered users.
vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "morgan", "mira"]),
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
    task_id?: number;
    item_name?: string;
  }>;
}

function seedItem(item: Partial<PurchaseItem> & { id: number; task_id: number; item_name: string }, owner = "alex") {
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
  clearCurrentUserCache();
});

describe("purchasesApi.assign", () => {
  it("persists assigned_to and notifies the assignee", async () => {
    // alex (current user) requests an item, assigns it to morgan.
    seedItem({ id: 1, task_id: 5, item_name: "Taq polymerase" });

    const updated = await purchasesApi.assign(1, "morgan", { actor: "alex" });

    // Field round-trip: assigned_to persisted on the item file.
    expect(updated?.assigned_to).toBe("morgan");
    expect(getItem(1)?.assigned_to).toBe("morgan");

    // morgan (the assignee) gets a purchase_assignment bell.
    const morganNotifs = getNotifs("morgan");
    expect(morganNotifs).toHaveLength(1);
    expect(morganNotifs[0].type).toBe("purchase_assignment");
    expect(morganNotifs[0].from_user).toBe("alex");
    expect(morganNotifs[0].owner_username).toBe("alex");
    expect(morganNotifs[0].purchase_item_id).toBe(1);
    expect(morganNotifs[0].task_id).toBe(5);
    expect(morganNotifs[0].item_name).toBe("Taq polymerase");

    // alex never self-notifies.
    expect(getNotifs("alex")).toHaveLength(0);
  });

  it("does not notify when assigning to the requester themselves", async () => {
    seedItem({ id: 2, task_id: 5, item_name: "Pipette tips" });

    const updated = await purchasesApi.assign(2, "alex", { actor: "alex" });

    expect(updated?.assigned_to).toBe("alex");
    // Self-assign is a no-op for the bell.
    expect(getNotifs("alex")).toHaveLength(0);
  });

  it("clears the assignment with no notification when assigned_to is null", async () => {
    seedItem({ id: 3, task_id: 5, item_name: "Agarose", assigned_to: "morgan" });

    const updated = await purchasesApi.assign(3, null, { actor: "alex" });

    expect(updated?.assigned_to).toBeNull();
    expect(getNotifs("morgan")).toHaveLength(0);
  });

  it("does not mint a notification for a non-lab-member target", async () => {
    seedItem({ id: 4, task_id: 5, item_name: "Buffer" });

    // "stranger" is not in the discovered users list.
    await purchasesApi.assign(4, "stranger", { actor: "alex" });

    expect(getNotifs("stranger")).toHaveLength(0);
  });
});

describe("purchasesApi.setOrderStatus — status round-trip", () => {
  it("persists each stage on the item file and defaults pre-feature records", async () => {
    // No `order_status` set on disk — read-side normalization treats it as
    // "needs_ordering" so the transition logic sees a clean baseline.
    seedItem({ id: 40, task_id: 8, item_name: "Falcon tubes" });
    delete (getItem(40) as unknown as Record<string, unknown>).order_status;

    const toOrdered = await purchasesApi.setOrderStatus(40, "ordered", {
      actor: "alex",
    });
    expect(toOrdered.item?.order_status).toBe("ordered");
    expect(getItem(40)?.order_status).toBe("ordered");

    const toReceived = await purchasesApi.setOrderStatus(40, "received", {
      actor: "alex",
    });
    expect(toReceived.item?.order_status).toBe("received");
    expect(getItem(40)?.order_status).toBe("received");

    // Revert is supported (received -> needs_ordering).
    const back = await purchasesApi.setOrderStatus(40, "needs_ordering", {
      actor: "alex",
    });
    expect(back.item?.order_status).toBe("needs_ordering");
    expect(getItem(40)?.order_status).toBe("needs_ordering");
  });

  it("returns null without writing when the item does not exist", async () => {
    const result = await purchasesApi.setOrderStatus(999, "ordered", {
      actor: "alex",
    });
    expect(result.item).toBeNull();
    expect(result.notified).toBe(false);
  });
});

describe("purchasesApi.setOrderStatus — purchase_ordered bell", () => {
  it("fires the requester bell on the needs_ordering -> ordered transition for a handed-off item", async () => {
    // alex requested the item and handed it to morgan; morgan places it.
    seedItem({
      id: 10,
      task_id: 5,
      item_name: "Taq polymerase",
      assigned_to: "morgan",
      order_status: "needs_ordering",
    });

    const result = await purchasesApi.setOrderStatus(10, "ordered", {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified).toBe(true);
    expect(result.item?.order_status).toBe("ordered");

    const alexNotifs = getNotifs("alex");
    expect(alexNotifs).toHaveLength(1);
    expect(alexNotifs[0].type).toBe("purchase_ordered");
    expect(alexNotifs[0].owner_username).toBe("alex");
    expect(alexNotifs[0].from_user).toBe("morgan");
    expect(alexNotifs[0].purchase_item_id).toBe(10);
    expect(alexNotifs[0].task_id).toBe(5);
    expect(alexNotifs[0].item_name).toBe("Taq polymerase");
  });

  it("does NOT re-fire when an already-ordered item is set to ordered again", async () => {
    seedItem({
      id: 11,
      task_id: 5,
      item_name: "dNTP mix",
      assigned_to: "morgan",
      order_status: "ordered",
    });

    const result = await purchasesApi.setOrderStatus(11, "ordered", {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified).toBe(false);
    expect(getNotifs("alex")).toHaveLength(0);
  });

  it("does NOT fire on the ordered -> received transition", async () => {
    seedItem({
      id: 12,
      task_id: 5,
      item_name: "Agarose",
      assigned_to: "morgan",
      order_status: "ordered",
    });

    const result = await purchasesApi.setOrderStatus(12, "received", {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified).toBe(false);
    expect(getNotifs("alex")).toHaveLength(0);
  });

  it("is silent when the requester marks their own handed-off item ordered", async () => {
    seedItem({
      id: 20,
      task_id: 6,
      item_name: "Tubes",
      assigned_to: "morgan",
      order_status: "needs_ordering",
    });

    const result = await purchasesApi.setOrderStatus(20, "ordered", {
      owner: "alex",
      actor: "alex",
    });

    expect(result.notified).toBe(false);
    expect(getNotifs("alex")).toHaveLength(0);
    // The status still persisted — only the bell is suppressed.
    expect(getItem(20)?.order_status).toBe("ordered");
  });

  it("sends no bell for an unassigned item the requester keeps for themselves", async () => {
    seedItem({
      id: 30,
      task_id: 7,
      item_name: "Gloves",
      assigned_to: null,
      order_status: "needs_ordering",
    });

    const result = await purchasesApi.setOrderStatus(30, "ordered", {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified).toBe(false);
    expect(getNotifs("alex")).toHaveLength(0);
    expect(getItem(30)?.order_status).toBe("ordered");
  });

  it("does not mint a bell for a non-lab-member requester", async () => {
    // Item owned by "stranger" (not in discoverUsers), handed to morgan.
    seedItem(
      {
        id: 31,
        task_id: 9,
        item_name: "Buffer",
        assigned_to: "morgan",
        order_status: "needs_ordering",
      },
      "stranger",
    );

    const result = await purchasesApi.setOrderStatus(31, "ordered", {
      owner: "stranger",
      actor: "morgan",
    });

    // setOrderStatus reports notified=true (it attempted the write), but the
    // membership guard in appendPurchaseNotification drops the actual write.
    expect(getNotifs("stranger")).toHaveLength(0);
    expect(getItem(31, "stranger")?.order_status).toBe("ordered");
    void result;
  });
});

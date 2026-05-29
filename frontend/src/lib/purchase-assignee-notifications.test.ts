// Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29).
//
// Exercises the two halves of the trainee -> lab-member ordering handoff:
//   - `purchasesApi.assign` persists `assigned_to` AND posts a
//     `purchase_assignment` bell to the assignee (skipping self-assign and
//     non-lab-member targets).
//   - `purchasesApi.notifyOrdered` posts a `purchase_ordered` bell to the
//     requester (item owner) for every assigned line item when the order
//     is marked ordered (skipping the requester-marks-own-order case).
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

describe("purchasesApi.notifyOrdered", () => {
  it("notifies the requester for each assigned item when ordered by someone else", async () => {
    // alex requested two items on task 5 and handed them to morgan.
    seedItem({ id: 10, task_id: 5, item_name: "Taq polymerase", assigned_to: "morgan" });
    seedItem({ id: 11, task_id: 5, item_name: "dNTP mix", assigned_to: "morgan" });
    // A third item alex kept for herself (no assignee) — no bell.
    seedItem({ id: 12, task_id: 5, item_name: "Ethanol", assigned_to: null });

    // morgan marks the order ordered.
    const result = await purchasesApi.notifyOrdered(5, {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified_count).toBe(2);

    const alexNotifs = getNotifs("alex");
    expect(alexNotifs).toHaveLength(2);
    expect(alexNotifs.every((n) => n.type === "purchase_ordered")).toBe(true);
    expect(alexNotifs.every((n) => n.owner_username === "alex")).toBe(true);
    expect(alexNotifs.map((n) => n.item_name).sort()).toEqual([
      "Taq polymerase",
      "dNTP mix",
    ]);
    expect(alexNotifs[0].from_user).toBe("morgan");
  });

  it("is silent when the requester marks their own order ordered", async () => {
    seedItem({ id: 20, task_id: 6, item_name: "Tubes", assigned_to: "morgan" });

    const result = await purchasesApi.notifyOrdered(6, {
      owner: "alex",
      actor: "alex",
    });

    expect(result.notified_count).toBe(0);
    expect(getNotifs("alex")).toHaveLength(0);
  });

  it("sends no bells when no items are assigned", async () => {
    seedItem({ id: 30, task_id: 7, item_name: "Gloves", assigned_to: null });

    const result = await purchasesApi.notifyOrdered(7, {
      owner: "alex",
      actor: "morgan",
    });

    expect(result.notified_count).toBe(0);
    expect(getNotifs("alex")).toHaveLength(0);
  });
});

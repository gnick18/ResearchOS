// frontend/src/lib/migrations/funding-rework.test.ts
//
// Tests for the funding-rework migration (audit fix-bot, 2026-06-08):
//   - backfills PurchaseItem.funding_account_id from the legacy funding_string
//     label by matching FundingAccount.name (per-user, lab-wide accounts),
//   - strips the dead spent / remaining counters from funding-account files,
//   - is idempotent (a second run changes nothing),
//   - never clobbers an already-set id and leaves unmatched labels alone.
//
// Node-env test against an in-memory file map, mirroring the funding round-trip
// and other migration tests.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory file-service mock ─────────────────────────────────────────────
const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    }),
    listDirectories: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const dirs = new Set<string>();
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash > 0) dirs.add(rest.slice(0, slash));
      }
      return Array.from(dirs);
    }),
  },
}));

import { runFundingRework } from "./funding-rework";

function seedAccount(
  id: number,
  name: string,
  extra: Record<string, unknown> = {},
) {
  memFs.set(`users/lab/funding_accounts/${id}.json`, {
    id,
    name,
    description: null,
    total_budget: 1000,
    ...extra,
  });
}

function seedPurchase(
  username: string,
  id: number,
  fields: Record<string, unknown>,
) {
  memFs.set(`users/${username}/purchase_items/${id}.json`, {
    id,
    task_id: 1,
    item_name: `item-${id}`,
    quantity: 1,
    total_price: 10,
    funding_string: null,
    ...fields,
  });
}

beforeEach(() => {
  memFs.clear();
});

describe("runFundingRework", () => {
  it("backfills funding_account_id from a matching funding_string label", async () => {
    seedAccount(7, "NIH R01");
    seedPurchase("alex", 1, { funding_string: "NIH R01" });

    const report = await runFundingRework();

    const item = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    expect(item.funding_account_id).toBe(7);
    expect(report.changed).toBeGreaterThanOrEqual(1);
  });

  it("trims whitespace on the label before matching", async () => {
    seedAccount(3, "NSF CAREER");
    seedPurchase("alex", 1, { funding_string: "  NSF CAREER  " });

    await runFundingRework();

    const item = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    expect(item.funding_account_id).toBe(3);
  });

  it("leaves a label that matches no account untouched (stays null)", async () => {
    seedAccount(7, "NIH R01");
    seedPurchase("alex", 1, { funding_string: "Petty cash" });

    await runFundingRework();

    const item = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    expect(item.funding_account_id ?? null).toBeNull();
  });

  it("does not clobber an item that already has an id", async () => {
    seedAccount(7, "NIH R01");
    seedPurchase("alex", 1, {
      funding_string: "NIH R01",
      funding_account_id: 99,
    });

    await runFundingRework();

    const item = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    expect(item.funding_account_id).toBe(99);
  });

  it("strips spent / remaining from funding-account files", async () => {
    seedAccount(7, "NIH R01", { spent: 420, remaining: 580 });

    await runFundingRework();

    const acc = memFs.get("users/lab/funding_accounts/7.json") as Record<
      string,
      unknown
    >;
    expect("spent" in acc).toBe(false);
    expect("remaining" in acc).toBe(false);
    expect(acc.total_budget).toBe(1000);
    expect(acc.name).toBe("NIH R01");
  });

  it("backfills across multiple user folders", async () => {
    seedAccount(7, "NIH R01");
    seedAccount(8, "DOE EERE");
    seedPurchase("alex", 1, { funding_string: "NIH R01" });
    seedPurchase("morgan", 1, { funding_string: "DOE EERE" });

    await runFundingRework();

    const a = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    const m = memFs.get("users/morgan/purchase_items/1.json") as {
      funding_account_id: number | null;
    };
    expect(a.funding_account_id).toBe(7);
    expect(m.funding_account_id).toBe(8);
  });

  it("is idempotent: a second run changes nothing", async () => {
    seedAccount(7, "NIH R01", { spent: 100, remaining: 900 });
    seedPurchase("alex", 1, { funding_string: "NIH R01" });

    const first = await runFundingRework();
    expect(first.changed).toBeGreaterThanOrEqual(2); // item + account file

    const second = await runFundingRework();
    expect(second.changed).toBe(0);
    expect(second.failed).toBe(0);
  });

  it("ignores blank / null funding strings", async () => {
    seedAccount(7, "NIH R01");
    seedPurchase("alex", 1, { funding_string: "   " });
    seedPurchase("alex", 2, { funding_string: null });

    const report = await runFundingRework();

    const i1 = memFs.get("users/alex/purchase_items/1.json") as {
      funding_account_id?: number | null;
    };
    const i2 = memFs.get("users/alex/purchase_items/2.json") as {
      funding_account_id?: number | null;
    };
    expect(i1.funding_account_id ?? null).toBeNull();
    expect(i2.funding_account_id ?? null).toBeNull();
    expect(report.changed).toBe(0);
  });
});

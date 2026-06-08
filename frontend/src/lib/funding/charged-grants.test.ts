// frontend/src/lib/funding/charged-grants.test.ts
//
// Unit tests for the derived charged-grants helper. Post funding-rework
// (2026-06-08) purchases resolve to a grant by the authoritative
// `funding_account_id` FK, with a `funding_string` -> name fallback for records
// the migration has not backfilled yet. Covers id matching, the name fallback,
// dangling ids, unmatched-label echoes, the empty case, and the async loader.

import { describe, expect, it, vi } from "vitest";
import {
  computeChargedGrants,
  loadChargedGrants,
  type ChargedGrantsDeps,
} from "./charged-grants";
import type { FundingAccount, PurchaseItem, Task } from "@/lib/types";

// Minimal FundingAccount factory - only the fields the helper touches matter.
function acct(id: number, name: string): FundingAccount {
  return {
    id,
    name,
    description: null,
    total_budget: 0,
  };
}

function task(id: number, projectId: number): Pick<Task, "id" | "project_id"> {
  return { id, project_id: projectId };
}

// A purchase carrying the authoritative FK plus the legacy label.
function purchase(
  taskId: number,
  fundingAccountId: number | null,
  fundingString: string | null = null,
): Pick<PurchaseItem, "task_id" | "funding_account_id" | "funding_string"> {
  return {
    task_id: taskId,
    funding_account_id: fundingAccountId,
    funding_string: fundingString,
  };
}

describe("computeChargedGrants", () => {
  const accounts = [acct(1, "NIH R01"), acct(2, "NSF CAREER"), acct(3, "Internal")];

  it("returns empty for a project with no tasks", () => {
    const result = computeChargedGrants({
      projectId: 99,
      tasks: [task(1, 1), task(2, 2)],
      purchases: [purchase(1, 1)],
      fundingAccounts: accounts,
    });
    expect(result.accounts).toEqual([]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("returns empty when the project's tasks have no purchases", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1), task(11, 1)],
      purchases: [],
      fundingAccounts: accounts,
    });
    expect(result.accounts).toEqual([]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("resolves distinct accounts charged by funding_account_id across tasks", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1), task(11, 1), task(20, 2)],
      purchases: [
        purchase(10, 1),
        purchase(11, 2),
        // belongs to a task in a DIFFERENT project - must be excluded
        purchase(20, 3),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("dedupes when the same grant id is charged by several purchases", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1), task(11, 1)],
      purchases: [purchase(10, 1), purchase(10, 1), purchase(11, 1)],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.id)).toEqual([1]);
  });

  it("falls back to funding_string name match when the id is null (un-backfilled)", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, null, "NIH R01"),
        purchase(10, null, "  NSF CAREER  "),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("collects null-id labels that match no known account", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, 1),
        purchase(10, null, "Gift fund 2021"),
        purchase(10, null, "Petty cash"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual(["Gift fund 2021", "Petty cash"]);
  });

  it("echoes the label when an id is dangling (account deleted)", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, 1),
        // id 42 resolves to no account, but a label is present
        purchase(10, 42, "Old NASA grant"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual(["Old NASA grant"]);
  });

  it("ignores empty / null labels on unlinked purchases", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, 1),
        purchase(10, null, ""),
        purchase(10, null, "   "),
        purchase(10, null, null),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("name fallback is case-sensitive", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, null, "NIH R01"),
        // different case - does not match, lands in unmatched
        purchase(10, null, "nih r01"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual(["nih r01"]);
  });

  it("sorts resolved accounts and unmatched strings alphabetically", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, 2),
        purchase(10, 1),
        purchase(10, null, "Zeta fund"),
        purchase(10, null, "Alpha fund"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result.unmatchedStrings).toEqual(["Alpha fund", "Zeta fund"]);
  });
});

describe("loadChargedGrants", () => {
  it("wires the API reads into the pure core and resolves the set", async () => {
    const accounts = [acct(1, "NIH R01"), acct(2, "NSF CAREER")];
    const tasks: Task[] = [
      { ...task(10, 5) } as Task,
      { ...task(11, 5) } as Task,
    ];
    const deps: ChargedGrantsDeps = {
      listTasksByProject: vi.fn(async () => tasks),
      listPurchasesByTask: vi.fn(async (taskId: number) =>
        taskId === 10
          ? ([purchase(10, 1)] as PurchaseItem[])
          : ([purchase(11, 2), purchase(11, null, "Gift")] as PurchaseItem[]),
      ),
      listFundingAccounts: vi.fn(async () => accounts),
    };

    const result = await loadChargedGrants(5, deps);

    expect(deps.listTasksByProject).toHaveBeenCalledWith(5, undefined);
    expect(deps.listPurchasesByTask).toHaveBeenCalledTimes(2);
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result.unmatchedStrings).toEqual(["Gift"]);
  });

  it("passes the owner hint through to the task + purchase reads", async () => {
    const deps: ChargedGrantsDeps = {
      listTasksByProject: vi.fn(async () => [{ ...task(10, 5) } as Task]),
      listPurchasesByTask: vi.fn(async () => [] as PurchaseItem[]),
      listFundingAccounts: vi.fn(async () => []),
    };

    await loadChargedGrants(5, deps, "alice");

    expect(deps.listTasksByProject).toHaveBeenCalledWith(5, "alice");
    expect(deps.listPurchasesByTask).toHaveBeenCalledWith(10, "alice");
  });

  it("degrades a failing per-task purchase read to an empty list", async () => {
    const accounts = [acct(1, "NIH R01")];
    const deps: ChargedGrantsDeps = {
      listTasksByProject: vi.fn(async () => [
        { ...task(10, 5) } as Task,
        { ...task(11, 5) } as Task,
      ]),
      listPurchasesByTask: vi.fn(async (taskId: number) => {
        if (taskId === 11) throw new Error("read failed");
        return [purchase(10, 1)] as PurchaseItem[];
      }),
      listFundingAccounts: vi.fn(async () => accounts),
    };

    const result = await loadChargedGrants(5, deps);
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual([]);
  });
});

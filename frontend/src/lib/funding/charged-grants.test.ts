// frontend/src/lib/funding/charged-grants.test.ts
//
// Unit tests for the derived charged-grants helper (funding-niceties bot,
// 2026-05-28): distinct resolution, name matching, unmatched-string handling,
// the empty / no-purchases case, and the async loader wiring.

import { describe, expect, it, vi } from "vitest";
import {
  computeChargedGrants,
  loadChargedGrants,
  type ChargedGrantsDeps,
} from "./charged-grants";
import type { FundingAccount, PurchaseItem, Task } from "@/lib/types";

// Minimal FundingAccount factory - only the fields the helper touches matter,
// the rest are filled to satisfy the type.
function acct(id: number, name: string): FundingAccount {
  return {
    id,
    name,
    description: null,
    total_budget: 0,
    spent: 0,
    remaining: 0,
  };
}

function task(id: number, projectId: number): Pick<Task, "id" | "project_id"> {
  return { id, project_id: projectId };
}

function purchase(
  taskId: number,
  fundingString: string | null,
): Pick<PurchaseItem, "task_id" | "funding_string"> {
  return { task_id: taskId, funding_string: fundingString };
}

describe("computeChargedGrants", () => {
  const accounts = [acct(1, "NIH R01"), acct(2, "NSF CAREER"), acct(3, "Internal")];

  it("returns empty for a project with no tasks", () => {
    const result = computeChargedGrants({
      projectId: 99,
      tasks: [task(1, 1), task(2, 2)],
      purchases: [purchase(1, "NIH R01")],
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

  it("resolves distinct accounts charged across multiple tasks in the project", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1), task(11, 1), task(20, 2)],
      purchases: [
        purchase(10, "NIH R01"),
        purchase(11, "NSF CAREER"),
        // belongs to a task in a DIFFERENT project - must be excluded
        purchase(20, "Internal"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("dedupes when the same grant is charged by several purchases", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1), task(11, 1)],
      purchases: [
        purchase(10, "NIH R01"),
        purchase(10, "NIH R01"),
        purchase(11, "NIH R01"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.id)).toEqual([1]);
  });

  it("collects funding strings that match no known account", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, "NIH R01"),
        purchase(10, "Gift fund 2021"),
        purchase(10, "Petty cash"),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual(["Gift fund 2021", "Petty cash"]);
  });

  it("trims whitespace and ignores empty / null funding strings", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, "  NIH R01  "),
        purchase(10, ""),
        purchase(10, "   "),
        purchase(10, null),
      ],
      fundingAccounts: accounts,
    });
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual([]);
  });

  it("matches by exact name (not id) and is case-sensitive", () => {
    const result = computeChargedGrants({
      projectId: 1,
      tasks: [task(10, 1)],
      purchases: [
        purchase(10, "NIH R01"),
        // different case - does not match, lands in unmatched
        purchase(10, "nih r01"),
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
        purchase(10, "NSF CAREER"),
        purchase(10, "NIH R01"),
        purchase(10, "Zeta fund"),
        purchase(10, "Alpha fund"),
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
          ? ([purchase(10, "NIH R01")] as PurchaseItem[])
          : ([purchase(11, "NSF CAREER"), purchase(11, "Gift")] as PurchaseItem[]),
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
        return [purchase(10, "NIH R01")] as PurchaseItem[];
      }),
      listFundingAccounts: vi.fn(async () => accounts),
    };

    const result = await loadChargedGrants(5, deps);
    expect(result.accounts.map((a) => a.name)).toEqual(["NIH R01"]);
    expect(result.unmatchedStrings).toEqual([]);
  });
});

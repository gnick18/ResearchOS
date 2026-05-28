// frontend/src/lib/funding/charged-grants.ts
//
// Derived "charged-grants" set (funding-niceties bot, 2026-05-28).
//
// Computes, for a given project, the DISTINCT set of FundingAccounts that
// purchases inside that project were actually charged to. This is a DERIVED
// view, NOT a stored field: it is recomputed live from the existing data
// chain (Project -> Task -> PurchaseItem.funding_string -> FundingAccount.name)
// every time it is needed. Nothing new is persisted to disk.
//
// The "primary" grant link (Project.funding_account_id) is a separate,
// stored, single-value concept. This helper is the complementary "where did
// the money actually go" rollup, which can differ from the primary link
// (a project may charge several grants over its life, or charge a grant that
// is not its declared primary).
//
// Match rule: PurchaseItem.funding_string is a free-form label that matches a
// FundingAccount by its `name` (NOT its id). Strings that match no known
// account are returned separately so the UI can surface a soft
// "charged to X (no matching account)" hint rather than silently dropping
// them.
//
// The core (`computeChargedGrants`) is a PURE function over plain data so it
// is trivially unit-testable and dependency-free; the async wrapper
// (`loadChargedGrants`) only wires it to the local-api reads. Keeping the
// pure core importable means a later export / deposit slice can reuse the
// exact same resolution logic without re-fetching or duplicating the rule.

import type { FundingAccount, PurchaseItem, Task } from "@/lib/types";

/**
 * The distinct set of grants charged within a project.
 *
 * `accounts` are the resolved FundingAccounts (deduped by id, ordered by the
 * account `name` for a stable surface). `unmatchedStrings` are the distinct,
 * trimmed `funding_string` values that did NOT resolve to any known account,
 * preserving the casing of their first occurrence so the UI can echo what the
 * user actually typed.
 */
export interface ChargedGrants {
  accounts: FundingAccount[];
  unmatchedStrings: string[];
}

export interface ComputeChargedGrantsInput {
  projectId: number;
  /** All tasks visible to the caller. Filtered here by `project_id`. */
  tasks: ReadonlyArray<Pick<Task, "id" | "project_id">>;
  /** All purchase items visible to the caller. Filtered here by `task_id`. */
  purchases: ReadonlyArray<Pick<PurchaseItem, "task_id" | "funding_string">>;
  /** Known funding accounts to resolve funding strings against by name. */
  fundingAccounts: ReadonlyArray<FundingAccount>;
}

/**
 * Pure core. Given a projectId plus the full task / purchase / account sets,
 * returns the distinct grants charged within that project.
 *
 * Steps:
 *   1. Collect the ids of tasks whose `project_id === projectId`.
 *   2. Collect the purchases whose `task_id` is in that set.
 *   3. Collect the distinct non-empty (trimmed) `funding_string` values.
 *   4. Resolve each to a FundingAccount by exact `name` match; collect the
 *      rest as `unmatchedStrings`.
 *
 * Empty / no-purchase projects yield `{ accounts: [], unmatchedStrings: [] }`.
 */
export function computeChargedGrants({
  projectId,
  tasks,
  purchases,
  fundingAccounts,
}: ComputeChargedGrantsInput): ChargedGrants {
  // 1. Tasks in this project.
  const taskIds = new Set<number>();
  for (const task of tasks) {
    if (task.project_id === projectId) taskIds.add(task.id);
  }

  // 2 + 3. Distinct, trimmed, non-empty funding strings on those tasks'
  // purchases. The Map is keyed on the trimmed string so duplicates collapse
  // while preserving the first-seen value for the unmatched echo.
  const distinctStrings = new Map<string, string>();
  for (const purchase of purchases) {
    if (!taskIds.has(purchase.task_id)) continue;
    const raw = purchase.funding_string;
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (!distinctStrings.has(trimmed)) distinctStrings.set(trimmed, trimmed);
  }

  // 4. Resolve by exact name. An account name index lets repeated lookups
  // stay O(1); the first account wins if two accounts somehow share a name
  // (a malformed lab folder), matching the single-row select behaviour.
  const accountByName = new Map<string, FundingAccount>();
  for (const acc of fundingAccounts) {
    if (!accountByName.has(acc.name)) accountByName.set(acc.name, acc);
  }

  const resolvedById = new Map<number, FundingAccount>();
  const unmatched: string[] = [];
  for (const value of distinctStrings.values()) {
    const match = accountByName.get(value);
    if (match) {
      // Dedupe by id: two different funding strings could resolve to the same
      // account only if names collide, but the name-index above already
      // collapses that. Keeping the id dedupe is cheap insurance.
      if (!resolvedById.has(match.id)) resolvedById.set(match.id, match);
    } else {
      unmatched.push(value);
    }
  }

  const accounts = Array.from(resolvedById.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  unmatched.sort((a, b) => a.localeCompare(b));

  return { accounts, unmatchedStrings: unmatched };
}

/**
 * Async wrapper that fetches the data the pure core needs, then computes the
 * charged-grants set for a project.
 *
 * `deps` is injectable so component code and tests can pass either the real
 * local-api functions or fakes. The default wiring (in the component) imports
 * `tasksApi`, `purchasesApi` from `@/lib/local-api`.
 *
 * `owner` routes the task read into a shared project's owner directory,
 * mirroring `tasksApi.listByProject(projectId, owner)`. Purchases are read via
 * `listByTask(taskId, owner)` per task so shared-project purchases resolve
 * from the owner's `purchase_items/` directory rather than the viewer's
 * (same isolation rule the /purchases merged loader follows).
 */
export interface ChargedGrantsDeps {
  listTasksByProject: (projectId: number, owner?: string) => Promise<Task[]>;
  listPurchasesByTask: (taskId: number, owner?: string) => Promise<PurchaseItem[]>;
  listFundingAccounts: () => Promise<FundingAccount[]>;
}

export async function loadChargedGrants(
  projectId: number,
  deps: ChargedGrantsDeps,
  owner?: string,
): Promise<ChargedGrants> {
  const [tasks, fundingAccounts] = await Promise.all([
    deps.listTasksByProject(projectId, owner),
    deps.listFundingAccounts(),
  ]);

  // Only purchase-bearing tasks matter, but every task can carry purchases
  // (the inline PurchaseEditor attaches items to any task type), so read all
  // of them. Reads run in parallel; failures on a single task degrade to an
  // empty list rather than failing the whole rollup.
  const purchaseLists = await Promise.all(
    tasks.map((task) =>
      deps.listPurchasesByTask(task.id, owner).catch(() => [] as PurchaseItem[]),
    ),
  );
  const purchases = purchaseLists.flat();

  return computeChargedGrants({ projectId, tasks, purchases, fundingAccounts });
}

// frontend/src/lib/funding/charged-grants.ts
//
// Derived "charged-grants" set (funding-niceties bot, 2026-05-28).
//
// Computes, for a given project, the DISTINCT set of FundingAccounts that
// purchases inside that project were actually charged to. This is a DERIVED
// view, NOT a stored field: it is recomputed live from the existing data
// chain (Project -> Task -> PurchaseItem.funding_account_id -> FundingAccount)
// every time it is needed. Nothing new is persisted to disk.
//
// The "primary" grant link (Project.funding_account_id) is a separate,
// stored, single-value concept. This helper is the complementary "where did
// the money actually go" rollup, which can differ from the primary link
// (a project may charge several grants over its life, or charge a grant that
// is not its declared primary).
//
// Match rule (funding-rework, 2026-06-08): a purchase links to a grant by the
// AUTHORITATIVE foreign key `PurchaseItem.funding_account_id` (-> id). For
// records the auto-migration has not yet backfilled (null id but a populated
// `funding_string`), we fall back to matching the label against the account
// `name`, the legacy rule, so the rollup stays correct during the transition.
// Links that resolve to no known account (a deleted grant, or a typed label
// with no matching account) are returned separately via their `funding_string`
// label so the UI can surface a soft "charged to X (no matching account)" hint
// rather than silently dropping them.
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
 * trimmed `funding_string` labels of purchases whose funding link did NOT
 * resolve to any known account, preserving the casing of their first occurrence
 * so the UI can echo what the user actually typed.
 */
export interface ChargedGrants {
  accounts: FundingAccount[];
  unmatchedStrings: string[];
}

export interface ComputeChargedGrantsInput {
  projectId: number;
  /** All tasks visible to the caller. Filtered here by `project_id`. */
  tasks: ReadonlyArray<Pick<Task, "id" | "project_id">>;
  /** All purchase items visible to the caller. Filtered here by `task_id`.
   *  Resolved by `funding_account_id` (authoritative), with a `funding_string`
   *  -> name fallback for records not yet backfilled by the migration. */
  purchases: ReadonlyArray<
    Pick<PurchaseItem, "task_id" | "funding_account_id" | "funding_string">
  >;
  /** Known funding accounts to resolve funding links against (by id, then name). */
  fundingAccounts: ReadonlyArray<FundingAccount>;
}

/**
 * Pure core. Given a projectId plus the full task / purchase / account sets,
 * returns the distinct grants charged within that project.
 *
 * Steps:
 *   1. Collect the ids of tasks whose `project_id === projectId`.
 *   2. For each purchase on those tasks, resolve its funding link:
 *        a. by `funding_account_id` -> account id (authoritative), else
 *        b. (null id only) by trimmed `funding_string` -> account name
 *           (transition fallback for un-backfilled records).
 *   3. Resolved purchases contribute their account (deduped by id); links that
 *      resolve to nothing but carry a `funding_string` label collect into
 *      `unmatchedStrings` (distinct, first-seen casing).
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

  // Account indexes. `byId` is the authoritative resolver; `byName` backs the
  // legacy funding_string fallback for records the migration has not reached.
  // First account wins on a name collision (a malformed lab folder), matching
  // the single-row select behaviour.
  const accountById = new Map<number, FundingAccount>();
  const accountByName = new Map<string, FundingAccount>();
  for (const acc of fundingAccounts) {
    accountById.set(acc.id, acc);
    if (!accountByName.has(acc.name)) accountByName.set(acc.name, acc);
  }

  const resolvedById = new Map<number, FundingAccount>();
  // Keyed on the trimmed label so duplicate unmatched strings collapse while
  // preserving the first-seen casing for the UI echo.
  const unmatched = new Map<string, string>();

  for (const purchase of purchases) {
    if (!taskIds.has(purchase.task_id)) continue;

    const rawString =
      typeof purchase.funding_string === "string"
        ? purchase.funding_string.trim()
        : "";

    // a. Authoritative FK.
    if (purchase.funding_account_id != null) {
      const match = accountById.get(purchase.funding_account_id);
      if (match) {
        resolvedById.set(match.id, match);
      } else if (rawString.length > 0) {
        // Dangling id (the grant was deleted) — echo the label if we have one.
        if (!unmatched.has(rawString)) unmatched.set(rawString, rawString);
      }
      continue;
    }

    // b. Transition fallback: no id yet, resolve the label by name.
    if (rawString.length === 0) continue;
    const match = accountByName.get(rawString);
    if (match) {
      resolvedById.set(match.id, match);
    } else if (!unmatched.has(rawString)) {
      unmatched.set(rawString, rawString);
    }
  }

  const accounts = Array.from(resolvedById.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const unmatchedStrings = Array.from(unmatched.values()).sort((a, b) =>
    a.localeCompare(b),
  );

  return { accounts, unmatchedStrings };
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

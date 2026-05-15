"use client";

import { useMemo, useState } from "react";
import type {
  PurchaseItem,
  Task,
  Project,
  FundingAccount,
} from "@/lib/types";

// SAFEGUARD: aggregations scope to PurchaseItem by identity, not field name.
// LabLink also has a `category` field (~10 instances in wiki-capture fixture);
// naive grouping by field name would cross-contaminate. Source data is
// purchasesApi.listAllIncludingShared, which returns only PurchaseItem.

type TimeRangeOption = "30d" | "90d" | "12mo" | "all" | "custom";
type BreakdownLens = "project" | "vendor" | "category";

const TIME_RANGE_LABELS: Record<TimeRangeOption, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12mo": "Last 12 months",
  all: "All time",
  custom: "Custom",
};

interface SpendingDashboardProps {
  // already-merged-view items (decorated with owner). Items only — never
  // mixed with other entity types that happen to share field names.
  purchaseItems: Array<PurchaseItem & { owner: string }>;
  tasks: Task[];
  // Wired for Chip D (project-name lookup keyed by composite `${owner}:${id}`).
  // Unused in the Chip C placeholder breakdown — kept on the prop signature
  // so the caller doesn't need a follow-up edit.
  projects: Project[];
  fundingAccounts: FundingAccount[];
  // global project-filter state from useAppStore. The "All projects" toggle
  // below lets the user override it within the dashboard without leaving.
  selectedProjectIds: number[];
}

function timeRangeStartIso(option: TimeRangeOption): string | null {
  if (option === "all" || option === "custom") return null;
  const now = new Date();
  if (option === "30d") now.setDate(now.getDate() - 30);
  else if (option === "90d") now.setDate(now.getDate() - 90);
  else if (option === "12mo") now.setMonth(now.getMonth() - 12);
  return now.toISOString().slice(0, 10);
}

export default function SpendingDashboard({
  purchaseItems,
  tasks,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- wired for Chip D project-name lookup; see prop comment
  projects,
  fundingAccounts,
  selectedProjectIds,
}: SpendingDashboardProps) {
  const [timeRangeOption, setTimeRangeOption] =
    useState<TimeRangeOption>("12mo");
  const [breakdownLens, setBreakdownLens] = useState<BreakdownLens>("project");
  const [respectGlobalProjectFilter, setRespectGlobalProjectFilter] =
    useState<boolean>(true);

  // Task lookup keyed by composite `${owner}:${id}` — per-user ID spaces
  // mean alex's task 5 and morgan's task 5 are different tasks. Each
  // PurchaseItem carries `owner` from listAllIncludingShared so the route
  // back to the parent task is unambiguous.
  const taskByKey = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(`${t.owner}:${t.id}`, t);
    return map;
  }, [tasks]);

  // Filter items: time range + project filter (respecting the override).
  // Project filter applies via the parent task's `project_id`.
  const filteredItems = useMemo(() => {
    const startIso = timeRangeStartIso(timeRangeOption);
    const projectFilterActive =
      respectGlobalProjectFilter && selectedProjectIds.length > 0;
    return purchaseItems.filter((item) => {
      const task = taskByKey.get(`${item.owner}:${item.task_id}`);
      if (!task) return false;
      if (startIso && task.start_date < startIso) return false;
      if (projectFilterActive && !selectedProjectIds.includes(task.project_id))
        return false;
      return true;
    });
  }, [
    purchaseItems,
    taskByKey,
    timeRangeOption,
    respectGlobalProjectFilter,
    selectedProjectIds,
  ]);

  // Items whose parent task is NOT typed as a purchase — the latent
  // grandTotal bug from PURCHASES_PAGE_PROPOSAL.md §5. Surfaced here so the
  // user can see what's silently contributing to spend totals. Source is
  // already PurchaseItem-only (see safeguard at top of file).
  const nonPurchaseTaskItems = useMemo(() => {
    return filteredItems.filter((item) => {
      const task = taskByKey.get(`${item.owner}:${item.task_id}`);
      return task && task.task_type !== "purchase";
    });
  }, [filteredItems, taskByKey]);

  const nonPurchaseTaskTotal = useMemo(
    () =>
      nonPurchaseTaskItems.reduce((sum, i) => sum + (i.total_price ?? 0), 0),
    [nonPurchaseTaskItems]
  );

  const totalSpent = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.total_price ?? 0), 0),
    [filteredItems]
  );

  // Funding-account spend computed live from items — FundingAccount.spent on
  // disk is stale (see LabPurchasesPanel.tsx:101-108 for the same workaround).
  const spentByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filteredItems) {
      const key = item.funding_string ?? "__uncategorized__";
      map.set(key, (map.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return map;
  }, [filteredItems]);

  const breakdownLensLabel: Record<BreakdownLens, string> = {
    project: "Project",
    vendor: "Vendor",
    category: "Category",
  };

  return (
    <div className="mt-12 border-t-2 border-gray-200 pt-8">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Spending dashboard
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            ${totalSpent.toFixed(2)} across {filteredItems.length} item
            {filteredItems.length === 1 ? "" : "s"} in window
          </p>
        </div>
        <button
          disabled
          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed"
          title="Wired in Chip D"
        >
          Export CSV
        </button>
      </div>

      {/* Top controls: time range + project-filter override */}
      <div className="flex flex-wrap items-center gap-4 mb-6 p-3 bg-gray-50 rounded-lg">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <span>Time range:</span>
          <select
            value={timeRangeOption}
            onChange={(e) =>
              setTimeRangeOption(e.target.value as TimeRangeOption)
            }
            className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
          >
            {(Object.keys(TIME_RANGE_LABELS) as TimeRangeOption[]).map(
              (opt) => (
                <option key={opt} value={opt}>
                  {TIME_RANGE_LABELS[opt]}
                </option>
              )
            )}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={!respectGlobalProjectFilter}
            onChange={(e) =>
              setRespectGlobalProjectFilter(!e.target.checked)
            }
            className="w-3.5 h-3.5"
          />
          <span>
            All projects
            {selectedProjectIds.length > 0 &&
              respectGlobalProjectFilter &&
              ` (currently filtered to ${selectedProjectIds.length})`}
          </span>
        </label>
      </div>

      {/* FUNDING ACCOUNTS */}
      <section className="mb-8">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Funding accounts
        </h4>
        {fundingAccounts.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            No funding accounts yet — add one from the manager above.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fundingAccounts.map((acc) => {
              const spent = spentByAccount.get(acc.name) ?? 0;
              const pct =
                acc.total_budget > 0
                  ? Math.min(100, (spent / acc.total_budget) * 100)
                  : 0;
              return (
                <div
                  key={acc.id}
                  className="p-3 bg-white border border-gray-200 rounded-lg"
                >
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {acc.name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    ${spent.toFixed(2)} / ${acc.total_budget.toFixed(2)}
                  </p>
                  <div className="mt-2 h-2 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {pct.toFixed(0)}%
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SPEND OVER TIME */}
      <section className="mb-8">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Spend over time
        </h4>
        <div className="p-6 bg-white border border-dashed border-gray-300 rounded-lg text-center">
          <p className="text-xs text-gray-400">
            Per-month bars populate in Chip D
          </p>
        </div>
      </section>

      {/* BREAKDOWN BY [lens] */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Breakdown by {breakdownLensLabel[breakdownLens]}
          </h4>
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5 text-xs">
            {(Object.keys(breakdownLensLabel) as BreakdownLens[]).map(
              (lens) => (
                <button
                  key={lens}
                  onClick={() => setBreakdownLens(lens)}
                  className={`px-3 py-1 rounded transition-colors ${
                    breakdownLens === lens
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {breakdownLensLabel[lens]}
                </button>
              )
            )}
          </div>
        </div>
        <div className="p-6 bg-white border border-dashed border-gray-300 rounded-lg text-center">
          <p className="text-xs text-gray-400">
            Breakdown bars populate in Chip D
          </p>
        </div>
      </section>

      {/* Items on non-purchase tasks — surfaces the latent grandTotal bug */}
      <section className="mb-2">
        <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800">
            <span className="font-semibold">
              Items on non-purchase tasks:
            </span>{" "}
            {nonPurchaseTaskItems.length} item
            {nonPurchaseTaskItems.length === 1 ? "" : "s"}, $
            {nonPurchaseTaskTotal.toFixed(2)}
          </p>
          {nonPurchaseTaskItems.length > 0 && (
            <p className="text-[10px] text-amber-700 mt-1">
              These items live on tasks not typed as &ldquo;purchase&rdquo; — they still
              count toward spend totals. Open the parent task in /workbench to
              reclassify or move them.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

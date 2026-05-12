"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LabTask, LabUser, LabProject, purchasesApi, labApi } from "@/lib/local-api";

interface LabPurchasesPanelProps {
  purchases: LabTask[];
  users: LabUser[];
  projects: LabProject[];
  selectedUsernames: Set<string>;
  onPurchaseClick: (purchase: LabTask) => void;
}

const UNCATEGORIZED = "__uncategorized__";

export default function LabPurchasesPanel({
  purchases,
  users,
  projects,
  selectedUsernames,
  onPurchaseClick,
}: LabPurchasesPanelProps) {
  const [selectedFundingString, setSelectedFundingString] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "summary">("list");

  // Fetch funding accounts
  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
  });

  // Fetch all purchase items across users so we can resolve funding_string per task.
  const { data: allItems = [] } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
  });

  // Get user color by username
  const getUserColor = (username: string) => {
    const user = users.find(u => u.username === username);
    return user?.color || "#6b7280";
  };

  // Get project name by ID
  const getProjectName = (projectId: number, username: string) => {
    const project = projects.find(p => p.id === projectId && p.username === username);
    return project?.name || "Unknown Project";
  };

  // Map: "username:taskId" -> Set of funding strings touched by that purchase task's items.
  // A purchase task can span multiple funding accounts because each line item carries
  // its own funding_string (see app/purchases/page.tsx).
  const fundingByTask = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of allItems) {
      const key = `${item.username}:${item.task_id}`;
      const bucket = map.get(key) ?? new Set<string>();
      bucket.add(item.funding_string || UNCATEGORIZED);
      map.set(key, bucket);
    }
    return map;
  }, [allItems]);

  // Filter purchases by selected users and (if active) the selected funding string.
  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      if (!selectedUsernames.has(p.username)) return false;
      if (!selectedFundingString) return true;
      const key = `${p.username}:${p.id}`;
      const buckets = fundingByTask.get(key);
      if (!buckets) return selectedFundingString === UNCATEGORIZED;
      return buckets.has(selectedFundingString);
    });
  }, [purchases, selectedUsernames, selectedFundingString, fundingByTask]);

  // Items belonging to the currently-visible (selected-user) purchase tasks.
  const visibleItems = useMemo(() => {
    const visibleKeys = new Set(
      purchases
        .filter((p) => selectedUsernames.has(p.username))
        .map((p) => `${p.username}:${p.id}`),
    );
    return allItems.filter((item) => visibleKeys.has(`${item.username}:${item.task_id}`));
  }, [allItems, purchases, selectedUsernames]);

  // Spent per funding string across the currently-visible (selected-user) items.
  const spentByFunding = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of visibleItems) {
      const key = item.funding_string || UNCATEGORIZED;
      totals.set(key, (totals.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return totals;
  }, [visibleItems]);

  // Lab-wide spend per funding string across ALL users (not just selected).
  // FundingAccount.spent on disk is stale (set to 0 at create time and never
  // recomputed), so we derive the displayed "Spent" from items here.
  const spentByFundingAll = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of allItems) {
      const key = item.funding_string || UNCATEGORIZED;
      totals.set(key, (totals.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return totals;
  }, [allItems]);

  // Lookup: "username:taskId" -> parent purchase task. Used to attribute
  // line items to a project and month for summary rollups.
  const taskLookup = useMemo(() => {
    const map = new Map<string, LabTask>();
    for (const p of purchases) map.set(`${p.username}:${p.id}`, p);
    return map;
  }, [purchases]);

  // For the summary view we apply the funding filter too, so all rollups
  // stay consistent with what the list shows.
  const summaryItems = useMemo(() => {
    if (!selectedFundingString) return visibleItems;
    return visibleItems.filter(
      (item) => (item.funding_string || UNCATEGORIZED) === selectedFundingString,
    );
  }, [visibleItems, selectedFundingString]);

  const spentByUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of summaryItems) {
      totals.set(item.username, (totals.get(item.username) ?? 0) + (item.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [summaryItems]);

  const spentByProject = useMemo(() => {
    const totals = new Map<string, { username: string; projectId: number; total: number }>();
    for (const item of summaryItems) {
      const task = taskLookup.get(`${item.username}:${item.task_id}`);
      if (!task) continue;
      const key = `${task.username}:${task.project_id}`;
      const existing = totals.get(key) ?? {
        username: task.username,
        projectId: task.project_id,
        total: 0,
      };
      existing.total += item.total_price ?? 0;
      totals.set(key, existing);
    }
    return Array.from(totals.values()).sort((a, b) => b.total - a.total);
  }, [summaryItems, taskLookup]);

  // Per-month spend keyed by parent task's start_date (items lack their own
  // date). We show the last 12 months, oldest first.
  const spentByMonth = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of summaryItems) {
      const task = taskLookup.get(`${item.username}:${item.task_id}`);
      const start = task?.start_date;
      if (!start) continue;
      const month = start.slice(0, 7); // YYYY-MM
      totals.set(month, (totals.get(month) ?? 0) + (item.total_price ?? 0));
    }
    const months = Array.from(totals.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return months.slice(-12);
  }, [summaryItems, taskLookup]);

  const totalSpentInView = useMemo(
    () => summaryItems.reduce((acc, item) => acc + (item.total_price ?? 0), 0),
    [summaryItems],
  );

  const exportCsv = () => {
    const headers = [
      "username",
      "task_id",
      "task_name",
      "task_start_date",
      "task_complete",
      "project",
      "item_name",
      "quantity",
      "price_per_unit",
      "shipping_fees",
      "total_price",
      "funding_string",
      "link",
      "cas",
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const rows = summaryItems.map((item) => {
      const task = taskLookup.get(`${item.username}:${item.task_id}`);
      return [
        item.username,
        item.task_id,
        task?.name ?? "",
        task?.start_date ?? "",
        task?.is_complete ? "yes" : "no",
        task ? getProjectName(task.project_id, task.username) : "",
        item.item_name,
        item.quantity,
        item.price_per_unit ?? "",
        item.shipping_fees ?? "",
        item.total_price ?? "",
        item.funding_string ?? "",
        item.link ?? "",
        item.cas ?? "",
      ].map(escape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-purchases-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Bar chart helper: max month value normalizes bar widths.
  const maxMonthly = useMemo(
    () => Math.max(0, ...spentByMonth.map(([, v]) => v)),
    [spentByMonth],
  );

  const formatMonth = (yyyyMm: string) => {
    const [y, m] = yyyyMm.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // Calculate totals
  const totalPurchases = filteredPurchases.length;
  const completedPurchases = filteredPurchases.filter(p => p.is_complete).length;
  const pendingPurchases = totalPurchases - completedPurchases;

  // Funding cards we want to render: every named account + an "Uncategorized" tile
  // if there is uncategorized spend visible.
  const uncategorizedSpent = spentByFunding.get(UNCATEGORIZED) ?? 0;

  const noPurchases = purchases.filter((p) => selectedUsernames.has(p.username)).length === 0;

  return (
    <div className="space-y-6">
      {/* Funding Accounts Summary */}
      {fundingAccounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Funding Accounts Overview</h3>
              <p className="text-xs text-gray-500">Click an account to filter the list below</p>
            </div>
            {selectedFundingString && (
              <button
                onClick={() => setSelectedFundingString(null)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {fundingAccounts.map((acc) => {
                const visibleSpent = spentByFunding.get(acc.name) ?? 0;
                const isSelected = selectedFundingString === acc.name;
                // Derive these locally — FundingAccount.spent/remaining on disk
                // is unreliable (set to 0 on create, never recomputed, and
                // missing entirely on older account files).
                const budget = acc.total_budget ?? 0;
                const spent = spentByFundingAll.get(acc.name) ?? 0;
                const remaining = budget - spent;
                const pct = budget > 0 ? (spent / budget) * 100 : 0;
                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-lg border-2 transition-colors cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setSelectedFundingString(isSelected ? null : acc.name)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-gray-900 truncate" title={acc.name}>
                        {acc.name}
                      </p>
                      {budget > 0 && remaining < 0 ? (
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                          Over Budget
                        </span>
                      ) : budget > 0 && remaining < budget * 0.1 ? (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          Low
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Spent</span>
                        <span className="font-medium text-gray-900">${spent.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">In view</span>
                        <span className="font-medium text-gray-700">${visibleSpent.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Budget</span>
                        <span className="font-medium text-gray-900">${budget.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Remaining</span>
                        <span className={`font-medium ${remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          ${remaining.toFixed(2)}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pct > 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {uncategorizedSpent > 0 && (
                <div
                  className={`p-4 rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
                    selectedFundingString === UNCATEGORIZED
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                  onClick={() =>
                    setSelectedFundingString(
                      selectedFundingString === UNCATEGORIZED ? null : UNCATEGORIZED,
                    )
                  }
                >
                  <p className="text-sm font-medium text-gray-700 mb-2">Uncategorized</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">In view</span>
                    <span className="font-medium text-gray-900">${uncategorizedSpent.toFixed(2)}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">
                    Items without a funding account assigned
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Total Purchases</p>
          <p className="text-2xl font-bold text-gray-900">{totalPurchases}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">{completedPurchases}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Pending</p>
          <p className="text-2xl font-bold text-amber-600">{pendingPurchases}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Spent (in view)</p>
          <p className="text-2xl font-bold text-gray-900">${totalSpentInView.toFixed(2)}</p>
        </div>
      </div>

      {/* View Toggle + Export */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === "list" ? "bg-emerald-100 text-emerald-700" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode("summary")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewMode === "summary" ? "bg-emerald-100 text-emerald-700" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            Summary
          </button>
        </div>
        <button
          onClick={exportCsv}
          disabled={summaryItems.length === 0}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {viewMode === "summary" ? (
        <>
          {/* Per-month bar list */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700">Spend by month</h3>
              <p className="text-xs text-gray-500">By parent purchase task&apos;s start date, last 12 months in window</p>
            </div>
            {spentByMonth.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">No data.</div>
            ) : (
              <div className="p-4 space-y-2">
                {spentByMonth.map(([month, total]) => (
                  <div key={month} className="flex items-center gap-3">
                    <div className="w-16 text-xs text-gray-500 flex-shrink-0">{formatMonth(month)}</div>
                    <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded"
                        style={{ width: `${maxMonthly > 0 ? (total / maxMonthly) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="w-24 text-right text-xs font-medium text-gray-700 flex-shrink-0">
                      ${total.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Two tables side-by-side on wide screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Spend by user</h3>
              </div>
              {spentByUser.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">No data.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {spentByUser.map(([username, total]) => (
                    <div key={username} className="flex items-center gap-3 px-4 py-2.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                        style={{ backgroundColor: getUserColor(username) }}
                      >
                        {username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 text-sm text-gray-900 truncate">{username}</div>
                      <div className="text-sm font-medium text-gray-700">${total.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Spend by project</h3>
              </div>
              {spentByProject.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">No data.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {spentByProject.map((row) => (
                    <div
                      key={`${row.username}-${row.projectId}`}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getUserColor(row.username) }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {getProjectName(row.projectId, row.username)}
                        </p>
                        <p className="text-xs text-gray-500">{row.username}</p>
                      </div>
                      <div className="text-sm font-medium text-gray-700 flex-shrink-0">
                        ${row.total.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (

      /* Purchases List - Simplified View */
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Purchase Orders</h3>
              <p className="text-sm text-gray-500">
                {selectedFundingString === UNCATEGORIZED
                  ? "Filtered by: Uncategorized"
                  : selectedFundingString
                  ? `Filtered by: ${selectedFundingString}`
                  : "All purchase orders"}
              </p>
            </div>
            {selectedFundingString && (
              <button
                onClick={() => setSelectedFundingString(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>

        {noPurchases ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            No purchases found for selected users.
          </div>
        ) : filteredPurchases.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            No purchases match the selected funding account.
          </div>
        ) : (
        <div className="divide-y divide-gray-100">
          {filteredPurchases
            .sort((a, b) => b.start_date.localeCompare(a.start_date))
            .map((purchase) => (
              <div
                key={`${purchase.username}-${purchase.id}`}
                onClick={() => onPurchaseClick(purchase)}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                {/* User avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
                  style={{ backgroundColor: getUserColor(purchase.username) }}
                >
                  {purchase.username.charAt(0).toUpperCase()}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-gray-900 font-medium truncate">{purchase.name}</p>
                    {purchase.is_complete ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full flex-shrink-0">
                        Complete
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full flex-shrink-0">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    <span className="font-medium text-gray-700">{purchase.username}</span>
                    <span className="text-gray-300 mx-1.5">•</span>
                    <span>{getProjectName(purchase.project_id, purchase.username)}</span>
                    <span className="text-gray-300 mx-1.5">•</span>
                    <span>{formatDate(purchase.start_date)}</span>
                  </p>
                </div>

                {/* Arrow */}
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            ))}
        </div>
        )}
      </div>
      )}
    </div>
  );
}

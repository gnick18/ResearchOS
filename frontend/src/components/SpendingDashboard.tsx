"use client";

import { useMemo, useState } from "react";
import Link from "@/components/FixtureLink";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  PurchaseItem,
  Task,
  Project,
  FundingAccount,
} from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";

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

const UNCATEGORIZED = "Uncategorized";
// emerald-400 — match LabPurchasesPanel's bar palette.
const BAR_COLOR = "#34d399";

interface SpendingDashboardProps {
  // already-merged-view items (decorated with owner). Items only — never
  // mixed with other entity types that happen to share field names.
  purchaseItems: Array<PurchaseItem & { owner: string }>;
  tasks: Task[];
  projects: Project[];
  fundingAccounts: FundingAccount[];
  // global project-filter state from useAppStore. The "All projects" toggle
  // below lets the user override it within the dashboard without leaving.
  // Composite `${owner}:${id}` keys (per-user id collision fix; see
  // useAppStore.selectedProjectIds comment and matchesAnyProjectFilter).
  selectedProjectIds: string[];
}

function timeRangeStartIso(option: TimeRangeOption): string | null {
  if (option === "all" || option === "custom") return null;
  const now = new Date();
  if (option === "30d") now.setDate(now.getDate() - 30);
  else if (option === "90d") now.setDate(now.getDate() - 90);
  else if (option === "12mo") now.setMonth(now.getMonth() - 12);
  return now.toISOString().slice(0, 10);
}

function monthsBetween(startYM: string, endYM: string): string[] {
  // Inclusive [startYM..endYM] as YYYY-MM list, ascending.
  if (startYM > endYM) return [startYM];
  const out: string[] = [];
  const [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  let y = sy;
  let m = sm;
  // Hard cap defends against absurd custom ranges (e.g. 1900 → today).
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function SpendingDashboard({
  purchaseItems,
  tasks,
  projects,
  fundingAccounts,
  selectedProjectIds,
}: SpendingDashboardProps) {
  const [timeRangeOption, setTimeRangeOption] =
    useState<TimeRangeOption>("12mo");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [breakdownLens, setBreakdownLens] = useState<BreakdownLens>("project");
  const [respectGlobalProjectFilter, setRespectGlobalProjectFilter] =
    useState<boolean>(true);
  const [nonPurchaseExpanded, setNonPurchaseExpanded] = useState(false);
  // Row-click affordance for the non-purchase-tasks panel: opens the parent
  // task's detail popup on the Items tab. Items tab is the surface where users reclassify
  // or relocate orphan items (see TaskDetailPopup `initialTab` plumbing
  // c83528aa + Items-tab expansion 4d4da06d).
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Task lookup keyed by composite `${owner}:${id}` — per-user ID spaces
  // mean alex's task 5 and morgan's task 5 are different tasks. Each
  // PurchaseItem carries `owner` from listAllIncludingShared so the route
  // back to the parent task is unambiguous.
  const taskByKey = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(`${t.owner}:${t.id}`, t);
    return map;
  }, [tasks]);

  // Project lookup keyed by `${owner}:${id}` per the page.tsx:168-170
  // composite-key convention. Alex's project 1 != morgan's project 1.
  const projectByKey = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(`${p.owner}:${p.id}`, p);
    return map;
  }, [projects]);

  // Filter items: time range + project filter (respecting the override).
  // Project filter applies via the parent task's `project_id`.
  const filteredItems = useMemo(() => {
    const builtInStart = timeRangeStartIso(timeRangeOption);
    const startIso =
      timeRangeOption === "custom" && customFrom ? customFrom : builtInStart;
    const endIso =
      timeRangeOption === "custom" && customTo ? customTo : null;
    const projectFilterActive =
      respectGlobalProjectFilter && selectedProjectIds.length > 0;
    return purchaseItems.filter((item) => {
      const task = taskByKey.get(`${item.owner}:${item.task_id}`);
      if (!task) return false;
      if (startIso && task.start_date < startIso) return false;
      if (endIso && task.start_date > endIso) return false;
      // Composite-key match (alex:1 vs morgan:1 disambiguated by owner).
      // Pre-fix bare `.includes(task.project_id)` collapsed across owners.
      if (projectFilterActive && !matchesAnyProjectFilter(task, selectedProjectIds))
        return false;
      return true;
    });
  }, [
    purchaseItems,
    taskByKey,
    timeRangeOption,
    customFrom,
    customTo,
    respectGlobalProjectFilter,
    selectedProjectIds,
  ]);

  // Items whose parent task is NOT typed as a purchase — the latent
  // grandTotal bug from PURCHASES_PAGE_PROPOSAL.md §5. Surfaced here so the
  // user can see what's silently contributing to spend totals. Source is
  // already PurchaseItem-only (see safeguard at top of file).
  const nonPurchaseTaskItems = useMemo(() => {
    return filteredItems
      .map((item) => ({
        item,
        task: taskByKey.get(`${item.owner}:${item.task_id}`) ?? null,
      }))
      .filter(({ task }) => task !== null && task.task_type !== "purchase");
  }, [filteredItems, taskByKey]);

  const nonPurchaseTaskTotal = useMemo(
    () =>
      nonPurchaseTaskItems.reduce(
        (sum, entry) => sum + (entry.item.total_price ?? 0),
        0
      ),
    [nonPurchaseTaskItems]
  );

  const totalSpent = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.total_price ?? 0), 0),
    [filteredItems]
  );

  // Funding-account spend computed live from items — FundingAccount.spent on
  // disk is stale (see LabPurchasesPanel.tsx:101-108 for the same workaround).
  const spentByFundingString = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filteredItems) {
      const key = item.funding_string ?? "__uncategorized__";
      map.set(key, (map.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return map;
  }, [filteredItems]);

  const uncategorizedFundingTotal =
    spentByFundingString.get("__uncategorized__") ?? 0;

  // Per-month spend keyed by parent task's start_date.slice(0, 7).
  const spentByMonthMap = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const item of filteredItems) {
      const task = taskByKey.get(`${item.owner}:${item.task_id}`);
      const month = task?.start_date?.slice(0, 7);
      if (!month) continue;
      const existing = map.get(month) ?? { total: 0, count: 0 };
      existing.total += item.total_price ?? 0;
      existing.count += 1;
      map.set(month, existing);
    }
    return map;
  }, [filteredItems, taskByKey]);

  // The window of months to render bars for. Empty months inside the window
  // render zero-bars so the time span reads as the user's selection.
  const monthsInWindow = useMemo(() => {
    const todayMonth = new Date().toISOString().slice(0, 7);
    let startMonth: string | null = null;
    let endMonth: string = todayMonth;
    if (timeRangeOption === "custom") {
      if (customFrom) startMonth = customFrom.slice(0, 7);
      if (customTo) endMonth = customTo.slice(0, 7);
    } else if (timeRangeOption !== "all") {
      const startIso = timeRangeStartIso(timeRangeOption);
      if (startIso) startMonth = startIso.slice(0, 7);
    }
    if (!startMonth) {
      // "all" or custom-without-from: derive from earliest item.
      let min: string | null = null;
      for (const month of spentByMonthMap.keys()) {
        if (!min || month < min) min = month;
      }
      startMonth = min ?? todayMonth;
    }
    if (endMonth < startMonth) endMonth = startMonth;
    return monthsBetween(startMonth, endMonth);
  }, [timeRangeOption, customFrom, customTo, spentByMonthMap]);

  const spendOverTimeData = useMemo(() => {
    return monthsInWindow.map((month) => {
      const entry = spentByMonthMap.get(month);
      return {
        month,
        label: formatMonth(month),
        total: entry?.total ?? 0,
        count: entry?.count ?? 0,
      };
    });
  }, [monthsInWindow, spentByMonthMap]);

  // Active breakdown — grouped by current lens, sorted desc.
  const breakdownData = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; total: number }
    >();
    for (const item of filteredItems) {
      let key: string;
      let label: string;
      if (breakdownLens === "project") {
        const task = taskByKey.get(`${item.owner}:${item.task_id}`);
        if (!task) continue;
        const projectKey = `${task.owner}:${task.project_id}`;
        const project = projectByKey.get(projectKey);
        key = projectKey;
        label = project?.name ?? UNCATEGORIZED;
      } else if (breakdownLens === "vendor") {
        label = item.vendor ?? UNCATEGORIZED;
        key = `vendor:${label}`;
      } else {
        // category lens — safeguard applies: source is already PurchaseItem
        // (see header comment), so this never crosses into LabLink.category.
        label = item.category ?? UNCATEGORIZED;
        key = `category:${label}`;
      }
      const existing = map.get(key) ?? { key, label, total: 0 };
      existing.total += item.total_price ?? 0;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredItems, breakdownLens, taskByKey, projectByKey]);

  const handleExportCsv = () => {
    const headers = [
      "item_id",
      "item_name",
      "vendor",
      "category",
      "funding_string",
      "project_name",
      "task_name",
      "start_date",
      "total_price",
      "owner",
    ];
    const rows = filteredItems.map((item) => {
      const task = taskByKey.get(`${item.owner}:${item.task_id}`) ?? null;
      const project = task
        ? projectByKey.get(`${task.owner}:${task.project_id}`) ?? null
        : null;
      return [
        item.id,
        item.item_name,
        item.vendor ?? "",
        item.category ?? "",
        item.funding_string ?? "",
        project?.name ?? "",
        task?.name ?? "",
        task?.start_date ?? "",
        item.total_price ?? "",
        item.owner,
      ]
        .map(csvEscape)
        .join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const breakdownLensLabel: Record<BreakdownLens, string> = {
    project: "Project",
    vendor: "Vendor",
    category: "Category",
  };

  const isEmpty = purchaseItems.length === 0;
  const exportDisabled = filteredItems.length === 0;

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
        <div className="flex items-center gap-3">
          <Tooltip label="Cross-lab spending view">
            <Link
              href="/lab?tab=purchases"
              className="text-xs text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              View in Lab Mode →
            </Link>
          </Tooltip>
          <button
            onClick={handleExportCsv}
            disabled={exportDisabled}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              exportDisabled
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            }`}
            title={
              exportDisabled
                ? "No items in current window"
                : "Download CSV of items in current scope"
            }
          >
            Export CSV
          </button>
        </div>
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
        {timeRangeOption === "custom" && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              <span>From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
              />
            </label>
          </div>
        )}
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

      {/* FUNDING ACCOUNTS — meaningful even at zero state. */}
      <section className="mb-8">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Funding accounts
        </h4>
        {fundingAccounts.length === 0 && uncategorizedFundingTotal === 0 ? (
          <p className="text-xs text-gray-400 italic">
            No funding accounts yet — add one from the manager above.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fundingAccounts.map((acc) => {
              const spent = spentByFundingString.get(acc.name) ?? 0;
              const pct =
                acc.total_budget > 0
                  ? Math.min(100, (spent / acc.total_budget) * 100)
                  : 0;
              const overBudget =
                acc.total_budget > 0 && spent > acc.total_budget;
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
                      className={`h-full rounded ${
                        overBudget ? "bg-red-400" : "bg-emerald-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {pct.toFixed(0)}%
                    {overBudget && (
                      <span className="ml-1 text-red-500">over budget</span>
                    )}
                  </p>
                </div>
              );
            })}
            {uncategorizedFundingTotal > 0 && (
              <div className="p-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg">
                <p className="text-sm font-semibold text-gray-600 truncate">
                  Uncategorized
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  ${uncategorizedFundingTotal.toFixed(2)} · no funding string
                </p>
                <p className="text-[10px] text-gray-400 mt-2 italic">
                  Items without a funding account assigned.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {isEmpty ? (
        <section className="mb-8">
          <div className="p-8 bg-white border border-dashed border-gray-300 rounded-lg text-center">
            <p className="text-sm text-gray-500">
              Add your first purchase to see spend breakdowns here.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* SPEND OVER TIME */}
          <section className="mb-8">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
              Spend over time
            </h4>
            {spendOverTimeData.length === 0 ? (
              <div className="p-6 bg-white border border-dashed border-gray-300 rounded-lg text-center">
                <p className="text-xs text-gray-400">
                  No items match the current time range.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={spendOverTimeData}
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#f3f4f6"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e5e7eb" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                      }
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e5e7eb" }}
                      width={50}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "#f9fafb" }}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #e5e7eb",
                      }}
                      formatter={(value, _name, entry) => {
                        const num =
                          typeof value === "number" ? value : Number(value);
                        const count = (entry?.payload as { count?: number })
                          ?.count;
                        return [
                          `$${num.toFixed(2)} (${count ?? 0} item${count === 1 ? "" : "s"})`,
                          "Spend",
                        ];
                      }}
                      labelFormatter={(label) => String(label)}
                    />
                    <Bar dataKey="total" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
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
            {breakdownData.length === 0 ? (
              <div className="p-6 bg-white border border-dashed border-gray-300 rounded-lg text-center">
                <p className="text-xs text-gray-400">
                  No items match the current time range.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(160, breakdownData.length * 36 + 24)}
                >
                  <BarChart
                    data={breakdownData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#f3f4f6"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                      }
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e5e7eb" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fontSize: 12, fill: "#374151" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e5e7eb" }}
                      width={140}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "#f9fafb" }}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #e5e7eb",
                      }}
                      formatter={(value) => {
                        const num =
                          typeof value === "number" ? value : Number(value);
                        return [`$${num.toFixed(2)}`, "Total"];
                      }}
                    />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                      {breakdownData.map((row) => (
                        <Cell
                          key={row.key}
                          fill={
                            row.label === UNCATEGORIZED
                              ? "#9ca3af"
                              : BAR_COLOR
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}

      {/* Items on non-purchase tasks — surfaces the latent grandTotal bug */}
      <section className="mb-2">
        <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
          <button
            onClick={() =>
              nonPurchaseTaskItems.length > 0 &&
              setNonPurchaseExpanded((v) => !v)
            }
            disabled={nonPurchaseTaskItems.length === 0}
            className={`w-full text-left flex items-center justify-between gap-3 ${
              nonPurchaseTaskItems.length > 0
                ? "cursor-pointer"
                : "cursor-default"
            }`}
          >
            <p className="text-xs text-amber-800">
              <span className="font-semibold">
                Items on non-purchase tasks:
              </span>{" "}
              {nonPurchaseTaskItems.length} item
              {nonPurchaseTaskItems.length === 1 ? "" : "s"}, $
              {nonPurchaseTaskTotal.toFixed(2)}
            </p>
            {nonPurchaseTaskItems.length > 0 && (
              <span className="text-amber-700 text-xs">
                {nonPurchaseExpanded ? "▲ hide" : "▼ show"}
              </span>
            )}
          </button>
          {nonPurchaseTaskItems.length > 0 && !nonPurchaseExpanded && (
            <p className="text-[10px] text-amber-700 mt-1">
              These items live on tasks not typed as &ldquo;purchase&rdquo; — they still
              count toward spend totals. Click a row to open the parent task
              and reclassify or move them.
            </p>
          )}
          {nonPurchaseExpanded && nonPurchaseTaskItems.length > 0 && (
            <div className="mt-3 border-t border-amber-200 pt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-amber-700">
                    <th className="pb-1.5 pr-3 font-semibold">Item</th>
                    <th className="pb-1.5 pr-3 font-semibold">Host task</th>
                    <th className="pb-1.5 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {nonPurchaseTaskItems.map(({ item, task }) => {
                    const clickable = task !== null;
                    return (
                      <tr
                        key={`${item.owner}:${item.id}`}
                        onClick={
                          clickable ? () => setSelectedTask(task) : undefined
                        }
                        className={`border-t border-amber-100 transition-colors ${
                          clickable
                            ? "cursor-pointer hover:bg-amber-100/50"
                            : ""
                        }`}
                      >
                        <td className="py-1.5 pr-3 text-gray-800">
                          {item.item_name}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-600">
                          {task?.name ?? "(missing task)"}
                          {task && (
                            <span className="ml-1 text-[10px] text-gray-400">
                              · {task.task_type}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-gray-800 tabular-nums">
                          ${(item.total_price ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-amber-700 mt-2 italic">
                Tip: click a row to open the host task and either reclassify
                it as a purchase or move the items to a proper purchase
                order.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Task Detail Popup — opens to Items tab so the user lands on the
          orphan-items editor (the amber warning + reclassify/move controls
          live there, per the Items-tab expansion at 4d4da06d). */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projectByKey.get(
            `${selectedTask.owner}:${selectedTask.project_id}`
          )}
          initialTab="purchases"
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

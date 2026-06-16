"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import {
  computeFundingSpendByAccount,
  computeUncategorizedSpend,
} from "@/lib/funding/spend";
import {
  MISC_CATEGORY_LABEL,
  isMiscProject,
} from "@/lib/purchases/misc-project";

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
// emerald-400 — matches the funding-rollup bar palette in MetricsWidget.
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

  // Funding-account spend computed live from items (funding-rework): the stored
  // `FundingAccount.spent` field is gone, so the shared helper rolls spend up by
  // the authoritative `funding_account_id` FK — one source of truth across the
  // dashboard, the funding nav, and the admin summary.
  const spendByAccountId = useMemo(
    () => computeFundingSpendByAccount(fundingAccounts, filteredItems),
    [fundingAccounts, filteredItems],
  );

  // Spend not attributed to any known account (null FK, or an FK whose account
  // was deleted) — the "Uncategorized" bucket.
  const uncategorizedFundingTotal = useMemo(
    () => computeUncategorizedSpend(fundingAccounts, filteredItems),
    [fundingAccounts, filteredItems],
  );

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
        // Friendly label override: the hidden `_misc_purchases` project
        // surfaces as "Miscellaneous" on /purchases, so the breakdown
        // chart matches. Real projects render their on-disk name.
        if (project && isMiscProject(project)) {
          label = MISC_CATEGORY_LABEL;
        } else {
          label = project?.name ?? UNCATEGORIZED;
        }
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
      // Friendly export label for the misc bucket — the raw
      // `_misc_purchases` reserved name should never leak into a
      // user-visible CSV export.
      const projectName =
        project && isMiscProject(project)
          ? MISC_CATEGORY_LABEL
          : project?.name ?? "";
      return [
        item.id,
        item.item_name,
        item.vendor ?? "",
        item.category ?? "",
        item.funding_string ?? "",
        projectName,
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

  // BeakerSearch Purchases source (2026-06-07): the palette's "Export current
  // spending" + "Open the spending dashboard" commands drive these in-component
  // actions through a window-event bridge, the same channel the page already
  // uses for the tour's demo overlay. The dashboard owns the live range /
  // breakdown state, so lifting it would be a large refactor; subscribing to two
  // events keeps the change tiny and the export byte-identical. The export
  // handler is held in a ref so the listener always runs the latest closure
  // (current filteredItems) without re-subscribing on every render.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef(handleExportCsv);
  useEffect(() => {
    exportRef.current = handleExportCsv;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onExport = () => exportRef.current();
    const onFocus = () =>
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.addEventListener("purchases:export-csv", onExport);
    window.addEventListener("purchases:focus-dashboard", onFocus);
    return () => {
      window.removeEventListener("purchases:export-csv", onExport);
      window.removeEventListener("purchases:focus-dashboard", onFocus);
    };
  }, []);

  const isEmpty = purchaseItems.length === 0;
  const exportDisabled = filteredItems.length === 0;

  return (
    <div ref={rootRef} className="mt-12 border-t-2 border-border pt-8" data-testid="purchases-spending-dashboard">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-heading font-semibold text-foreground">
            Spending dashboard
          </h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            ${totalSpent.toFixed(2)} across {filteredItems.length} item
            {filteredItems.length === 1 ? "" : "s"} in window
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            disabled={exportDisabled}
            className={`px-3 py-1.5 text-meta rounded-lg transition-colors ${
              exportDisabled
                ? "bg-surface-sunken text-foreground-muted cursor-not-allowed"
                : "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200"
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
      <div className="flex flex-wrap items-center gap-4 mb-6 p-3 bg-surface-sunken rounded-lg">
        <label className="flex items-center gap-2 text-meta text-foreground-muted">
          <span>Time range:</span>
          <select
            value={timeRangeOption}
            onChange={(e) =>
              setTimeRangeOption(e.target.value as TimeRangeOption)
            }
            className="px-2 py-1 border border-border rounded text-meta bg-surface-raised"
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
          <div className="flex items-center gap-2 text-meta text-foreground-muted">
            <label className="flex items-center gap-1">
              <span>From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 border border-border rounded text-meta bg-surface-raised"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 border border-border rounded text-meta bg-surface-raised"
              />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 text-meta text-foreground-muted">
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
      <section className="mb-8" data-testid="purchases-funding-rollup">
        <h4 className="text-meta font-bold text-foreground-muted uppercase tracking-wider mb-3">
          Funding accounts
        </h4>
        {fundingAccounts.length === 0 && uncategorizedFundingTotal === 0 ? (
          <p className="text-meta text-foreground-muted italic">
            No funding accounts yet — add one from the manager above.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fundingAccounts.map((acc) => {
              const spent = spendByAccountId.get(acc.id) ?? 0;
              const pct =
                acc.total_budget > 0
                  ? Math.min(100, (spent / acc.total_budget) * 100)
                  : 0;
              const overBudget =
                acc.total_budget > 0 && spent > acc.total_budget;
              return (
                <div
                  key={acc.id}
                  className="p-3 bg-surface-raised border border-border rounded-lg"
                >
                  <p className="text-body font-semibold text-foreground truncate">
                    {acc.name}
                  </p>
                  <p className="text-meta text-foreground-muted mt-0.5">
                    ${spent.toFixed(2)} / ${acc.total_budget.toFixed(2)}
                  </p>
                  <div className="mt-2 h-2 bg-surface-sunken rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${
                        overBudget ? "bg-red-400" : "bg-emerald-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-meta text-foreground-muted mt-1">
                    {pct.toFixed(0)}%
                    {overBudget && (
                      <span className="ml-1 text-red-500">over budget</span>
                    )}
                  </p>
                </div>
              );
            })}
            {uncategorizedFundingTotal > 0 && (
              <div className="p-3 bg-surface-sunken border border-dashed border-border rounded-lg">
                <p className="text-body font-semibold text-foreground-muted truncate">
                  Uncategorized
                </p>
                <p className="text-meta text-foreground-muted mt-0.5">
                  ${uncategorizedFundingTotal.toFixed(2)} · no funding account
                </p>
                <p className="text-meta text-foreground-muted mt-2 italic">
                  Items without a funding account assigned.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {isEmpty ? (
        <section className="mb-8">
          <div className="p-8 bg-surface-raised border border-dashed border-border rounded-lg text-center">
            <p className="text-body text-foreground-muted">
              Add a purchase to see spend breakdowns here.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* SPEND OVER TIME */}
          <section className="mb-8">
            <h4 className="text-meta font-bold text-foreground-muted uppercase tracking-wider mb-3">
              Spend over time
            </h4>
            {spendOverTimeData.length === 0 ? (
              <div className="p-6 bg-surface-raised border border-dashed border-border rounded-lg text-center">
                <p className="text-meta text-foreground-muted">
                  No items match the current time range.
                </p>
              </div>
            ) : (
              <div className="bg-surface-raised border border-border rounded-lg p-3">
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
              <h4 className="text-meta font-bold text-foreground-muted uppercase tracking-wider">
                Breakdown by {breakdownLensLabel[breakdownLens]}
              </h4>
              <div
                className="inline-flex bg-surface-sunken rounded-lg p-0.5 text-meta ros-seg-track border border-border"
                data-tour-target="spending-breakdown-lens-toggle"
              >
                {(Object.keys(breakdownLensLabel) as BreakdownLens[]).map(
                  (lens) => (
                    <button
                      key={lens}
                      onClick={() => setBreakdownLens(lens)}
                      data-tour-target={`spending-breakdown-lens-${lens}`}
                      className={`px-3 py-1 rounded transition-colors ${
                        breakdownLens === lens
                          ? "bg-surface-raised text-foreground ros-seg-active"
                          : "text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      {breakdownLensLabel[lens]}
                    </button>
                  )
                )}
              </div>
            </div>
            {breakdownData.length === 0 ? (
              <div className="p-6 bg-surface-raised border border-dashed border-border rounded-lg text-center">
                <p className="text-meta text-foreground-muted">
                  No items match the current time range.
                </p>
              </div>
            ) : (
              <div className="bg-surface-raised border border-border rounded-lg p-3">
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
        <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
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
            <p className="text-meta text-amber-800 dark:text-amber-200">
              <span className="font-semibold">
                Items on non-purchase tasks:
              </span>{" "}
              {nonPurchaseTaskItems.length} item
              {nonPurchaseTaskItems.length === 1 ? "" : "s"}, $
              {nonPurchaseTaskTotal.toFixed(2)}
            </p>
            {nonPurchaseTaskItems.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300 text-meta">
                {nonPurchaseExpanded ? "▲ hide" : "▼ show"}
              </span>
            )}
          </button>
          {nonPurchaseTaskItems.length > 0 && !nonPurchaseExpanded && (
            <p className="text-meta text-amber-700 dark:text-amber-300 mt-1">
              These items live on tasks not typed as &ldquo;purchase&rdquo; — they still
              count toward spend totals. Click a row to open the parent task
              and reclassify or move them.
            </p>
          )}
          {nonPurchaseExpanded && nonPurchaseTaskItems.length > 0 && (
            <div className="mt-3 border-t border-amber-200 dark:border-amber-500/30 pt-3">
              <table className="w-full text-meta">
                <thead>
                  <tr className="text-left text-meta uppercase tracking-wider text-amber-700 dark:text-amber-300">
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
                            ? "cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-500/20"
                            : ""
                        }`}
                      >
                        <td className="py-1.5 pr-3 text-foreground">
                          {item.item_name}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground-muted">
                          {task?.name ?? "(missing task)"}
                          {task && (
                            <span className="ml-1 text-meta text-foreground-muted">
                              · {task.task_type}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-foreground tabular-nums">
                          ${(item.total_price ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-meta text-amber-700 dark:text-amber-300 mt-2 italic">
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

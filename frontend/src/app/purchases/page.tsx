"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, purchasesApi, labApi, fetchAllProjectsIncludingShared, fetchAllTasksIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useIsLabMode } from "@/hooks/useIsLabMode";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import NewPurchaseModal from "@/components/NewPurchaseModal";
import PurchaseEditor from "@/components/PurchaseEditor";
import SpendingDashboard from "@/components/SpendingDashboard";
import DemoPurchasesViewer from "@/components/DemoPurchasesViewer";
import FundingAccountsManager from "@/components/FundingAccountsManager";
import { buildPurchaseAuditCsv } from "@/lib/purchases/audit-export";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";
import { useRouter, useSearchParams } from "next/navigation";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  MISC_CATEGORY_LABEL,
  isMiscProject,
} from "@/lib/purchases/misc-project";
import {
  normalizeOrderStatus,
  PURCHASE_ORDER_STATUS_LABEL,
  taskKey,
  type PurchaseOrderStatus,
  type Task,
  type PurchaseItem,
} from "@/lib/types";
import { usePurchasesBeakerSource } from "./usePurchasesBeakerSource";

/**
 * Segmented filter on /purchases: gates which purchase tasks render.
 *   - "all": every purchase task (project + misc)
 *   - "project": purchase tasks attached to real projects (misc bucket
 *     hidden)
 *   - "misc": purchase tasks attached to the hidden `_misc_purchases`
 *     project (everything else hidden)
 *   - "awaiting_approval": purchase tasks that contain at least one
 *     line item with `approved !== true`. Per-role label, see the
 *     `awaitingApprovalLabel` helper below. (Purchases UX fix, 2026-05-24.)
 *
 * The default landing chip is "all" so newcomers see everything; users
 * can switch to "misc" to triage their conference-travel pile without
 * the rest of the list in the way.
 */
type PurchaseCategoryFilter = "all" | "project" | "misc" | "awaiting_approval";

/**
 * Per-item ordering-status filter (purchases-ordered-stage, 2026-05-29).
 * Gates the purchase-task list to orders that contain at least one line item
 * in the selected stage, so the wiki / AI-helper "Needs ordering / Ordered /
 * Received" framing finally maps onto a real field. "any" shows everything
 * (the default). Applied on top of the category filter.
 */
type PurchaseOrderStatusFilter = "any" | PurchaseOrderStatus;

export default function PurchasesPage() {
  // Supplies v2 chunk 7: when the unified Supplies page is live
  // (INVENTORY_ENABLED), /purchases is retired and redirects into /supplies,
  // mapping its known deep-link param so the loop-strip / search intent
  // survives. When the flag is OFF (prod default) this branch is never taken,
  // so the standalone purchases page below renders exactly as before and prod
  // is unchanged. INVENTORY_ENABLED is a module constant, so the same branch is
  // taken on every render (no Rules-of-Hooks issue).
  if (INVENTORY_ENABLED) {
    return <PurchasesRedirect />;
  }
  return <PurchasesPageContent />;
}

/** Redirect /purchases into the unified /supplies page (chunk 7). Maps the
 *  legacy "needs ordering" deep-link (?stage=needs_ordering) onto the unified
 *  on-order filter; every other param lands on the default list. */
function PurchasesRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stage = searchParams.get("stage");
  useEffect(() => {
    const target =
      stage === "needs_ordering" ? "/supplies?filter=onorder" : "/supplies";
    router.replace(target);
  }, [router, stage]);
  return null;
}

function PurchasesPageContent() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);
  const [showFundingManager, setShowFundingManager] = useState(false);
  // Quick "+ New Purchase" modal — drives the Onboarding v4 §6.14 demo
  // and gives /purchases a self-contained "create a one-off purchase"
  // surface (parent task + first line item in one form). The deeper
  // PurchaseEditor inline-row affordance remains for adding more items
  // to an existing purchase order.
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  // Onboarding v4 §6.14 Purchases redesign 2026-05-22 (Purchases
  // manager): the tour's `purchases-demo-warp-prompt` step dispatches
  // `tour:demo-purchases-viewer-open` to mount Alex's fixture data as a
  // read-only overlay on top of this page. No route change — the user
  // never leaves /purchases, so the tour controller's step state stays
  // intact. The `purchases-back-to-real` step dispatches the matching
  // close event to dismiss the overlay before advancing.
  const [showDemoViewer, setShowDemoViewer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openHandler = () => setShowDemoViewer(true);
    const closeHandler = () => setShowDemoViewer(false);
    window.addEventListener("tour:demo-purchases-viewer-open", openHandler);
    window.addEventListener("tour:demo-purchases-viewer-close", closeHandler);
    return () => {
      window.removeEventListener("tour:demo-purchases-viewer-open", openHandler);
      window.removeEventListener("tour:demo-purchases-viewer-close", closeHandler);
    };
  }, []);
  const [categoryFilter, setCategoryFilter] = useState<PurchaseCategoryFilter>("all");
  // Per-item ordering-status filter (purchases-ordered-stage, 2026-05-29).
  const [orderStatusFilter, setOrderStatusFilter] =
    useState<PurchaseOrderStatusFilter>("any");
  // Supplies hub deep-link: a `?stage=needs_ordering|ordered|received` param
  // (set by the clickable "to order" loop-strip count in SuppliesTabs) seeds the
  // ordering-status filter on load. After seeding, the chips own the state.
  const searchParams = useSearchParams();
  const stageParam = searchParams.get("stage");
  useEffect(() => {
    if (
      stageParam === "needs_ordering" ||
      stageParam === "ordered" ||
      stageParam === "received"
    ) {
      setOrderStatusFilter(stageParam);
    }
  }, [stageParam]);
  const queryClient = useQueryClient();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const router = useRouter();

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  // Lab head vs. member gating (Purchases UX fix, 2026-05-24):
  //  - Bug 2: the awaiting-approval chip label changes per role.
  //    Members see "Awaiting approval" (they're waiting on the lab
  //    head). Lab heads see "Pending approval" (they're the queue
  //    owner).
  //  - Bug 3: lab heads see a banner pointing them at the lab-wide
  //    approval queue when their personal /purchases is empty but the
  //    lab queue is not. Mira-the-new-lab-head was concluding "nothing
  //    pending" because /purchases is scoped to her own submissions.
  const accountType = useAccountType(currentUser || null);
  const isLabHead = accountType === "lab_head";
  const awaitingApprovalLabel = isLabHead
    ? "Pending approval"
    : "Awaiting approval";
  // Approval is a lab concept (a member submits, a lab head approves). In a
  // solo folder there is no approver, so hide the awaiting-approval filter.
  const showApprovalFilter = useIsLabMode() === true;
  // NOTE: /purchases is the PI's PERSONAL purchases page; the lab-wide pending
  // queue lives on the Approvals tab + the Supplies "Awaiting approval" lens, not
  // here. (An earlier RS-4 default that landed this page on "Pending approval"
  // was reverted: it showed the PI's empty personal queue + a banner, not the
  // lab-wide data RS-4 intends.)

  // /purchases is the ONLY surface that needs the hidden
  // `_misc_purchases` project to render — pass `includeHidden: true` so
  // the misc bucket can be grouped + filtered on screen. Every other
  // caller of `fetchAllProjectsIncludingShared` uses the default
  // (hidden filtered out) so the misc project never leaks into Home,
  // Workbench, Gantt, search, the project picker, etc.
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser, { includeHidden: true }],
    queryFn: () => fetchAllProjectsIncludingShared({ includeHidden: true }),
  });

  // Use the canonical merged-view loader instead of
  // `projects.map(p => tasksApi.listByProject(...))`. The latter reads raw
  // on-disk task files for each owner — it does NOT decorate shared tasks
  // with `is_shared_with_me: true`, so `taskKey()` collapses to `self:<id>`
  // for every task in this path and shared+own tasks with the same numeric
  // id silently collide downstream. See `/experiments` fix at `caa22513`.
  // `fetchAllTasksIncludingShared` is the canonical merged-view loader (used
  // by `/`, `/gantt`, `/settings`, `/experiments`) — decorates with
  // `is_shared_with_me: true`, surfaces Option-C hosted tasks, dedups via
  // composite key, and has a dev-mode duplicate-key guardrail.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: projects.length > 0,
  });

  // Use the merged-view loader mirroring `fetchAllTasksIncludingShared`.
  // `purchasesApi.listAll()` is current-user-only — shared purchase tasks
  // would render rows but with 0 items and $0 totals (the
  // multi-user-data-isolation gap flagged in AGENTS.md §6). The new loader
  // also reads each shared-task owner's `purchase_items/` directory and
  // decorates every item with `owner` so the composite-key map below routes
  // each item to the correct task without colliding with our own.
  const { data: allPurchases = [] } = useQuery({
    queryKey: ["purchases-all", currentUser],
    queryFn: () => purchasesApi.listAllIncludingShared(currentUser),
    enabled: !!currentUser,
  });

  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts", currentUser],
    queryFn: purchasesApi.listFundingAccounts,
  });

  // Purchases UX fix Bug 3 (2026-05-24): lab-wide purchase items, so a
  // lab head landing on /purchases with 0 personal purchases still
  // sees the pending-approval count for the whole lab. Shares the
  // canonical `["lab", "purchase-items"]` key used by
  // LabPurchasesPanel, MetricsWidget, and LabUserDetailPanel — React
  // Query dedupes the fetch when those surfaces are already mounted.
  // Gated to lab-head accounts so members don't pay for the discovery
  // walk on every /purchases mount.
  const { data: labPurchaseItems = [] } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    enabled: isLabHead,
  });
  const labPendingApprovalCount = useMemo(() => {
    if (!isLabHead) return 0;
    let n = 0;
    for (const item of labPurchaseItems) {
      if (!item.approved) n += 1;
    }
    return n;
  }, [labPurchaseItems, isLabHead]);

  // Filter to purchase tasks only
  const purchaseTasks = useMemo(
    () => allTasks.filter((t) => t.task_type === "purchase"),
    [allTasks]
  );

  // Apply the category filter chip. Resolves each purchase task to its
  // project (composite-key match on `(id, owner)` because per-user id
  // spaces can collide) and checks the project's `is_hidden` +
  // `_misc_purchases` name pair via `isMiscProject`. Tasks whose project
  // can't be resolved (e.g. orphaned project_id=0) are treated as
  // non-misc — they show under "All" and "Project purchases", never
  // under "Miscellaneous".
  //
  // Awaiting-approval filter (Purchases UX fix Bug 2, 2026-05-24): a
  // task is "awaiting approval" if it owns at least one line item with
  // `approved !== true`. We resolve items per-task via
  // `purchasesByTask` (built further down — declared here lazily so we
  // can reuse the same composite-key map).
  const categorizedTasks = useMemo(() => {
    return purchaseTasks.filter((task) => {
      // Order-status filter (purchases-ordered-stage, 2026-05-29): keep the
      // order if any of its line items is in the selected stage. Applied
      // first so it composes with whichever category chip is active.
      if (orderStatusFilter !== "any") {
        const items = allPurchases.filter(
          (p) => p.owner === task.owner && p.task_id === task.id,
        );
        const hasStatus = items.some(
          (p) => normalizeOrderStatus(p.order_status) === orderStatusFilter,
        );
        if (!hasStatus) return false;
      }
      if (categoryFilter === "awaiting_approval") {
        const items = allPurchases.filter(
          (p) => p.owner === task.owner && p.task_id === task.id,
        );
        return items.some((p) => !p.approved);
      }
      const project = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      const taskIsMisc = !!project && isMiscProject(project);
      if (categoryFilter === "misc") return taskIsMisc;
      if (categoryFilter === "project") return !taskIsMisc;
      return true;
    });
  }, [purchaseTasks, projects, categoryFilter, orderStatusFilter, allPurchases]);

  // Counts for the segmented control labels. Computed off the full
  // purchase-task list so the chip badges stay stable as the user
  // switches between filters.
  const { miscTaskCount, projectTaskCount, awaitingApprovalCount } = useMemo(() => {
    let misc = 0;
    let proj = 0;
    let awaiting = 0;
    for (const task of purchaseTasks) {
      const project = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      if (project && isMiscProject(project)) misc += 1;
      else proj += 1;
      const items = allPurchases.filter(
        (p) => p.owner === task.owner && p.task_id === task.id,
      );
      if (items.some((p) => !p.approved)) awaiting += 1;
    }
    return {
      miscTaskCount: misc,
      projectTaskCount: proj,
      awaitingApprovalCount: awaiting,
    };
  }, [purchaseTasks, projects, allPurchases]);

  // Per-ordering-status task counts (purchases-ordered-stage, 2026-05-29).
  // A task contributes to a stage's count when it has at least one line item
  // in that stage. Computed off the full purchase-task list so the chip
  // badges stay stable regardless of the active category / status filter.
  const orderStatusCounts = useMemo(() => {
    const counts: Record<PurchaseOrderStatus, number> = {
      needs_ordering: 0,
      ordered: 0,
      received: 0,
    };
    for (const task of purchaseTasks) {
      const items = allPurchases.filter(
        (p) => p.owner === task.owner && p.task_id === task.id,
      );
      const seen = new Set<PurchaseOrderStatus>();
      for (const p of items) seen.add(normalizeOrderStatus(p.order_status));
      for (const s of seen) counts[s] += 1;
    }
    return counts;
  }, [purchaseTasks, allPurchases]);

  // Unified scroll — pure reverse chronology, no active/earlier split.
  // The active-before-complete partition was Chip-2's temporary mirror of
  // the Workbench arc; purchases don't have an in-flight phase, so a single
  // start_date-desc list reads more naturally ("did we already buy that
  // primer?"). Completion state remains visible per-row via the green dot
  // and `· Complete` suffix in renderPurchaseTaskCard below.
  const sortedTasks = useMemo(
    () =>
      [...categorizedTasks].sort((a, b) =>
        b.start_date.localeCompare(a.start_date)
      ),
    [categorizedTasks]
  );

  // Group purchases by task. Items now carry `owner` (decorated by
  // `listAllIncludingShared`), so the key is the same composite
  // `${owner}:${task_id}` that the sweep fix at `8de2c24d` uses on the task
  // side. Shared-task purchases land in their correct buckets automatically.
  const purchasesByTask = useMemo(() => {
    const map: Record<string, PurchaseItem[]> = {};
    for (const p of allPurchases) {
      const key = `${p.owner}:${p.task_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return map;
  }, [allPurchases]);

  // Grand total
  const grandTotal = useMemo(
    () => allPurchases.reduce((sum, p) => sum + (p.total_price ?? 0), 0),
    [allPurchases]
  );

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm("Are you sure you want to delete this purchase order and all its items?")) {
      return;
    }
    setDeletingTaskId(taskId);
    try {
      await tasksApi.delete(taskId);
      setSelectedTask(null);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
    } catch {
      alert("Failed to delete purchase order");
    } finally {
      setDeletingTaskId(null);
    }
  };

  // Register the Purchases BeakerSearch source (step 3) while the page is
  // mounted. The pure builder + the thin wiring live in the co-located
  // purchases-beaker-source.ts / usePurchasesBeakerSource.ts; this hands it the
  // page's selected order + the modal / filter setters + the delete handler.
  // The heavier domain data (orders, items, funding, role, edit-gate) the hook
  // reads itself from the same React Query caches this page already holds.
  usePurchasesBeakerSource({
    selectedTask,
    setSelectedTask,
    setShowNewPurchase,
    setShowFundingManager,
    categoryFilter,
    orderStatusFilter,
    setCategoryFilter,
    setOrderStatusFilter,
    handleDeleteTask,
    router,
  });

  // By-grant audit export (PURCHASE_DOCS_AND_ROUTING.md phase 1b). Builds a CSV
  // of every purchase grouped by grant, with its attached document references,
  // and triggers a download. The PDF bytes are retained separately; this is the
  // index an auditor needs.
  const handleExportAudit = () => {
    const csv = buildPurchaseAuditCsv(allPurchases, fundingAccounts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "researchos-purchases-audit.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 pt-3 pb-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-title font-semibold text-foreground">Purchases</h2>
            <span className="text-meta text-foreground-muted">
              {purchaseTasks.length} purchase order
              {purchaseTasks.length !== 1 ? "s" : ""} · ${grandTotal.toFixed(2)}{" "}
              total
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewPurchase(true)}
              className="ros-btn-raise px-3 py-1.5 text-body bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              data-tour-target="purchases-new-button"
            >
              + New Purchase
            </button>
            <button
              onClick={() => setShowFundingManager(true)}
              className="px-3 py-1.5 text-body bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 transition-colors"
            >
              Manage Funding Accounts
            </button>
            <button
              onClick={handleExportAudit}
              disabled={allPurchases.length === 0}
              title="Download a CSV of all purchases grouped by grant, with their attached documents, for a grant audit"
              className="ros-btn-neutral px-3 py-1.5 text-body disabled:opacity-50"
            >
              Export audit CSV
            </button>
          </div>
        </div>

        <NewPurchaseModal
          open={showNewPurchase}
          onClose={() => setShowNewPurchase(false)}
        />

        {/* Onboarding v4 §6.14 Purchases redesign 2026-05-22: read-only
            overlay rendering Alex's demo data. Closing the viewer just
            dismisses the overlay — the tour's `purchases-back-to-real`
            step is what dispatches the close event AND advances the
            tour forward. */}
        <DemoPurchasesViewer
          open={showDemoViewer}
          onClose={() => setShowDemoViewer(false)}
        />

        {/* Purchases UX fix Bug 3 (purchases UX fix manager, 2026-05-24):
            lab-head approval-queue banner. A fresh PI landing on
            /purchases sees their PERSONAL submissions (0 if they haven't
            ordered anything yet). The lab-wide approval queue lives in
            the LabPurchases popup widget on /lab-overview, so the lab
            head can reasonably conclude "nothing pending" and miss the
            queue. The banner surfaces the count and routes them to
            /lab-overview where the LabPurchases tile is one click away.
            Gated to lab_head accounts only (members don't have a queue
            to approve) and to a non-zero count so it disappears once the
            queue is drained. */}
        {isLabHead && labPendingApprovalCount > 0 && (
          <div
            className="mb-4 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10"
            role="status"
            data-testid="purchases-lab-head-pending-banner"
          >
            <div className="flex items-start gap-3 min-w-0">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="min-w-0">
                <p className="text-body font-semibold text-amber-900">
                  {labPendingApprovalCount} item
                  {labPendingApprovalCount === 1 ? "" : "s"} across the lab
                  await{labPendingApprovalCount === 1 ? "s" : ""} your approval
                </p>
                <p className="text-meta text-amber-800 dark:text-amber-200 mt-0.5">
                  This page shows your personal purchases. The lab-wide
                  approval queue lives on Lab Overview.
                </p>
              </div>
            </div>
            {/* R2 Literal Reader fix (2026-05-25): the CTA used to read
                "Open lab purchases" but the click handler routes to
                /lab-overview (not directly to the LabPurchases queue).
                Honest copy: label matches destination. Users land on Lab
                Overview where the LabPurchases tile is one click away,
                as described in the supporting paragraph above. */}
            <button
              onClick={() => router.push("/lab-overview")}
              className="ros-btn-raise flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-meta font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              data-testid="purchases-lab-head-pending-banner-cta"
            >
              Open Lab Overview
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        )}

        {/* Category filter chips. Single source of truth for the
            project-vs-miscellaneous segmentation: drives `categorizedTasks`
            above and hides the segmented control's middle pill if there
            are no misc purchases yet (avoids a confusing empty bucket
            on first-run / freshly-onboarded accounts). The "All" chip
            stays visible at all times so a user can always reset. */}
        <div
          className="flex items-center gap-2 mb-4"
          role="tablist"
          aria-label="Filter purchases by category"
        >
          {([
            { key: "all", label: "All", count: purchaseTasks.length },
            {
              key: "project",
              label: "Project purchases",
              count: projectTaskCount,
            },
            {
              key: "misc",
              label: MISC_CATEGORY_LABEL,
              count: miscTaskCount,
            },
            // Purchases UX fix Bug 2 (2026-05-24): per-role label.
            // Members see "Awaiting approval" because they're the
            // submitter waiting on someone else; lab heads see
            // "Pending approval" because they're the queue owner.
            {
              key: "awaiting_approval",
              label: awaitingApprovalLabel,
              count: awaitingApprovalCount,
            },
          ] as const)
            .filter(
              (chip) => chip.key !== "awaiting_approval" || showApprovalFilter,
            )
            .map((chip) => {
            const isActive = categoryFilter === chip.key;
            return (
              <button
                key={chip.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setCategoryFilter(chip.key)}
                data-tour-target={`purchases-filter-${chip.key}`}
                className={`px-3 py-1 text-meta rounded-full transition-colors ${
                  isActive
                    ? "bg-amber-600 text-white"
                    : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                }`}
              >
                {chip.label}
                <span
                  className={`ml-2 ${
                    isActive ? "text-amber-100" : "text-foreground-muted"
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Order-status filter chips (purchases-ordered-stage, 2026-05-29).
            The wiki / AI-helper "Needs ordering / Ordered / Received"
            vocabulary now maps onto the real per-item `order_status` field.
            Filters the list to orders containing at least one line item in
            the chosen stage; composes with the category chips above. */}
        <div
          className="flex items-center gap-2 mb-4"
          role="tablist"
          aria-label="Filter purchases by ordering status"
        >
          <span className="text-meta text-foreground-muted mr-1">Ordering:</span>
          {([
            { key: "any", label: "Any stage", count: purchaseTasks.length },
            {
              key: "needs_ordering",
              label: PURCHASE_ORDER_STATUS_LABEL.needs_ordering,
              count: orderStatusCounts.needs_ordering,
            },
            {
              key: "ordered",
              label: PURCHASE_ORDER_STATUS_LABEL.ordered,
              count: orderStatusCounts.ordered,
            },
            {
              key: "received",
              label: PURCHASE_ORDER_STATUS_LABEL.received,
              count: orderStatusCounts.received,
            },
          ] as const).map((chip) => {
            const isActive = orderStatusFilter === chip.key;
            return (
              <button
                key={chip.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setOrderStatusFilter(chip.key)}
                data-tour-target={`purchases-order-status-${chip.key}`}
                className={`px-3 py-1 text-meta rounded-full transition-colors ${
                  isActive
                    ? "bg-brand-action text-white"
                    : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                }`}
              >
                {chip.label}
                <span
                  className={`ml-2 ${
                    isActive ? "text-blue-100" : "text-foreground-muted"
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Funding Accounts Manager, in a slick popup (no blur) instead of
            expanding inline and shoving half the page down. */}
        <LivingPopup
          open={showFundingManager}
          onClose={() => setShowFundingManager(false)}
          label="Funding accounts"
          widthClassName="max-w-2xl"
          card={false}
        >
          <FundingAccountsManager fundingAccounts={fundingAccounts} />
        </LivingPopup>

        {/* Purchase tasks list */}
        {(() => {
          // Shared per-task card renderer — used by both the active pipeline
          // up top and the collapsed "Earlier" accordion at the bottom. Kept
          // inline so it closes over `selectedTask`, `projects`,
          // `purchasesByTask`, `queryClient`, etc. without prop-drilling.
          const renderPurchaseTaskCard = (task: Task) => {
            // Purchases live in the task owner's data folder. The
            // merged-view loader (`listAllIncludingShared`) reads both the
            // current user's items and each shared-task owner's items, so
            // shared purchase tasks render with real items + totals. The
            // composite key matches because each item is decorated with its
            // on-disk `owner`.
            const items = purchasesByTask[`${task.owner}:${task.id}`] || [];
            const taskTotal = items.reduce(
              (sum, i) => sum + (i.total_price ?? 0),
              0
            );
            // Project lookup must compare both `id` AND `owner` — per-user
            // ID spaces mean alex's project 1 and morgan's project 1 are
            // different projects.
            const project = projects.find(
              (p) => p.id === task.project_id && p.owner === task.owner
            );
            // Display-only override: the misc-purchases project is
            // stored on disk as `_misc_purchases` (reserved name) but
            // user-facing UI must always show "Miscellaneous". Real
            // projects render their on-disk name unchanged.
            const projectDisplayName =
              project && isMiscProject(project)
                ? MISC_CATEGORY_LABEL
                : project?.name;
            const tkey = taskKey(task);
            const isOpen = selectedTask !== null && taskKey(selectedTask) === tkey;
            // Destructive + write actions are gated on `!task.is_shared_with_me`.
            // `tasksApi.delete` and `tasksApi.update` (no `owner` arg) are
            // current-user-scoped, so on id-collision between an own task and a
            // shared task with the same numeric id they would clobber the OWN
            // task. Mirrors the gate used by TaskDetailPopup's delete affordance.
            const completeLabel = task.is_shared_with_me
              ? `Only the owner (${task.owner}) can change completion`
              : task.is_complete
                ? "Mark as incomplete"
                : "Mark as complete";
            const deleteLabel = task.is_shared_with_me
              ? `Only the owner (${task.owner}) can delete this purchase order`
              : "Delete purchase order";

            return (
              <div
                key={tkey}
                // BeakerSearch hover-as-context (step 4). Tagging the order card
                // lets the palette resolve "the order under your cursor" when it
                // opens, biasing Suggested + the context card. The kind is
                // "purchase" and the key is taskKey(task), the SAME composite the
                // hook parses (purchases-beaker-source resolveFocus, where SELECTED
                // still outranks HOVERED).
                data-beaker-target={`purchase:${tkey}`}
                className="bg-surface-raised border border-border rounded-xl overflow-hidden"
              >
                {/* Task header */}
                <div
                  className="flex items-center justify-between px-5 py-3 border-b border-border cursor-pointer hover:bg-surface-sunken"
                  onClick={() => setSelectedTask(isOpen ? null : task)}
                  data-testid={`purchase-row-${tkey}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Completion indicator */}
                    <div
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        task.is_complete ? "bg-green-500" : "bg-foreground-muted/30"
                      }`}
                    />
                    <div>
                      <h3 className={`text-body font-semibold ${task.is_complete ? "text-green-700 dark:text-green-300" : "text-foreground"}`}>
                        {task.name}
                      </h3>
                      <p className="text-meta text-foreground-muted">
                        {projectDisplayName} · {task.start_date} ·{" "}
                        {items.length} item{items.length !== 1 ? "s" : ""}{task.is_complete && " · Complete"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-body font-semibold text-foreground">
                      ${taskTotal.toFixed(2)}
                    </span>
                    <span className="text-foreground-muted">
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {/* Expanded purchase editor */}
                {isOpen && (
                  <div className="relative">
                    {/* Shared purchase tasks: thread isSharedWithMe so
                        write affordances (add-row, delete-item, click-to-
                        edit) inside PurchaseEditor are gated the same way
                        the destructive task-level buttons above are.
                        purchasesApi.create/update/delete are current-user
                        scoped (no owner arg), so without this gate a
                        write would land items under the receiver's data
                        dir at the shared task's numeric id — clobbering
                        or orphaning items. Mirrors the parent-chip
                        TaskDetailPopup pattern (TaskDetailPopup.tsx:794
                        already passes username for shared tasks).

                        username={task.owner} is passed too so the editor
                        reads items from the owner's data dir (matching
                        the brief's "items remain viewable" claim);
                        without it the editor calls
                        purchasesApi.listByTask(taskId) under the current
                        user and shows empty / collision items. */}
                    <PurchaseEditor
                      taskId={task.id}
                      taskType={task.task_type}
                      isSharedWithMe={task.is_shared_with_me ?? false}
                      ownerLabel={task.is_shared_with_me ? task.owner : undefined}
                      username={task.is_shared_with_me ? task.owner : undefined}
                    />
                    <div className="absolute bottom-3 right-4 flex items-center gap-2">
                      {/* Complete toggle button */}
                      <Tooltip label={completeLabel} placement="bottom">
                        <button
                          aria-label={completeLabel}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const willComplete = !task.is_complete;
                              await tasksApi.update(task.id, { is_complete: willComplete });
                              // Per-item ordering status
                              // (purchases-ordered-stage, 2026-05-29): the
                              // `purchase_ordered` bell no longer fires here.
                              // The complete-toggle is now purely the parent
                              // order's done/not-done state. The real
                              // "ordered" transition (and its requester bell)
                              // lives on each line item's order-status control
                              // in PurchaseEditor -> purchasesApi.setOrderStatus.
                              queryClient.invalidateQueries({ queryKey: ["tasks"] });
                            } catch {
                              alert("Failed to update task");
                            }
                          }}
                          disabled={task.is_shared_with_me}
                          className={`p-1.5 rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                            task.is_complete
                              ? "bg-green-500 text-white hover:bg-green-600"
                              : "text-foreground-muted hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10"
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5"/>
                          </svg>
                        </button>
                      </Tooltip>
                      {/* Delete task button */}
                      <Tooltip label={deleteLabel} placement="bottom">
                        <button
                          aria-label={deleteLabel}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTask(task.id);
                          }}
                          disabled={task.is_shared_with_me || deletingTaskId === task.id}
                          className="p-2 text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-red-400 disabled:hover:bg-transparent"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="w-5 h-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                            />
                          </svg>
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </div>
            );
          };

          if (purchaseTasks.length === 0) {
            return (
              <div className="text-center py-16">
                <p className="text-title text-foreground-muted mb-2">No purchases yet</p>
                <p className="text-body text-foreground-muted">
                  Create a task with type &ldquo;Purchase&rdquo; to start
                  tracking orders
                </p>
              </div>
            );
          }

          // Filter-specific empty state: when the user is on a filter
          // chip and that bucket happens to be empty, surface a softer
          // message so it doesn't look like /purchases lost data.
          if (sortedTasks.length === 0) {
            let filterLabel: string;
            if (categoryFilter === "misc") {
              filterLabel = `${MISC_CATEGORY_LABEL.toLowerCase()} purchases`;
            } else if (categoryFilter === "awaiting_approval") {
              filterLabel = isLabHead
                ? "purchases pending your approval"
                : "purchases awaiting approval";
            } else {
              filterLabel = "project-attached purchases";
            }
            return (
              <div className="text-center py-12">
                <p className="text-body text-foreground-muted">
                  No {filterLabel} yet
                </p>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {sortedTasks.map(renderPurchaseTaskCard)}
            </div>
          );
        })()}

        {/* Spending dashboard — sits below the unified scroll, visually
            separated by the section heading inside the component. Renders
            even when there are no purchases yet so first-time users see the
            placeholders + funding-account scaffold. */}
        <SpendingDashboard
          purchaseItems={allPurchases}
          tasks={allTasks}
          projects={projects}
          fundingAccounts={fundingAccounts}
          selectedProjectIds={selectedProjectIds}
        />
      </div>
    </AppShell>
  );
}


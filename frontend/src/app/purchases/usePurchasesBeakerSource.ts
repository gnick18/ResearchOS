// sequence editor master (Purchases source sub-bot). BeakerSearch step 3, the
// thin HOOK that wires the live Purchases page state + handlers into the pure
// buildPurchasesSource builder and registers the result with the shared palette.
//
// All the testable logic lives in purchases-beaker-source.ts (no React, no
// store). This hook reads the same React Query caches the page reads (sharing
// each cache by query key so no extra fetch), reads the role + the PI edit-gate
// confirm state, closes the handler bag over the real purchasesApi / tasksApi /
// pi-actions handlers + the queryClient invalidations (the spec 1.4 table), and
// bridges the SpendingDashboard's in-component export / focus through the page's
// own window-event channel (the same pattern the page already uses for the
// tour's demo overlay). It calls buildPurchasesSource inside a useMemo so the
// registration object is stable, then useBeakerSearchSource.
//
// The page-local UI state the source drives (the selected order + the modal /
// filter setters) is owned by PurchasesPage and threaded in as args, mirroring
// useCalendarBeakerSource. The heavier domain data is read here so the page wire
// stays a single call.
//
// The session substitution (the spec's "live PI edit session" does not exist on
// this worktree, replaced by the per-record PI edit-confirm gate) is documented
// in purchases-beaker-source.ts. Here `hasLiveSession` for the FOCUSED order is
// "the lab head already confirmed editing this owner's order this session"; the
// approve / decline handlers mark that confirm before writing, so the first run
// is the confirm and the rest write straight through.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tasksApi,
  purchasesApi,
  labApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHasPiPowers } from "@/hooks/useIsLabManager";
import { setPurchaseApproval, declinePurchase } from "@/lib/lab/pi-actions";
import {
  isPiEditConfirmed,
  markPiEditConfirmed,
  piEditKey,
} from "@/lib/lab/pi-edit-guard";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
// beaker-hover.ts deleted (ai centered-redesign bot): hover bias removed.
import { isMiscProject, MISC_CATEGORY_LABEL } from "@/lib/purchases/misc-project";
import {
  isPurchasePending,
  normalizeOrderStatus,
  taskKey,
  type FundingAccount,
  type Project,
  type PurchaseItem,
  type PurchaseOrderStatus,
  type Task,
} from "@/lib/types";
import {
  buildPurchasesSource,
  type PurchaseCategoryFilter,
  type PurchaseOrderStatusFilter,
  type PurchasesSourceData,
  type PurchasesSourceHandlers,
  type SpendingExportDescriptor,
} from "./purchases-beaker-source";

// The window events the SpendingDashboard listens for, so the palette can drive
// the in-component export / focus without lifting the dashboard's state up. The
// page mounts the dashboard and the dashboard subscribes (see SpendingDashboard
// + PurchasesPage). Mirrors the page's existing tour:* event channel.
export const PURCHASES_EXPORT_EVENT = "purchases:export-csv";
export const PURCHASES_FOCUS_DASHBOARD_EVENT = "purchases:focus-dashboard";

// How many recent spending-export descriptors the session-local list keeps.
const RECENT_EXPORTS_CAP = 4;

// The `data-beaker-target` kind prefix the order cards carry (page.tsx tags each
// card `purchase:${taskKey(task)}`). The hook parses the provider's last-hovered
// key, matches this kind, and resolves the rest (a composite "{self|owner}:{id}"
// taskKey) back to the order. Keep in lockstep with the page's attribute.
const PURCHASE_HOVER_KIND = "purchase";

/** The human label for the dashboard's time-range option, for the export
 *  descriptor row (spec 5). Defaults to the dashboard's own default. */
function rangeLabelFor(option: string): string {
  switch (option) {
    case "30d":
      return "last 30 days";
    case "90d":
      return "last 90 days";
    case "12mo":
      return "last 12 months";
    case "all":
      return "all time";
    case "custom":
      return "custom range";
    default:
      return "last 12 months";
  }
}

/** The page-owned UI state + setters the source drives. PurchasesPage threads
 *  these in (they live in its useState), mirroring useCalendarBeakerSource. */
export interface UsePurchasesBeakerSourceArgs {
  selectedTask: Task | null;
  setSelectedTask: (task: Task | null) => void;
  setShowNewPurchase: (open: boolean) => void;
  setShowFundingManager: (open: boolean) => void;
  categoryFilter: PurchaseCategoryFilter;
  orderStatusFilter: PurchaseOrderStatusFilter;
  setCategoryFilter: (key: PurchaseCategoryFilter) => void;
  setOrderStatusFilter: (key: PurchaseOrderStatusFilter) => void;
  handleDeleteTask: (taskId: number) => void;
  router: { push: (href: string) => void };
}

/** Register the Purchases page's BeakerSearch source while the page is mounted.
 *  Call once from app/purchases/page.tsx after the existing reads. */
export function usePurchasesBeakerSource(args: UsePurchasesBeakerSourceArgs): void {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // Purchase approval (incl. the BeakerBot purchase tools) is a delegated power
  // (Lab Manager Phase 1): the lab head OR a Lab Manager. isLabHead here means
  // "has PI powers"; the name is kept so the downstream tool logic is untouched.
  const isLabHead = useHasPiPowers(currentUser || null) === true;

  // Hover bias removed (ai centered-redesign bot). hoveredKey is always null;
  // hoveredTask is always null (selected context only).
  const hoveredKey: string | null = null;

  // ── Queries, mirroring the page's keys so the cache is shared (no refetch). ─
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser, { includeHidden: true }],
    queryFn: () => fetchAllProjectsIncludingShared({ includeHidden: true }),
  });
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: projects.length > 0,
  });
  const { data: allPurchases = [] } = useQuery({
    queryKey: ["purchases-all", currentUser],
    queryFn: () => purchasesApi.listAllIncludingShared(currentUser),
    enabled: !!currentUser,
  });
  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts", currentUser],
    queryFn: purchasesApi.listFundingAccounts,
  });
  const { data: labPurchaseItems = [] } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    enabled: isLabHead,
  });

  // ── Derived state (same shapes the page derives). ────────────────────────
  const purchaseTasks = useMemo(
    () => allTasks.filter((t) => t.task_type === "purchase"),
    [allTasks],
  );

  const purchasesByTask = useMemo(() => {
    const map: Record<string, PurchaseItem[]> = {};
    for (const p of allPurchases) {
      const key = `${p.owner}:${p.task_id}`;
      (map[key] ??= []).push(p);
    }
    return map;
  }, [allPurchases]);

  const grandTotal = useMemo(
    () => allPurchases.reduce((sum, p) => sum + (p.total_price ?? 0), 0),
    [allPurchases],
  );

  const labPendingApprovalCount = useMemo(() => {
    if (!isLabHead) return 0;
    let n = 0;
    for (const item of labPurchaseItems) if (!item.approved) n += 1;
    return n;
  }, [labPurchaseItems, isLabHead]);

  // The on-screen list, recomputed the same way the page's categorizedTasks +
  // sortedTasks do, so the empty-query jump list matches the visible cards.
  const sortedTasks = useMemo<Task[]>(() => {
    const itemsOf = (t: Task) =>
      allPurchases.filter((p) => p.owner === t.owner && p.task_id === t.id);
    const filtered = purchaseTasks.filter((task) => {
      if (args.orderStatusFilter !== "any") {
        const hasStatus = itemsOf(task).some(
          (p) => normalizeOrderStatus(p.order_status) === args.orderStatusFilter,
        );
        if (!hasStatus) return false;
      }
      if (args.categoryFilter === "awaiting_approval") {
        return itemsOf(task).some((p) => !p.approved);
      }
      const project = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      const taskIsMisc = !!project && isMiscProject(project);
      if (args.categoryFilter === "misc") return taskIsMisc;
      if (args.categoryFilter === "project") return !taskIsMisc;
      return true;
    });
    return [...filtered].sort((a, b) =>
      b.start_date.localeCompare(a.start_date),
    );
  }, [
    purchaseTasks,
    projects,
    allPurchases,
    args.categoryFilter,
    args.orderStatusFilter,
  ]);

  const visibleTotal = useMemo(() => {
    let sum = 0;
    for (const task of sortedTasks) {
      for (const it of purchasesByTask[`${task.owner}:${task.id}`] ?? []) {
        sum += it.total_price ?? 0;
      }
    }
    return sum;
  }, [sortedTasks, purchasesByTask]);

  // Number of line items in the currently visible (filtered) orders. Gates the
  // "Export current spending" command so it disables when the active filter
  // shows zero orders, matching what the export would actually contain.
  const visibleItemCount = useMemo(
    () =>
      sortedTasks.reduce(
        (n, t) => n + (purchasesByTask[`${t.owner}:${t.id}`]?.length ?? 0),
        0,
      ),
    [sortedTasks, purchasesByTask],
  );

  // Hover bias removed; hoveredTask is always null (hover feature deleted).
  const hoveredTask: Task | null = null;

  // The focused order's owner + first pending item drive the PI edit-confirm
  // gate (the session substitution). hasLiveSession = already confirmed for this
  // order this session.
  const focusedTask = args.selectedTask ?? hoveredTask;
  const hasLiveSession = useMemo(() => {
    if (!isLabHead || !focusedTask) return false;
    const items = purchasesByTask[`${focusedTask.owner}:${focusedTask.id}`] ?? [];
    const firstPending = items.find((i) => isPurchasePending(i));
    if (!firstPending) return false;
    return isPiEditConfirmed(
      piEditKey(focusedTask.owner, "purchase", firstPending.id),
    );
  }, [isLabHead, focusedTask, purchasesByTask]);

  // ── Display helpers (project-name override + composite key). ──────────────
  // BeakerSearch v2 (sub-flow framework, chunk 2). The change-project move
  // targets, resolved the SAME way the page's project pickers do, the current
  // user's OWN, non-archived, non-misc real projects (label = name). The misc
  // project is excluded here and offered as the picker's separate
  // "Miscellaneous" option, pointing at miscProjectId below.
  const moveTargets = useMemo(
    () =>
      projects
        .filter((p) => p.owner === currentUser)
        .filter((p) => !p.is_archived)
        .filter((p) => !isMiscProject(p))
        .map((p) => ({ id: p.id, name: p.name })),
    [projects, currentUser],
  );

  // The hidden _misc_purchases project's id (the Miscellaneous sentinel), or
  // null when it has not been bootstrapped yet (the picker then omits it).
  const miscProjectId = useMemo(() => {
    const misc = projects.find(
      (p) => p.owner === currentUser && isMiscProject(p),
    );
    return misc ? misc.id : null;
  }, [projects, currentUser]);

  const projectNameOf = useCallback(
    (task: Task): string | null => {
      const project = projects.find(
        (p: Project) => p.id === task.project_id && p.owner === task.owner,
      );
      if (!project) return null;
      return isMiscProject(project) ? MISC_CATEGORY_LABEL : project.name;
    },
    [projects],
  );

  // ── Session-local recent spending exports (spec 5). ──────────────────────
  const [recentExports, setRecentExports] = useState<SpendingExportDescriptor[]>(
    [],
  );
  const [exportSeq, setExportSeq] = useState(0);

  // ── Handlers (real apis + invalidations, spec 1.4). ──────────────────────
  const refetch = useCallback(
    (queryKey: (string | number)[]) =>
      queryClient.refetchQueries({ queryKey }),
    [queryClient],
  );

  const handlers = useMemo<PurchasesSourceHandlers>(() => {
    const dispatch = (name: string) => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(name));
      }
    };
    return {
      setSelectedTask: args.setSelectedTask,
      setShowNewPurchase: args.setShowNewPurchase,
      setShowFundingManager: args.setShowFundingManager,
      setCategoryFilter: args.setCategoryFilter,
      setOrderStatusFilter: args.setOrderStatusFilter,

      setItemStatus: (item: PurchaseItem, order: Task, status: PurchaseOrderStatus) => {
        void purchasesApi
          .setOrderStatus(item.id, status, {
            owner: order.is_shared_with_me ? order.owner : undefined,
            actor: currentUser,
          })
          .then(() => refetch(["purchases-all"]));
      },
      setOrderComplete: (order: Task, complete: boolean) => {
        void tasksApi
          .update(order.id, { is_complete: complete })
          .then(() => refetch(["tasks"]));
      },
      deleteOrder: (order: Task) => {
        // Keeps the page's confirm() + invalidations (handleDeleteTask).
        args.handleDeleteTask(order.id);
      },

      // BeakerSearch v2 (sub-flow framework, chunk 2), the two picker handlers,
      // the SAME real wiring v1 had behind the order editor.
      changeOrderProject: (order: Task, projectId: number | null) => {
        // Own orders only (the command gates !is_shared_with_me), so no owner
        // route. project_id null normalizes to "no project" inside tasksApi.
        void tasksApi
          .update(order.id, { project_id: projectId })
          .then(() => {
            void refetch(["tasks"]);
            void refetch(["task", taskKey(order)]);
            void refetch(["projects"]);
          });
      },
      setItemFunding: (
        item: PurchaseItem,
        order: Task,
        account: { id: number; name: string },
      ) => {
        // Own orders only, so no owner route. The builder loops this over every
        // uncategorized item, one purchasesApi.update per item. The FK is
        // authoritative (funding-rework); the name rides along as the label.
        void order;
        void purchasesApi
          .update(item.id, {
            funding_account_id: account.id,
            funding_string: account.name,
          })
          .then(() => refetch(["purchases-all"]));
      },

      approveItem: (item: PurchaseItem, order: Task) => {
        // The first approve IS the PI edit-confirm for this order's owner.
        markPiEditConfirmed(piEditKey(order.owner, "purchase", item.id));
        void setPurchaseApproval({
          actor: currentUser,
          sessionId: undefined,
          targetOwner: order.owner,
          purchaseItemId: item.id,
          approved: true,
          itemName: item.item_name,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
      },
      declineItem: (item: PurchaseItem, order: Task) => {
        markPiEditConfirmed(piEditKey(order.owner, "purchase", item.id));
        void declinePurchase({
          actor: currentUser,
          sessionId: undefined,
          targetOwner: order.owner,
          purchaseItemId: item.id,
          itemName: item.item_name,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
      },

      exportSpendingCsv: () => {
        // Capture a descriptor BEFORE the export so "Recent results" can reopen
        // it. The dashboard owns the real range/breakdown state, so we read the
        // visible window snapshot the page already has and let the dashboard
        // regenerate the byte-identical CSV on reopen. The range label here is
        // the dashboard's default window; a future lift could surface the live
        // range option (see the file header simplification note).
        const nextSeq = exportSeq + 1;
        setExportSeq(nextSeq);
        const descriptor: SpendingExportDescriptor = {
          id: String(nextSeq),
          rangeLabel: rangeLabelFor("12mo"),
          itemCount: sortedTasks.reduce(
            (n, t) =>
              n + (purchasesByTask[`${t.owner}:${t.id}`]?.length ?? 0),
            0,
          ),
          total: visibleTotal,
        };
        setRecentExports((prev) =>
          [descriptor, ...prev].slice(0, RECENT_EXPORTS_CAP),
        );
        dispatch(PURCHASES_EXPORT_EVENT);
      },
      focusDashboard: () => dispatch(PURCHASES_FOCUS_DASHBOARD_EVENT),
      openLabOverview: () => args.router.push("/lab-overview"),
    };
  }, [
    args,
    currentUser,
    refetch,
    sortedTasks,
    purchasesByTask,
    visibleTotal,
    exportSeq,
  ]);

  const source = useMemo(() => {
    const data: PurchasesSourceData = {
      purchaseTasks,
      purchasesByTask,
      projects,
      fundingAccounts,
      moveTargets,
      miscProjectId,
      sortedTasks,
      grandTotal,
      categoryFilter: args.categoryFilter,
      orderStatusFilter: args.orderStatusFilter,
      visibleTotal,
      hasExportableItems: visibleItemCount > 0,
      selectedTask: args.selectedTask,
      hoveredTask,
      currentUser,
      isLabHead,
      hasLiveSession,
      sessionId: undefined,
      labPendingApprovalCount,
      projectNameOf,
      taskKeyOf: (task) => taskKey(task),
    };
    return buildPurchasesSource(data, handlers, recentExports);
  }, [
    purchaseTasks,
    purchasesByTask,
    projects,
    fundingAccounts,
    moveTargets,
    miscProjectId,
    sortedTasks,
    grandTotal,
    args.categoryFilter,
    args.orderStatusFilter,
    args.selectedTask,
    visibleTotal,
    visibleItemCount,
    hoveredTask,
    currentUser,
    isLabHead,
    hasLiveSession,
    labPendingApprovalCount,
    projectNameOf,
    handlers,
    recentExports,
  ]);

  useBeakerSearchSource(source);
}

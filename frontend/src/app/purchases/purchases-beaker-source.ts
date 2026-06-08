// sequence editor master (Purchases source sub-bot). BeakerSearch step 3, a
// per-page SOURCE, the Purchases page.
//
// This module is the PURE builder behind the Purchases BeakerSearch
// registration. It takes a plain snapshot of the page state (purchase orders,
// their line items grouped by task, projects, funding accounts, the on-screen
// filtered list, the spending snapshot, the selection / hover, and the
// role + edit-gate signals) plus a bag of handler callbacks, and returns one
// BeakerSearchSource (context card + commands + suggested ids + nav groups). It
// reads NO store, holds NO React, and calls NO Date.now(), so the context-card
// copy, the command ids / groups / enabled gating, the Suggested ordering, and
// the nav groups are all unit-tested without rendering. The thin
// usePurchasesBeakerSource hook (co-located) wires the live queries + store +
// handlers into this builder inside a useMemo.
//
// The spec is docs/proposals/beakersearch-purchases.md and the approved visual
// target is docs/mockups/beakersearch-purchases-palette.html. This maps the
// spec's older function-based sketch (context() / suggested() / entities() /
// results()) onto the ACTUAL generic BeakerSearchSource contract, contextCard +
// commands (with stable ids + page-defined groups) + suggestedIds + navGroups.
//
// One honest substitution from the spec, called out so a reader is not misled.
// The spec describes a "live PI edit session" with a session id that
// setPurchaseApproval / declinePurchase assert. That model does NOT exist on
// this worktree. The PI capability revamp (2026-06-07) replaced the
// password + live-session with a once-per-session per-record CONFIRM gate
// (usePiEditGate / pi-edit-guard). So here `hasLiveSession` maps to "the lab
// head has crossed the PI edit-confirm for this owner", `sessionId` passes
// through as the optional id the handlers already accept (undefined today), and
// the greyed reason points the lab head at confirming the order, not at a
// nonexistent Lab Overview edit session. The data SHAPE the brief asked for
// (isLabHead + hasLiveSession + sessionId) is preserved so the wiring is a
// one-line change if a real session model lands later.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import type {
  EditorCommand,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
  PaletteSubflow,
} from "@/components/sequences/editor-commands";
import {
  isPurchasePending,
  normalizeOrderStatus,
  PURCHASE_ORDER_STATUS_LABEL,
  type FundingAccount,
  type Project,
  type PurchaseItem,
  type PurchaseOrderStatus,
  type Task,
} from "@/lib/types";
import { computeFundingSpendByAccount } from "@/lib/funding/spend";

// ── The two filter unions (mirrored from the page so the builder stays pure) ─
export type PurchaseCategoryFilter =
  | "all"
  | "project"
  | "misc"
  | "awaiting_approval";
export type PurchaseOrderStatusFilter = "any" | PurchaseOrderStatus;

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const PURCHASES_GROUP_SELECTED = "Selected order";
export const PURCHASES_GROUP_CREATE = "Create";
export const PURCHASES_GROUP_ORDER_STATUS = "Order status";
export const PURCHASES_GROUP_APPROVAL = "Approval";
export const PURCHASES_GROUP_FILTERS = "Filters";
export const PURCHASES_GROUP_FUNDING = "Funding";
export const PURCHASES_GROUP_SPENDING = "Spending";
export const PURCHASES_GROUP_ORDER_MGMT = "Order management";

// Above this many line items, the per-item "mark / approve" rows collapse into
// "Open it" plus the bulk variants, so Suggested never balloons (spec 3.2).
const BULK_COLLAPSE_THRESHOLD = 4;

// The registry has no "cart" / "receipt" glyph (icon-guard blocks new inline
// svg), so reuse registered glyphs. "download" is the export / card icon,
// "box" reads as an order / package, "folder" a project, "users" a member,
// "check" a status flip, the rest are literal.
const ICON_ORDER: IconName = "box";
const ICON_FUNDING: IconName = "folder";
const ICON_EXPORT: IconName = "download";

// The "Miscellaneous" catch-all label in the change-project picker. Mirrors the
// MISC_CATEGORY_LABEL the page maps the hidden _misc_purchases project to, so
// the picker option reads the same as the project-name override everywhere else.
const MISC_PROJECT_OPTION_LABEL = "Miscellaneous";

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface PurchasesSourceData {
  /** Every purchase order (task_type === "purchase"), own + shared, decorated
   *  with is_shared_with_me + owner. */
  purchaseTasks: Task[];
  /** Line items grouped by the composite `${owner}:${task_id}` key (already
   *  deduped by the merged loader). The ONLY item source the builder reads. */
  purchasesByTask: Record<string, PurchaseItem[]>;
  /** Projects WITH the hidden _misc_purchases bucket (the page passes it). */
  projects: Project[];
  /** Funding accounts (current user). */
  fundingAccounts: FundingAccount[];

  // BeakerSearch v2 (sub-flow framework, chunk 2). The MOVE TARGETS the
  // change-project sub-flow lists, resolved in the hook (own, non-archived,
  // non-misc real projects), label = name. The "Miscellaneous" option is added
  // by the builder, pointing at miscProjectId below. The data model requires a
  // project_id on every purchase task (see misc-project.ts), so Miscellaneous
  // resolves to the hidden _misc_purchases project's id, not a null project_id.
  moveTargets: { id: number; name: string }[];
  /** The hidden _misc_purchases project's id (the Miscellaneous sentinel), or
   *  null when it does not exist yet (the sub-flow then omits the option). */
  miscProjectId: number | null;

  // ON SCREEN (the two filters + the live spending snapshot).
  sortedTasks: Task[];
  grandTotal: number;
  categoryFilter: PurchaseCategoryFilter;
  orderStatusFilter: PurchaseOrderStatusFilter;
  /** The visible-window dollar total (summed total_price over sortedTasks'
   *  items), pre-computed so the builder never re-walks the item map. */
  visibleTotal: number;
  /** Whether the dashboard's export window currently holds any items, gates the
   *  "Export current spending" command (spec 3.4 / 6). */
  hasExportableItems: boolean;

  // SELECTED / HOVERED.
  selectedTask: Task | null;
  /** The hovered order, resolved by the hook from the provider's
   *  [data-beaker-target] key (null when nothing is hovered or a selection
   *  wins). SELECTED beats HOVERED. */
  hoveredTask: Task | null;

  // Role + the edit gate (see the file header for the session substitution).
  currentUser: string;
  isLabHead: boolean;
  /** True when the lab head has crossed the PI edit-confirm so approve / decline
   *  may write. False greys those rows with a confirm reason. Always false for a
   *  member (the rows are omitted for members anyway). */
  hasLiveSession: boolean;
  /** The optional session id the approval handlers accept. Undefined on this
   *  worktree (no live-session model); passed through unchanged. */
  sessionId?: string;
  /** Lab-wide pending-approval count (lab head only, 0 for members), drives the
   *  context-card role line + the queue commands. */
  labPendingApprovalCount: number;

  // Pre-computed display helpers the builder must not derive itself.
  /** The project display name for a task, with the "_misc_purchases" reserved
   *  name already mapped to the "Miscellaneous" override (null when orphaned). */
  projectNameOf: (task: Task) => string | null;
  /** taskKey(task), the composite "{self|owner}:{id}". */
  taskKeyOf: (task: Task) => string;
}

// ── The handler bag (closures over the page's real handlers + invalidations) ─
export interface PurchasesSourceHandlers {
  // Selection / open.
  setSelectedTask: (task: Task | null) => void;

  // Create + funding modals.
  setShowNewPurchase: (open: boolean) => void;
  setShowFundingManager: (open: boolean) => void;

  // Filters.
  setCategoryFilter: (key: PurchaseCategoryFilter) => void;
  setOrderStatusFilter: (key: PurchaseOrderStatusFilter) => void;

  // Order writes (own / owner-routed). Each wraps the real purchasesApi /
  // tasksApi call + the spec invalidation keys; the builder never calls an api.
  setItemStatus: (
    item: PurchaseItem,
    order: Task,
    status: PurchaseOrderStatus,
  ) => void;
  setOrderComplete: (order: Task, complete: boolean) => void;
  deleteOrder: (order: Task) => void;

  // BeakerSearch v2 (sub-flow framework, chunk 2), the two picker handlers.
  /** Change the order's project via tasksApi.update(task.id, { project_id })
   *  (owner-routed for own orders, i.e. no owner), then refetch the spec keys.
   *  projectId null means "no project"; the Miscellaneous option passes the
   *  hidden misc project's id instead (the data model needs a real project_id). */
  changeOrderProject: (order: Task, projectId: number | null) => void;
  /** Set ONE uncategorized item's funding via purchasesApi.update(itemId,
   *  { funding_account_id, funding_string }), then refetch ["purchases-all"].
   *  The builder loops this over every uncategorized item in the order so the
   *  api stays single-item. The id is authoritative (funding-rework); the name
   *  rides along as the denormalized display label. */
  setItemFunding: (
    item: PurchaseItem,
    order: Task,
    account: Pick<FundingAccount, "id" | "name">,
  ) => void;

  // Approval (lab head + confirmed only). targetOwner = order.owner.
  approveItem: (item: PurchaseItem, order: Task) => void;
  declineItem: (item: PurchaseItem, order: Task) => void;

  // Spending dashboard (lifted via the page's event bridge, see the hook).
  exportSpendingCsv: () => void;
  focusDashboard: () => void;

  // Navigate out.
  openLabOverview: () => void;
}

/** The order the builder treats as the strongest context (SELECTED beats
 *  HOVERED), with a flag so the card line + Suggested hint can soften for a
 *  hover. Null when nothing is in focus. */
function resolveFocus(
  data: PurchasesSourceData,
): { task: Task; items: PurchaseItem[]; hovered: boolean } | null {
  const sel = data.selectedTask;
  if (sel) {
    return { task: sel, items: itemsFor(data, sel), hovered: false };
  }
  const hov = data.hoveredTask;
  if (hov) {
    return { task: hov, items: itemsFor(data, hov), hovered: true };
  }
  return null;
}

/** Line items for an order, from the already-deduped map (never a raw read). */
function itemsFor(data: PurchasesSourceData, task: Task): PurchaseItem[] {
  return data.purchasesByTask[`${task.owner}:${task.id}`] ?? [];
}

/** The summed total_price of an order's items. */
function orderTotal(items: PurchaseItem[]): number {
  return items.reduce((sum, i) => sum + (i.total_price ?? 0), 0);
}

/** Whether a line item has no funding account assigned yet (an empty
 *  funding_string). The set-funding sub-flow only writes these (spec 3.2,
 *  "order has uncategorized items"). */
function isUncategorized(item: PurchaseItem): boolean {
  return !item.funding_string || item.funding_string.trim() === "";
}

/** The uncategorized (unfunded) items of an order, from the deduped map. */
function uncategorizedItems(items: PurchaseItem[]): PurchaseItem[] {
  return items.filter(isUncategorized);
}

/** A "$1,234.56" money string (no mid-string locale surprises in the test). */
function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The shared-write reason ("Only the owner (alex) can change this"), spec 3.1. */
function ownerReason(task: Task): string {
  return `Only the owner (${task.owner}) can change this`;
}

/** The greyed-approve reason when a lab head has not confirmed the edit gate
 *  (the session substitution, see the file header). */
const NO_SESSION_REASON = "Confirm 'Edit as lab head' on the order to approve";

// ── Context card (spec 2.5) ─────────────────────────────────────────────────

/** Line 1, the scope + snapshot. When a status filter is active it leads; else
 *  the category filter label leads; a purely-unfiltered card mirrors the page
 *  subhead ("18 orders, $9,140 total"). */
function buildScopeMeta(data: PurchasesSourceData): string {
  const visibleCount = data.sortedTasks.length;

  if (data.purchaseTasks.length === 0) return "no orders yet";

  // Purely unfiltered, mirror the page subhead off the grand total.
  if (data.categoryFilter === "all" && data.orderStatusFilter === "any") {
    const n = data.purchaseTasks.length;
    return `${n} order${n === 1 ? "" : "s"}, ${money(data.grandTotal)} total`;
  }

  // A filter is active, lead with its label, then the visible window snapshot.
  const scope =
    data.orderStatusFilter !== "any"
      ? PURCHASE_ORDER_STATUS_LABEL[data.orderStatusFilter].toLowerCase()
      : categoryScopeLabel(data.categoryFilter, data.isLabHead);
  return `${scope}, ${visibleCount} order${
    visibleCount === 1 ? "" : "s"
  }, ${money(data.visibleTotal)}`;
}

/** The human label for a category filter scope (role-derived for approval). */
function categoryScopeLabel(
  filter: PurchaseCategoryFilter,
  isLabHead: boolean,
): string {
  switch (filter) {
    case "project":
      return "project purchases";
    case "misc":
      return "miscellaneous";
    case "awaiting_approval":
      return isLabHead ? "pending approval" : "awaiting approval";
    case "all":
    default:
      return "all";
  }
}

function buildContextCard(data: PurchasesSourceData): PaletteContextCard {
  const focus = resolveFocus(data);

  // Selection / hover line (spec 2.5 line 2). Project, item count, total.
  let selection: PaletteContextCard["selection"];
  if (focus) {
    const { task, items, hovered } = focus;
    if (hovered) {
      selection = { iconName: ICON_ORDER, text: `Pointing at "${task.name}"` };
    } else {
      const project = data.projectNameOf(task);
      const bits = [
        project,
        `${items.length} item${items.length === 1 ? "" : "s"}`,
        money(orderTotal(items)),
      ].filter(Boolean);
      selection = {
        iconName: ICON_ORDER,
        text: `Selected, "${task.name}", ${bits.join(", ")}`,
      };
    }
  }

  // Role line (spec 2.5 line 3, lab head + non-empty queue only). Folded into a
  // chip so it reads as a distinct affordance under the title.
  const chips: PaletteContextCard["chips"] = [];
  if (data.isLabHead && data.labPendingApprovalCount > 0) {
    const n = data.labPendingApprovalCount;
    chips.push({
      label: `${n} item${n === 1 ? "" : "s"} await${
        n === 1 ? "s" : ""
      } your approval`,
      italic: true,
    });
  }

  return {
    iconName: ICON_EXPORT,
    title: "Purchases",
    meta: buildScopeMeta(data),
    chips: chips.length > 0 ? chips : undefined,
    selection,
  };
}

// ── BeakerSearch v2 (sub-flow framework, chunk 2), the two INLINE pickers ────

/** The INLINE change-project flow (single stage). Items are the active project
 *  move targets plus a "Miscellaneous" option (the hidden _misc_purchases
 *  project's id when it exists); picking one calls the owner-routed
 *  changeOrderProject then COMPLETES (onPick returns void). Single stage, so the
 *  framework renders it inline under the command row (mirrors the Gantt assign
 *  proof). */
function buildChangeProjectSubflow(
  task: Task,
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): PaletteSubflow {
  const currentProjectId = task.project_id;
  const items: PaletteNavItem[] = data.moveTargets.map((p) => ({
    id: String(p.id),
    label: p.name,
    detail: p.id === currentProjectId ? "current project" : undefined,
    iconName: ICON_FUNDING,
    tone: "project",
    enabled: p.id !== currentProjectId,
    onRun: () => {},
  }));
  // The Miscellaneous catch-all, pointing at the hidden misc project id (the
  // data model needs a real project_id, see misc-project.ts). Omitted only when
  // the misc project has not been bootstrapped yet.
  if (data.miscProjectId != null) {
    items.push({
      id: String(data.miscProjectId),
      label: MISC_PROJECT_OPTION_LABEL,
      detail:
        data.miscProjectId === currentProjectId ? "current project" : "no project",
      iconName: "list",
      tone: "project",
      enabled: data.miscProjectId !== currentProjectId,
      onRun: () => {},
    });
  }
  // Belt-and-suspenders: the command is gated on having a target, but if the
  // picker somehow opens empty, show a quiet disabled placeholder rather than
  // a blank list.
  if (items.length === 0) {
    items.push({
      id: "no-projects",
      label: "No other projects yet",
      iconName: "list",
      tone: "project",
      enabled: false,
      onRun: () => {},
    });
  }
  return {
    title: `Change project of "${task.name}"`,
    placeholder: "Pick a project",
    items,
    onPick: (item) => {
      handlers.changeOrderProject(task, Number(item.id));
    },
  };
}

/** The INLINE set-funding flow (single stage). Items are the lab's funding
 *  accounts (label = name, detail = spent / budget); picking one loops the
 *  single-item setItemFunding over every UNCATEGORIZED item in the order, then
 *  COMPLETES (onPick returns void). Single stage, so it renders inline. */
function buildSetFundingSubflow(
  task: Task,
  items: PurchaseItem[],
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): PaletteSubflow {
  const unfunded = uncategorizedItems(items);
  // Live spend per account (funding-rework): the on-disk `spent` field is gone,
  // so roll it up from every line item the page already holds.
  const spendByAccount = computeFundingSpendByAccount(
    data.fundingAccounts,
    Object.values(data.purchasesByTask).flat(),
  );
  return {
    title: `Set funding account for ${unfunded.length} item${
      unfunded.length === 1 ? "" : "s"
    }`,
    placeholder: "Pick a funding account",
    items: data.fundingAccounts.map((a) => ({
      id: `funding-${a.id}`,
      label: a.name,
      detail: `${money(spendByAccount.get(a.id) ?? 0)} of ${money(a.total_budget)} spent`,
      keywords: [
        a.award_number ?? "",
        a.funder_name ?? "",
        a.award_title ?? "",
        "grant award funding",
      ]
        .filter(Boolean)
        .join(" "),
      iconName: ICON_FUNDING,
      tone: "funding",
      onRun: () => {},
    })),
    onPick: (chosen) => {
      const account = data.fundingAccounts.find((a) => `funding-${a.id}` === chosen.id);
      if (!account) return;
      for (const it of unfunded) {
        handlers.setItemFunding(it, task, account);
      }
    },
  };
}

// ── Commands (spec 3 + 6) ───────────────────────────────────────────────────

/** The full command set with stable ids + page-defined groups. The
 *  selection-specific rows carry the stable ids the Suggested rule names. The
 *  whole Approval block is OMITTED for members (so it never appears in the typed
 *  long-tail either, spec 7). */
function buildCommands(
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  const focus = resolveFocus(data);

  // ── Selected / hovered order actions (spec 3.2). ─────────────────────────
  if (focus) {
    const { task, items } = focus;
    const writable = !task.is_shared_with_me;
    const writeReason = writable ? undefined : ownerReason(task);
    const many = items.length > BULK_COLLAPSE_THRESHOLD;

    const firstNeedsOrdering = items.find(
      (i) => normalizeOrderStatus(i.order_status) === "needs_ordering",
    );
    const firstOrdered = items.find(
      (i) => normalizeOrderStatus(i.order_status) === "ordered",
    );
    const pendingItems = items.filter((i) => isPurchasePending(i));
    const nonReceived = items.filter(
      (i) => normalizeOrderStatus(i.order_status) !== "received",
    );

    // Open it (always, read is allowed for shared).
    out.push({
      id: "purchases-open-order",
      label: `Open "${task.name}"`,
      detail: orderSummaryDetail(data, task, items),
      group: PURCHASES_GROUP_SELECTED,
      iconName: "eye",
      run: () => handlers.setSelectedTask(task),
    });

    // Per-item status flips, collapsed to bulk when the order is large.
    if (!many && firstNeedsOrdering) {
      out.push({
        id: "purchases-mark-ordered",
        label: `Mark "${firstNeedsOrdering.item_name}" ordered`,
        detail: writeReason ?? "needs ordering to ordered",
        group: PURCHASES_GROUP_SELECTED,
        iconName: "check",
        enabled: writable,
        run: () =>
          handlers.setItemStatus(firstNeedsOrdering, task, "ordered"),
      });
    }
    if (!many && firstOrdered) {
      out.push({
        id: "purchases-mark-received",
        label: `Mark "${firstOrdered.item_name}" received`,
        detail: writeReason ?? "ordered to received",
        group: PURCHASES_GROUP_SELECTED,
        iconName: "check",
        enabled: writable,
        run: () => handlers.setItemStatus(firstOrdered, task, "received"),
      });
    }
    if (nonReceived.length > 0) {
      out.push({
        id: "purchases-mark-order-received",
        label: "Mark whole order received",
        detail: writeReason ?? `${nonReceived.length} item${
          nonReceived.length === 1 ? "" : "s"
        }`,
        group: PURCHASES_GROUP_SELECTED,
        iconName: "check",
        enabled: writable,
        run: () => {
          for (const it of nonReceived) {
            handlers.setItemStatus(it, task, "received");
          }
        },
      });
    }

    // Approval (lab head only, omit entirely for members, spec 3.1 / 7).
    if (data.isLabHead && pendingItems.length > 0) {
      const canApprove = data.isLabHead && data.hasLiveSession;
      const approveReason = data.hasLiveSession ? undefined : NO_SESSION_REASON;
      const first = pendingItems[0];

      if (!many) {
        out.push({
          id: "purchases-approve-item",
          label: `Approve "${first.item_name}"`,
          detail: approveReason ?? "pending to approved",
          group: PURCHASES_GROUP_APPROVAL,
          iconName: "check",
          enabled: canApprove,
          run: () => handlers.approveItem(first, task),
        });
        out.push({
          id: "purchases-decline-item",
          label: `Decline "${first.item_name}"`,
          detail: approveReason ?? "marks declined",
          group: PURCHASES_GROUP_APPROVAL,
          iconName: "close",
          enabled: canApprove,
          run: () => handlers.declineItem(first, task),
        });
      }
      if (pendingItems.length > 1) {
        out.push({
          id: "purchases-approve-all-in-order",
          label: "Approve all pending in this order",
          detail:
            approveReason ??
            `${pendingItems.length} pending`,
          group: PURCHASES_GROUP_APPROVAL,
          iconName: "check",
          enabled: canApprove,
          run: () => {
            for (const it of pendingItems) handlers.approveItem(it, task);
          },
        });
      }
    }

    // Complete toggle (own orders).
    out.push({
      id: "purchases-toggle-complete",
      label: task.is_complete
        ? `Mark "${task.name}" incomplete`
        : `Mark "${task.name}" complete`,
      detail: writeReason ?? (task.is_complete ? "currently complete" : "currently open"),
      group: PURCHASES_GROUP_SELECTED,
      iconName: "check",
      enabled: writable,
      run: () => handlers.setOrderComplete(task, !task.is_complete),
    });

    // Change project (own orders), an INLINE sub-flow over the move targets +
    // Miscellaneous (BeakerSearch v2 chunk 2). run stays terminal-safe (opens
    // the order) for any caller without the sub-flow framework.
    out.push({
      id: "purchases-change-project",
      label: `Change project of "${task.name}"`,
      detail: writeReason ?? `currently ${data.projectNameOf(task) ?? "no project"}`,
      keywords: "move reassign bucket",
      group: PURCHASES_GROUP_SELECTED,
      iconName: ICON_FUNDING,
      // Gate on having somewhere to move it (a real project or the misc
      // catch-all) so we never open an empty picker. Mirrors set-funding below.
      enabled:
        writable && (data.moveTargets.length > 0 || data.miscProjectId != null),
      run: () => handlers.setSelectedTask(task),
      subflow: () => buildChangeProjectSubflow(task, data, handlers),
    });

    // Set funding account for the order's uncategorized items (own orders), an
    // INLINE sub-flow over the funding accounts. Gated to own orders that have at
    // least one unfunded item AND at least one funding account to choose from.
    const unfunded = uncategorizedItems(items);
    out.push({
      id: "purchases-set-funding",
      label: "Set funding account for items",
      detail: writeReason ?? `${unfunded.length} item${
        unfunded.length === 1 ? "" : "s"
      } unfunded`,
      keywords: "grant award budget categorize",
      group: PURCHASES_GROUP_SELECTED,
      iconName: ICON_FUNDING,
      enabled: writable && unfunded.length > 0 && data.fundingAccounts.length > 0,
      run: () => handlers.setSelectedTask(task),
      subflow: () => buildSetFundingSubflow(task, items, data, handlers),
    });

    // Delete (own orders).
    out.push({
      id: "purchases-delete-order",
      label: `Delete "${task.name}"`,
      detail: writeReason ?? "removes the order and items",
      group: PURCHASES_GROUP_SELECTED,
      iconName: "trash",
      enabled: writable,
      run: () => handlers.deleteOrder(task),
    });
  }

  // ── Awaiting-approval bulk (lab head, that filter active, spec 3.3). ──────
  if (data.categoryFilter === "awaiting_approval" && data.isLabHead) {
    const canApprove = data.hasLiveSession;
    // Every pending item across the visible orders.
    const pendingAcrossPage: { item: PurchaseItem; order: Task }[] = [];
    for (const order of data.sortedTasks) {
      for (const it of itemsFor(data, order)) {
        if (isPurchasePending(it)) pendingAcrossPage.push({ item: it, order });
      }
    }
    if (pendingAcrossPage.length > 0) {
      out.push({
        id: "purchases-approve-all-page",
        label: "Approve all pending (this page)",
        detail: canApprove
          ? `${pendingAcrossPage.length} item${
              pendingAcrossPage.length === 1 ? "" : "s"
            }`
          : NO_SESSION_REASON,
        group: PURCHASES_GROUP_APPROVAL,
        iconName: "check",
        enabled: canApprove,
        run: () => {
          for (const { item, order } of pendingAcrossPage) {
            handlers.approveItem(item, order);
          }
        },
      });
    }
  }

  // ── Create (spec 6). ─────────────────────────────────────────────────────
  out.push({
    id: "purchases-new",
    label: "New purchase",
    detail: "parent order plus first line item",
    group: PURCHASES_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.setShowNewPurchase(true),
  });

  // ── Filters (spec 6). ────────────────────────────────────────────────────
  pushCategoryFilters(out, data, handlers);
  pushOrderStatusFilters(out, data, handlers);

  // ── Funding (spec 6). ────────────────────────────────────────────────────
  out.push({
    id: "purchases-manage-funding",
    label: "Manage funding accounts",
    detail: `${data.fundingAccounts.length} account${
      data.fundingAccounts.length === 1 ? "" : "s"
    }`,
    keywords: "grant award budget",
    group: PURCHASES_GROUP_FUNDING,
    iconName: ICON_FUNDING,
    run: () => handlers.setShowFundingManager(true),
  });
  out.push({
    id: "purchases-new-funding",
    label: "New funding account",
    detail: "opens the manager",
    keywords: "grant award add",
    group: PURCHASES_GROUP_FUNDING,
    iconName: "plus",
    run: () => handlers.setShowFundingManager(true),
  });

  // ── Spending (spec 6). ───────────────────────────────────────────────────
  out.push({
    id: "purchases-open-dashboard",
    label: "Open the spending dashboard",
    detail: "scroll to the breakdown",
    keywords: "report chart total",
    group: PURCHASES_GROUP_SPENDING,
    iconName: "history",
    run: () => handlers.focusDashboard(),
  });
  out.push({
    id: "purchases-export-csv",
    label: "Export current spending (CSV)",
    detail: data.hasExportableItems
      ? "downloads the in-window items"
      : "nothing in the current window",
    keywords: "download report csv",
    group: PURCHASES_GROUP_SPENDING,
    iconName: ICON_EXPORT,
    enabled: data.hasExportableItems,
    run: () => handlers.exportSpendingCsv(),
  });

  // ── Navigate out (lab head, spec 6). ─────────────────────────────────────
  if (data.isLabHead) {
    out.push({
      id: "purchases-open-lab-queue",
      label: "Open the lab approval queue",
      detail:
        data.labPendingApprovalCount > 0
          ? `${data.labPendingApprovalCount} awaiting`
          : "on Lab Overview",
      keywords: "lab overview pending",
      group: PURCHASES_GROUP_ORDER_MGMT,
      iconName: "users",
      run: () => handlers.openLabOverview(),
    });
  }

  return out;
}

/** A "Project Alpha, 4 items, $612.40, 2 need ordering" summary for the open /
 *  nav detail rows (spec 4). */
function orderSummaryDetail(
  data: PurchasesSourceData,
  task: Task,
  items: PurchaseItem[],
): string {
  const project = data.projectNameOf(task);
  const needs = items.filter(
    (i) => normalizeOrderStatus(i.order_status) === "needs_ordering",
  ).length;
  const bits = [
    project,
    `${items.length} item${items.length === 1 ? "" : "s"}`,
    money(orderTotal(items)),
  ].filter(Boolean);
  if (needs > 0) bits.push(`${needs} need ordering`);
  return bits.join(", ");
}

/** The four category-filter rows, the active one shown disabled (already here). */
function pushCategoryFilters(
  out: EditorCommand[],
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): void {
  const rows: { key: PurchaseCategoryFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "project", label: "Project purchases" },
    { key: "misc", label: "Miscellaneous" },
    {
      key: "awaiting_approval",
      label: data.isLabHead ? "Pending approval" : "Awaiting approval",
    },
  ];
  for (const row of rows) {
    const active = data.categoryFilter === row.key;
    out.push({
      id: `purchases-filter-${row.key}`,
      label: `Filter, ${row.label}`,
      detail: active ? "current filter" : undefined,
      keywords: "scope category",
      group: PURCHASES_GROUP_FILTERS,
      iconName: "list",
      enabled: !active,
      run: () => handlers.setCategoryFilter(row.key),
    });
  }
}

/** The four ordering-status rows, the active one shown disabled. */
function pushOrderStatusFilters(
  out: EditorCommand[],
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): void {
  const rows: { key: PurchaseOrderStatusFilter; label: string }[] = [
    { key: "any", label: "Any stage" },
    { key: "needs_ordering", label: PURCHASE_ORDER_STATUS_LABEL.needs_ordering },
    { key: "ordered", label: PURCHASE_ORDER_STATUS_LABEL.ordered },
    { key: "received", label: PURCHASE_ORDER_STATUS_LABEL.received },
  ];
  for (const row of rows) {
    const active = data.orderStatusFilter === row.key;
    out.push({
      id: `purchases-ordering-${row.key}`,
      label: `Ordering, ${row.label}`,
      detail: active ? "current stage" : undefined,
      keywords: "stage status",
      group: PURCHASES_GROUP_FILTERS,
      iconName: "list",
      enabled: !active,
      run: () => handlers.setOrderStatusFilter(row.key),
    });
  }
}

// ── Suggested (spec 3) ──────────────────────────────────────────────────────

/** The ordered ids of the contextually relevant commands. These ids must exist
 *  in buildCommands; ids that are disabled / absent are silently skipped by the
 *  palette. SELECTED / HOVERED first (3.2), then the awaiting-approval set
 *  (3.3), then the nothing-selected set (3.4). */
function buildSuggestedIds(data: PurchasesSourceData): string[] {
  const focus = resolveFocus(data);

  if (focus) {
    const { task, items } = focus;
    const ids: string[] = ["purchases-open-order"];
    const many = items.length > BULK_COLLAPSE_THRESHOLD;
    if (!many) {
      ids.push("purchases-mark-ordered", "purchases-mark-received");
    }
    ids.push("purchases-mark-order-received");
    if (data.isLabHead) {
      if (!many) {
        ids.push("purchases-approve-item", "purchases-decline-item");
      }
      ids.push("purchases-approve-all-in-order");
    }
    ids.push("purchases-toggle-complete");
    if (!task.is_shared_with_me) {
      ids.push(
        "purchases-change-project",
        "purchases-set-funding",
        "purchases-delete-order",
      );
    }
    return ids;
  }

  if (data.categoryFilter === "awaiting_approval" && data.isLabHead) {
    return [
      "purchases-approve-all-page",
      "purchases-open-lab-queue",
      "purchases-filter-all",
    ];
  }

  // Nothing selected, no hover (spec 3.4).
  const ids = [
    "purchases-new",
    "purchases-manage-funding",
    "purchases-export-csv",
    "purchases-open-dashboard",
  ];
  if (data.isLabHead) ids.push("purchases-open-lab-queue");
  return ids;
}

/** The Suggested heading hint (spec 3). */
function buildSuggestedHint(data: PurchasesSourceData): string | undefined {
  const focus = resolveFocus(data);
  if (focus?.hovered) return "for the order under your cursor";
  if (focus) return "for the selected order";
  if (data.categoryFilter === "awaiting_approval" && data.isLabHead) {
    return "for the approval queue";
  }
  return undefined;
}

// ── Navigate (spec 4) ───────────────────────────────────────────────────────

/** Jump to a purchase order (carries the composite key via the task object). */
function orderNavItem(
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
  task: Task,
): PaletteNavItem {
  const items = itemsFor(data, task);
  return {
    id: `purchase-${data.taskKeyOf(task)}`,
    label: task.name,
    detail: orderSummaryDetail(data, task, items),
    keywords: [data.projectNameOf(task) ?? "", task.is_shared_with_me ? `shared ${task.owner}` : ""]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_ORDER,
    tone: "task",
    onRun: () => handlers.setSelectedTask(task),
  };
}

/** Jump to a funding account (opens the manager). `spentAmount` is the live
 *  spend the caller rolled up from line items (funding-rework: no stored field). */
function fundingNavItem(
  handlers: PurchasesSourceHandlers,
  account: FundingAccount,
  spentAmount: number,
): PaletteNavItem {
  const spent = money(spentAmount);
  const budget = money(account.total_budget);
  return {
    id: `funding-${account.id}`,
    label: account.name,
    detail: `${spent} of ${budget} spent`,
    keywords: [
      account.award_number ?? "",
      account.funder_name ?? "",
      account.award_title ?? "",
      "grant award funding",
    ]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_FUNDING,
    tone: "funding",
    onRun: () => handlers.setShowFundingManager(true),
  };
}

/** Build the nav groups (spec 4). Jump to a purchase (on-screen orders first,
 *  task amber tone), then Funding accounts (green tone). When the visible filter
 *  is empty but orders exist, widen the jump list to all orders (spec edge
 *  case). */
function buildNavGroups(
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  const jumpBase =
    data.sortedTasks.length > 0 ? data.sortedTasks : data.purchaseTasks;
  const jumpItems = jumpBase.map((t) => orderNavItem(data, handlers, t));
  if (jumpItems.length > 0) {
    groups.push({
      title: "Jump to a purchase",
      hint: `on screen (${jumpItems.length})`,
      items: jumpItems,
    });
  }

  if (data.fundingAccounts.length > 0) {
    // Live spend per account (funding-rework): rolled up once from every line
    // item the page holds, then read per account below.
    const spendByAccount = computeFundingSpendByAccount(
      data.fundingAccounts,
      Object.values(data.purchasesByTask).flat(),
    );
    groups.push({
      title: "Funding accounts",
      hint: `${data.fundingAccounts.length}`,
      items: data.fundingAccounts.map((a) =>
        fundingNavItem(handlers, a, spendByAccount.get(a.id) ?? 0),
      ),
    });
  }

  return groups;
}

// ── Results (spec 5, the reopenable spending export) ────────────────────────

/** A captured descriptor of a spending export the user ran from the palette, so
 *  it can reopen as a reproducible report (the CSV is cheap to regenerate, only
 *  the scope is kept, spec 5). */
export interface SpendingExportDescriptor {
  /** A stable id for the row (the hook mints one per run). */
  id: string;
  /** Human range, e.g. "last 12 months" / "all time". */
  rangeLabel: string;
  /** Items in the export window at capture time. */
  itemCount: number;
  /** Dollar total of those items. */
  total: number;
}

/** Build the "Recent results" nav group from captured spending exports. Reopen
 *  re-runs the export (spec 5). Omitted when there is nothing recent. */
function buildResultsGroup(
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
  recentExports: SpendingExportDescriptor[],
): PaletteNavGroup | null {
  if (recentExports.length === 0) return null;
  void data;
  return {
    title: "Recent results",
    items: recentExports.map((exp) => ({
      id: `spending-export-${exp.id}`,
      label: "Spending export",
      detail: `${exp.rangeLabel}, ${exp.itemCount} item${
        exp.itemCount === 1 ? "" : "s"
      }, ${money(exp.total)}`,
      keywords: "csv download report reopen",
      iconName: ICON_EXPORT,
      onRun: () => handlers.exportSpendingCsv(),
    })),
  };
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Build the whole Purchases BeakerSearch source from a pure state snapshot
 *  plus the captured recent spending exports (spec 5). */
export function buildPurchasesSource(
  data: PurchasesSourceData,
  handlers: PurchasesSourceHandlers,
  recentExports: SpendingExportDescriptor[] = [],
): BeakerSearchSource {
  const navGroups = buildNavGroups(data, handlers);
  const resultsGroup = buildResultsGroup(data, handlers, recentExports);
  if (resultsGroup) navGroups.push(resultsGroup);

  return {
    id: "purchases",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups,
  };
}

// Re-export so the hook / tests can name the icon type without re-deriving it.
export type { IconName };

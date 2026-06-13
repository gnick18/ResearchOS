// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 6: interaction parity
// (section 4.6 + 8). The audit found Inventory / Supplies had NO BeakerSearch
// source and NO right-click menu while Purchases had both; this module is the
// PURE builder that closes the palette half of that gap.
//
// It mirrors purchases-beaker-source.ts: a side-effect-free builder that takes a
// plain snapshot of the Supplies page state (the unified Supply list, the visible
// window, the active filter, the selection / hover, the role + the PI edit-gate)
// plus a bag of handler callbacks, and returns one BeakerSearchSource (context
// card + commands with stable ids + page-defined groups + suggested ids + nav
// groups). It reads NO store, holds NO React, and calls NO Date.now(), so the
// card copy, the command ids / groups / enabled gating, the Suggested ordering,
// and the inline set-status sub-flow are all unit-tested without rendering. The
// thin useSuppliesBeakerSource hook (co-located) wires the live queries + store +
// handlers into this builder inside a useMemo.
//
// The "Supply" is the identity-keyed view-layer union (see supply-model.ts), so a
// command's scope is a Supply, not a raw InventoryItem or PurchaseItem. The
// lab-head approve / decline rows act on the supply's first open purchase line
// (its ordering side), reusing the same PI edit-confirm substitution the
// purchases source documents (hasLiveSession = the lab head crossed the PI
// edit-confirm for that line's owner this session).
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
  type InventoryStockStatus,
  type PurchaseItem,
} from "@/lib/types";
import type { Supply } from "@/lib/supplies/supply-model";

// ── The filter union (mirrored from the page so the builder stays pure) ───────
export type SupplyFilter =
  | "all"
  | "attention"
  | "onorder"
  | "awaiting_approval"
  // Lab-head-only: the lab-wide inventory browse, every member's items grouped
  // by owner (RS-4). Like awaiting_approval it is not a seedable deep-link.
  | "lab_inventory";

// ── Page-defined command groups ──────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const SUPPLIES_GROUP_SELECTED = "Selected supply";
export const SUPPLIES_GROUP_CREATE = "Create";
export const SUPPLIES_GROUP_APPROVAL = "Approval";
export const SUPPLIES_GROUP_FILTERS = "Filters";
export const SUPPLIES_GROUP_TOOLS = "Tools";
export const SUPPLIES_GROUP_SPENDING = "Spending";

// The registry has no "supply" glyph (icon-guard blocks new inline svg), so reuse
// registered glyphs. "box" reads as a supply / package, "refresh" is reorder /
// cycle, "check" a status flip / approve, "close" a decline, "eye" open / view.
const ICON_SUPPLY: IconName = "box";
const ICON_REORDER: IconName = "refresh";

// The one-tap stock statuses (mirrors TAPPABLE_STATUSES + STATUS_LABEL in
// inventory-ui). Inlined here so the pure builder + its test never import the
// inventory UI module. "expired" is derived from the expiry date, not a manual
// tap, so it is intentionally absent.
const STATUS_OPTIONS: { status: InventoryStockStatus; label: string }[] = [
  { status: "in_stock", label: "In stock" },
  { status: "low", label: "Low" },
  { status: "empty", label: "Empty" },
];

// ── The plain state snapshot the builder reads ───────────────────────────────
export interface SuppliesSourceData {
  /** The full unified Supply list (every identity-keyed supply, own + shared). */
  supplies: Supply[];
  /** The on-screen (filtered + searched + sorted) window the page renders. */
  visible: Supply[];
  /** Live counts for the filter chips + the context card scope line. */
  counts: { all: number; attention: number; onorder: number };

  // ACTIVE filter.
  filter: SupplyFilter;

  // SELECTED / HOVERED.
  selectedSupply: Supply | null;
  /** The hovered supply, resolved by the hook from the provider's
   *  [data-beaker-target] key (null when nothing is hovered or a selection
   *  wins). SELECTED beats HOVERED. */
  hoveredSupply: Supply | null;

  // Role + the edit gate (see the file header for the session substitution).
  currentUser: string;
  isLabHead: boolean;
  /** True when the lab head has crossed the PI edit-confirm for the focused
   *  supply's first open line owner so approve / decline may write. Always false
   *  for a member (the rows are omitted for members anyway). */
  hasLiveSession: boolean;
  /** Lab-wide pending-approval count (lab head only, 0 for members), drives the
   *  context-card role chip + the awaiting-approval suggested set. */
  labPendingApprovalCount: number;

  // Pre-computed display helpers the builder must not derive itself.
  /** The category display label for a category enum (the page's categoryLabel). */
  categoryLabelOf: (category: string | null) => string;
  /** Whether the current user may edit a supply's backing item (whole-lab-edit
   *  sharing carries over from inventory). Gates set-status. */
  canEdit: (supply: Supply) => boolean;
  /** Whether a supply is already in the reorder cart (gates / softens reorder). */
  isInCart: (key: string) => boolean;
}

// ── The handler bag (closures over the page's real handlers + invalidations) ──
export interface SuppliesSourceHandlers {
  // Selection / open.
  setSelectedKey: (key: string | null) => void;

  // Create + tools.
  openAddItem: () => void;
  openScan: () => void;
  openImport: () => void;

  // Reorder (-> the chunk-4 draft-order cart).
  reorderSupply: (supply: Supply) => void;

  // Filters.
  setFilter: (filter: SupplyFilter) => void;

  // Set the status of a supply's single on-hand stock (the inline sub-flow
  // completion). The hook resolves the lone stock + routes the owner write.
  setStockStatus: (supply: Supply, status: InventoryStockStatus) => void;

  // Approval (lab head + confirmed only), acting on a supply's open line.
  approveLine: (line: PurchaseItem) => void;
  declineLine: (line: PurchaseItem) => void;

  // Lab-head spending drawer.
  openSpending: () => void;
}

/** The supply the builder treats as the strongest context (SELECTED beats
 *  HOVERED), with a flag so the card line + Suggested hint can soften for a
 *  hover. Null when nothing is in focus. */
function resolveFocus(
  data: SuppliesSourceData,
): { supply: Supply; hovered: boolean } | null {
  if (data.selectedSupply) return { supply: data.selectedSupply, hovered: false };
  if (data.hoveredSupply) return { supply: data.hoveredSupply, hovered: true };
  return null;
}

/** The first open purchase line of a supply that is still awaiting approval, or
 *  null. Drives the lab-head approve / decline rows. */
function firstPendingLine(supply: Supply): PurchaseItem | null {
  if (!supply.ordering) return null;
  return supply.ordering.openLines.find((p) => isPurchasePending(p)) ?? null;
}

/** A short on-hand + on-order summary for a supply ("3 on hand, on order"). */
function supplySummary(supply: Supply): string {
  const bits: string[] = [];
  if (supply.onHand) {
    bits.push(`${supply.onHand.totalCount} on hand`);
  }
  if (supply.ordering) {
    bits.push(
      supply.ordering.needsOrderingCount > 0 ? "needs ordering" : "on order",
    );
  }
  if (bits.length === 0) return "no stock or orders";
  return bits.join(", ");
}

// ── Context card ─────────────────────────────────────────────────────────────

/** The human label for a filter scope. */
function filterScopeLabel(filter: SupplyFilter, isLabHead: boolean): string {
  switch (filter) {
    case "attention":
      return "needs attention";
    case "onorder":
      return "on order";
    case "awaiting_approval":
      return isLabHead ? "pending approval" : "awaiting approval";
    case "all":
    default:
      return "all";
  }
}

/** Line 1, the scope + snapshot. A purely-unfiltered card mirrors the page count
 *  ("18 supplies"); a filtered card leads with the filter scope + the window. */
function buildScopeMeta(data: SuppliesSourceData): string {
  if (data.counts.all === 0) return "no supplies yet";
  if (data.filter === "all") {
    const n = data.counts.all;
    return `${n} suppl${n === 1 ? "y" : "ies"}`;
  }
  const shown = data.visible.length;
  return `${filterScopeLabel(data.filter, data.isLabHead)}, ${shown} shown`;
}

function buildContextCard(data: SuppliesSourceData): PaletteContextCard {
  const focus = resolveFocus(data);

  let selection: PaletteContextCard["selection"];
  if (focus) {
    const { supply, hovered } = focus;
    if (hovered) {
      selection = {
        iconName: ICON_SUPPLY,
        text: `Pointing at "${supply.identity.name}"`,
      };
    } else {
      selection = {
        iconName: ICON_SUPPLY,
        text: `Selected, "${supply.identity.name}", ${supplySummary(supply)}`,
      };
    }
  }

  // Role chip (lab head + non-empty queue only).
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
    iconName: ICON_SUPPLY,
    title: "Supplies",
    meta: buildScopeMeta(data),
    chips: chips.length > 0 ? chips : undefined,
    selection,
  };
}

// ── The inline set-status sub-flow ───────────────────────────────────────────

/** The INLINE set-status flow (single stage). Items are the three tappable
 *  statuses; picking one calls setStockStatus(supply, status) then COMPLETES
 *  (onPick returns void). Single stage, so the framework renders it inline under
 *  the command row (mirrors the Purchases change-project proof). */
function buildSetStatusSubflow(
  supply: Supply,
  handlers: SuppliesSourceHandlers,
): PaletteSubflow {
  const current = supply.onHand?.worstStatus;
  return {
    title: `Set stock status of "${supply.identity.name}"`,
    placeholder: "Pick a status",
    items: STATUS_OPTIONS.map((opt) => ({
      id: `status-${opt.status}`,
      label: opt.label,
      detail: opt.status === current ? "current status" : undefined,
      iconName: "check",
      enabled: opt.status !== current,
      onRun: () => {},
    })),
    onPick: (item) => {
      const chosen = STATUS_OPTIONS.find((o) => `status-${o.status}` === item.id);
      if (chosen) handlers.setStockStatus(supply, chosen.status);
    },
  };
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** The greyed-reorder reason when the supply is already in the cart. */
const IN_CART_REASON = "already in the reorder cart";
/** The greyed set-status reason when there is not exactly one stock to act on. */
const STATUS_AMBIGUOUS_REASON = "open the supply to set a specific stock";
/** The greyed set-status reason when the backing item is not editable. */
const STATUS_READONLY_REASON = "you cannot edit this supply";
/** The greyed-approve reason when a lab head has not confirmed the edit gate. */
const NO_SESSION_REASON = "Confirm 'Edit as lab head' on the line to approve";

function buildCommands(
  data: SuppliesSourceData,
  handlers: SuppliesSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  const focus = resolveFocus(data);

  // ── Selected / hovered supply actions. ───────────────────────────────────
  if (focus) {
    const { supply } = focus;
    const writable = data.canEdit(supply);
    const inCart = data.isInCart(supply.key);

    // Open it (always, read is allowed).
    out.push({
      id: "supplies-open-supply",
      label: `Open "${supply.identity.name}"`,
      detail: supplySummary(supply),
      group: SUPPLIES_GROUP_SELECTED,
      iconName: "eye",
      run: () => handlers.setSelectedKey(supply.key),
    });

    // Reorder (-> the cart). Softened (not blocked) when already in the cart.
    out.push({
      id: "supplies-reorder",
      label: `Reorder "${supply.identity.name}"`,
      detail: inCart ? IN_CART_REASON : reorderDetail(supply),
      keywords: "buy purchase order cart restock",
      group: SUPPLIES_GROUP_SELECTED,
      iconName: ICON_REORDER,
      enabled: !inCart,
      run: () => handlers.reorderSupply(supply),
    });

    // Set stock status, an INLINE sub-flow over the three tappable statuses.
    // Gated to a supply with exactly one on-hand stock (unambiguous target) that
    // the user can edit; otherwise greyed with the reason.
    const stockCount = supply.onHand?.stockCount ?? 0;
    const statusEnabled = writable && stockCount === 1;
    out.push({
      id: "supplies-set-status",
      label: "Set stock status",
      detail: !writable
        ? STATUS_READONLY_REASON
        : stockCount === 1
          ? "in stock / low / empty"
          : STATUS_AMBIGUOUS_REASON,
      keywords: "low empty in stock mark",
      group: SUPPLIES_GROUP_SELECTED,
      iconName: "check",
      enabled: statusEnabled,
      run: () => handlers.setSelectedKey(supply.key),
      subflow: () => buildSetStatusSubflow(supply, handlers),
    });

    // Approval (lab head only, omit entirely for members), acting on the
    // supply's first open line that is still pending.
    const line = firstPendingLine(supply);
    if (data.isLabHead && line) {
      const canApprove = data.hasLiveSession;
      const approveReason = canApprove ? undefined : NO_SESSION_REASON;
      out.push({
        id: "supplies-approve-line",
        label: `Approve "${line.item_name}"`,
        detail: approveReason ?? "pending to approved",
        group: SUPPLIES_GROUP_APPROVAL,
        iconName: "check",
        enabled: canApprove,
        run: () => handlers.approveLine(line),
      });
      out.push({
        id: "supplies-decline-line",
        label: `Decline "${line.item_name}"`,
        detail: approveReason ?? "marks declined",
        group: SUPPLIES_GROUP_APPROVAL,
        iconName: "close",
        enabled: canApprove,
        run: () => handlers.declineLine(line),
      });
    }
  }

  // ── Create. ──────────────────────────────────────────────────────────────
  out.push({
    id: "supplies-add",
    label: "Add supply",
    detail: "a new inventory item",
    keywords: "new item reagent create",
    group: SUPPLIES_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.openAddItem(),
  });

  // ── Filters. ─────────────────────────────────────────────────────────────
  pushFilters(out, data, handlers);

  // ── Tools (scan + import). ───────────────────────────────────────────────
  out.push({
    id: "supplies-scan",
    label: "Scan a barcode",
    detail: "identify a supply by its code",
    keywords: "barcode camera qr",
    group: SUPPLIES_GROUP_TOOLS,
    iconName: "scan",
    run: () => handlers.openScan(),
  });
  out.push({
    id: "supplies-import",
    label: "Import supplies",
    detail: "from a spreadsheet",
    keywords: "spreadsheet csv excel bulk",
    group: SUPPLIES_GROUP_TOOLS,
    iconName: "import",
    run: () => handlers.openImport(),
  });

  // ── Spending (lab head only). ────────────────────────────────────────────
  if (data.isLabHead) {
    out.push({
      id: "supplies-open-spending",
      label: "View spending",
      detail: "the lab spending drawer",
      keywords: "report chart total budget dashboard",
      group: SUPPLIES_GROUP_SPENDING,
      iconName: "eye",
      run: () => handlers.openSpending(),
    });
  }

  return out;
}

/** "Reorder (1 left, low at 2)" style detail when the on-hand gap is known
 *  (decision 4.4, reorder informed by on-hand), else a plain hint. */
function reorderDetail(supply: Supply): string {
  if (supply.onHand) {
    return `${supply.onHand.totalCount} on hand, adds to the cart`;
  }
  return "adds to the reorder cart";
}

/** The filter rows, the active one shown disabled. The lab-head-only
 *  awaiting-approval lens row is appended for a lab head. */
function pushFilters(
  out: EditorCommand[],
  data: SuppliesSourceData,
  handlers: SuppliesSourceHandlers,
): void {
  const rows: { key: SupplyFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "attention", label: "Needs attention" },
    { key: "onorder", label: "On order" },
  ];
  if (data.isLabHead) {
    rows.push({ key: "awaiting_approval", label: "Awaiting approval" });
  }
  for (const row of rows) {
    const active = data.filter === row.key;
    out.push({
      id: `supplies-filter-${row.key}`,
      label: `Filter, ${row.label}`,
      detail: active ? "current filter" : undefined,
      keywords: "scope show",
      group: SUPPLIES_GROUP_FILTERS,
      iconName: "list",
      enabled: !active,
      run: () => handlers.setFilter(row.key),
    });
  }
}

// ── Suggested ────────────────────────────────────────────────────────────────

/** The ordered ids of the contextually relevant commands. Ids that are disabled
 *  or absent are silently skipped by the palette, so the rule can be generous.
 *  SELECTED / HOVERED first, then the awaiting-approval lens, then the
 *  nothing-selected set. */
function buildSuggestedIds(data: SuppliesSourceData): string[] {
  const focus = resolveFocus(data);
  if (focus) {
    const ids = ["supplies-open-supply", "supplies-reorder", "supplies-set-status"];
    if (data.isLabHead && firstPendingLine(focus.supply)) {
      ids.push("supplies-approve-line", "supplies-decline-line");
    }
    return ids;
  }

  if (data.filter === "awaiting_approval" && data.isLabHead) {
    return ["supplies-filter-all", "supplies-open-spending"];
  }

  const ids = ["supplies-add", "supplies-scan", "supplies-import"];
  if (data.isLabHead) ids.push("supplies-open-spending");
  return ids;
}

/** The Suggested heading hint. */
function buildSuggestedHint(data: SuppliesSourceData): string | undefined {
  const focus = resolveFocus(data);
  if (focus?.hovered) return "for the supply under your cursor";
  if (focus) return "for the selected supply";
  if (data.filter === "awaiting_approval" && data.isLabHead) {
    return "for the approval queue";
  }
  return undefined;
}

// ── Navigate ─────────────────────────────────────────────────────────────────

/** Jump to a supply (carries the identity key). */
function supplyNavItem(
  data: SuppliesSourceData,
  handlers: SuppliesSourceHandlers,
  supply: Supply,
): PaletteNavItem {
  const metaBits = [
    data.categoryLabelOf(supply.identity.category),
    supply.identity.vendor,
    supply.identity.catalogNumber,
  ].filter((p) => p && String(p).trim());
  return {
    id: `supply-${supply.key}`,
    label: supply.identity.name,
    detail: supplySummary(supply),
    keywords: [...metaBits, supply.identity.cas ?? ""].filter(Boolean).join(" "),
    iconName: "vial",
    tone: "inventory",
    onRun: () => handlers.setSelectedKey(supply.key),
  };
}

/** Build the nav groups. Jump to a supply (on-screen supplies first; widen to
 *  all when the visible window is empty but supplies exist). */
function buildNavGroups(
  data: SuppliesSourceData,
  handlers: SuppliesSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];
  const jumpBase = data.visible.length > 0 ? data.visible : data.supplies;
  const jumpItems = jumpBase.map((s) => supplyNavItem(data, handlers, s));
  if (jumpItems.length > 0) {
    groups.push({
      title: "Jump to a supply",
      hint: `on screen (${jumpItems.length})`,
      items: jumpItems,
    });
  }
  return groups;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Build the whole Supplies BeakerSearch source from a pure state snapshot. */
export function buildSuppliesSource(
  data: SuppliesSourceData,
  handlers: SuppliesSourceHandlers,
): BeakerSearchSource {
  return {
    id: "supplies",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
  };
}

// Re-export so the hook / tests can name the icon type without re-deriving it.
export type { IconName };

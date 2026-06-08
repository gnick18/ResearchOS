// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 6: the thin HOOK that
// wires the live Supplies page state + handlers into the pure buildSuppliesSource
// builder and registers the result with the shared BeakerSearch palette.
//
// All the testable logic lives in supplies-beaker-source.ts (no React, no store).
// This hook reads the role + the PI edit-gate confirm state, resolves the hovered
// supply from the provider's [data-beaker-target] key, closes the handler bag over
// the real inventoryStocksApi / pi-actions calls + the queryClient invalidations,
// and threads the page-owned UI state (the unified Supply list, the visible
// window, the active filter, the selection, the create / scan / import / spending
// openers, and the reorder-to-cart action) in as args, mirroring
// usePurchasesBeakerSource. It calls buildSuppliesSource inside a useMemo so the
// registration object is stable, then useBeakerSearchSource.
//
// The session substitution (the spec's "live PI edit session" does not exist on
// this worktree, replaced by the per-record PI edit-confirm gate) matches the
// Purchases source. Here `hasLiveSession` for the FOCUSED supply is "the lab head
// already confirmed editing the first open line's owner this session"; the
// approve / decline handlers mark that confirm before writing.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { inventoryStocksApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { setPurchaseApproval, declinePurchase } from "@/lib/lab/pi-actions";
import {
  isPiEditConfirmed,
  markPiEditConfirmed,
  piEditKey,
} from "@/lib/lab/pi-edit-guard";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import { useBeakerHoveredKey } from "@/components/beaker-search/BeakerSearchProvider";
import { parseBeakerTargetKey } from "@/components/beaker-search/beaker-hover";
import { normalizeSharedWith, WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import {
  isPurchasePending,
  type InventoryItem,
  type InventoryStock,
  type InventoryStockStatus,
  type PurchaseItem,
} from "@/lib/types";
import type { Supply } from "@/lib/supplies/supply-model";
import {
  buildSuppliesSource,
  type SupplyFilter,
  type SuppliesSourceData,
  type SuppliesSourceHandlers,
} from "./supplies-beaker-source";

// The `data-beaker-target` kind prefix the supply rows carry (page.tsx tags each
// row `supply:${supply.key}`). The hook parses the provider's last-hovered key,
// matches this kind, and resolves the rest (the identity key, which itself may
// contain colons, e.g. "vc:neb|m0491s") back to the supply. Keep in lockstep
// with the page's attribute. parseBeakerTargetKey splits on the FIRST colon, so
// the kind is "supply" and the key is everything after it.
const SUPPLY_HOVER_KIND = "supply";

/** Whole-lab-edit sharing carries over from inventory. Mirrors the local
 *  canEditItem in SupplyDetailPanel (not exported, so re-stated here). */
function canEditItem(item: InventoryItem, currentUser: string | null): boolean {
  if (!currentUser) return false;
  if (item.owner === currentUser) return true;
  return normalizeSharedWith(item.shared_with).some(
    (s) =>
      (s.username === currentUser || s.username === WHOLE_LAB_SENTINEL) &&
      s.level === "edit",
  );
}

/** Owner to route a stock write into (the owner's folder for a shared-into-me
 *  record, else the cheap current-user path). Mirrors SupplyDetailPanel. */
function effectiveOwnerOf(
  item: InventoryItem,
  currentUser: string | null,
): string | undefined {
  return item.is_shared_with_me && item.owner !== currentUser
    ? item.owner
    : undefined;
}

/** Read the owner the loader decorated onto a purchase line. supply-model types
 *  openLines as plain PurchaseItem[], but the records come from
 *  listAllIncludingShared (PurchaseItem & { owner }), so the live object carries
 *  it. Falls back to the current user for an own (undecorated) line. */
function ownerOfLine(line: PurchaseItem, currentUser: string): string {
  return (line as PurchaseItem & { owner?: string }).owner ?? currentUser;
}

/** The page-owned UI state + setters + data the source drives. SuppliesPage
 *  threads these in (they live in its useState / useMemo), mirroring
 *  usePurchasesBeakerSource. */
export interface UseSuppliesBeakerSourceArgs {
  /** The full unified Supply list (buildSupplies output). */
  supplies: Supply[];
  /** The on-screen filtered window the page renders. */
  visible: Supply[];
  /** Live filter-chip counts. */
  counts: { all: number; attention: number; onorder: number };
  /** All loaded inventory items + stocks, for stock resolution + edit checks. */
  items: InventoryItem[];
  stocks: InventoryStock[];
  /** Lab-wide pending-approval count (the page already computes it). */
  pendingApprovalCount: number;
  /** The category display label (the page's categoryLabel). */
  categoryLabelOf: (category: string | null) => string;

  filter: SupplyFilter;
  setFilter: (filter: SupplyFilter) => void;
  selectedKey: string | null;
  setSelectedKey: (key: string | null) => void;

  /** Whether a supply key is already in the reorder cart. */
  isInCart: (key: string) => boolean;
  /** Add a supply to the reorder cart (the page's addToCart). */
  reorderSupply: (supply: Supply) => void;

  openAddItem: () => void;
  openScan: () => void;
  openImport: () => void;
  openSpending: () => void;
}

/** Register the Supplies page's BeakerSearch source while the page is mounted.
 *  Call once from app/supplies/page.tsx after the existing reads. */
export function useSuppliesBeakerSource(args: UseSuppliesBeakerSourceArgs): void {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const isLabHead = useIsLabHead(currentUser || null) === true;

  // HOVERED context. The shared provider snapshots the `data-beaker-target` key
  // of the last tagged element hovered before the palette opened. The supply rows
  // tag themselves `supply:${supply.key}`, so we read that snapshot and resolve
  // it below (SELECTED still outranks HOVERED).
  const hoveredKey = useBeakerHoveredKey();

  const itemsById = useMemo(() => {
    const m = new Map<number, InventoryItem>();
    for (const it of args.items) m.set(it.id, it);
    return m;
  }, [args.items]);

  const selectedSupply = useMemo(
    () =>
      args.selectedKey == null
        ? null
        : args.supplies.find((s) => s.key === args.selectedKey) ?? null,
    [args.selectedKey, args.supplies],
  );

  const hoveredSupply = useMemo<Supply | null>(() => {
    if (args.selectedKey != null) return null;
    const parsed = parseBeakerTargetKey(hoveredKey);
    if (!parsed || parsed.kind !== SUPPLY_HOVER_KIND) return null;
    return args.supplies.find((s) => s.key === parsed.key) ?? null;
  }, [args.selectedKey, hoveredKey, args.supplies]);

  // The focused supply's first open line + its owner drive the PI edit-confirm
  // gate (the session substitution). hasLiveSession = already confirmed for that
  // line this session.
  const focusedSupply = selectedSupply ?? hoveredSupply;
  const hasLiveSession = useMemo(() => {
    if (!isLabHead || !focusedSupply?.ordering) return false;
    const line = focusedSupply.ordering.openLines.find((p) => isPurchasePending(p));
    if (!line) return false;
    return isPiEditConfirmed(
      piEditKey(ownerOfLine(line, currentUser), "purchase", line.id),
    );
  }, [isLabHead, focusedSupply, currentUser]);

  const canEditSupply = useCallback(
    (supply: Supply): boolean => {
      if (!supply.onHand) return false;
      const backing = itemsById.get(supply.onHand.itemIds[0]);
      return backing ? canEditItem(backing, currentUser) : false;
    },
    [itemsById, currentUser],
  );

  // ── Handlers (real apis + invalidations). ────────────────────────────────
  const refetchInventory = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: ["inventory-items"] });
    void queryClient.refetchQueries({ queryKey: ["inventory-stocks"] });
  }, [queryClient]);

  const handlers = useMemo<SuppliesSourceHandlers>(() => {
    return {
      setSelectedKey: args.setSelectedKey,
      openAddItem: args.openAddItem,
      openScan: args.openScan,
      openImport: args.openImport,
      openSpending: args.openSpending,
      reorderSupply: args.reorderSupply,
      setFilter: args.setFilter,

      setStockStatus: (supply: Supply, status: InventoryStockStatus) => {
        if (!supply.onHand) return;
        const stockList = args.stocks.filter((st) =>
          supply.onHand!.itemIds.includes(st.item_id),
        );
        // The builder gates this command to a single-stock supply; bail
        // defensively if that ever drifts so we never write the wrong stock.
        if (stockList.length !== 1) return;
        const stock = stockList[0];
        const stItem = itemsById.get(stock.item_id);
        void inventoryStocksApi
          .update(stock.id, { status }, stItem ? effectiveOwnerOf(stItem, currentUser) : undefined)
          .then(() => refetchInventory());
      },

      approveLine: (line: PurchaseItem) => {
        const owner = ownerOfLine(line, currentUser);
        // The first approve IS the PI edit-confirm for this line's owner.
        markPiEditConfirmed(piEditKey(owner, "purchase", line.id));
        void setPurchaseApproval({
          actor: currentUser,
          targetOwner: owner,
          purchaseItemId: line.id,
          approved: true,
          itemName: line.item_name,
        }).then(() => {
          void queryClient.refetchQueries({ queryKey: ["lab", "purchase-items"] });
          void queryClient.refetchQueries({ queryKey: ["purchases-all"] });
        });
      },
      declineLine: (line: PurchaseItem) => {
        const owner = ownerOfLine(line, currentUser);
        markPiEditConfirmed(piEditKey(owner, "purchase", line.id));
        void declinePurchase({
          actor: currentUser,
          targetOwner: owner,
          purchaseItemId: line.id,
          itemName: line.item_name,
        }).then(() => {
          void queryClient.refetchQueries({ queryKey: ["lab", "purchase-items"] });
          void queryClient.refetchQueries({ queryKey: ["purchases-all"] });
        });
      },
    };
  }, [args, currentUser, itemsById, queryClient, refetchInventory]);

  const source = useMemo(() => {
    const data: SuppliesSourceData = {
      supplies: args.supplies,
      visible: args.visible,
      counts: args.counts,
      filter: args.filter,
      selectedSupply,
      hoveredSupply,
      currentUser,
      isLabHead,
      hasLiveSession,
      labPendingApprovalCount: isLabHead ? args.pendingApprovalCount : 0,
      categoryLabelOf: args.categoryLabelOf,
      canEdit: canEditSupply,
      isInCart: args.isInCart,
    };
    return buildSuppliesSource(data, handlers);
  }, [
    args.supplies,
    args.visible,
    args.counts,
    args.filter,
    args.pendingApprovalCount,
    args.categoryLabelOf,
    args.isInCart,
    selectedSupply,
    hoveredSupply,
    currentUser,
    isLabHead,
    hasLiveSession,
    canEditSupply,
    handlers,
  ]);

  useBeakerSearchSource(source);
}

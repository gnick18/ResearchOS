"use client";

// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 5: the lab-head
// "Orders & approvals" lens.
//
// The default /supplies view is per-Supply (one row per physical thing). This
// lens is the lab head's counter-view: it drops out of the per-supply framing
// and groups the pending-approval purchase lines ORDER-BY-ORDER (decision 4.2),
// so the PI works the queue the way they submit it (one order, one owner, one
// funding context). It reuses the existing approval machinery wholesale: the
// PurchaseApprovalToggle / FlagForReviewButton controls and the
// pi-actions.declinePurchase writer, the same surfaces /purchases and
// PurchaseEditor already use. Members never see this lens (the page gates the
// chip on isLabHead); it renders only when the lab-head "Awaiting approval"
// filter is active.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, Tooltip on
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  PurchaseApprovalToggle,
  PurchaseApprovalBadge,
  PurchaseDeclinedBadge,
} from "@/components/lab-head/PurchaseApprovalControls";
import FlagForReviewButton from "@/components/lab-head/FlagForReviewButton";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { declinePurchase } from "@/lib/lab/pi-actions";
import type { LabTask } from "@/lib/local-api";
import type { PurchaseItem } from "@/lib/types";

/** A lab-wide purchase item carries the owner username (labApi.getAllPurchaseItems). */
export type LabPurchaseItem = PurchaseItem & { username: string };

/**
 * The pending-approval predicate, shared with the page so the chip count and
 * the rendered queue can never diverge. An item is pending when the lab head
 * has not approved it yet (declined items remain pending so the PI can revisit
 * and re-approve). Mirrors the `!p.approved` test the /purchases awaiting chip
 * uses, so the two surfaces agree on the count.
 */
export function isPendingApproval(item: PurchaseItem): boolean {
  return !item.approved;
}

interface OrderGroup {
  key: string;
  owner: string;
  taskId: number;
  taskName: string;
  items: LabPurchaseItem[];
}

interface OrdersApprovalsLensProps {
  /** Lab-wide purchase items (labApi.getAllPurchaseItems), already loaded. */
  items: LabPurchaseItem[];
  /** Lab-wide tasks (labApi.getTasks) for resolving order names. */
  tasks: LabTask[];
  /** The lab head's username (audit actor). */
  actor: string;
  /** Fires after any approve / decline / flag write so the page can refetch
   *  the lab purchase items (and the chip count with them). */
  onChanged: () => void;
}

export default function OrdersApprovalsLens({
  items,
  tasks,
  actor,
  onChanged,
}: OrdersApprovalsLensProps) {
  const profileMap = useLabUserProfileMap();

  const taskNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(`${t.username}:${t.id}`, t.name);
    return m;
  }, [tasks]);

  // Group the pending lines by order (composite owner:task_id key, the same
  // per-user-id-collision-safe key the rest of the app uses). Orders sort by
  // owner then task id so a PI's queue is stable across refetches.
  const groups = useMemo(() => {
    const byKey = new Map<string, OrderGroup>();
    for (const item of items) {
      if (!isPendingApproval(item)) continue;
      const key = `${item.username}:${item.task_id}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          owner: item.username,
          taskId: item.task_id,
          taskName: taskNameByKey.get(key) ?? `Order #${item.task_id}`,
          items: [],
        };
        byKey.set(key, g);
      }
      g.items.push(item);
    }
    return [...byKey.values()].sort((a, b) => {
      if (a.owner !== b.owner) return a.owner.localeCompare(b.owner);
      return a.taskId - b.taskId;
    });
  }, [items, taskNameByKey]);

  if (groups.length === 0) {
    return (
      <p className="py-12 text-center text-body text-foreground-muted">
        Nothing is awaiting your approval right now.
      </p>
    );
  }

  return (
    <ul className="space-y-3" data-testid="orders-approvals-lens">
      {groups.map((g) => {
        const ownerLabel =
          profileMap[g.owner]?.displayName?.trim() || g.owner;
        const orderTotal = g.items.reduce(
          (sum, i) => sum + (i.total_price ?? 0),
          0,
        );
        return (
          <li
            key={g.key}
            className="overflow-hidden rounded-xl border border-border bg-surface-raised"
            data-testid="approval-order-group"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-sunken/50 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-body font-semibold text-foreground">
                  {g.taskName}
                </div>
                <div className="truncate text-meta text-foreground-muted">
                  {ownerLabel} · {g.items.length} item
                  {g.items.length === 1 ? "" : "s"} awaiting approval
                </div>
              </div>
              <span className="flex-none text-body font-semibold text-foreground">
                ${orderTotal.toFixed(2)}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {g.items.map((item) => (
                <ApprovalRow
                  key={`${g.owner}:${item.id}`}
                  item={item}
                  actor={actor}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function ApprovalRow({
  item,
  actor,
  onChanged,
}: {
  item: LabPurchaseItem;
  actor: string;
  onChanged: () => void;
}) {
  const lineTotal = item.total_price ?? 0;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-foreground">
          {item.item_name}
        </div>
        <div className="truncate text-meta text-foreground-muted">
          {[
            item.quantity ? `qty ${item.quantity}` : null,
            item.vendor || null,
            lineTotal ? `$${lineTotal.toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
        {item.approved ? <PurchaseApprovalBadge item={item} /> : null}
        {!item.approved && item.declined_at ? (
          <PurchaseDeclinedBadge item={item} />
        ) : null}
        <PurchaseApprovalToggle
          item={item}
          actor={actor}
          targetOwner={item.username}
          onChanged={onChanged}
        />
        <DeclinePurchaseButton
          item={item}
          actor={actor}
          onChanged={onChanged}
        />
        <FlagForReviewButton
          recordType="purchase_item"
          recordId={item.id}
          recordName={item.item_name}
          targetOwner={item.username}
          actor={actor}
          currentFlag={item.flagged ?? null}
          onFlagged={() => onChanged()}
        />
      </div>
    </li>
  );
}

/**
 * Small "Decline" control wired to pi-actions.declinePurchase. There is no
 * shared decline button today (PurchaseEditor only exposes approve + flag), so
 * this is the minimal sibling to PurchaseApprovalToggle, handling the same
 * PiActionResult envelope. Declining stamps declined_at / declined_by, clears
 * approval, emits an audit entry, and (per pi-actions) does not notify the
 * owner.
 */
function DeclinePurchaseButton({
  item,
  actor,
  onChanged,
}: {
  item: LabPurchaseItem;
  actor: string;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  // inFlightRef guards against rapid double-clicks that fire before React
  // re-renders with busy=true (ref mutation is synchronous, state is not).
  const inFlightRef = useRef(false);

  const handleDecline = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      const result = await declinePurchase({
        actor,
        targetOwner: item.username,
        purchaseItemId: item.id,
        itemName: item.item_name,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[supplies-approvals] decline data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to decline this purchase. See console.";
        alert(msg);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      onChanged();
      if (!result.ok && result.reason === "audit") {
        console.warn("[supplies-approvals] decline audit write failed", result.error);
        alert(
          "The purchase was declined, but the audit log entry could not be written. " +
            "The record reflects the new state, but this change won't appear in the audit history.",
        );
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const isDeclined = !item.approved && !!item.declined_at;

  return (
    <Tooltip
      label={
        isDeclined
          ? "Already declined. Use Approve to revert to pending."
          : "Decline this purchase. The owner sees a red badge."
      }
      placement="bottom"
    >
      <button
        type="button"
        onClick={handleDecline}
        disabled={busy || isDeclined}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-meta font-medium text-red-700 dark:text-red-200 border border-red-300 dark:border-red-400/40 bg-red-50 dark:bg-red-500/25 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="lab-head-purchase-decline-button"
      >
        <Icon name="close" className="h-3 w-3" />
        Decline
      </button>
    </Tooltip>
  );
}

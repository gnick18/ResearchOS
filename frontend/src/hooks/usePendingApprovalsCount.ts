"use client";

// usePendingApprovalsCount (approvals-bell-awareness, 2026-06-26): the canonical
// "how many purchase / supply requests are waiting for the PI to sign off" hook.
//
// Why it exists: a lab head doing their own science can flip the header into
// "My work" mode, which drops the Approvals tab from the nav. In that mode the
// pending-approvals queue had no mode-independent signal, so the PI never
// learned a request was waiting until they manually flipped back to Lab mode.
// That is a soft-lock. Folding this count into the mode-independent notification
// bell gives the PI a signal in either mode, and the bell entry routes to
// /approvals (which re-enters Lab context).
//
// It reuses the EXACT source the Approvals page derives its pending count from:
// labApi.getAllPurchaseItems filtered by isPendingApproval, keyed on the same
// ["lab", "purchase-items"] React Query key so the bell count and the page can
// never diverge and the two call sites share one fetch.
//
// It is INERT for everyone who is not a lab head (count 0, no fetch), because
// approvals are PI-only. A member or a solo user never polls.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { labApi } from "@/lib/local-api";
import {
  isPendingApproval,
  type LabPurchaseItem,
} from "@/components/supplies/OrdersApprovalsLens";

/**
 * The shared React Query key for the lab-wide purchase-items poll. This is the
 * same key the Approvals page uses, so both surfaces read one cached fetch and
 * the bell count cannot drift from the page count.
 */
export const PURCHASE_ITEMS_QUERY_KEY = ["lab", "purchase-items"] as const;

/** How often to re-poll while the head has the app open. Matches the bell. */
const REFETCH_INTERVAL_MS = 30_000;

export interface PendingApprovalsCount {
  /** Pending purchase / supply approvals. Zero whenever the hook is inert. */
  count: number;
  isLoading: boolean;
}

/**
 * Returns the count of pending purchase / supply approvals across the lab.
 * Disabled (count 0, no fetch) for anyone who is not a lab head.
 */
export function usePendingApprovalsCount(): PendingApprovalsCount {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);

  const enabled = isLabHead === true;

  const query = useQuery({
    queryKey: enabled
      ? PURCHASE_ITEMS_QUERY_KEY
      : [...PURCHASE_ITEMS_QUERY_KEY, "disabled"],
    enabled,
    queryFn: () => labApi.getAllPurchaseItems() as Promise<LabPurchaseItem[]>,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const items = query.data ?? [];
  const count = enabled ? items.filter(isPendingApproval).length : 0;

  return {
    count,
    isLoading: enabled && query.isLoading,
  };
}

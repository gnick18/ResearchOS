"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { purchasesApi, fetchAllTasks } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  computeReorderSuggestions,
  type ReorderPurchaseInput,
  type ReorderSuggestion,
} from "@/lib/purchases/reorder-cadence";

/**
 * Reorder-cadence suggestions for the current user (reorder-loop sub-bot,
 * 2026-05-31).
 *
 * Joins the user's own `PurchaseItem` history to each item's parent-task
 * `start_date` (the same date signal SpendingDashboard uses for per-month
 * spend) and runs the pure cadence model. ZERO new input, ZERO storage:
 * everything is derived at load from data already on disk.
 *
 * Scoped to the user's OWN purchases (the nudge is personal - "you reorder
 * this about every N weeks"). It reuses the React Query keys the
 * /purchases page already populates (`["purchases-all", user]` shares with
 * the page's prior-items fetch; `["tasks", user]` shares the task list) so
 * mounting the widget alongside the page costs no extra fetch.
 */
export function useReorderSuggestions(): {
  suggestions: ReorderSuggestion[];
  dueCount: number;
  isLoading: boolean;
} {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // Own purchases. Shares the cache key NewPurchaseModal's prior-items
  // query uses, but without the trailing marker so it also dedupes with
  // any plain `["purchases-all", user]` fetch. listAll is current-user
  // scoped, which is exactly the personal-history scope we want.
  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["purchases-all", currentUser, "reorder"],
    queryFn: () => purchasesApi.listAll(),
    enabled: !!currentUser,
    staleTime: 60_000,
  });

  // Own tasks, to resolve each purchase's order date via its parent task's
  // start_date. `fetchAllTasks` is the current user's own tasks only  - 
  // purchases from listAll() belong to the current user, so the parent
  // task lives in the same directory.
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks", currentUser, "reorder"],
    queryFn: () => fetchAllTasks(),
    enabled: !!currentUser,
    staleTime: 60_000,
  });

  const taskDateById = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of tasks) {
      if (t.start_date) map.set(t.id, t.start_date);
    }
    return map;
  }, [tasks]);

  const inputs = useMemo<ReorderPurchaseInput[]>(() => {
    return purchases.map((p) => ({
      id: p.id,
      item_name: p.item_name,
      cas: p.cas ?? null,
      vendor: p.vendor ?? null,
      link: p.link ?? null,
      price_per_unit: p.price_per_unit ?? 0,
      quantity: p.quantity ?? 1,
      // Parent task's start_date is the order date; null when the parent
      // can't be resolved (the cadence model drops undated records).
      order_date: taskDateById.get(p.task_id) ?? null,
    }));
  }, [purchases, taskDateById]);

  const suggestions = useMemo(
    () => computeReorderSuggestions(inputs),
    [inputs],
  );

  const dueCount = useMemo(
    () => suggestions.filter((s) => s.due).length,
    [suggestions],
  );

  return {
    suggestions,
    dueCount,
    isLoading: purchasesLoading || tasksLoading,
  };
}

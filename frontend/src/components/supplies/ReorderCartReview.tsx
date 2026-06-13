"use client";

// Supplies v2 (SUPPLIES_V2_UNIFIED.md), chunk 4: the draft-order review.
//
// Opened from the "Reorder cart (N)" chip on /supplies. Shows the batched
// reorder lines, lets the user adjust each quantity and remove lines, set ONE
// funding account for the whole batch (decision 2, one funding context per
// order), then Submit. Submit resolves the typed funding label to an account
// (find-or-create, the same way NewPurchaseModal does), creates one purchase
// task with all the lines via submitDraftOrder, and (in lab mode) the lines
// route for PI approval through the existing purchases pipeline.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, Tooltip on
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { purchasesApi } from "@/lib/local-api";
import { submitDraftOrder } from "@/lib/purchases/reorder-actions";
import { useReorderCart } from "./ReorderCartContext";

export default function ReorderCartReview({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const { lines, remove, setQuantity, clear } = useReorderCart();
  const [funding, setFunding] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
  });

  const handleSubmit = async () => {
    if (lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // Resolve the typed funding label to an account id, creating the account
      // if it does not exist yet (mirrors NewPurchaseModal). The label still
      // lands in funding_string even if the account create fails.
      let fundingAccountId: number | null = null;
      const fundingTrimmed = funding.trim();
      if (fundingTrimmed) {
        const existing = fundingAccounts.find((a) => a.name === fundingTrimmed);
        if (existing) {
          fundingAccountId = existing.id;
        } else {
          try {
            const created = await purchasesApi.createFundingAccount({
              name: fundingTrimmed,
              total_budget: 0,
            });
            fundingAccountId = created.id;
          } catch (err) {
            console.warn("[supplies-reorder] funding account create failed", err);
          }
        }
      }

      await submitDraftOrder(
        lines.map((l) => l.seed),
        {
          currentUser: currentUser ?? undefined,
          funding: {
            funding_account_id: fundingAccountId,
            funding_string: fundingTrimmed || null,
          },
        },
      );

      // Refresh the surfaces that read these writes so the new order shows as
      // "on order" on its supply rows without a manual reload.
      void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });

      clear();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not submit the reorder.",
      );
      setSubmitting(false);
    }
  };

  return (
    <LivingPopup
      open
      onClose={onClose}
      label="Reorder cart"
      widthClassName="max-w-lg"
      closeOnScrimClick={!submitting}
    >
      <div className="w-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-title font-semibold text-foreground">Reorder cart</h2>
            <p className="text-meta text-foreground-muted">
              Review the batch, set one funding account, then submit as one order.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none rounded-md p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <p className="py-8 text-center text-body text-foreground-muted">
              The cart is empty. Use Reorder on a supply to add a line.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-foreground">
                      {line.seed.item_name}
                    </div>
                    {(line.seed.vendor || line.seed.catalog_number) && (
                      <div className="truncate text-meta text-foreground-muted">
                        {[line.seed.vendor, line.seed.catalog_number]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <Tooltip label="Order one fewer">
                      <button
                        type="button"
                        onClick={() => setQuantity(line.key, line.seed.quantity - 1)}
                        disabled={submitting || line.seed.quantity <= 1}
                        aria-label="Order one fewer"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Icon name="minus" className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <span className="min-w-[2rem] text-center text-body font-semibold tabular-nums text-foreground">
                      {line.seed.quantity}
                    </span>
                    <Tooltip label="Order one more">
                      <button
                        type="button"
                        onClick={() => setQuantity(line.key, line.seed.quantity + 1)}
                        disabled={submitting}
                        aria-label="Order one more"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Icon name="plus" className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                  <Tooltip label="Remove from cart">
                    <button
                      type="button"
                      onClick={() => remove(line.key)}
                      disabled={submitting}
                      aria-label="Remove from cart"
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-foreground-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 disabled:opacity-40"
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 && (
            <div className="mt-4">
              <label htmlFor="reorder-cart-funding" className="block text-meta font-medium text-foreground-muted mb-1">
                Funding account
              </label>
              <input
                id="reorder-cart-funding"
                list="reorder-cart-funding-options"
                value={funding}
                onChange={(e) => setFunding(e.target.value)}
                placeholder="Charge the whole order to one account (optional)"
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
              />
              <datalist id="reorder-cart-funding-options">
                {fundingAccounts.map((a) => (
                  <option key={a.id} value={a.name} />
                ))}
              </datalist>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-meta text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || lines.length === 0}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="check" className="h-4 w-4" />
            {submitting ? "Submitting..." : "Submit order"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}

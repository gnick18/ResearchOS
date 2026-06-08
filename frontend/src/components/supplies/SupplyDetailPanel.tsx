"use client";

// Supplies v2 (SUPPLIES_V2_UNIFIED.md), chunk 3: the two-section detail panel.
// Click a Supply row -> this read panel shows the two orthogonal sections that
// define a supply: On hand (its stocks) and Ordering (its open order lines).
// Read-only here; chunk 4 wires reorder + the inline stock controls, chunk 5
// adds the lab-head ordering actions. Sections render only when that side
// exists, so an order-only supply shows just Ordering and an on-hand-only
// supply shows just On hand.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, no emojis /
// em-dashes / mid-sentence colons.

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  containerCountLabel,
  formatDate,
  statusChipClass,
} from "@/components/inventory/inventory-ui";
import type { InventoryStock } from "@/lib/types";
import { normalizeOrderStatus, PURCHASE_ORDER_STATUS_LABEL } from "@/lib/types";
import type { Supply } from "@/lib/supplies/supply-model";

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  return (CATEGORY_LABEL as Record<string, string>)[cat] ?? cat;
}

export default function SupplyDetailPanel({
  supply,
  stocks,
  onClose,
}: {
  supply: Supply;
  /** All loaded stocks; the panel filters to this supply's item(s). */
  stocks: InventoryStock[];
  onClose: () => void;
}) {
  const onHandStocks = supply.onHand
    ? stocks.filter((st) => supply.onHand!.itemIds.includes(st.item_id))
    : [];
  const meta = [categoryLabel(supply.identity.category), supply.identity.vendor, supply.identity.catalogNumber]
    .filter((p) => p && String(p).trim())
    .join(" · ");

  return (
    <LivingPopup open onClose={onClose} fillHeight label={`Supply details, ${supply.identity.name}`}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-title font-semibold text-foreground">{supply.identity.name}</h2>
              {meta ? <p className="truncate text-meta text-foreground-muted">{meta}</p> : null}
              {supply.identity.cas ? (
                <p className="text-meta text-foreground-muted">CAS {supply.identity.cas}</p>
              ) : null}
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
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* On hand */}
          {supply.onHand ? (
            <section>
              <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                On hand
              </h3>
              {onHandStocks.length === 0 ? (
                <p className="text-meta text-foreground-muted">No stocks recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {onHandStocks.map((st) => (
                    <li
                      key={st.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-sunken px-3 py-2"
                    >
                      <span className="text-body font-semibold text-foreground tabular-nums">
                        {containerCountLabel(st.container_count, null)}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-meta font-medium ${statusChipClass(st.status)}`}>
                        {STATUS_LABEL[st.status]}
                      </span>
                      {st.lot_number ? <span className="text-meta text-foreground-muted">Lot {st.lot_number}</span> : null}
                      {st.expiration_date ? (
                        <span className="text-meta text-foreground-muted">Expires {formatDate(st.expiration_date)}</span>
                      ) : null}
                      {st.location_text ? <span className="text-meta text-foreground-muted">{st.location_text}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* Ordering */}
          {supply.ordering ? (
            <section>
              <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                Ordering
              </h3>
              <ul className="space-y-2">
                {supply.ordering.openLines.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-sunken px-3 py-2"
                  >
                    <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-meta font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
                      {PURCHASE_ORDER_STATUS_LABEL[normalizeOrderStatus(p.order_status)]}
                    </span>
                    <span className="text-meta text-foreground-muted">Qty {p.quantity}</span>
                    {p.total_price ? (
                      <span className="text-meta text-foreground-muted">${p.total_price.toFixed(2)}</span>
                    ) : null}
                    {p.funding_string ? <span className="text-meta text-foreground-muted">{p.funding_string}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="border-t border-border px-5 py-3 text-meta text-foreground-muted">
          Reorder and inline stock actions arrive in the next build step.
        </div>
      </div>
    </LivingPopup>
  );
}

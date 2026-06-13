"use client";

// Phase 3 org billing: the payment chooser shared by the department + institution
// dashboards. It combines two axes into three clear options: how the charge is
// collected (an emailed net-30 invoice or an auto-charge on file) and the pay
// CLASS that sets the price (card = list, bank debit = a genuine discount that
// reflects the lower processing fee, never a card surcharge).
//
//   invoice_bank - emailed net-30 invoice, paid by bank transfer / ACH (discount)
//   auto_bank    - auto-charge a bank account on file (discount)
//   auto_card    - auto-charge a card on file (list price)
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { OrgBillingMethod, OrgPayClass } from "@/lib/billing/org-billing";

export type OrgPayOption = "invoice_bank" | "auto_bank" | "auto_card";

/** Maps a chosen option to the request fields the billing API expects. */
export function payOptionRequest(opt: OrgPayOption): {
  method: OrgBillingMethod;
  payClass: OrgPayClass;
} {
  if (opt === "auto_card") return { method: "automatic", payClass: "card" };
  if (opt === "auto_bank") return { method: "automatic", payClass: "bank" };
  return { method: "invoice", payClass: "bank" };
}

/** Maps a saved (method, payClass) back to the option, for seeding the UI. */
export function requestToPayOption(
  method: OrgBillingMethod,
  payClass: OrgPayClass,
): OrgPayOption {
  if (method === "automatic") return payClass === "card" ? "auto_card" : "auto_bank";
  return "invoice_bank";
}

const OPTIONS: { value: OrgPayOption; title: string; blurb: string; discount: boolean }[] = [
  {
    value: "invoice_bank",
    title: "Emailed invoice",
    blurb: "Net 30, PO number, paid by bank transfer or ACH. For procurement.",
    discount: true,
  },
  {
    value: "auto_bank",
    title: "Auto-charge bank",
    blurb: "A bank account on file, charged each cycle.",
    discount: true,
  },
  {
    value: "auto_card",
    title: "Auto-charge card",
    blurb: "A card on file, charged each cycle. Works anywhere.",
    discount: false,
  },
];

export default function PayMethodChoice({
  value,
  onChange,
  bankSaving,
}: {
  value: OrgPayOption;
  onChange: (o: OrgPayOption) => void;
  /** Formatted bank-debit saving vs the card list price, e.g. "$8". Shown on the
   *  discounted options so the lower rate is visible. */
  bankSaving?: string;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg border p-2.5 text-left ${
              active
                ? "border-brand-action bg-brand-action/10"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <span className="flex items-center gap-2 text-meta font-semibold text-foreground">
              <span
                className={`h-3 w-3 flex-none rounded-full border ${
                  active ? "border-brand-action bg-brand-action" : "border-border"
                }`}
              />
              {o.title}
            </span>
            <span className="mt-1 block text-meta text-foreground-muted">{o.blurb}</span>
            {o.discount && bankSaving && (
              <span className="mt-1 block text-meta font-semibold text-green-600 dark:text-green-400">
                Save {bankSaving}/mo
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

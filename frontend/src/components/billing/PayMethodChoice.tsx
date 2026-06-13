"use client";

// Phase 3 org billing: the payment-method chooser shared by the department and
// institution dashboards. An org picks how it pays (both are real buyer types our
// pricing research found):
//   invoice    - an emailed invoice with net 30 terms (PO, ACH or card), for a
//                procurement office that requires a purchase order.
//   automatic  - auto-charge a card or bank account on file each cycle, for a
//                smaller department or a PI fronting the cost.
//
// No emojis, no em-dashes, no mid-sentence colons.

export type PayMethod = "invoice" | "automatic";

const OPTIONS: { value: PayMethod; title: string; blurb: string }[] = [
  {
    value: "invoice",
    title: "Emailed invoice",
    blurb: "Net 30, PO number, pay by ACH or card. For procurement offices.",
  },
  {
    value: "automatic",
    title: "Auto-charge",
    blurb: "Put a card or bank account on file, charged each cycle.",
  },
];

export default function PayMethodChoice({
  method,
  onChange,
}: {
  method: PayMethod;
  onChange: (m: PayMethod) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const active = method === o.value;
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
          </button>
        );
      })}
    </div>
  );
}

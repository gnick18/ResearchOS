// DEV-only visual preview of the Model-A billing panel in every state, so the
// look can be reviewed without a live billing backend. The /dev tree is gated to
// local-only in proxy.ts (404 in production).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { ModelABilling, type ModelAStatus } from "@/components/billing/ModelABilling";

const STATES: { label: string; status: ModelAStatus }[] = [
  { label: "Free owner (upgrade pitch)", status: { planId: "free", accruedCents: 0, capCents: null, hasCard: false } },
  { label: "Solo, card on file, small balance, no cap", status: { planId: "solo", accruedCents: 412, capCents: null, hasCard: true } },
  { label: "Solo, no card yet", status: { planId: "solo", accruedCents: 0, capCents: null, hasCard: false } },
  { label: "Lab, card on file, near threshold, $50 cap", status: { planId: "lab", accruedCents: 480, capCents: 5000, hasCard: true } },
  { label: "Lab, over $5, $20 cap", status: { planId: "lab", accruedCents: 1928, capCents: 2000, hasCard: true } },
  { label: "Member, premium via their lab", status: { planId: "free", accruedCents: 0, capCents: null, hasCard: false, sponsoringLab: { name: "Fungal Interactions Lab", tier: "lab" } } },
];

export default function ModelABillingPreview() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-extrabold text-foreground">Model A billing panel preview</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Dev-only. Each block renders the panel with fixture status, no backend.
        </p>
      </div>
      {STATES.map((s) => (
        <div key={s.label} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">{s.label}</div>
          <ModelABilling initialStatus={s.status} />
        </div>
      ))}
    </div>
  );
}

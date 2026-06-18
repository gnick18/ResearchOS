"use client";

// The operator-only "locked pricing" reference: ONLY the final, settled Model A
// numbers, nothing modeled or projected (that lives in the Price modeling tab).
// Every figure is read LIVE from the pricing engine (catalog + Model-A plans +
// service-model + ai-config), so this card can never drift from what customers
// are actually billed. Canonical write-up: docs/branding/PRICING.md.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  PLAN_PRICES,
  AI_PACK_DOLLARS,
  DEPT_PER_LAB_DISCOUNT_CENTS,
  DEPT_USAGE_DISCOUNT_PCT,
  usd,
} from "@/lib/billing/catalog";
import { ACCRUAL_CHARGE_THRESHOLD_CENTS } from "@/lib/billing/model-a/pricing";
import { STORAGE_MARKUP } from "@/lib/pricing/service-model";
import {
  AI_MEASURED_BARE_COST_USD_PER_TOKEN,
  AI_INDIVIDUAL_MARKUP,
  AI_ORG_MARKUP,
} from "@/lib/billing/ai-config";

interface TierRow {
  name: string;
  base: string;
  suffix: string;
  usage: string;
  what: string;
}

// The four tiers, prices pulled from the engine. Free is the network audience
// (receive-only, no recurring charge); Solo / Lab / Dept are the paid services.
const TIERS: TierRow[] = [
  {
    name: "Free",
    base: "$0",
    suffix: "",
    usage: "None",
    what: "Receive-only. Unlimited local notebook, shared-folder workspaces, directory presence, accept invites. No cloud produce features.",
  },
  {
    name: PLAN_PRICES.solo.name,
    base: PLAN_PRICES.solo.base,
    suffix: PLAN_PRICES.solo.baseSuffix,
    usage: `${PLAN_PRICES.solo.usageMarkup}x cost`,
    what: "Unlocks the produce side. Send, live co-edit, the paired companion app, push.",
  },
  {
    name: PLAN_PRICES.lab.name,
    base: PLAN_PRICES.lab.base,
    suffix: PLAN_PRICES.lab.baseSuffix,
    usage: `${PLAN_PRICES.lab.usageMarkup}x cost`,
    what: "The core paid unit. Companion app pairing, the lab web home and paper companion pages, real-time co-edit, the dashboard, shared library, pooled budgets.",
  },
  {
    name: PLAN_PRICES.dept.name,
    base: PLAN_PRICES.dept.base,
    suffix: PLAN_PRICES.dept.baseSuffix,
    usage: `${PLAN_PRICES.dept.usageMarkup}x cost`,
    what: "Institutional volume tier. Cheaper per lab than a standalone lab, with the governance layer included, not charged as a premium.",
  },
];

const AI_COST_PER_M = (AI_MEASURED_BARE_COST_USD_PER_TOKEN * 1_000_000).toFixed(3);

/** Small labelled fact card, used for the storage / AI / billing rows. */
function FactCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-5">
      <p className="text-meta font-bold uppercase tracking-wide text-foreground-muted">
        {title}
      </p>
      <div className="mt-2 text-body text-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export default function LockedPricingPanel() {
  return (
    <div className="space-y-5">
      {/* Provenance, so an operator reading this knows it is live and authoritative. */}
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-meta text-emerald-800 leading-relaxed">
        These are the final, settled Model A prices, read live from the pricing
        engine so they can never drift from what customers are billed. Anything
        modeled or projected lives in Price modeling instead. Canonical write-up
        in docs/branding/PRICING.md.
      </p>

      {/* The four tiers. */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-meta uppercase tracking-wide text-foreground-muted">
              <th className="px-5 py-3 font-bold">Plan</th>
              <th className="px-5 py-3 font-bold">Base</th>
              <th className="px-5 py-3 font-bold">Cloud usage</th>
              <th className="px-5 py-3 font-bold">What it is</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {TIERS.map((t) => (
              <tr key={t.name} className="align-top">
                <td className="px-5 py-4 text-body font-semibold text-foreground whitespace-nowrap">
                  {t.name}
                </td>
                <td className="px-5 py-4 whitespace-nowrap">
                  <span className="text-title font-bold text-foreground">{t.base}</span>
                  {t.suffix ? (
                    <span className="text-meta text-foreground-muted"> {t.suffix}</span>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-body text-foreground whitespace-nowrap">
                  {t.usage}
                </td>
                <td className="px-5 py-4 text-meta text-foreground-muted leading-relaxed">
                  {t.what}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Department volume framing, derived from the plan gap so it stays true. */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-4 text-body text-sky-900 leading-relaxed">
        Department is the volume tier, priced BELOW a standalone Lab on purpose.
        It is {usd(DEPT_PER_LAB_DISCOUNT_CENTS)} per lab cheaper on the base
        ({PLAN_PRICES.dept.base} vs {PLAN_PRICES.lab.base}) and about{" "}
        {DEPT_USAGE_DISCOUNT_PCT}% lower on the usage markup
        ({PLAN_PRICES.dept.usageMarkup}x vs {PLAN_PRICES.lab.usageMarkup}x),
        because landing a department brings many labs at once.
      </div>

      {/* Storage / AI / Billing facts. */}
      <div className="grid gap-4 md:grid-cols-3">
        <FactCard title="Storage">
          A-la-carte at {STORAGE_MARKUP}x our cost (fee recovery, no margin).
          Opt-in per object, nothing is ever force-pushed.
        </FactCard>
        <FactCard title="AI">
          Prepaid token packs of{" "}
          {AI_PACK_DOLLARS.map((d) => `$${d}`).join(", ")}. Metered at{" "}
          {AI_INDIVIDUAL_MARKUP}x for Solo and Lab and {AI_ORG_MARKUP}x for
          Department, over our measured ~${AI_COST_PER_M} per million tokens.
        </FactCard>
        <FactCard title="Billing">
          We show a monthly price but bill off an accrued ledger. The card runs
          once the owed balance crosses about{" "}
          {usd(ACCRUAL_CHARGE_THRESHOLD_CENTS)}, or at cancellation. The local
          app and data always keep working.
        </FactCard>
      </div>

      <p className="text-meta text-foreground-muted leading-relaxed">
        For context, LabArchives alone is about $27.50 per user per month, so a
        6-seat lab here stays a fraction of the same seats elsewhere.
      </p>
    </div>
  );
}

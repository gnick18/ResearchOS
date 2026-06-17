// Shared, catalog-driven price callout for the marketing + pricing pages.
//
// Grant 2026-06-16: unify the pricing presentation across /labs, /departments, the
// payment/pricing page, and the onboarding chooser, so the numbers AND the
// department volume-discount wording are identical everywhere and a price change
// still propagates from one place. Every figure comes from lib/billing/catalog
// (which derives from MODEL_A_PLANS), never a hardcoded literal.
//
// Department is shown as a DISCOUNT off the lab rate, never an internal markup.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  PLAN_PRICES,
  usd,
  DEPT_PER_LAB_DISCOUNT_CENTS,
  DEPT_USAGE_DISCOUNT_PCT,
  type PaidPlanId,
} from "@/lib/billing/catalog";

export function PlanPriceCallout({ planId }: { planId: PaidPlanId }) {
  const plan = PLAN_PRICES[planId];
  const isDept = planId === "dept";

  return (
    <div className="rounded-2xl border border-[#cfdcec] bg-white p-5 text-left shadow-[0_2px_14px_rgba(15,40,80,0.05)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {isDept && (
          <span className="text-title text-[#94a3b8] line-through">
            {PLAN_PRICES.lab.base}
          </span>
        )}
        <span className="text-3xl font-extrabold tracking-tight text-brand-ink">
          {plan.base}
        </span>
        <span className="text-body text-[#475569]">
          {plan.baseSuffix} plus cloud usage
        </span>
      </div>
      {isDept ? (
        <p className="mt-2 text-body leading-relaxed text-[#475569]">
          A volume discount versus a standalone lab,{" "}
          <strong className="font-semibold text-brand-ink">
            {usd(DEPT_PER_LAB_DISCOUNT_CENTS)} off per lab
          </strong>{" "}
          and about{" "}
          <strong className="font-semibold text-brand-ink">
            {DEPT_USAGE_DISCOUNT_PCT}% off cloud usage
          </strong>
          , because a department brings many labs at once. The governance layer is
          included, not a premium.
        </p>
      ) : (
        <p className="mt-2 text-body leading-relaxed text-[#475569]">
          Pay for what you use, a small base plus your actual cloud usage, with a
          monthly cap you set so there are no surprises.
        </p>
      )}
      <p className="mt-3 border-t border-[#eef2f7] pt-3 text-meta leading-relaxed text-[#64748b]">
        Shown per month, but we only run your card once you have built up about
        $5, or when you close your account. In practice that is a couple of
        charges a year, never a monthly nickel-and-dime.
      </p>
    </div>
  );
}

export default PlanPriceCallout;

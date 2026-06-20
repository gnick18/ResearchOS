// Shared, catalog-driven price callout for the marketing + pricing pages.
//
// Grant 2026-06-16: unify the pricing presentation across /labs, /departments, the
// payment/pricing page, and the onboarding chooser, so the numbers are identical
// everywhere and a price change still propagates from one place. Every figure
// comes from lib/billing/catalog, never a hardcoded literal.
//
// Grant 2026-06-19: lab shows the FOUNDING lock-in rate ($25, locked for life for
// founding labs), and department pricing is contact/TBD (a reach-out button, no
// price), so the old "dept is a discount off the lab rate" framing is retired.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { PLAN_PRICES, type PaidPlanId } from "@/lib/billing/catalog";

const CARD =
  "rounded-2xl border border-[#cfdcec] bg-white p-5 text-left shadow-[0_2px_14px_rgba(15,40,80,0.05)]";

export function PlanPriceCallout({ planId }: { planId: PaidPlanId }) {
  const plan = PLAN_PRICES[planId];

  if (plan.contactOnly) {
    return (
      <div className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-extrabold tracking-tight text-brand-ink">
            Pricing TBD
          </span>
        </div>
        <p className="mt-2 text-body leading-relaxed text-[#475569]">
          A department brings many labs at once, so we set the price with you
          rather than off a list. Reach out and we will scope it together.
        </p>
        <Link
          href="/departments/contact"
          className="btn-brand mt-4 inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 text-body"
        >
          Reach out
        </Link>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl font-extrabold tracking-tight text-brand-ink">
          {plan.base}
        </span>
        <span className="text-body text-[#475569]">
          {plan.baseSuffix} plus cloud usage
        </span>
      </div>
      {plan.founding ? (
        <p className="mt-2 text-body leading-relaxed text-[#475569]">
          A founding rate. Lock it in now and it stays {plan.base} per lab for as
          long as you keep your plan, even as the price goes up for labs that join
          later.
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

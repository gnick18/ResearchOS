import type { Metadata } from "next";

import BeakerBot from "@/components/BeakerBot";
import MadeInMadison from "@/components/MadeInMadison";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import CompetitorSavings from "@/components/pricing/CompetitorSavings";
import CostMath from "@/components/pricing/CostMath";
import FeatureGrid, {
  type FeatureItem,
} from "@/components/pricing/FeatureGrid";
import PlanPicker from "@/components/pricing/PlanPicker";
import PricingFaq from "@/components/pricing/PricingFaq";
import PricingHero from "@/components/pricing/PricingHero";
import { Section, SectionHeading } from "@/components/pricing/Section";
import TrustBand from "@/components/pricing/TrustBand";
import TwoPartModel from "@/components/pricing/TwoPartModel";
import { isAiBillingEnabled, isBillingEnabled } from "@/lib/billing/config";

/**
 * Public `/pricing` route. The first real pricing page, a faithful port of the
 * approved mockup `docs/mockups/2026-06-10-pricing-page.html`. Every word comes
 * from BILLING_FACTS in the house voice. No Plus or Pro dollar figures are
 * printed (those are still provisional). Beta-free copy is flag-driven: it
 * shows only while the relevant billing flag (BILLING_ENABLED for storage,
 * AI_BILLING_ENABLED for the AI) is off, and switches to live-pricing copy
 * once the flag is on, so the page is always truthful.
 *
 * Marketing / informational page, intentionally excluded from the wiki-coverage
 * map (alongside /transparency) and rendered without the AppShell
 * or a connected data folder so anyone can read it.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */
export const metadata: Metadata = {
  title: "Pricing | ResearchOS",
  description:
    "The ResearchOS local notebook is free and open source forever. The only paid parts are optional cloud storage and the optional AI assistant, both metered at cost. Individuals and labs pay what it costs us, larger institutions pay a little more to keep it free for everyone else. See the competitor savings, the plan builders, the AI pricing, and the actual cost math.",
};

const SUPPORT_ITEMS: FeatureItem[] = [
  {
    icon: "database",
    title: "Buy only the storage you use",
    body: [
      "The most direct support is to buy the cloud storage you actually use, and no more. That keeps us sustainable without overpaying for space you do not need.",
    ],
  },
  {
    icon: "heart",
    title: "Sponsor us on GitHub Sponsors",
    body: [
      "A sponsorship is a direct contribution that funds development. It is also not subject to sales tax the way a product purchase can be, so more of your money reaches the actual dev work.",
    ],
  },
];

const AI_ITEMS: FeatureItem[] = [
  {
    icon: "heart",
    title: "About 1.6 million free tokens to start",
    body: [
      "Every new account gets a one-time gift of about 1.6 million AI tokens to try BeakerBot, no card needed. How far they stretch depends on what you ask. A quick question is cheap, a full task that reads across your work costs more, and the gift works out to roughly 15 tasks or 30-plus quick questions. Plenty to see what BeakerBot does over your own data before you spend anything.",
    ],
  },
  {
    icon: "gauge",
    title: "Then prepaid top-ups, near cost",
    body: [
      "After the gift runs out you buy a prepaid top-up, and each task draws down what it actually cost us to run plus a thin buffer for processing. Because a full task is only a couple cents of compute, a $10 top-up is a few hundred tasks. You always see your token balance and what the last task cost. No subscription, you pay only for what you use.",
    ],
  },
  {
    icon: "lock",
    title: "Cheap because your data stays home",
    body: [
      "We run an open-weight model and the agent loop runs in your browser, so only a small result ever crosses to the model, never your files. Low cost and your-data-stays-home are the same fact.",
    ],
  },
  {
    icon: "users",
    title: "Or have your lab or institution cover it",
    body: [
      "A lab, department, or institution can fund a shared pool, so members use BeakerBot without paying out of pocket. Departments and institutions pay a small sustaining rate above cost, the same as storage, and that keeps the free sign-up tokens free for everyone.",
    ],
  },
];

export default function PricingPage() {
  // TEMP: hide the public pricing page on deployed builds while we finalize the
  // new (Model A) pricing, so visitors never see stale tiers. Shows a Beaker
  // maintenance state on prod/preview; the real page still renders in local
  // `next dev` so we keep building it. Set PRICING_LIVE=true to expose it, or
  // remove this block once pricing is locked.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PRICING_LIVE !== "true"
  ) {
    return (
      <div className="min-h-screen bg-surface-sunken">
        <MarketingNav />
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
          <BeakerBot
            pose="idle"
            animated={false}
            className="h-40 w-40 text-sky-500"
            ariaLabel="BeakerBot updating the pricing"
          />
          <h1 className="mt-6 text-2xl font-semibold text-foreground sm:text-3xl">
            Pricing is getting an update
          </h1>
          <p className="mt-3 max-w-md text-body leading-relaxed text-foreground-muted">
            We are finalizing a simpler, fairer pricing model built for
            academics. It will be back here shortly, and everything in the app
            stays free during the beta in the meantime.
          </p>
          <a
            href="/"
            className="mt-7 rounded-full border border-border px-5 py-2 text-meta font-medium text-foreground hover:bg-surface"
          >
            Back to home
          </a>
        </main>
        <MarketingFooter />
      </div>
    );
  }

  const billingEnabled = isBillingEnabled();
  const aiBillingEnabled = isAiBillingEnabled();

  return (
    <div className="min-h-screen bg-surface-sunken">
      <MarketingNav />
      <div className="mx-auto max-w-7xl px-2 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface sm:rounded-3xl">
          <PricingHero billingEnabled={billingEnabled} />

          {/* Two-part model */}
          <Section>
            <SectionHeading
              title="The app is free. Two optional things ever cost money."
              subtitle="Your data has two parts, your folder on your own disk which is free, and the cloud copy you choose to sync or share which is the paid storage part. The one other optional paid thing is the AI assistant, also metered at cost and covered below. The reason it all stays cheap is the local-first design, your daily work never leaves your disk."
            />
            <TwoPartModel />
          </Section>

          {/* BeakerBot, the AI assistant over your own data. Leads with the free
              token gift as the hook, then the at-cost framing. Placed high (right
              after the two-part model) so the free gift is the first concrete
              perk, not buried below the storage math. id="ai-pricing" so the
              competitor-savings AI highlight can link here. */}
          <Section id="ai-pricing">
            <SectionHeading
              title="BeakerBot, an AI assistant over your own data, free to start"
              subtitle="BeakerBot reasons over your notes and results, runs an analysis, makes a plot, and writes it up, always with your approval. It is the one optional thing that is metered, because each task calls a hosted model that costs us real money. Every new account starts with a free batch of tokens, and after that it is priced near our actual cost."
            />
            <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-brand-action/30 bg-brand-action/[0.06] px-5 py-4 text-center">
              <div className="text-2xl font-extrabold tracking-tight text-brand-ink dark:text-foreground">
                About 1.6 million free AI tokens
              </div>
              <p className="mt-1 text-[13px] font-semibold text-foreground-muted">
                a one-time sign-up gift, about 15 tasks or 30-plus quick
                questions
              </p>
            </div>
            <FeatureGrid items={AI_ITEMS} />
            <p className="mt-6 text-center">
              <a
                href="/ai"
                className="inline-flex items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
              >
                See everything BeakerBot can do{" "}
                <span aria-hidden>&rarr;</span>
              </a>
            </p>
            <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
              <b className="text-foreground">Why no final AI prices yet.</b> We
              hold the exact top-up prices until a few real tasks show what they
              actually cost, the same way we set storage from data instead of
              guessing. The free sign-up gift is set so realistic use lands near
              25 cents of compute
              {aiBillingEnabled
                ? "."
                : ", and during the beta the AI is free."}
            </p>
          </Section>

          {/* What you pay today, competitor savings */}
          <Section>
            <SectionHeading
              title="What you are paying for today"
              subtitle="Tick the tools your lab already pays for. These are academic list prices from the vendors, and ResearchOS replaces all of them in one app. Benchling is shown free because its academic tier is, we are not padding the number."
            />
            <CompetitorSavings />
          </Section>

          {/* Plans */}
          <Section id="plans">
            <SectionHeading
              title="One plan covers your storage and your editing, on one invoice"
              subtitle="Pick a plan, not a pile of meters. Each plan bundles a storage allowance and an editing allowance into a single monthly price. Most people stay on Free."
            />
            <PlanPicker billingEnabled={billingEnabled} />
            <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
              <b className="text-foreground">
                Why no final Plus and Pro prices yet.
              </b>{" "}
              We hold the exact figure until a few weeks of real usage show what
              storage actually costs, so we set it from data instead of guessing
              high.{" "}
              {billingEnabled
                ? "The plan structure itself is final, six plans, one picker, Free at 5 GB and zero dollars."
                : "During the beta every plan is free. The plan structure itself is final, six plans, one picker, Free at 5 GB and zero dollars."}
            </p>
          </Section>

          {/* Cost math */}
          <Section>
            <SectionHeading
              title="How we would price it, our actual costs"
              subtitle={
                billingEnabled
                  ? "No guessing. Here is the real math, our infrastructure cost plus payment processing plus a small buffer. Individuals and labs pay exactly this, and larger institutions pay a transparent bit more that funds the free tiers."
                  : "No guessing. Here is the real math, our infrastructure cost plus payment processing plus a small buffer. Individuals and labs pay exactly this, and larger institutions pay a transparent bit more that funds the free tiers. Everything is free during the beta."
              }
            />
            <CostMath billingEnabled={billingEnabled} />
          </Section>

          {/* Trust band: metering + labs + guardrails as one designed band with
              mechanic illustrations, replacing the three flat FeatureGrids. */}
          <Section>
            <TrustBand />
          </Section>

          {/* Supporting us */}
          <Section>
            <SectionHeading
              title="Want to support the project?"
              subtitle="There are two good ways, and one of them sends more of your money to the actual work."
            />
            <FeatureGrid items={SUPPORT_ITEMS} />
          </Section>

          {/* Pricing FAQ (saas-landing-pages framework: answer the billing and
              switching objections right before the closing reassurance). */}
          <PricingFaq billingEnabled={billingEnabled} />

          {/* Credibility + beta note */}
          <Section className="bg-surface-raised text-center">
            <h2 className="mb-4 text-xl font-extrabold text-brand-ink dark:text-foreground">
              A real, accountable business
            </h2>
            <div className="mb-4 flex justify-center">
              <MadeInMadison variant="badge" tone="punchy" />
            </div>
            <p className="mx-auto max-w-[64ch] text-[12.5px] leading-relaxed text-foreground-muted">
              We are the merchant of record, with real banking and Stripe set up,
              so paid storage is a real and accountable business, not a hobby
              donation link.{" "}
              {billingEnabled || aiBillingEnabled ? (
                <>
                  Cloud storage and the AI are billed at what they cost us,
                  with a transparent cost breakdown above.
                </>
              ) : (
                <>
                  Until then we are in beta, and everything, including sharing
                  and real-time collaboration, is{" "}
                  <b className="text-foreground">free right now</b>.
                </>
              )}
            </p>
          </Section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}

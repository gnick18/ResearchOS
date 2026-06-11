import type { Metadata } from "next";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import MadeInMadison from "@/components/MadeInMadison";
import CompetitorSavings from "@/components/pricing/CompetitorSavings";
import CostMath from "@/components/pricing/CostMath";
import FeatureGrid, {
  type FeatureItem,
} from "@/components/pricing/FeatureGrid";
import PlanPicker from "@/components/pricing/PlanPicker";
import PricingFaq from "@/components/pricing/PricingFaq";
import PricingHero from "@/components/pricing/PricingHero";
import { Section, SectionHeading } from "@/components/pricing/Section";
import TwoPartModel from "@/components/pricing/TwoPartModel";

/**
 * Public `/pricing` route. The first real pricing page, a faithful port of the
 * approved mockup `docs/mockups/2026-06-10-pricing-page.html`. Every word comes
 * from BILLING_FACTS in the house voice. No Plus or Pro dollar figures are
 * printed (those are still provisional), and nothing claims billing is live
 * since it is off during the beta.
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
    "The ResearchOS local notebook is free and open source forever. The only paid part is optional cloud storage for shared and co-edited documents. Individuals and labs pay what it costs us, larger institutions pay a little more to keep it free for everyone else. See the competitor savings, the plan builders, and the actual cost math. Everything is free during the beta.",
};

const METERING_ITEMS: FeatureItem[] = [
  {
    icon: "pencil",
    title: "Editing is included, not billed",
    body: [
      "Collaboration and editing come with your plan. There is no second meter watching what you type, and no per-edit charge ever appears on your invoice.",
    ],
  },
  {
    icon: "gauge",
    title: "A throttle, never a surprise bill",
    body: [
      "If a very heavy month runs past your editing allowance, real-time sync slows to periodic sync. Your work keeps saving. If a lab keeps hitting it, the PI raises the plan, nobody gets a shock charge.",
    ],
  },
];

const LABS_ITEMS: FeatureItem[] = [
  {
    icon: "receipt",
    title: "One shared pool, one invoice",
    body: [
      "The free tier and any paid plan are a single pool for the whole lab. Only the PI pays, on one consolidated invoice. Members are never billed and never enter a card.",
    ],
  },
  {
    icon: "mail",
    title: "Invite by email, member accepts",
    body: [
      "The PI invites a member by email, and the member accepts before the lab starts covering them. We do not store the email address permanently.",
    ],
  },
  {
    icon: "chart",
    title: "The PI can manage the pool",
    body: [
      "Because the PI pays, they can see each member's storage and activity use, so they can manage the shared pool. Members are told this when they accept.",
    ],
  },
  {
    icon: "folder",
    title: "Local-first for everyone",
    body: [
      "Every member still keeps their own data in their own folder. The lab plan funds the shared, synced copies, not the local work, which stays free.",
    ],
  },
];

const GUARDRAIL_ITEMS: FeatureItem[] = [
  {
    icon: "shield",
    title: "A cost circuit breaker",
    body: [
      "We set a hard monthly budget. If cloud spend ever approaches it, cloud writes pause and the local-first app keeps working with zero interruption. There is no runaway bill that we then pass to you.",
    ],
  },
  {
    icon: "scale",
    title: "Priced to sustain, not to profit",
    body: [
      "Individuals and labs pay what storage costs us, no more. Larger institutions pay a modest sustaining rate above cost, and that surplus keeps ResearchOS free for individual researchers and funds the open-source development. We are not extracting profit, we are keeping a public good alive.",
    ],
  },
];

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

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-surface-sunken">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-body font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          ← ResearchOS
        </Link>

        <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
          <PricingHero />

          {/* Two-part model */}
          <Section>
            <SectionHeading
              title="Two parts, and only one of them ever costs money"
              subtitle="Knowing which part is which is the whole pricing model. The reason cloud stays cheap is the local-first design, your daily work never leaves your disk."
            />
            <TwoPartModel />
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
            <PlanPicker />
            <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
              <b className="text-foreground">
                Why no final Plus and Pro prices yet.
              </b>{" "}
              We hold the exact figure until a few weeks of real usage show what
              storage actually costs, so we set it from data instead of guessing
              high. The math below shows how we will get there, and during the beta
              every plan is free. The plan structure itself is final, six plans,
              one picker, Free at 5 GB and zero dollars.
            </p>
          </Section>

          {/* Cost math */}
          <Section>
            <SectionHeading
              title="How we would price it, our actual costs"
              subtitle="No guessing. Here is the real math, our infrastructure cost plus payment processing plus a small buffer. Individuals and labs pay exactly this, and larger institutions pay a transparent bit more that funds the free tiers. Everything is free during the beta."
            />
            <CostMath />
          </Section>

          {/* Editing is never metered */}
          <Section>
            <SectionHeading
              title="Your editing is never metered"
              subtitle="We never charge per keystroke or per sync. Other tools nickel and dime every action, and we built the opposite on purpose."
            />
            <FeatureGrid items={METERING_ITEMS} />
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm font-bold leading-snug text-brand-purple">
              Your editing is never metered.
            </p>
          </Section>

          {/* How labs work */}
          <Section>
            <SectionHeading
              title="Built for a whole lab, billed to one person"
              subtitle="A lab plan is a shared pool for the team, not a charge per head. The PI runs it and members just use it."
            />
            <FeatureGrid items={LABS_ITEMS} />
          </Section>

          {/* Guardrails */}
          <Section>
            <SectionHeading
              title="We cannot run up a bill and hand it to you"
              subtitle="Two guardrails make that a promise we can keep, not a slogan."
            />
            <FeatureGrid items={GUARDRAIL_ITEMS} />
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
          <PricingFaq />

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
              so paid storage, when it turns on, is a real and accountable
              business, not a hobby donation link. Until then we are in beta, and
              everything, including sharing and real-time collaboration, is{" "}
              <b className="text-foreground">free right now</b>.
            </p>
          </Section>
        </div>
      </div>

      <AppFooter />
    </div>
  );
}

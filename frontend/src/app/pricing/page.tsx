import type { Metadata } from "next";

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
    "The ResearchOS local notebook is free and open source forever. The only paid parts are optional cloud storage and the optional AI assistant, both metered at cost. Individuals and labs pay what it costs us, larger institutions pay a little more to keep it free for everyone else. See the competitor savings, the plan builders, the AI pricing, and the actual cost math. Everything is free during the beta.",
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

const AI_ITEMS: FeatureItem[] = [
  {
    icon: "heart",
    title: "About 750,000 free tokens to start",
    body: [
      "Every new account gets a one-time gift of about 750,000 AI tokens to try BeakerBot, no card needed. How far they stretch depends on what you ask. A quick question is cheap, a full analysis costs more, and the gift works out to roughly 20 to 25 full analyses or over 100 quick questions. Plenty to see what BeakerBot does over your own data before you spend anything.",
    ],
  },
  {
    icon: "gauge",
    title: "Then prepaid top-ups, near cost",
    body: [
      "After the gift runs out you buy a prepaid top-up, and each task draws down what it actually cost us to run plus a thin buffer for processing. Because a full analysis is about a penny of compute, a $10 top-up is hundreds of analyses. You always see your token balance and what the last task cost. No subscription, you pay only for what you use.",
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
  return (
    <div className="min-h-screen bg-surface-sunken">
      <MarketingNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-border bg-surface">
          <PricingHero />

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
                About 750,000 free AI tokens
              </div>
              <p className="mt-1 text-[13px] font-semibold text-foreground-muted">
                a one-time sign-up gift, about 20 to 25 full analyses or over 100
                quick questions
              </p>
            </div>
            <FeatureGrid items={AI_ITEMS} />
            <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
              <b className="text-foreground">Why no final AI prices yet.</b> We
              hold the exact top-up prices until a few real tasks show what they
              actually cost, the same way we set storage from data instead of
              guessing. The free sign-up gift is set so realistic use lands near
              25 cents of compute, and during the beta the AI is free.
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

      <MarketingFooter />
    </div>
  );
}

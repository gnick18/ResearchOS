import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";
import MadeInMadison from "@/components/MadeInMadison";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import FeatureGrid, { type FeatureItem } from "@/components/pricing/FeatureGrid";
import { Section, SectionHeading } from "@/components/pricing/Section";
import PlanPriceCallout from "@/components/marketing/PlanPriceCallout";
import { isAiBillingEnabled, isBillingEnabled } from "@/lib/billing/config";

/**
 * Public `/pricing` route, rebuilt for Model A (2026-06-16): a local-first
 * cloud-SERVICES company, pay-for-what-you-use. The local app is free and open
 * source forever; paid plans are a small base fee plus your actual cloud usage,
 * billed off an accrued ledger (run at ~$5 owed or at close). Every dollar figure
 * comes from the shared PlanPriceCallout (lib/billing/catalog), the single source,
 * so this page, /labs, /departments, and the chooser never drift.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "The ResearchOS local notebook is free and open source forever. Paid plans are pay-for-what-you-use, a small base fee plus your actual cloud usage, with a cap you set. Solo, Lab, and Department, plus a separate metered AI assistant and storage at roughly cost.",
};

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
    title: "Then prepaid top-ups, at a small markup",
    body: [
      "After the gift runs out you buy a prepaid top-up, and each task draws down a small markup over what it actually cost us to run. Because a full task is only a couple cents of compute, a $10 top-up is a few hundred tasks. You always see your token balance and what the last task cost. No subscription, you pay only for what you use.",
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
    title: "Or have your lab or department cover it",
    body: [
      "A lab or department can fund a shared pool, so members use BeakerBot without paying out of pocket. The whole AI meter stays a small markup over our measured cost, never the money-maker.",
    ],
  },
];

const SUPPORT_ITEMS: FeatureItem[] = [
  {
    icon: "database",
    title: "Buy only the cloud you use",
    body: [
      "The most direct support is to pay for the cloud services you actually use, and no more. Pay-for-what-you-use keeps us sustainable without you overpaying for capacity you do not need.",
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

// ---- A paid plan card (price comes from the shared PlanPriceCallout) ----
function PlanCard({
  eyebrow,
  planId,
  features,
}: {
  eyebrow: string;
  planId: "solo" | "lab" | "dept";
  features: { icon: IconName; text: ReactNode }[];
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
      <div className="text-[11px] font-extrabold uppercase tracking-widest text-brand-action">
        {eyebrow}
      </div>
      <div className="mt-3">
        <PlanPriceCallout planId={planId} />
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-body text-foreground-muted">
            <span aria-hidden className="mt-0.5 text-brand-action">
              <Icon name={f.icon} className="h-4 w-4" />
            </span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is the app really free?",
    a: "Yes. The local notebook and every feature on your own machine are free and open source forever. You only pay for the optional cloud services that send, co-edit, and sync your work beyond your own disk.",
  },
  {
    q: "How am I billed?",
    a: "Prices show per month, but we bill off a running balance to avoid per-charge fees. We only run your card once you have built up about $5, or when you close your account, so in practice it is a couple of charges a year, never a monthly nickel-and-dime. You set a monthly cap, so cloud sync pauses before any surprise and the local app keeps working.",
  },
  {
    q: "Do my lab members pay?",
    a: "No. Only the lab head pays. Members join free with an invite, and they are never asked for a card. A joining member should accept the invite, not start a new lab.",
  },
  {
    q: "Why is a department cheaper per lab than a standalone lab?",
    a: "Because a department brings many labs at once, which is our distribution win, so we reward it with a volume discount instead of taxing it. The governance layer (the Commons, compliance, and one consolidated invoice) is included value, not a premium.",
  },
  {
    q: "Why is this so much cheaper than LabArchives or Benchling?",
    a: "Because the app is local-first, your everyday work never touches our servers, so we only bill the small slice you sync. Storage is billed at roughly cost, and even our usage markup lands far below a per-seat license.",
  },
];

export default function PricingPage() {
  // TEMP: hide the public pricing page on deployed builds while pricing is
  // finalized (Grant + Emile sign-off). Shows a Beaker maintenance state on
  // prod/preview; the real page renders in local `next dev`. Set PRICING_LIVE=true
  // to expose it, or remove this block once pricing is locked.
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
          <Link
            href="/"
            className="mt-7 rounded-full border border-border px-5 py-2 text-meta font-medium text-foreground hover:bg-surface"
          >
            Back to home
          </Link>
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
          {/* HERO */}
          <Section className="text-center">
            <h1 className="mx-auto max-w-[22ch] text-3xl font-extrabold leading-[1.08] tracking-tight text-brand-ink dark:text-foreground sm:text-4xl">
              The app is free. You pay only for the cloud you use.
            </h1>
            <p className="mx-auto mt-4 max-w-[62ch] text-body leading-relaxed text-foreground-muted sm:text-title">
              ResearchOS is local-first, so your everyday work never touches our
              servers. The notebook is free and open source forever. Paid plans
              are pay-for-what-you-use, a small base fee plus your actual cloud
              usage, with a monthly cap you set.
              {billingEnabled ? "" : " Everything is free during the beta."}
            </p>
          </Section>

          {/* PLANS: Free on-ramp + three customer types */}
          <Section id="plans">
            <SectionHeading
              title="Pick what fits who you are"
              subtitle="Free is the on-ramp for everyone. The paid plans are priced for three different people, not stacked tiers, an individual researcher, a lab head, and a department."
            />

            {/* Free banner */}
            <div className="mb-5 flex flex-col items-start justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 p-5 sm:flex-row sm:items-center dark:border-green-900/40 dark:bg-green-950/20">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold text-green-700">
                    Free
                  </span>
                  <span className="text-title font-extrabold text-brand-ink dark:text-foreground">
                    For everyone, to start
                  </span>
                </div>
                <p className="mt-1 max-w-[64ch] text-body text-foreground-muted">
                  $0, no card. Unlimited local notebook, receive work others
                  share with you, directory presence, and a one-time gift of
                  about 1.6M AI tokens. Sending, co-editing, and pairing the app
                  are the paid part.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex flex-none items-center gap-2 rounded-xl border border-green-300 bg-white px-5 py-2.5 text-body font-semibold text-green-800 transition-colors hover:border-green-500"
              >
                Start free
              </Link>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <PlanCard
                eyebrow="For one researcher"
                planId="solo"
                features={[
                  { icon: "share", text: "Send and co-edit your work with anyone" },
                  { icon: "camera", text: "Pair the companion app for bench capture" },
                  { icon: "bell", text: "Push notifications and cross-device sync" },
                ]}
              />
              <PlanCard
                eyebrow="For a lab head"
                planId="lab"
                features={[
                  { icon: "users", text: "One shared workspace for your whole team" },
                  { icon: "pencil", text: "Real-time co-editing and PI oversight" },
                  { icon: "reference", text: "Your lab's web home and paper companion pages" },
                  { icon: "check", text: "You pay; your members join free" },
                ]}
              />
              <PlanCard
                eyebrow="For a department"
                planId="dept"
                features={[
                  { icon: "folder", text: "Many labs under one admin" },
                  { icon: "lock", text: "The Commons, compliance, and data continuity" },
                  { icon: "reference", text: "One consolidated procurement invoice" },
                  { icon: "check", text: "Cheaper per lab than a standalone lab" },
                ]}
              />
            </div>

            <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
              <b className="text-foreground">Joining a lab is free.</b> Only the
              lab head pays. If your PI invited you, accept the invite, do not
              start a new lab.
              {billingEnabled
                ? ""
                : " During the beta every plan is free."}
            </p>
          </Section>

          {/* BeakerBot AI */}
          <Section id="ai-pricing">
            <SectionHeading
              title="BeakerBot, an AI assistant over your own data, free to start"
              subtitle="BeakerBot reasons over your notes and results, runs an analysis, makes a plot, and writes it up, always with your approval. It is a separate metered token product, because each task calls a hosted model that costs real money. Every new account starts with a free batch of tokens, and after that it is priced at a small markup over our measured cost."
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
              <Link
                href="/ai"
                className="inline-flex items-center gap-1.5 text-body font-bold text-brand-action transition-colors hover:text-brand-ink"
              >
                See everything BeakerBot can do <span aria-hidden>&rarr;</span>
              </Link>
            </p>
            {!aiBillingEnabled && (
              <p className="mx-auto mt-5 max-w-2xl border-t border-dashed border-border pt-3.5 text-center text-[12px] leading-relaxed text-foreground-muted">
                During the beta the AI is free.
              </p>
            )}
          </Section>

          {/* How you pay (the model + the cadence) */}
          <Section className="bg-surface-raised">
            <SectionHeading
              title="How you pay, in plain terms"
              subtitle="No per-gigabyte meter, no surprise bills. A small base fee plus the cloud you actually use, and storage at roughly what it costs us."
            />
            <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
              {[
                {
                  icon: "gauge" as IconName,
                  h: "Pay for what you use",
                  p: "A small base fee plus your actual cloud usage at a fair markup. Storage is a-la-carte at roughly our cost, never a profit center.",
                },
                {
                  icon: "reference" as IconName,
                  h: "Billed a couple times a year",
                  p: "Shown per month, but we run your card only once you owe about $5, or when you close. A running balance, not a monthly bill.",
                },
                {
                  icon: "lock" as IconName,
                  h: "A cap you control",
                  p: "Set a monthly cap and cloud sync pauses before any surprise charge. The local app and your data always keep working.",
                },
              ].map((c) => (
                <div key={c.h} className="rounded-2xl border border-border bg-surface p-5">
                  <span aria-hidden className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-sky/10 text-brand-action">
                    <Icon name={c.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="text-body font-extrabold text-brand-ink dark:text-foreground">{c.h}</h3>
                  <p className="mt-1.5 text-meta leading-relaxed text-foreground-muted">{c.p}</p>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-5 max-w-2xl text-center text-[12.5px] leading-relaxed text-foreground-muted">
              Every unit is a fraction of a per-seat ELN. LabArchives alone is
              about $27.50 per user per month, so a six-seat lab there is roughly
              $165 a month, far above a lab here.
            </p>
          </Section>

          {/* Supporting us */}
          <Section>
            <SectionHeading
              title="Want to support the project?"
              subtitle="There are two good ways, and one of them sends more of your money to the actual work."
            />
            <FeatureGrid items={SUPPORT_ITEMS} />
          </Section>

          {/* FAQ */}
          <Section>
            <SectionHeading title="Questions, answered" />
            <div className="mx-auto max-w-3xl divide-y divide-border">
              {FAQ.map((f) => (
                <div key={f.q} className="py-4">
                  <h3 className="text-body font-extrabold text-brand-ink dark:text-foreground">{f.q}</h3>
                  <p className="mt-1.5 text-body leading-relaxed text-foreground-muted">{f.a}</p>
                </div>
              ))}
            </div>
          </Section>

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
              so paid plans are a real and accountable business, not a hobby
              donation link.{" "}
              {billingEnabled || aiBillingEnabled ? (
                <>Cloud usage and AI are billed at a fair markup, and storage at roughly cost.</>
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

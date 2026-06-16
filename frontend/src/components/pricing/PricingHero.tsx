/**
 * Hero for /pricing. Leads with the core promise from BILLING_FACTS, the
 * notebook is free and you pay only for optional cloud storage. When billing
 * is off (BILLING_ENABLED unset), shows a beta-free pill. When billing is on,
 * the pill is replaced with a live-pricing note. CTAs are honest, "Start free"
 * enters the app, "See the plans" jumps to the plan picker by anchor.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

interface PricingHeroProps {
  billingEnabled: boolean;
}

export default function PricingHero({ billingEnabled }: PricingHeroProps) {
  return (
    <section className="border-b border-border bg-surface-raised px-6 py-10 text-center sm:px-8">
      <div
        aria-hidden
        className="brand-rainbow-bg mx-auto mb-5 h-1.5 w-32 rounded-full"
      />
      <p className="text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-brand-action">
        Pricing
      </p>
      <h1 className="mx-auto mb-3 mt-2.5 max-w-[26ch] text-2xl font-extrabold leading-tight text-brand-ink dark:text-foreground sm:text-3xl lg:text-4xl">
        The notebook is free. You pay only for optional cloud storage.
      </h1>
      <p className="mx-auto mb-4 max-w-[60ch] text-[14.5px] leading-relaxed text-foreground-muted">
        ResearchOS runs on your own computer, so your everyday research never
        touches our servers. The local notebook is free and open source forever.
        Cloud storage is the one optional add on, priced to cover what it costs
        us. Larger institutions pay a little above that, and the surplus keeps
        ResearchOS free for individual researchers.
      </p>
      <div className="flex flex-wrap justify-center gap-2.5">
        <a
          href="/"
          className="btn-brand rounded-xl px-5 py-2.5 text-[13.5px] font-bold"
        >
          Start free
        </a>
        <a
          href="#plans"
          className="rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-[13.5px] font-bold text-foreground transition-colors hover:border-foreground-muted"
        >
          See the plans
        </a>
      </div>
      <div className="mt-4">
        {billingEnabled ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3.5 py-1.5 text-[12px] font-semibold text-foreground-muted">
            Cloud storage and the AI are billed at what they cost us.
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full border border-green-600/30 bg-green-600/[0.11] px-3.5 py-1.5 text-[12px] font-semibold text-green-700 dark:border-green-400/30 dark:text-green-400">
            <span className="h-[7px] w-[7px] rounded-full bg-green-600 dark:bg-green-400" />
            Billing is off during the beta, so every plan is free right now.
          </span>
        )}
      </div>
    </section>
  );
}

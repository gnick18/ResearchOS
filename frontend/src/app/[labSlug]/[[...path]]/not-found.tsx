import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";

/**
 * Generic public 404 for the top-level optional-catch-all route. Because
 * [labSlug] is the segment that catches any path with no matching static route,
 * this renders for BOTH a missing lab companion page AND any unknown or retired
 * top-level path (a typo, an old bookmark, the retired /welcome route, ...), so
 * the copy is deliberately generic. The earlier lab-specific wording ("this lab
 * page does not exist, published lab pages stay live") was misleading on a plain
 * unknown path, which is the far more common case.
 *
 * It is a calm public 404 on the shared marketing chrome with explicit escape
 * affordances (home + the researcher network), so a wrong / lapsed / retired URL
 * is never a soft-lock (per the project's no-soft-locks rule).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
export default function MarketingNotFound() {
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="soft" />
        <div className="relative z-10 mx-auto max-w-lg px-6 pb-24 pt-24 text-center sm:pt-32">
          <h1 className="text-display font-bold tracking-tight text-foreground">
            Page not found
          </h1>
          <p className="mt-3 text-body text-foreground-muted">
            The page you are looking for does not exist or may have moved. Check
            the address, or head back home.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-full bg-brand-action px-5 py-2.5 text-meta font-semibold text-white transition-opacity hover:opacity-90"
            >
              Go home
            </Link>
            <Link
              href="/network"
              className="rounded-full border border-border bg-surface-raised px-5 py-2.5 text-meta font-semibold text-foreground transition-colors hover:border-brand-action/40"
            >
              Researcher network
            </Link>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}

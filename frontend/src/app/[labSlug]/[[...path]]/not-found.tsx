import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";

/**
 * Not-found state for the public lab companion-site route (lab-domains Phase 2).
 *
 * Rendered whenever the route notFound()s: the feature flag is off, the slug is
 * not a lab, the lab has no site, or the page is missing / unpublished. It is a
 * calm public 404 on the shared marketing chrome with explicit escape
 * affordances (home + the researcher network), so a wrong / lapsed / draft URL is
 * never a soft-lock (per the project's no-soft-locks rule).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
export default function LabSiteNotFound() {
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
            This lab page does not exist, has not been published, or its address
            has changed. Published lab pages stay live, so a citation link will
            keep working once it is set up.
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

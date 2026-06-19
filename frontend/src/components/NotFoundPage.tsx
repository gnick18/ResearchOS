import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";

/**
 * Branded public 404 used by EVERY notFound() state in the app.
 *
 * Rendered by both the root app/not-found.tsx (which catches explicit
 * notFound() calls from static routes, e.g. /network when the social layer
 * ships dark) and the top-level optional-catch-all app/[labSlug]/[[...path]]
 * not-found.tsx (which catches any unknown or retired top-level path). Sharing
 * one component keeps every 404 on the same marketing chrome, so a wrong,
 * lapsed, or flag-gated URL never falls through to the raw default 404 screen.
 *
 * It is a calm public 404 with explicit escape affordances, so a wrong /
 * lapsed / retired URL is never a soft-lock (per the project's no-soft-locks
 * rule). The "Researcher network" link is only shown when the social layer is
 * enabled, so the 404 never links to a route that itself 404s.
 *
 * It assumes NO AppShell and NO connected folder (it renders on the shared
 * marketing chrome), so it is safe on a fully public 404.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
export default function NotFoundPage() {
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
            {SOCIAL_LAYER_ENABLED ? (
              <Link
                href="/network"
                className="rounded-full border border-border bg-surface-raised px-5 py-2.5 text-meta font-semibold text-foreground transition-colors hover:border-brand-action/40"
              >
                Researcher network
              </Link>
            ) : null}
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}

"use client";

// Public lab companion-site page view (lab-domains Phase 2, social lane).
//
// Renders ONE published markdown page on the public marketing chrome (the same
// MarketingNav / MarketingBackdrop / MarketingFooter used by /institution/[slug]
// and /network), so a published lab page is a calm, login-free public surface.
// The body is plain markdown rendered through the EXISTING RenderedMarkdown
// component (the canonical read-only markdown view); the live-visualizer block
// system is Phase 3, so Phase 2 is text/markdown only.
//
// The server route (app/[labSlug]/[[...path]]) decides visibility (flag on, slug
// is a lab, page published) and only mounts this for a real published page, so
// this component is a pure presenter. Reached only when NEXT_PUBLIC_LAB_SITES is
// effectively on (the route 404s otherwise), so it never ships visible by default.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import RenderedMarkdown from "@/components/RenderedMarkdown";

export default function LabSitePageView({
  slug,
  title,
  bodyMd,
}: {
  slug: string;
  title: string;
  bodyMd: string;
}) {
  const heading = title?.trim() || slug;
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="soft" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pb-16 pt-14 sm:pt-20">
          <p className="text-meta font-medium text-foreground-muted">
            <Link
              href={`/${slug}`}
              className="text-brand-action underline-offset-2 hover:underline"
            >
              {slug}
            </Link>
          </p>
          <h1 className="mt-2 text-display font-bold tracking-tight text-foreground">
            {heading}
          </h1>

          <RenderedMarkdown
            content={bodyMd ?? ""}
            className="prose prose-gray mt-8 max-w-none dark:prose-invert"
          />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

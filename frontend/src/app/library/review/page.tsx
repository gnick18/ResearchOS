import type { Metadata } from "next";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import ReviewQueue from "@/components/library/ReviewQueue";

/**
 * Public `/library/review` route: the wiki-style peer-review queue for
 * community-contributed icons (Part 3b). Renders the live queue when the
 * contribution feature is on, otherwise a coming-soon placeholder so the IA
 * resolves.
 */
export const metadata: Metadata = {
  title: "Help review submissions | ResearchOS open library",
  description:
    "Review community-contributed scientific icons. Vouch for accurate, openly licensed icons or flag the ones that are not. An independent reviewer clears each unverified flag.",
};

const REVIEW_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

export default function ReviewPage() {
  if (REVIEW_ENABLED) return <ReviewQueue />;

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pb-14 pt-16 text-center sm:pt-24">
          <div className="flex justify-center">
            <Kicker>Help review</Kicker>
          </div>
          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Help keep the library accurate
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-foreground-muted">
            Community-contributed icons are checked by other researchers,
            wiki-style. The review queue is coming with the contribution feature.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/library"
              className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold transition hover:border-brand-action"
            >
              <Icon name="chevronLeft" className="h-4 w-4" /> Back to the library
            </Link>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}

import Link from "next/link";

import Wordmark from "@/components/Wordmark";

/**
 * Sticky top nav for the public marketing pages (pricing, transparency,
 * open-source, thanks, privacy, about). Minimal and light, the same five
 * destinations everywhere so a prospective user always has the wordmark home
 * link, the credibility pages, and the two calls to action in reach.
 *
 * Transparency earns a nav slot because it is the most credibility-moving page
 * for an institution deciding whether to trust the tool with their data.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */
const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Product", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Transparency", href: "/transparency" },
  { label: "Docs", href: "/wiki" },
  { label: "About", href: "/about" },
];

export default function MarketingNav({
  className = "",
}: {
  className?: string;
}) {
  return (
    <header
      data-testid="marketing-nav"
      className={`sticky top-0 z-30 border-b border-border bg-surface-raised/90 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <Link href="/" aria-label="ResearchOS home" className="inline-flex shrink-0">
          <Wordmark size="sm" animated={false} markEasterEgg="none" />
        </Link>

        <nav
          aria-label="Marketing"
          className="hidden items-center gap-5 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="text-meta font-medium text-foreground-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="text-meta font-medium text-foreground-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Open app
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center justify-center rounded-lg bg-brand-action px-3.5 py-1.5 text-meta font-semibold text-white transition-colors hover:bg-brand-action/90"
          >
            Try the demo
          </Link>
        </div>
      </div>
    </header>
  );
}

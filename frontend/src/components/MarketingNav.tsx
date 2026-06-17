"use client";

import { useState } from "react";
import Link from "next/link";

import Wordmark from "@/components/Wordmark";
import { Icon } from "@/components/icons";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";

/**
 * Sticky top nav for the public marketing pages (pricing, transparency,
 * open-source, thanks, privacy, about). Minimal and light, the same
 * destinations everywhere so a prospective user always has the wordmark home
 * link, the credibility pages, and the two calls to action in reach.
 *
 * Transparency earns a nav slot because it is the most credibility-moving page
 * for an institution deciding whether to trust the tool with their data.
 *
 * On a phone the link row collapses into a menu button (the marketing pages are
 * meant to read on any device), so the destinations stay reachable instead of
 * vanishing below the md breakpoint.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */
const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Product", href: "/" },
  { label: "BeakerBot", href: "/ai" },
  { label: "Labs", href: "/labs" },
  { label: "Departments", href: "/departments" },
  { label: "Library", href: "/library" },
  // Social layer (Phase A), behind NEXT_PUBLIC_SOCIAL_LAYER so flag-off is unchanged.
  ...(SOCIAL_LAYER_ENABLED ? [{ label: "Network", href: "/network" }] : []),
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
  const [open, setOpen] = useState(false);

  return (
    <header
      data-testid="marketing-nav"
      className={`sticky top-0 z-30 border-b border-border bg-surface-raised/90 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <Link href="/" aria-label="ResearchOS home" className="inline-flex shrink-0">
          <Wordmark size="sm" animated={false} markEasterEgg="none" />
        </Link>

        {/* Desktop link row. */}
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
            className="hidden text-meta font-medium text-foreground-muted underline-offset-2 transition-colors hover:text-foreground hover:underline sm:inline"
          >
            Open app
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center justify-center rounded-lg bg-brand-action px-3.5 py-1.5 text-meta font-semibold text-white transition-colors hover:bg-brand-action/90"
          >
            Try the demo
          </Link>
          {/* Mobile menu toggle, only below md where the link row is hidden. */}
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:text-foreground md:hidden"
          >
            <Icon name={open ? "close" : "list"} className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel. Rendered in-flow under the bar so it pushes
          nothing off-screen; closes on any link tap. */}
      {open && (
        <nav
          aria-label="Marketing"
          className="border-t border-border bg-surface-raised px-6 py-2 md:hidden"
        >
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.href + link.label}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-body font-medium text-foreground-muted transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="block py-2.5 text-body font-medium text-foreground-muted transition-colors hover:text-foreground"
              >
                Open app
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

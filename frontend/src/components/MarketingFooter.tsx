import Link from "next/link";

import MadeInMadison from "@/components/MadeInMadison";
import Wordmark from "@/components/Wordmark";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";

/**
 * Rich marketing footer for the public pages (welcome, pricing, transparency,
 * open-source, thanks, privacy, about). The in-app and operator pages keep the
 * brand-only AppFooter, so the heavy footer only ever shows on the surfaces a
 * prospective user reads before they sign in.
 *
 * Four columns plus a thin legal bottom row, kept airy on purpose. The second
 * column ("Open and trustworthy") is the differentiator, the open-source,
 * data-ownership, and validation pages that set ResearchOS apart from a closed
 * cloud notebook, so they get their own column rather than a buried link.
 *
 * Every link points at a route that actually exists today. Terms has no page
 * yet, so it is intentionally absent from the bottom row.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons. State the why
 * where a benefit is asserted.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";
const GITHUB_DISCUSSIONS_URL =
  "https://github.com/gnick18/ResearchOS/discussions";
const CONTACT_EMAIL = "researchos.llc@gmail.com";

type FooterLink = {
  label: string;
  href: string;
  /** External links open in a new tab and skip the Next Link wrapper. */
  external?: boolean;
};

type FooterColumn = {
  heading: string;
  links: FooterLink[];
};

const COLUMNS: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/#stack" },
      { label: "BeakerBot AI", href: "/ai" },
      { label: "Pricing", href: "/pricing" },
      { label: "Live demo", href: "/demo" },
      { label: "Icon library", href: "/library" },
      // Social layer (Phase A), behind NEXT_PUBLIC_SOCIAL_LAYER so flag-off is unchanged.
      ...(SOCIAL_LAYER_ENABLED
        ? [{ label: "Researcher network", href: "/network" }]
        : []),
      { label: "Docs", href: "/wiki" },
    ],
  },
  {
    heading: "Open and trustworthy",
    links: [
      { label: "Transparency", href: "/transparency" },
      { label: "Open source and credits", href: "/open-source" },
      {
        label: "Security and data ownership",
        href: "/wiki/compliance/nih-data-management",
      },
      { label: "Sponsors and thanks", href: "/thanks" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: `mailto:${CONTACT_EMAIL}`, external: true },
      { label: "GitHub", href: GITHUB_URL, external: true },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Getting started", href: "/wiki/getting-started" },
      { label: "Help", href: "/wiki/start-here" },
      { label: "Community", href: GITHUB_DISCUSSIONS_URL, external: true },
    ],
  },
];

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className =
    "text-meta text-foreground-muted underline-offset-2 transition-colors hover:text-foreground hover:underline";
  if (link.external) {
    const isMail = link.href.startsWith("mailto:");
    return (
      <a
        href={link.href}
        className={className}
        {...(isMail
          ? {}
          : { target: "_blank", rel: "noopener noreferrer" })}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export default function MarketingFooter({
  className = "",
}: {
  className?: string;
}) {
  return (
    <footer
      data-testid="marketing-footer"
      className={`relative border-t border-border bg-surface-raised ${className}`}
    >
      {/* Brand rainbow hairline along the top edge, the same liquid ramp as the
          banner and avatars, used as a quiet brand signature. */}
      <div
        aria-hidden
        className="brand-rainbow-bg absolute inset-x-0 top-0 h-[3px]"
      />

      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-meta font-semibold uppercase tracking-wide text-foreground">
                {column.heading}
              </h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Thin legal bottom row: brand sign-off on the left, legal links on the
            right (Terms, Privacy, the AGPLv3 license). */}
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-foreground-muted">
            <Wordmark
              size="sm"
              animated={false}
              markEasterEgg="none"
              textClassName="text-foreground"
            />
            <span>LLC, a registered Wisconsin company</span>
            <span aria-hidden="true">·</span>
            <MadeInMadison variant="line" tone="soft" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-foreground-muted">
            <Link
              href="/terms"
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Terms
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              href="/privacy"
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              href="/open-source"
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              License (AGPLv3)
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Site-wide recognition for higher-tier sponsors.
 *
 * Lab ($25) and Institute ($100) backers earn a logo and link wherever this
 * strip is mounted (the welcome page and the wiki footer). Institute is
 * featured first and larger, Lab is secondary. Bench ($5) is thanks-page only
 * and never appears here. See docs/proposals/THANKS_PAGE.md.
 *
 * Empty by design: with no Lab or Institute sponsors the component renders
 * nothing at all, so the strip stays invisible until a real sponsor is added.
 *
 * Styling uses semantic theme tokens so it works in light and dark mode.
 */

import { sponsors, type Sponsor } from "@/data/sponsors";

type Variant = "welcome" | "wiki-footer";

/** Benefactor first, then Patron. Backer is dropped entirely. */
function featuredSponsors(): Sponsor[] {
  const order: Record<string, number> = { benefactor: 0, patron: 1 };
  return sponsors
    .filter((s) => s.tier === "patron" || s.tier === "benefactor")
    .sort((a, b) => order[a.tier] - order[b.tier]);
}

function SponsorItem({
  sponsor,
  variant,
}: {
  sponsor: Sponsor;
  variant: Variant;
}) {
  const isBenefactor = sponsor.tier === "benefactor";

  // Benefactor renders larger than Patron; the whole strip is more compact in
  // the wiki footer than on the welcome page.
  let logoHeight: string;
  if (variant === "wiki-footer") {
    logoHeight = isBenefactor ? "h-8" : "h-6";
  } else {
    logoHeight = isBenefactor ? "h-12" : "h-8";
  }

  const inner = sponsor.logo ? (
    <img
      src={sponsor.logo}
      alt={sponsor.name}
      className={`${logoHeight} w-auto`}
    />
  ) : (
    <span
      className={`font-semibold text-foreground ${
        isBenefactor ? "text-title" : "text-body"
      }`}
    >
      {sponsor.name}
    </span>
  );

  if (sponsor.url) {
    return (
      <a
        href={sponsor.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center transition-opacity hover:opacity-80"
      >
        {inner}
      </a>
    );
  }
  return <span className="inline-flex items-center">{inner}</span>;
}

export default function SponsorStrip({ variant }: { variant: Variant }) {
  const featured = featuredSponsors();

  // Critical empty state: render nothing when there are no higher-tier
  // sponsors. No heading, no wrapper, no whitespace.
  if (featured.length === 0) {
    return null;
  }

  if (variant === "wiki-footer") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border px-6 py-6 text-foreground-muted">
        <span className="text-meta font-medium uppercase tracking-wider">
          Supported by
        </span>
        {featured.map((s) => (
          <SponsorItem key={s.name} sponsor={s} variant="wiki-footer" />
        ))}
      </div>
    );
  }

  return (
    <section className="px-6 py-12 text-center">
      <p className="mb-6 text-meta font-bold uppercase tracking-wider text-foreground-muted">
        Supported by these labs
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {featured.map((s) => (
          <SponsorItem key={s.name} sponsor={s} variant="welcome" />
        ))}
      </div>
    </section>
  );
}

export { featuredSponsors };

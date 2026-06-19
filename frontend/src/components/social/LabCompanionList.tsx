"use client";

// Lab companion-page listing (Phase 1, lab-site network presence).
//
// Lists the lab's published paper-companion pages (native pages whose path starts
// with "papers/") and links to them. The paper-companion convention is path-based
// (no page-type field), so any published page under "papers/*" appears here. A
// BYO companion link is shown when hasByo is true, pointing at the lab's own
// static bundle served from the .com subdomain. No schema change needed.
//
// Cookie isolation: no session, no folder. Safe on the .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { LAB_SITE_BYO_PREFIX } from "@/lib/social/lab-byo";
import { labLinkBase, labSamePath } from "@/lib/social/lab-collab";
import type { PublishedPageEntry } from "@/lib/social/lab-site-db";

export default function LabCompanionList({
  slug,
  pages,
  hasByo,
}: {
  /** The lab slug. Used to build hrefs. */
  slug: string;
  /**
   * All published pages for the lab (already ordered by orderNavPages). The
   * component filters to those under "papers/*". When the filtered list is empty
   * AND hasByo is false, nothing renders.
   */
  pages: PublishedPageEntry[];
  /**
   * True when this lab has a BYO static bundle. Controlled by the route via
   * isLabByoSitesEnabled() + getByoSiteByOwner(), so the BYO link is inert
   * whenever the BYO flag is off.
   */
  hasByo: boolean;
}) {
  // Paper companions are any published page whose path is under "papers/".
  const companions = pages.filter(
    (p) => p.path === "papers" || p.path.startsWith("papers/"),
  );

  // Build the BYO href using the same derivation as LabDirectoryCard and
  // LabSiteSwitcher so all three agree on where the bundle lives.
  const onComOrigin = LAB_SITES_COM_ORIGIN_ENABLED;
  const labHost = `${slug}.research-os.com`;
  const byoHref = onComOrigin
    ? `https://${labHost}${LAB_SITE_BYO_PREFIX}/`
    : `https://${labHost}`;
  // Same-origin companion links: slug-less on the subdomain, slug-prefixed on the
  // app origin (the proxy already prepends the slug on the subdomain).
  const linkBase = labLinkBase(slug, onComOrigin);

  const hasNativeCompanions = companions.length > 0;
  const hasAny = hasNativeCompanions || hasByo;

  if (!hasAny) return null;

  return (
    <section aria-labelledby="companions-heading" className="mt-10">
      <h2
        id="companions-heading"
        className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <Icon name="file" className="h-4 w-4 text-foreground-muted" />
        Paper companions
      </h2>

      <ul className="space-y-2">
        {companions.map((entry) => {
          const href = labSamePath(linkBase, entry.path);
          return (
            <li key={entry.path}>
              <Link
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-border-strong"
              >
                <Icon
                  name="reference"
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <span className="flex-1 text-sm font-medium text-foreground group-hover:text-brand-action">
                  {entry.title || entry.path}
                </span>
                <Icon
                  name="chevronRight"
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
              </Link>
            </li>
          );
        })}

        {hasByo && (
          <li>
            <a
              href={byoHref}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-border-strong"
            >
              <Icon
                name="box"
                className="h-4 w-4 shrink-0 text-foreground-muted"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground group-hover:text-brand-action">
                  Paper companion (BYO)
                </span>
                <span className="block font-mono text-[11px] text-foreground-muted">
                  {labHost}
                </span>
              </span>
              <Icon
                name="export"
                className="h-4 w-4 shrink-0 text-foreground-muted"
              />
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

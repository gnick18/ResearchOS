"use client";

// Lab site/BYO switcher (Phase 1, lab-site network presence).
//
// A presentational control showing the two publishing surfaces a lab can have:
// the native wizard-authored site (always present) and the BYO static bundle
// (optional, only shown when hasByo is true). The current surface is highlighted.
// Clicking the other card navigates there.
//
// URL derivation mirrors LabDirectoryCard's `onComOrigin` branch so the switcher
// and the card agree on where the two sites live. Before the research-os.com
// cutover (flag off) the native site is the app-origin path (/<slug>) and the
// BYO bundle is the bare subdomain. After cutover (flag on) the native site IS
// the subdomain root and the BYO bundle is under /_site there.
//
// Cookie isolation: no session, no folder. Safe on the .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { LAB_SITE_BYO_PREFIX } from "@/lib/social/lab-byo";
import { Icon } from "@/components/icons";

/** Which surface is currently being viewed. Controls the "Viewing" badge. */
type CurrentSurface = "native" | "byo";

export default function LabSiteSwitcher({
  slug,
  hasByo,
  current,
}: {
  /** The lab slug. Used to build the native and BYO hrefs. */
  slug: string;
  /**
   * True when this lab has an uploaded BYO static bundle. When false, the BYO
   * card is not rendered (only the native card appears, with no "Viewing" badge
   * since there is nothing to switch between). The route sets this from
   * isLabByoSitesEnabled() plus a getByoSiteByOwner() read.
   */
  hasByo: boolean;
  /** Which surface is currently rendered. Defaults to "native". */
  current?: CurrentSurface;
}) {
  // When there is no BYO site, the switcher has nothing to switch between so it
  // should not render at all. The route controls `hasByo`, which is false when
  // isLabByoSitesEnabled() is off, so the BYO card is inert by flag inheritance.
  if (!hasByo) return null;

  const onComOrigin = LAB_SITES_COM_ORIGIN_ENABLED;
  const labHost = `${slug}.research-os.com`;

  // Native site URL: app-origin path before cutover, subdomain root after.
  const nativeHref = onComOrigin ? `https://${labHost}` : `/${slug}`;
  const nativeLabel = onComOrigin ? labHost : `research-os.app/${slug}`;

  // BYO site URL: bare subdomain before cutover (only the lab's own domain is
  // available for BYO then), the /_site/ prefix after.
  const byoHref = onComOrigin
    ? `https://${labHost}${LAB_SITE_BYO_PREFIX}/`
    : `https://${labHost}`;

  const viewing = current ?? "native";

  return (
    <div className="mb-6">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
        This lab publishes two sites
      </p>
      <div className="flex flex-wrap gap-2">
        {/* Native lab site card */}
        <a
          href={nativeHref}
          aria-current={viewing === "native" ? "true" : undefined}
          className={`flex min-w-[200px] flex-1 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
            viewing === "native"
              ? "border-brand-action bg-brand-action/5 ring-1 ring-brand-action"
              : "border-border bg-surface hover:border-border-strong"
          }`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              viewing === "native"
                ? "bg-white text-brand-action"
                : "bg-surface-raised text-foreground-muted"
            }`}
          >
            <Icon name="book" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              Lab site
            </span>
            <span className="block truncate font-mono text-[11px] text-foreground-muted">
              {nativeLabel}
            </span>
          </span>
          {viewing === "native" && (
            <span className="shrink-0 text-[10px] font-semibold text-brand-action">
              Viewing
            </span>
          )}
        </a>

        {/* BYO paper companion card */}
        <a
          href={byoHref}
          aria-current={viewing === "byo" ? "true" : undefined}
          className={`flex min-w-[200px] flex-1 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
            viewing === "byo"
              ? "border-brand-action bg-brand-action/5 ring-1 ring-brand-action"
              : "border-border bg-surface hover:border-border-strong"
          }`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              viewing === "byo"
                ? "bg-white text-brand-action"
                : "bg-surface-raised text-foreground-muted"
            }`}
          >
            <Icon name="box" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              Paper companion (BYO)
            </span>
            <span className="block truncate font-mono text-[11px] text-foreground-muted">
              {labHost}
            </span>
          </span>
          {viewing === "byo" && (
            <span className="shrink-0 text-[10px] font-semibold text-brand-action">
              Viewing
            </span>
          )}
        </a>
      </div>
    </div>
  );
}

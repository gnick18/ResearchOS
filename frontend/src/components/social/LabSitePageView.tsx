"use client";

// Public lab companion-site page view (lab-domains Phase 2 + Phase 1 enrichment,
// social lane).
//
// Renders ONE published markdown page on the public marketing chrome (the same
// MarketingNav / MarketingBackdrop / MarketingFooter used by /institution/[slug]
// and /network), so a published lab page is a calm, login-free public surface.
// The body is plain markdown rendered through the EXISTING RenderedMarkdown
// component (the canonical read-only markdown view); the live-visualizer block
// system is Phase 3, so Phase 2 is text/markdown only.
//
// Phase 1 enrichment. When the server route passes publishedPages + currentPath +
// hasByo, the page gains a full header (LabIdentityHeader, demo-only for Phase 1
// via card), a cross-page subnav (LabSiteNav), a site switcher
// (LabSiteSwitcher, only when hasByo), a companion listing (LabCompanionList),
// and a copyable citation block (LabCitation). All are inert when their props are
// absent or empty, so old callers that omit the new props are byte-identical.
//
// The server route (app/[labSlug]/[[...path]]) decides visibility (flag on, slug
// is a lab, page published) and only mounts this for a real published page, so
// this component is a pure presenter. Reached only when NEXT_PUBLIC_LAB_SITES is
// effectively on (the route 404s otherwise), so it never ships visible by default.
//
// Cookie isolation: no session, no folder. Safe on the .com origin. Every new
// component is pure presentational (read-side only).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import LabSiteBlockView from "@/components/social/LabSiteBlockView";
import DemoSampleLabRibbon from "@/components/social/DemoSampleLabRibbon";
import LabIdentityHeader from "@/components/social/LabIdentityHeader";
import LabSiteNav from "@/components/social/LabSiteNav";
import LabSiteSwitcher from "@/components/social/LabSiteSwitcher";
import LabCompanionList from "@/components/social/LabCompanionList";
import LabCitation from "@/components/social/LabCitation";
import LabCollaborationActions from "@/components/social/LabCollaborationActions";
import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { labLinkBase, labSamePath } from "@/lib/social/lab-collab";
import BadgePublicView from "@/components/badges/BadgePublicView";
import type { BadgeSnapshot } from "@/lib/badges/snapshot";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { HostedAssetEntry } from "@/lib/social/lab-site-hosted";
import type { PublishedPageEntry } from "@/lib/social/lab-site-db";
import { isDemoLabSlug, type DemoLabCard } from "@/lib/social/demo-lab";
import { parseLabSiteBlocks } from "@/lib/social/lab-site-blocks";

// The app origin for building the "Manage this site" deep link. Read at build
// time (no window access) so SSR and client hydration agree. Falls back to
// the canonical app URL so the link is correct even when the env var is absent.
const APP_ORIGIN =
  (process.env.NEXT_PUBLIC_APP_BASE_URL ?? "https://research-os.app").replace(
    /\/+$/,
    "",
  );

export default function LabSitePageView({
  slug,
  title,
  bodyMd,
  blocksJson,
  snapshots,
  hostedAssets,
  publishedPages,
  currentPath,
  hasByo,
  card,
  badgeSnapshot,
}: {
  slug: string;
  title: string;
  bodyMd: string;
  /**
   * The block-based page body (P1 companion builder). When non-null, the page
   * is a BLOCKS page rendered via LabSiteBlockView; bodyMd is ignored. When
   * null, the page is a markdown page rendered via RenderedMarkdown (existing
   * behavior, byte-identical to pre-P1). The server route passes this from
   * lab_site_pages.blocks_json when non-null.
   *
   * The snapshots map (below) is also used for baked block embeds: each data
   * block's sourceId is the key (same href convention as markdown embeds).
   */
  blocksJson?: string | null;
  /**
   * Frozen baked-block snapshots keyed by embed link href (Phase 3b). Passed
   * from the server route as a plain record (serializable across the
   * server/client boundary); rebuilt into the Map RenderedMarkdown / LabSiteBlockView expect.
   * Absent / empty means a text-only page or a page published before Phase 3b,
   * and any block embed then renders the calm unavailable card. A public reader
   * has no local workspace, so blocks render FROZEN, never live.
   */
  snapshots?: Record<string, BakedEmbed>;
  /**
   * Live hosted dataset assets keyed by embed link href (Phase 4a). Passed
   * from the server route as a plain record (serializable across the boundary),
   * rebuilt into the Map RenderedMarkdown expects. When an embed href has an
   * entry, it renders the LIVE DuckDB-WASM viewer reading the Parquet on R2;
   * otherwise the frozen baked snapshot (Phase 3b). Absent / empty means a
   * page with no hosted data, byte-identical to Phase 3b.
   */
  hostedAssets?: Record<string, HostedAssetEntry>;
  /**
   * Published pages for this lab in convention order (home, people, papers,
   * rest). Passed from the server route. When empty, the subnav is omitted so
   * old single-page renders are byte-identical to before.
   */
  publishedPages?: PublishedPageEntry[];
  /**
   * The normalized path of the currently-rendered page (empty string = home).
   * Used to highlight the active subnav item and for the citation block.
   */
  currentPath?: string;
  /**
   * True when this lab has a BYO static bundle. Controls LabSiteSwitcher and
   * the BYO entry in LabCompanionList. Defaults to false.
   */
  hasByo?: boolean;
  /**
   * The lab profile that drives the header, collaboration CTAs, and citation.
   * The demo lab uses DEMO_LAB_CARD; a real LISTED lab uses a card assembled from
   * existing data (getLabPublicCard, no schema change). Null for an unlisted or
   * unknown lab, which falls back to the bare breadcrumb page.
   */
  card?: DemoLabCard | null;
  /**
   * The lab's published badge snapshot (badges phase 2). Passed only on the
   * home page (normPath === "") and only when BADGES_ENABLED is true; undefined
   * on every subpage and when the flag is off. BadgePublicView no-ops on an
   * empty snapshot, so a lab that has never published badges renders nothing.
   */
  badgeSnapshot?: BadgeSnapshot;
}) {
  const heading = title?.trim() || slug;
  // Rebuild the Map from the serialized record once per snapshots object.
  // Used by both RenderedMarkdown (markdown path) and LabSiteBlockView (blocks
  // path); the same keying convention applies to both.
  const bakedEmbeds = useMemo(
    () => new Map<string, BakedEmbed>(Object.entries(snapshots ?? {})),
    [snapshots],
  );
  // Rebuild the hosted-asset Map (Phase 4a).
  const hostedAssetsMap = useMemo(
    () => new Map<string, HostedAssetEntry>(Object.entries(hostedAssets ?? {})),
    [hostedAssets],
  );
  // Parse the blocks array once per blocksJson string. A null/absent blocksJson
  // means this is a markdown page; a non-null string (even "[]") is a blocks page.
  const parsedBlocks = useMemo(
    () => (blocksJson != null ? parseLabSiteBlocks(blocksJson) : null),
    [blocksJson],
  );
  // True when this page is a blocks page (P1 companion builder path).
  const isBlocksPage = parsedBlocks !== null;
  // Demo framing is DEMO-SLUG-SCOPED so it can never appear on a real lab's site.
  const isDemo = isDemoLabSlug(slug);
  const pages = publishedPages ?? [];
  const normPath = currentPath ?? "";
  const byoActive = hasByo ?? false;
  // Same-origin link base: slug-less on the cookie-isolated subdomain, slug-prefixed
  // on the app origin. Used for the non-demo breadcrumb below; the child components
  // derive the same base the same way.
  const linkBase = labLinkBase(slug, LAB_SITES_COM_ORIGIN_ENABLED);

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      {isDemo && <DemoSampleLabRibbon tone="page" />}

      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="soft" />
        {/* Wide structural container so the page uses the full screen width
            (header, switcher, nav, companions, collaboration grid, citation), with
            the long-form body prose constrained to a readable line length below. */}
        <div className="relative z-10 mx-auto max-w-[90rem] px-6 pb-16 pt-14 sm:px-8 sm:pt-20">

          {/* Lab identity header. The demo lab and any LISTED real lab get the
              full header (card from getLabPublicCard). */}
          {card ? (
            <LabIdentityHeader card={card} />
          ) : (
            /* Fallback breadcrumb for a lab with no public card (unlisted or
               unknown). Byte-identical to the pre-Phase-4 render. */
            <p className="text-meta font-medium text-foreground-muted">
              <Link
                href={labSamePath(linkBase, "")}
                className="text-brand-action underline-offset-2 hover:underline"
              >
                {slug}
              </Link>
            </p>
          )}

          {/* Site switcher: only renders when hasByo is true. */}
          <LabSiteSwitcher
            slug={slug}
            hasByo={byoActive}
            current="native"
          />

          {/* Cross-page subnav. Omitted when pages is empty. */}
          <LabSiteNav
            slug={slug}
            currentPath={normPath}
            pages={pages}
          />

          {/* Page title. Shown only when the identity header is not providing it
              (i.e. not the home page with a demo card showing the lab name). */}
          {!(card && normPath === "") && (
            <h1 className="mt-2 text-display font-bold tracking-tight text-foreground">
              {heading}
            </h1>
          )}

          {isBlocksPage ? (
            /* P1 blocks path: render via LabSiteBlockView. The bakedEmbeds map
               is passed so data blocks use frozen snapshots on the public page.
               A public reader has no local workspace so live embeds are never
               used here; the map replaces the live ObjectEmbed path entirely. */
            <div className="mt-8">
              <LabSiteBlockView
                blocks={parsedBlocks ?? []}
                bakedEmbeds={bakedEmbeds}
              />
            </div>
          ) : (
            /* Legacy markdown path: byte-identical to pre-P1. */
            <RenderedMarkdown
              content={bodyMd ?? ""}
              className="prose prose-gray mt-8 max-w-3xl dark:prose-invert"
              bakedEmbeds={bakedEmbeds}
              hostedAssets={hostedAssetsMap}
            />
          )}

          {/* Companion listing (paper pages + BYO link). */}
          <LabCompanionList
            slug={slug}
            pages={pages}
            hasByo={byoActive}
          />

          {/* Collaboration CTAs (Phase 2). Deep links to research-os.app for all
              session-dependent actions (send data, reach out, request data).
              Find people stays on the lab origin (read-only People page). Cite
              is handled by LabCitation below and is NOT duplicated here.
              Absent for non-demo labs until Phase 4 adds a lab_sites profile. */}
          {card && <LabCollaborationActions card={card} />}

          {/* Copyable citation block. Only when we have a lab profile. */}
          {card && (
            <LabCitation
              card={card}
              pageTitle={title}
              pagePath={normPath}
            />
          )}

          {/* Achievement badges (badges phase 2, flag-gated, dark by default).
              Only on the home page so the section does not repeat on subpages.
              The snapshot is parsed by the server route (parseBadgeSnapshotJson)
              and passed here; BadgePublicView no-ops on an empty snapshot so a
              lab that has never published badges renders nothing. When the flag
              is off this renders nothing and the page is byte-identical. */}
          {badgeSnapshot && (
            <BadgePublicView snapshot={badgeSnapshot} />
          )}

          {/* "Manage this site" quiet affordance (Option B seamless nav).
              A non-authed link to the builder on research-os.app. Visible to
              everyone, but styled as a minimal, unobtrusive footer-level hint
              so it does not distract public readers. The PI or any granted
              editor who clicks it lands on the sign-in-gated /account/lab-site
              page; if they are already signed in on .app they land directly.
              No session is read here: this is a static deep link, not an
              authed-aware probe. No cookie is set or sent on this page.
              Only shown when the .com origin cutover is on (otherwise the site
              is at research-os.app/<slug> and the builder is reachable directly)
              and only for real labs (the demo ribbon handles the demo case). */}
          {LAB_SITES_COM_ORIGIN_ENABLED && !isDemo && (
            <div className="mt-10 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="globe" className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span>Is this your lab?</span>
              <a
                href={`${APP_ORIGIN}/account/lab-site`}
                className="text-brand-action underline-offset-2 hover:underline"
              >
                Manage this site
              </a>
              <span>on research-os.app.</span>
            </div>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

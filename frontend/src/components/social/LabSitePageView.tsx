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
// via demoCard), a cross-page subnav (LabSiteNav), a site switcher
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

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import DemoSampleLabRibbon from "@/components/social/DemoSampleLabRibbon";
import LabIdentityHeader from "@/components/social/LabIdentityHeader";
import LabSiteNav from "@/components/social/LabSiteNav";
import LabSiteSwitcher from "@/components/social/LabSiteSwitcher";
import LabCompanionList from "@/components/social/LabCompanionList";
import LabCitation from "@/components/social/LabCitation";
import LabCollaborationActions from "@/components/social/LabCollaborationActions";
import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { labLinkBase, labSamePath } from "@/lib/social/lab-collab";
import { BADGES_ENABLED } from "@/lib/badges/config";
import BadgeSection, { demoBadgeMetrics } from "@/components/badges/BadgeSection";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { HostedAssetEntry } from "@/lib/social/lab-site-hosted";
import type { PublishedPageEntry } from "@/lib/social/lab-site-db";
import { isDemoLabSlug, type DemoLabCard } from "@/lib/social/demo-lab";

export default function LabSitePageView({
  slug,
  title,
  bodyMd,
  snapshots,
  hostedAssets,
  publishedPages,
  currentPath,
  hasByo,
  demoCard,
}: {
  slug: string;
  title: string;
  bodyMd: string;
  /**
   * Frozen baked-block snapshots keyed by embed link href (Phase 3b). Passed
   * from the server route as a plain record (serializable across the
   * server/client boundary); rebuilt into the Map RenderedMarkdown expects.
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
   * The demo lab profile for LabIdentityHeader. Non-null only when the slug is
   * the demo lab (demo-scoped, Phase 1). Real labs get no header until Phase 4
   * adds a lab_sites profile column (open question Q4).
   */
  demoCard?: DemoLabCard | null;
}) {
  const heading = title?.trim() || slug;
  // Rebuild the Map from the serialized record once per snapshots object.
  const bakedEmbeds = useMemo(
    () => new Map<string, BakedEmbed>(Object.entries(snapshots ?? {})),
    [snapshots],
  );
  // Rebuild the hosted-asset Map (Phase 4a).
  const hostedAssetsMap = useMemo(
    () => new Map<string, HostedAssetEntry>(Object.entries(hostedAssets ?? {})),
    [hostedAssets],
  );
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

          {/* Lab identity header (demo-only Phase 1, real labs Phase 4). */}
          {demoCard ? (
            <LabIdentityHeader card={demoCard} />
          ) : (
            /* Fallback breadcrumb for non-demo labs until Phase 4 adds the
               lab_sites profile column. Byte-identical to the Phase 2 render. */
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
          {!(demoCard && normPath === "") && (
            <h1 className="mt-2 text-display font-bold tracking-tight text-foreground">
              {heading}
            </h1>
          )}

          <RenderedMarkdown
            content={bodyMd ?? ""}
            className="prose prose-gray mt-8 max-w-3xl dark:prose-invert"
            bakedEmbeds={bakedEmbeds}
            hostedAssets={hostedAssetsMap}
          />

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
          {demoCard && <LabCollaborationActions card={demoCard} />}

          {/* Copyable citation block. Only when we have a lab profile. */}
          {demoCard && (
            <LabCitation
              card={demoCard}
              pageTitle={title}
              pagePath={normPath}
            />
          )}

          {/* Achievement badges (badges v1, flag-gated, dark by default). Only
              on the home page so it is not repeated on every subpage. Real
              activity metrics are not plumbed to this server route yet, so v1
              feeds the section representative demo metrics (the hook-in point
              for real metrics is BadgeSection's `metrics` prop). When the flag
              is off this renders nothing and the page is byte-identical. */}
          {BADGES_ENABLED && normPath === "" && (
            <BadgeSection profileId={slug} metrics={demoBadgeMetrics()} />
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

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

import { useMemo } from "react";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { HostedAssetEntry } from "@/lib/social/lab-site-hosted";

export default function LabSitePageView({
  slug,
  title,
  bodyMd,
  snapshots,
  hostedAssets,
}: {
  slug: string;
  title: string;
  bodyMd: string;
  /**
   * Frozen baked-block snapshots keyed by embed link href (Phase 3b). Passed from
   * the server route as a plain record (serializable across the server/client
   * boundary); rebuilt into the Map RenderedMarkdown expects. Absent / empty means
   * a text-only page or a page published before Phase 3b, and any block embed then
   * renders the calm unavailable card. A public reader has no local workspace, so
   * blocks render FROZEN, never live.
   */
  snapshots?: Record<string, BakedEmbed>;
  /**
   * Live hosted dataset assets keyed by embed link href (Phase 4a). Passed from
   * the server route as a plain record (serializable across the boundary), rebuilt
   * into the Map RenderedMarkdown expects. When an embed href has an entry, it
   * renders the LIVE DuckDB-WASM viewer reading the Parquet on R2; otherwise the
   * frozen baked snapshot (Phase 3b). Absent / empty means a page with no hosted
   * data, byte-identical to Phase 3b.
   */
  hostedAssets?: Record<string, HostedAssetEntry>;
}) {
  const heading = title?.trim() || slug;
  // Rebuild the Map from the serialized record once per snapshots object. An
  // empty / absent record yields an empty Map, which still routes every block
  // embed through the frozen path (each shows the unavailable card), never live.
  const bakedEmbeds = useMemo(
    () => new Map<string, BakedEmbed>(Object.entries(snapshots ?? {})),
    [snapshots],
  );
  // Rebuild the hosted-asset Map (Phase 4a). Empty / absent yields an empty Map,
  // so every embed routes through the baked path unchanged.
  const hostedAssetsMap = useMemo(
    () => new Map<string, HostedAssetEntry>(Object.entries(hostedAssets ?? {})),
    [hostedAssets],
  );
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
            bakedEmbeds={bakedEmbeds}
            hostedAssets={hostedAssetsMap}
          />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

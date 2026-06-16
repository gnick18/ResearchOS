import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LabSitePageView from "@/components/social/LabSitePageView";
import { isLabSitesEnabled } from "@/lib/social/config";
import { getPage, getSiteBySlug } from "@/lib/social/lab-site-db";
import { normalizePagePath, resolvePublicPage } from "@/lib/social/lab-site";
import { parseSnapshotBundle } from "@/lib/social/lab-site-snapshots";
import { parseHostedManifest } from "@/lib/social/lab-site-hosted";
import { normalizeSlug } from "@/lib/social/slug-registry";
import { getSlug } from "@/lib/social/slug-registry-db";

/**
 * Public lab companion-site route (lab-domains Phase 2, social lane).
 *
 *   research-os.app/<labSlug>            -> the lab site home page
 *   research-os.app/<labSlug>/<...path>  -> a nested published page
 *
 * This is a TOP-LEVEL optional-catch-all dynamic segment. Routing safety: Next.js
 * App Router always prefers a STATIC segment over a dynamic one, so every existing
 * top-level route (frontend/src/app/about, /network, /datahub, /api, ...) still
 * wins; this route only fires for a path whose first segment matches no static
 * directory. Phase 1's RESERVED_SLUGS additionally makes every one of those
 * static segments unclaimable as a lab slug, so a lab slug can never shadow a
 * real route even at registry-write time.
 *
 * Inertness: when isLabSitesEnabled() is false this immediately notFound()s, so
 * with the flag OFF the route is byte-identical to a missing route (a plain 404)
 * and the whole feature ships dark. It also notFound()s unless the slug resolves
 * in slug_registry as kind=lab, a lab_sites row exists, and the page status is
 * published. The render decision is the pure resolvePublicPage() so it is unit
 * tested exhaustively.
 *
 * Rendered without the AppShell or a connected folder (a public surface, like
 * /institution/[slug]). Reads env: LAB_SITES_ENABLED, DATABASE_URL.
 */
export const runtime = "nodejs";

type RouteParams = { labSlug: string; path?: string[] };

async function resolve(rawSlug: string, rawPath: string[] | undefined) {
  const slug = normalizeSlug(rawSlug);
  const path = normalizePagePath(rawPath);
  const flagEnabled = isLabSitesEnabled();
  if (!flagEnabled) {
    return { decision: { kind: "not-found" as const }, slug, path, page: null };
  }
  // Look up the registry row, the site, and the page. A DB outage must not crash
  // the public route; treat any failure as not-found so a 404 is the worst case.
  let slugRow = null;
  let hasSite = false;
  let page = null;
  try {
    slugRow = await getSlug(slug);
    const site = slugRow ? await getSiteBySlug(slug) : null;
    hasSite = site !== null;
    page = site ? await getPage(site.labOwnerKey, path) : null;
  } catch {
    return { decision: { kind: "not-found" as const }, slug, path, page: null };
  }
  const decision = resolvePublicPage({
    flagEnabled,
    slugRow,
    hasSite,
    page,
  });
  return { decision, slug, path, page };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { labSlug, path } = await params;
  const { decision, slug, page } = await resolve(labSlug, path);
  if (decision.kind !== "render" || !page) {
    return { title: "Not found | ResearchOS" };
  }
  const title = page.title?.trim() || slug;
  return {
    title: `${title} | ResearchOS`,
    description: `${title}, a published page on the ${slug} lab site on ResearchOS.`,
  };
}

export default async function LabSitePublicPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { labSlug, path } = await params;
  const { decision, slug, page } = await resolve(labSlug, path);
  if (decision.kind !== "render" || !page) notFound();
  // Resolve the frozen baked-block snapshots (Phase 3b). The public reader has no
  // local workspace, so the page renders these FROZEN snapshots instead of live
  // embeds. parseSnapshotBundle is defensive, a null / malformed column yields an
  // empty bundle and each embed then shows the calm unavailable card.
  const bundle = parseSnapshotBundle(page.snapshotsJson);
  // Phase 4a: the hosted dataset-asset manifest. parseHostedManifest is defensive,
  // a null / malformed column yields an empty manifest and the page renders no live
  // viewers (each embed falls back to its baked snapshot). When entries exist, the
  // matching embed renders the LIVE DuckDB-WASM viewer reading the Parquet on R2.
  const manifest = parseHostedManifest(page.hostedJson);
  return (
    <LabSitePageView
      slug={slug}
      title={page.title}
      bodyMd={page.bodyMd}
      snapshots={bundle.snapshots}
      hostedAssets={manifest.assets}
    />
  );
}

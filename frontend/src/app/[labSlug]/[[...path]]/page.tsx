import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";

import LabSitePageView from "@/components/social/LabSitePageView";
import {
  isLabByoSitesEnabled,
  isLabSitesComOriginEnabled,
  isLabSitesEnabled,
} from "@/lib/social/config";
import {
  getPage,
  getSiteBySlug,
  listPublishedPages,
} from "@/lib/social/lab-site-db";
import { normalizePagePath, resolvePublicPage } from "@/lib/social/lab-site";
import { labSlugFromHost } from "@/lib/social/lab-byo";
import { getByoSiteByOwner } from "@/lib/social/lab-byo-db";
import { parseSnapshotBundle } from "@/lib/social/lab-site-snapshots";
import { parseHostedManifest } from "@/lib/social/lab-site-hosted";
import { normalizeSlug } from "@/lib/social/slug-registry";
import { getSlug } from "@/lib/social/slug-registry-db";
import {
  DEMO_LAB_CARD,
  isDemoLabSlug,
} from "@/lib/social/demo-lab";

/**
 * Public lab companion-site route (lab-domains Phase 2, social lane).
 *
 * Canonical public home (research-os.com origin cutover):
 *   <labSlug>.research-os.com/           -> the lab site home page
 *   <labSlug>.research-os.com/<...path>  -> a nested published page
 * Middleware (proxy.ts) rewrites the lab subdomain to the internal /<labSlug>/<path>
 * this route serves, so the route itself is unchanged. When the cutover flag is on,
 * an old research-os.app/<labSlug> link 301s to the subdomain (below).
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
    return {
      decision: { kind: "not-found" as const },
      slug,
      path,
      page: null,
      publishedPages: [],
      hasByo: false,
    };
  }
  // Look up the registry row, the site, the page, the published-page list, and
  // the BYO state. A DB outage must not crash the public route; degrade to
  // not-found for any failure so a 404 is the worst case (never a 500).
  let slugRow = null;
  let hasSite = false;
  let page = null;
  let publishedPages: import("@/lib/social/lab-site-db").PublishedPageEntry[] =
    [];
  let hasByo = false;
  try {
    slugRow = await getSlug(slug);
    const site = slugRow ? await getSiteBySlug(slug) : null;
    hasSite = site !== null;
    if (site) {
      // Fetch the current page + the published list in parallel to keep latency
      // minimal. The BYO check is conditional on the BYO flag so it is a no-op
      // query when the flag is off.
      const [pageResult, pagesResult, byoResult] = await Promise.all([
        getPage(site.labOwnerKey, path),
        listPublishedPages(site.labOwnerKey).catch(() => []),
        isLabByoSitesEnabled()
          ? getByoSiteByOwner(site.labOwnerKey).catch(() => null)
          : Promise.resolve(null),
      ]);
      page = pageResult;
      publishedPages = pagesResult;
      hasByo = byoResult !== null;
    }
  } catch {
    return {
      decision: { kind: "not-found" as const },
      slug,
      path,
      page: null,
      publishedPages: [],
      hasByo: false,
    };
  }
  const decision = resolvePublicPage({
    flagEnabled,
    slugRow,
    hasSite,
    page,
  });
  return { decision, slug, path, page, publishedPages, hasByo };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { labSlug, path } = await params;
  const { decision, slug, page } = await resolve(labSlug, path);
  if (decision.kind !== "render" || !page) {
    return { title: "Not found" };
  }
  const title = page.title?.trim() || slug;
  return {
    title: title,
    description: `${title}, a published page on the ${slug} lab site on ResearchOS.`,
  };
}

export default async function LabSitePublicPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { labSlug, path } = await params;
  const {
    decision,
    slug,
    path: normPath,
    page,
    publishedPages,
    hasByo,
  } = await resolve(labSlug, path);
  if (decision.kind !== "render" || !page) notFound();
  // Origin cutover: when the research-os.com move is live (runtime flag), the
  // canonical home is the per-lab subdomain. Any hit NOT already on the lab's own
  // subdomain (an old research-os.app/<slug> link, a deployment URL, etc) 301s to
  // the subdomain for citation continuity. This uses ONLY runtime state (the flag
  // + the Host), no build-inlined NEXT_PUBLIC value, so it survives a cached
  // rebuild. The flag is production-scoped, so local dev and preview (flag off)
  // keep rendering the path form in place, and a request already on
  // <slug>.research-os.com renders normally (onSubdomain true, no loop).
  if (isLabSitesComOriginEnabled()) {
    const host = (await headers()).get("host");
    const onSubdomain = labSlugFromHost(host) === slug;
    if (!onSubdomain) {
      // A cross-origin redirect from a Server Component render returns a 200
      // client-side fallback, not a real 308, so hop through a same-origin route
      // handler (api/social/lab-site/goto) that issues the true 308 to the
      // subdomain. The slug is already DB-gated above (decision === render), so the
      // handler is just the cross-origin mechanism.
      const gotoParams = new URLSearchParams({ slug });
      if (normPath) gotoParams.set("path", normPath);
      console.log("[lab301-diag2] about to permanentRedirect", slug);
      permanentRedirect(`/api/social/lab-site/goto?${gotoParams.toString()}`);
      // SENTINEL: must never print. If it does, the NEXT_REDIRECT throw was caught.
      console.log("[lab301-diag2] AFTER permanentRedirect (throw swallowed!)", slug);
    }
  }
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
  // Phase 1: demo-only lab profile. When the slug is the demo lab, pass the
  // DEMO_LAB_CARD so LabIdentityHeader renders the rich lab header. Real labs
  // get no header until Phase 4 adds a lab_sites profile column (Q4).
  const demoCard = isDemoLabSlug(slug) ? DEMO_LAB_CARD : null;
  return (
    <LabSitePageView
      slug={slug}
      title={page.title}
      bodyMd={page.bodyMd}
      snapshots={bundle.snapshots}
      hostedAssets={manifest.assets}
      publishedPages={publishedPages}
      currentPath={normPath}
      hasByo={hasByo}
      demoCard={demoCard}
    />
  );
}

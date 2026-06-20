import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LabSitePageView from "@/components/social/LabSitePageView";
import ToolSitePageView from "@/components/social/ToolSitePageView";
import {
  isLabByoSitesEnabled,
  isLabSitesEnabled,
} from "@/lib/social/config";
import {
  getPage,
  getSiteBySlug,
  listPublishedPages,
} from "@/lib/social/lab-site-db";
import { normalizePagePath, resolvePublicPage } from "@/lib/social/lab-site";
import { getByoSiteByOwner } from "@/lib/social/lab-byo-db";
import { parseSnapshotBundle } from "@/lib/social/lab-site-snapshots";
import { parseHostedManifest } from "@/lib/social/lab-site-hosted";
import { normalizeSlug } from "@/lib/social/slug-registry";
import { getSlug } from "@/lib/social/slug-registry-db";
import {
  DEMO_LAB_CARD,
  isDemoLabSlug,
} from "@/lib/social/demo-lab";
// Phase A: tool-type repo render. Reads the tool connection metadata from the
// lab_tool_github table (created lazily by ensureLabToolSchema). Inert when no
// tool connection exists for the lab.
import { getToolByOwner } from "@/lib/social/lab-tool-db";
import { parseBadgeSnapshotJson, type BadgeSnapshot } from "@/lib/badges/snapshot";
import { BADGES_ENABLED } from "@/lib/badges/config";

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
  let toolRow: import("@/lib/social/lab-tool-db").LabToolGithubRow | null = null;
  let badgeSnapshotJson: string | null = null;
  try {
    slugRow = await getSlug(slug);
    const site = slugRow ? await getSiteBySlug(slug) : null;
    hasSite = site !== null;
    if (site) {
      // Carry the badge snapshot from the site row (null when never published).
      // parseBadgeSnapshotJson runs below in the render, so this just captures
      // the raw string here for serialization across the server/client boundary.
      badgeSnapshotJson = site.badgeSnapshotJson;
      // Fetch the current page, published list, BYO state, and tool connection
      // in parallel to keep latency minimal. The BYO and tool checks are each
      // conditional so they are no-op queries when the respective table is absent.
      const [pageResult, pagesResult, byoResult, toolResult] = await Promise.all([
        getPage(site.labOwnerKey, path),
        listPublishedPages(site.labOwnerKey).catch(() => []),
        isLabByoSitesEnabled()
          ? getByoSiteByOwner(site.labOwnerKey).catch(() => null)
          : Promise.resolve(null),
        // Phase A: try to read the tool connection metadata. Fails gracefully
        // (null) when the table does not exist or the lab has no tool connection.
        getToolByOwner(site.labOwnerKey).catch(() => null),
      ]);
      page = pageResult;
      publishedPages = pagesResult;
      hasByo = byoResult !== null;
      toolRow = toolResult;
    }
  } catch {
    return {
      decision: { kind: "not-found" as const },
      slug,
      path,
      page: null,
      publishedPages: [],
      hasByo: false,
      toolRow: null,
      badgeSnapshotJson: null,
    };
  }
  const decision = resolvePublicPage({
    flagEnabled,
    slugRow,
    hasSite,
    page,
  });
  return { decision, slug, path, page, publishedPages, hasByo, toolRow, badgeSnapshotJson };
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
    toolRow,
    badgeSnapshotJson,
  } = await resolve(labSlug, path);
  if (decision.kind !== "render" || !page) notFound();

  // Phase A: if this lab has a tool connection, render the software-companion
  // page view instead of the native lab-site page view. The tool row carries
  // the repo metadata for the header (name, description, language, license,
  // links). The page body (README or wiki page) is the same `page.bodyMd`
  // that the native view would use, because tool ingest stores its content in
  // the same lab-site page store. This branch is flag-gated by LAB_SITES_ENABLED
  // (the route 404s when the flag is off, so toolRow can only be non-null when
  // the flag is already on).
  if (toolRow) {
    const latestReleaseUrl =
      toolRow.latestRelease
        ? `${toolRow.htmlUrl}/releases/tag/${encodeURIComponent(toolRow.latestRelease)}`
        : null;
    return (
      <ToolSitePageView
        slug={slug}
        repoName={toolRow.repoName}
        repoDescription={toolRow.repoDescription}
        primaryLanguage={toolRow.primaryLanguage}
        license={toolRow.license}
        repoUrl={toolRow.htmlUrl}
        latestReleaseUrl={latestReleaseUrl}
        latestReleaseTag={toolRow.latestRelease}
        logoUrl={toolRow.logoUrl}
        bodyMd={page.bodyMd}
        publishedPages={publishedPages}
        currentPath={normPath}
      />
    );
  }

  // Origin cutover note: the research-os.com move 308s an old research-os.app/<slug>
  // link to the per-lab subdomain for citation continuity. That redirect lives in
  // middleware (proxy.ts, resolveAppOriginLabRedirect), NOT here: a Server Component
  // redirect to an external cross-origin URL renders a 200 client-side fallback (the
  // app gate then wins and shows the welcome page), never a real 3xx. So by the time
  // this route renders for a lab slug, the request is already on the subdomain.
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
  // Badges publish path: parse the stored snapshot (null -> empty, so a lab
  // with no published badges renders nothing). Only passed on the home path so
  // the badge section does not repeat on every subpage. The public page is
  // server-rendered and has no access to the local folder, so badges always
  // come from this published snapshot, never from live metrics.
  const badgeSnapshot: BadgeSnapshot | undefined =
    BADGES_ENABLED && normPath === ""
      ? parseBadgeSnapshotJson(badgeSnapshotJson)
      : undefined;
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
      badgeSnapshot={badgeSnapshot}
    />
  );
}

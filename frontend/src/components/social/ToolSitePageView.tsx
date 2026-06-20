"use client";

// Software-companion page view for a tool-type GitHub-connected repo
// (Phase A, social lane).
//
// Renders a native "software companion" page when classifyRepo() returns "tool".
// The layout mirrors LabSitePageView in structure (same marketing chrome, same
// RenderedMarkdown body, same LabSiteNav subnav) but leads with a tool-specific
// header showing the repo name, one-line description, language badge, license,
// and links to the GitHub repo and latest release.
//
// Why a distinct component rather than extending LabSitePageView: the tool header
// is structurally different (metadata grid vs. lab identity header), and keeping
// the two presenters separate avoids branching inside the shared component while
// still reusing every primitive (MarketingNav, RenderedMarkdown, LabSiteNav,
// labLinkBase/labSamePath).
//
// Cookie isolation: no session, no folder. Safe on the .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo } from "react";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import LabSiteNav from "@/components/social/LabSiteNav";
import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { labLinkBase } from "@/lib/social/lab-collab";
import type { PublishedPageEntry } from "@/lib/social/lab-site-db";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ToolSitePageViewProps {
  /** The lab slug (used to build same-origin hrefs via labLinkBase). */
  slug: string;

  // -- Tool metadata (passed from the server route) --

  /** The repo name used as the page heading (e.g. "starfish"). */
  repoName: string;
  /** Short description from GitHub, or null. */
  repoDescription: string | null;
  /** Primary language as reported by GitHub (e.g. "Perl"), or null. */
  primaryLanguage: string | null;
  /** SPDX license identifier (e.g. "MIT"), or null. */
  license: string | null;
  /** Canonical GitHub URL (e.g. "https://github.com/egluckthaler/starfish"). */
  repoUrl: string;
  /**
   * URL of the latest release on GitHub (e.g.
   * "https://github.com/egluckthaler/starfish/releases/tag/v1.2.3"), or null
   * when the repo has no releases.
   */
  latestReleaseUrl: string | null;
  /** Tag name of the latest release (e.g. "v1.2.3"), or null. */
  latestReleaseTag: string | null;
  /**
   * URL of a logo image asset found in the repo's assets/ directory, or null.
   * Rendered as a small logo next to the repo name when present.
   */
  logoUrl: string | null;

  // -- Page content --

  /** The markdown body for the current page (README or a wiki page). */
  bodyMd: string;

  // -- Nav --

  /**
   * Published pages for this lab in convention order. The home ("") is the
   * README; "wiki/*" pages are the ingested wiki pages. Passed from the
   * server route. When empty the subnav is omitted.
   */
  publishedPages?: PublishedPageEntry[];
  /**
   * The normalized path of the currently-rendered page (empty string = home /
   * README). Used to highlight the active subnav item.
   */
  currentPath?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A small language or license badge rendered in the tool header. */
function MetaBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
      {label}
    </span>
  );
}

/** External link with consistent open-in-new styling. */
function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-action underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ToolSitePageView({
  slug,
  repoName,
  repoDescription,
  primaryLanguage,
  license,
  repoUrl,
  latestReleaseUrl,
  latestReleaseTag,
  logoUrl,
  bodyMd,
  publishedPages,
  currentPath,
}: ToolSitePageViewProps) {
  const pages = useMemo(() => publishedPages ?? [], [publishedPages]);
  const normPath = currentPath ?? "";

  // Origin-aware same-origin link base (slug-less on the subdomain, slug-prefixed
  // on the app origin). Passed to LabSiteNav which calls labSamePath internally.
  const linkBase = labLinkBase(slug, LAB_SITES_COM_ORIGIN_ENABLED);
  void linkBase; // LabSiteNav reads labLinkBase itself; we compute it for potential future use.

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="soft" />

        <div className="relative z-10 mx-auto max-w-[90rem] px-6 pb-16 pt-14 sm:px-8 sm:pt-20">

          {/* Tool header: logo, name, description, language/license badges, links. */}
          <div className="mb-6">
            {/* Logo + name row */}
            <div className="flex items-center gap-3">
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- logo URL is from raw.githubusercontent.com, an external CDN; next/image cannot optimize cross-origin assets without an allowlist entry, and this is a low-traffic companion page with no LCP constraint.
                <img
                  src={logoUrl}
                  alt={`${repoName} logo`}
                  className="h-10 w-10 rounded-md object-contain"
                />
              )}
              <h1 className="text-display font-bold tracking-tight text-foreground">
                {repoName}
              </h1>
            </div>

            {/* One-line description */}
            {repoDescription && (
              <p className="mt-2 max-w-2xl text-base text-foreground-muted">
                {repoDescription}
              </p>
            )}

            {/* Badges and links row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {primaryLanguage && <MetaBadge label={primaryLanguage} />}
              {license && license !== "NOASSERTION" && (
                <MetaBadge label={license} />
              )}

              <ExternalLink href={repoUrl}>
                View on GitHub
              </ExternalLink>

              {latestReleaseUrl && latestReleaseTag && (
                <ExternalLink href={latestReleaseUrl}>
                  {latestReleaseTag}
                </ExternalLink>
              )}
            </div>
          </div>

          {/* Cross-page subnav (README = Home, wiki pages). */}
          <LabSiteNav
            slug={slug}
            currentPath={normPath}
            pages={pages}
          />

          {/* Body: README or wiki page rendered as markdown. */}
          <RenderedMarkdown
            content={bodyMd ?? ""}
            className="prose prose-gray mt-6 max-w-3xl dark:prose-invert"
          />

        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

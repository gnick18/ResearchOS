"use client";

// Lab site cross-page subnav (Phase 1, lab-site network presence).
//
// Renders the public subnav bar for a native lab site: Home / People / Papers /
// then any remaining pages in the convention-driven order produced by
// orderNavPages (in lab-site-db.ts). The convention is: home ("") first, then
// "people", then "papers/*", then the rest alphabetically. That order is stored
// and computed by orderNavPages at route time so the nav is unit-testable.
//
// The current path is highlighted. "Home" maps to the bare slug path ("").
// The active detection compares normalized paths so a trailing slash or
// capitalization mismatch does not create a ghost "current" indicator.
//
// Cookie isolation: no session, no folder. Safe on .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";
import type { PublishedPageEntry } from "@/lib/social/lab-site-db";
import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { labLinkBase, labSamePath } from "@/lib/social/lab-collab";

/** Human-readable label for a page path. "Home" for the root, otherwise title
 *  (with "Paper companion" shortened to "Papers" for top-level nav width). */
function navLabel(entry: PublishedPageEntry): string {
  if (entry.path === "") return "Home";
  if (entry.path === "people") return "People";
  // Top-level nav label for any papers/* page or a standalone "papers" page.
  if (entry.path === "papers" || entry.path.startsWith("papers/")) {
    return entry.title || "Paper companion";
  }
  return entry.title || entry.path;
}

export default function LabSiteNav({
  slug,
  currentPath,
  pages,
}: {
  /** The lab slug, used to build href values like /<slug>/people. */
  slug: string;
  /**
   * The normalized path of the currently-rendered page (empty string "" for
   * home). Used to highlight the active nav item.
   */
  currentPath: string;
  /**
   * Published pages in convention order (already sorted by orderNavPages in
   * lab-site-db.ts). Passed from the server route as a plain array.
   */
  pages: PublishedPageEntry[];
}) {
  if (pages.length === 0) return null;

  // Same-origin links must be slug-less on the cookie-isolated subdomain (the slug
  // is already the host there) and slug-prefixed on the app origin. Without this
  // the subdomain doubled the slug (<slug>.research-os.com/<slug>/people) and 404ed.
  const linkBase = labLinkBase(slug, LAB_SITES_COM_ORIGIN_ENABLED);

  return (
    <nav
      aria-label="Lab site pages"
      className="mb-5 flex flex-wrap gap-1.5"
    >
      {pages.map((entry) => {
        const href = labSamePath(linkBase, entry.path);
        const isActive = entry.path === currentPath;
        return (
          <Link
            key={entry.path}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-full bg-foreground px-3.5 py-1 text-xs font-medium text-surface"
                : "rounded-full border border-border bg-surface-raised px-3.5 py-1 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
            }
          >
            {navLabel(entry)}
          </Link>
        );
      })}
    </nav>
  );
}

// Session-aware network shell (social layer, /network logged-in view).
//
// Rendered server-side when the caller has an Auth.js session. It fetches:
//   1. The caller's account profile (handle + display name) for the left rail.
//   2. Their publicly listed labs via getResearcherPublicLabs (left rail).
//   3. Their own lab site via getSiteByOwner (Owner row in "Sites you can edit").
//   4. Sites they were GRANTED editor access to via listSitesEditableBy (Editor rows).
//
// A server component avoids a client-side waterfall: all four data needs resolve
// in parallel on the server before the first byte is sent to the browser.
//
// The logged-out public discovery surface (NetworkLanding) is NEVER altered by
// this component; it is rendered instead of this shell when there is no session.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import PublicResearcherSearch from "@/components/social/PublicResearcherSearch";
import { getAccountProfile } from "@/lib/account/account-profile";
import { getResearcherPublicLabs } from "@/lib/account/researcher-labs";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { listSitesEditableBy } from "@/lib/social/lab-site-editors-db";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditableSiteEntry {
  /** Slug that forms <slug>.research-os.com. */
  slug: string;
  /** Human-readable label for the site row. */
  label: string;
  /** The billing owner key (used to build the builder link). */
  ownerKey: string;
  /** "Owner" when the caller is the PI; "Editor" when they hold a grant. */
  role: "Owner" | "Editor";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
        active
          ? "bg-brand-action/10 font-semibold text-brand-action"
          : "text-foreground hover:bg-surface-sunken",
      ].join(" ")}
    >
      <span className="h-[15px] w-[15px] flex-none">{icon}</span>
      {label}
    </Link>
  );
}

function LabRow({
  name,
  slug,
  canEdit,
}: {
  name: string;
  slug: string | null;
  canEdit: boolean;
}) {
  const inner = (
    <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-surface-sunken">
      <span className="h-2 w-2 flex-none rounded-full bg-emerald-500" />
      <span className="flex-1 truncate">{name}</span>
      {canEdit && (
        <span className="rounded-[5px] border border-purple-400/50 px-1.5 py-0.5 text-[9.5px] font-bold text-purple-500 dark:text-purple-400">
          edit
        </span>
      )}
    </span>
  );
  if (slug) {
    return (
      <a
        href={`https://${slug}.research-os.com`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {inner}
      </a>
    );
  }
  return <span>{inner}</span>;
}

function SiteRow({ site }: { site: EditableSiteEntry }) {
  const builderHref = `/account/lab-site?siteOwnerKey=${encodeURIComponent(site.ownerKey)}`;
  return (
    <div className="flex items-center gap-2.5 border-t border-border py-2 text-[12.5px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <b className="block truncate text-foreground">
          {site.slug}.research-os.com
        </b>
        <span className="text-[11px] text-foreground-muted">{site.label}</span>
      </div>
      <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted">
        {site.role}
      </span>
      <Link
        href={builderHref}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] bg-gradient-to-r from-brand-action to-purple-500 px-2.5 py-1 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
      >
        <Icon name="pencil" className="h-3 w-3" />
        Build
      </Link>
    </div>
  );
}

// ── Main shell ───────────────────────────────────────────────────────────────

export interface NetworkAppShellProps {
  /** The caller's billing owner key (from session). */
  ownerKey: string;
  /** Email from session (shown as fallback when no profile exists). */
  sessionEmail: string;
}

export default async function NetworkAppShell({
  ownerKey,
  sessionEmail,
}: NetworkAppShellProps) {
  // Fetch all four data needs in parallel.
  const [profile, ownSite, editorSites] = await Promise.all([
    getAccountProfile(ownerKey).catch(() => null),
    getSiteByOwner(ownerKey).catch(() => null),
    listSitesEditableBy(ownerKey).catch(() => []),
  ]);

  const handle = profile?.handle ?? null;
  const displayName = profile?.displayName ?? sessionEmail.split("@")[0];

  // Fetch labs only when we have a handle (requires a second round-trip, but it
  // is already server-side so it does not block client rendering).
  const labs = handle
    ? await getResearcherPublicLabs(handle).catch(() => [])
    : [];

  // Build the unified "Sites you can edit" list.
  const editableSites: EditableSiteEntry[] = [];

  if (ownSite) {
    editableSites.push({
      slug: ownSite.labSlug,
      label: "Your lab site",
      ownerKey,
      role: "Owner",
    });
  }

  for (const s of editorSites) {
    editableSites.push({
      slug: s.labSlug,
      label: "Granted edit access by the PI",
      ownerKey: s.labOwnerKey,
      role: "Editor",
    });
  }

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join("");

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5">
        <span className="text-[15px] font-extrabold text-foreground">
          Research<span className="text-brand-action">OS</span>
          <span className="ml-1 text-foreground-muted">Network</span>
        </span>

        {/* Search, centred and capped */}
        <div className="flex flex-1 justify-center">
          <div className="w-full max-w-[420px]">
            <PublicResearcherSearch />
          </div>
        </div>

        {/* Right: user avatar links to own profile */}
        <div className="ml-auto flex items-center gap-2.5">
          {handle ? (
            <Link
              href={`/u/${handle}`}
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-purple-500 text-[11px] font-bold text-white"
              aria-label={`View your profile`}
            >
              {initials}
            </Link>
          ) : (
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-purple-500 text-[11px] font-bold text-white">
              {initials}
            </div>
          )}
        </div>
      </header>

      {/* ── Body grid: left rail / feed / right rail ─────────────────────── */}
      <div className="mx-auto grid max-w-6xl gap-0 md:grid-cols-[212px_1fr_230px]">
        {/* Left rail */}
        <aside className="border-r border-border px-3 py-4">
          {/* "You" card */}
          <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-border p-2.5">
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-purple-500 text-[11px] font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <b className="block truncate text-[13px] text-foreground">
                {displayName}
              </b>
              {handle ? (
                <Link
                  href={`/u/${handle}`}
                  className="text-[11px] text-foreground-muted hover:underline"
                >
                  View your profile
                </Link>
              ) : (
                <Link
                  href="/settings?section=profile"
                  className="text-[11px] text-brand-action hover:underline"
                >
                  Set up your profile
                </Link>
              )}
            </div>
          </div>

          {/* Nav items */}
          <NavItem
            href="/network"
            icon={<Icon name="network" className="h-full w-full" />}
            label="Home feed"
            active
          />
          {handle && (
            <NavItem
              href={`/u/${handle}`}
              icon={<Icon name="user" className="h-full w-full" />}
              label="Your profile"
            />
          )}
          <NavItem
            href="/network#find"
            icon={<Icon name="search" className="h-full w-full" />}
            label="Discover"
          />

          {/* Your labs */}
          {labs.length > 0 && (
            <>
              <p className="mb-1.5 ml-2.5 mt-3.5 text-[10.5px] font-bold uppercase tracking-wide text-foreground-muted">
                Your labs
              </p>
              {labs.map((lab) => (
                <LabRow
                  key={lab.name}
                  name={lab.name}
                  slug={lab.slug}
                  canEdit={lab.isPi}
                />
              ))}
            </>
          )}

          {/* Your department / institution (placeholder, no cheap data source yet) */}
          {profile?.affiliation && (
            <>
              <p className="mb-1.5 ml-2.5 mt-3.5 text-[10.5px] font-bold uppercase tracking-wide text-foreground-muted">
                Your department
              </p>
              <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-foreground">
                <span className="h-2 w-2 flex-none rounded-full bg-brand-action" />
                <span className="flex-1 truncate">{profile.affiliation}</span>
              </span>
            </>
          )}
        </aside>

        {/* Center feed */}
        <main className="min-w-0 p-4">
          {/* Sites you can edit */}
          {editableSites.length > 0 ? (
            <div className="mb-4 rounded-xl border border-border bg-purple-50/60 p-3.5 dark:bg-purple-500/[0.06]">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-purple-600 dark:text-purple-400">
                <Icon name="pencil" className="h-3.5 w-3.5" />
                Sites you can edit
              </h3>
              {editableSites.map((site) => (
                <SiteRow key={`${site.ownerKey}-${site.slug}`} site={site} />
              ))}
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-border bg-purple-50/60 p-3.5 dark:bg-purple-500/[0.06]">
              <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-purple-600 dark:text-purple-400">
                <Icon name="pencil" className="h-3.5 w-3.5" />
                Sites you can edit
              </h3>
              <p className="text-[12.5px] text-foreground-muted">
                No lab sites yet. Once you claim a lab slug or a PI grants you editor
                access, your sites will appear here.
              </p>
              <Link
                href="/account/lab-site"
                className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-action hover:underline"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Claim a lab site
              </Link>
            </div>
          )}

          {/* Feed placeholder. Real feed needs a data source: activity events
              (shares, publications, lab updates) stored server-side and scoped to
              the caller's follow graph or lab affiliations. That table does not
              exist yet; a feed-events API + follow-graph table are required before
              this can show real content. For now a calm empty state is rendered. */}
          <div className="rounded-xl border border-border p-4 text-center">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken">
              <Icon name="bell" className="h-5 w-5 text-foreground-muted" />
            </div>
            <p className="text-[13px] font-semibold text-foreground">
              Your feed is warming up
            </p>
            <p className="mt-1 text-[12px] text-foreground-muted">
              When labs you follow share work or publish companion sites, activity
              will appear here.
            </p>
            <Link
              href="/network#find"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-brand-action hover:text-brand-action"
            >
              <Icon name="search" className="h-3.5 w-3.5" />
              Discover researchers and labs
            </Link>
          </div>
        </main>

        {/* Right rail: suggestions placeholder (no cheap data source for
            "people you may know" or "labs near you" without a follow/location
            graph; rendered as a calm placeholder for now). */}
        <aside className="hidden border-l border-border px-3 py-4 md:block">
          <div className="rounded-xl border border-border p-3">
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
              People you may know
            </h4>
            <p className="text-[12px] text-foreground-muted">
              Suggestions will appear as more researchers join and the follow graph
              grows.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

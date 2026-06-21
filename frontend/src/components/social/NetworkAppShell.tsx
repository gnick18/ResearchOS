// Session-aware network shell (social layer, /network logged-in view).
//
// Rendered server-side when the caller has an Auth.js session. It fetches:
//   1. The caller's account profile (handle + display name) for the left rail.
//   2. Their own labs (listed or not) via getResearcherOwnLabs (left rail).
//   3. Their own lab site via getSiteByOwner (Owner row in "Sites you can edit").
//   4. Sites they were GRANTED editor access to via listSitesEditableBy (Editor rows).
//   5. When NETWORK_FEED_ENABLED: the real feed + follow suggestions from Neon.
//
// A server component avoids a client-side waterfall: all data needs resolve
// in parallel on the server before the first byte is sent to the browser.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import PublicResearcherSearch from "@/components/social/PublicResearcherSearch";
import { getAccountProfile } from "@/lib/account/account-profile";
import { getResearcherOwnLabs } from "@/lib/account/researcher-labs";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { listSitesEditableBy } from "@/lib/social/lab-site-editors-db";
import {
  NETWORK_FEED_ENABLED,
  isNetworkFeedEnabled,
} from "@/lib/social/config";
import {
  ensureNetworkFeedSchema,
  getNetworkFeed,
  getFollowSuggestions,
  type FeedEventCard,
  type FollowSuggestion,
} from "@/lib/social/network-feed-db";

// -- Types --------------------------------------------------------------------

interface EditableSiteEntry {
  slug: string;
  label: string;
  ownerKey: string;
  role: "Owner" | "Editor";
}

// -- Sub-components -----------------------------------------------------------

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
  // The owner's OWN site links to the bare builder (owner mode). Only a granted
  // editor carries siteOwnerKey, which the dashboard reads as delegate mode.
  // Passing the owner their own key would wrongly show the "editing on behalf of
  // its owner" delegate banner on their own site.
  const builderHref =
    site.role === "Owner"
      ? "/account/lab-site"
      : `/account/lab-site?siteOwnerKey=${encodeURIComponent(site.ownerKey)}`;
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

// -- Feed card renderer -------------------------------------------------------

/** Human-readable label for a feed event kind. */
function kindLabel(kind: string): string {
  switch (kind) {
    case "site_published": return "published a page";
    case "work_shared": return "shared their work";
    case "lab_joined": return "joined a lab";
    default: return kind.replace(/_/g, " ");
  }
}

function FeedCard({ event }: { event: FeedEventCard }) {
  const actor = event.actorDisplayName ?? event.actorHandle ?? "A researcher";
  const actorHref = event.actorHandle ? `/u/${event.actorHandle}` : null;

  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
          {actor.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground">
            {actorHref ? (
              <Link href={actorHref} className="font-semibold hover:underline">
                {actor}
              </Link>
            ) : (
              <span className="font-semibold">{actor}</span>
            )}{" "}
            {kindLabel(event.kind)}
            {event.subjectLabel ? (
              <>
                {": "}
                {event.targetSlug ? (
                  <a
                    href={`https://${event.targetSlug}.research-os.com`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-action hover:underline"
                  >
                    {event.subjectLabel}
                  </a>
                ) : (
                  <span className="font-medium">{event.subjectLabel}</span>
                )}
              </>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

// -- Suggestion card (right rail) ---------------------------------------------

function SuggestionRow({
  suggestion,
  viewerOwnerKey,
}: {
  suggestion: FollowSuggestion;
  viewerOwnerKey: string;
}) {
  return (
    <div className="flex items-center gap-2 py-2 first:pt-0">
      <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-purple-500 text-[9px] font-bold text-white">
        {(suggestion.displayName ?? suggestion.handle).slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/u/${suggestion.handle}`}
          className="block truncate text-[12px] font-semibold text-foreground hover:underline"
        >
          {suggestion.displayName ?? suggestion.handle}
        </Link>
        {suggestion.affiliation && (
          <span className="block truncate text-[10.5px] text-foreground-muted">
            {suggestion.affiliation}
          </span>
        )}
      </div>
      {/* Follow button posts to /api/social/network/follow. A full client
          component is out of scope; this is a plain form POST that reloads. */}
      <form
        method="POST"
        action="/api/social/network/follow"
        className="shrink-0"
      >
        <input type="hidden" name="followeeOwnerKey" value={suggestion.ownerKey} />
        <button
          type="submit"
          className="rounded-full border border-brand-action px-2.5 py-0.5 text-[11px] font-semibold text-brand-action transition-colors hover:bg-brand-action hover:text-white"
        >
          Follow
        </button>
      </form>
    </div>
  );
}

// -- Main shell ---------------------------------------------------------------

export interface NetworkAppShellProps {
  ownerKey: string;
  sessionEmail: string;
}

export default async function NetworkAppShell({
  ownerKey,
  sessionEmail,
}: NetworkAppShellProps) {
  // Fetch all core data needs in parallel.
  const [profile, ownSite, editorSites] = await Promise.all([
    getAccountProfile(ownerKey).catch(() => null),
    getSiteByOwner(ownerKey).catch(() => null),
    listSitesEditableBy(ownerKey).catch(() => []),
  ]);

  const handle = profile?.handle ?? null;
  const displayName = profile?.displayName ?? sessionEmail.split("@")[0];

  // Fetch the caller's OWN labs for the rail, keyed by their owner key directly.
  // This is their authenticated view, so it includes UNLISTED own labs (the
  // listed-only rule governs the public profile, not what you see of yourself,
  // Grant decision 2026-06-20).
  const labs = await getResearcherOwnLabs(ownerKey).catch(() => []);

  // Network feed + follow suggestions (only when the flag is on).
  let feed: FeedEventCard[] = [];
  let suggestions: FollowSuggestion[] = [];
  if (isNetworkFeedEnabled()) {
    try {
      await ensureNetworkFeedSchema();
      [feed, suggestions] = await Promise.all([
        getNetworkFeed(ownerKey).catch(() => []),
        getFollowSuggestions(ownerKey).catch(() => []),
      ]);
    } catch {
      // Schema provision failed; degrade gracefully to placeholders.
    }
  }

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
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5">
        <span className="text-[15px] font-extrabold text-foreground">
          Research<span className="text-brand-action">OS</span>
          <span className="ml-1 text-foreground-muted">Network</span>
        </span>

        <div className="flex flex-1 justify-center">
          <div className="w-full max-w-[420px]">
            <PublicResearcherSearch />
          </div>
        </div>

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

      {/* Body grid: left rail / feed / right rail */}
      <div className="mx-auto grid max-w-6xl gap-0 md:grid-cols-[212px_1fr_230px]">
        {/* Left rail */}
        <aside className="border-r border-border px-3 py-4">
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

          {/* Feed: real data when NETWORK_FEED_ENABLED, placeholder when off */}
          {NETWORK_FEED_ENABLED ? (
            feed.length > 0 ? (
              <div className="flex flex-col gap-3">
                {feed.map((event) => (
                  <FeedCard key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border p-4 text-center">
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken">
                  <Icon name="bell" className="h-5 w-5 text-foreground-muted" />
                </div>
                <p className="text-[13px] font-semibold text-foreground">
                  Your feed is quiet right now
                </p>
                <p className="mt-1 text-[12px] text-foreground-muted">
                  Follow researchers to see their activity here.
                </p>
                <Link
                  href="/network#find"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-brand-action hover:text-brand-action"
                >
                  <Icon name="search" className="h-3.5 w-3.5" />
                  Discover researchers and labs
                </Link>
              </div>
            )
          ) : (
            /* Placeholder: byte-identical to the original when the flag is off */
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
          )}
        </main>

        {/* Right rail: real suggestions when NETWORK_FEED_ENABLED, placeholder when off */}
        <aside className="hidden border-l border-border px-3 py-4 md:block">
          {NETWORK_FEED_ENABLED ? (
            <div className="rounded-xl border border-border p-3">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
                People you may know
              </h4>
              {suggestions.length > 0 ? (
                <div className="divide-y divide-border">
                  {suggestions.map((s) => (
                    <SuggestionRow
                      key={s.ownerKey}
                      suggestion={s}
                      viewerOwnerKey={ownerKey}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-foreground-muted">
                  No suggestions yet. More will appear as researchers join.
                </p>
              )}
            </div>
          ) : (
            /* Placeholder: byte-identical to the original when the flag is off */
            <div className="rounded-xl border border-border p-3">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
                People you may know
              </h4>
              <p className="text-[12px] text-foreground-muted">
                Suggestions will appear as more researchers join and the follow graph
                grows.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

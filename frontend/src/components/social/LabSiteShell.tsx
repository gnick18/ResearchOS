"use client";

// LabSiteShell: a full-width, left-navigable frame for the /account/lab-site
// dashboard (lab-site redesign). The dashboard used to render as a single
// ~768px column inside PortalShell with no left nav and no clear way in or out,
// so on a laptop it read as a narrow orphan page in a sea of empty space.
//
// This wraps the dashboard body in a real two-pane layout: a persistent left
// rail (lab-site identity + primary navigation, including a clear EXIT back to
// the app and to account settings, plus a View public site jump when the slug is
// claimed) next to a wide main content area. The frame FILLS the laptop width
// (no max-width cap, just comfortable gutters) instead of clamping to a fixed box,
// matching the full-width header above it; the fixed-width rail stays put while
// the main column grows into the reclaimed space. The rail collapses above the
// content on narrow screens so it stays usable on a phone.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Icons via <Icon>.

import type { ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { labSiteOrigin } from "@/lib/social/lab-byo";

export interface LabSiteShellProps {
  /** The lab's claimed slug, or null before it is claimed. Drives the public
   *  site link in the rail. */
  slug: string | null;
  /** The dashboard body (all the existing sections). */
  children: ReactNode;
  /** Demo walkthrough: hide the real exits (the demo is a public, no-session
   *  tour) so the rail stays a calm preview without dead-ending into the app. */
  demoReadOnly?: boolean;
}

function RailLink({
  href,
  icon,
  label,
  external,
}: {
  href: string;
  icon: IconName;
  label: string;
  external?: boolean;
}) {
  const className =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground";
  const inner = (
    <>
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export default function LabSiteShell({
  slug,
  children,
  demoReadOnly = false,
}: LabSiteShellProps) {
  const publicUrl = slug ? labSiteOrigin(slug) : null;
  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-10">
      <div className="grid gap-6 lg:grid-cols-[224px_minmax(0,1fr)] lg:items-start">
        {/* Left rail: identity + primary nav + clear exits. */}
        <aside className="lg:sticky lg:top-6">
          <div className="rounded-xl border border-border bg-surface-raised p-3">
            <div className="mb-3 flex items-center gap-2 px-1.5">
              <Icon name="globe" className="h-4 w-4 text-brand-action" />
              <span className="text-[13px] font-bold text-foreground">Lab site</span>
            </div>

            {publicUrl ? (
              <div className="mb-3 rounded-lg border border-border bg-surface-sunken p-2.5">
                <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                  Public address
                </p>
                <p className="mb-1 truncate text-[12px] font-medium text-foreground">
                  {slug}.research-os.com
                </p>
                <RailLink
                  href={publicUrl}
                  icon="globe"
                  label="View public site"
                  external
                />
              </div>
            ) : null}

            <nav className="flex flex-col gap-0.5">
              {!demoReadOnly ? (
                <>
                  <RailLink href="/" icon="library" label="Back to app" />
                  <RailLink href="/account" icon="user" label="Account" />
                  <RailLink
                    href="/settings?section=storage"
                    icon="receipt"
                    label="Usage and billing"
                  />
                </>
              ) : (
                <Tooltip label="The live page returns you to the app">
                  <span className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-foreground-muted opacity-70">
                    <Icon name="eye" className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">Preview mode</span>
                  </span>
                </Tooltip>
              )}
            </nav>
          </div>
        </aside>

        {/* Main content: the existing dashboard body, now full width. */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

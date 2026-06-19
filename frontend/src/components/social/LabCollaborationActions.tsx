"use client";

// Collaboration CTAs for the public lab page (Phase 2, lab-site network presence).
//
// Renders four actions a visitor can take toward a lab:
//   1. Send data / share work   -> deep link to research-os.app/network?share=<slug>
//   2. Reach out for collaboration -> deep link to research-os.app/u/<piHandle>
//   3. Request data             -> deep link to research-os.app/u/<piHandle>?compose=request
//   4. Find people / Cite       -> the lab's People page (same-origin nav, read-only)
//
// The lab page lives on the cookie-isolated .com origin (research-os.com) after
// the .com cutover, so NO action here can open the RecipientShareDialog in-page.
// Every action that needs a session deep-links to the app origin. The Find people
// link stays on the lab origin because the People page is a read-only published
// page and needs no session. The Cite CTA is NOT duplicated here because
// LabCitation (already mounted in LabSitePageView) handles that; this section
// only carries the outbound collaboration links.
//
// These are plain <a> anchors. No session read, no folder, no API. Safe on the
// .com origin. The external links open in the same tab so the visitor keeps full
// control of navigation (no target="_blank" surprises on click).
//
// Rendered only when LabSitePageView has a resolved demoCard (demo-scoped Phase 2).
// For real labs the caller passes null and nothing renders, so the pre-Phase-4
// lab pages are byte-identical to Phase 1.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  buildLabShareDeepLink,
  buildPiProfileDeepLink,
  buildRequestDataDeepLink,
  resolveLabRecipient,
} from "@/lib/social/lab-collab";
import type { DemoLabCard } from "@/lib/social/demo-lab";

/** The app origin to use for deep links. Read from the environment at build time
 *  so this stays pure (no window access, no canonicalAppOrigin() call inside JSX,
 *  which would differ between SSR and client hydration). The env var is set to
 *  https://research-os.app in production. Falls back to "https://research-os.app"
 *  so the links are correct even when the env is unset (e.g. a quick local build). */
const APP_ORIGIN =
  (process.env.NEXT_PUBLIC_APP_BASE_URL ?? "https://research-os.app").replace(
    /\/+$/,
    "",
  );

interface LabCollaborationActionsProps {
  /**
   * The demo lab card, used to resolve the PI for outbound deep links. When null
   * this component renders nothing so pre-Phase-4 lab pages are byte-identical to
   * Phase 1. Only non-null for the demo lab slug (demo-scoped, Phase 2).
   */
  card: DemoLabCard | null | undefined;
}

export default function LabCollaborationActions({
  card,
}: LabCollaborationActionsProps) {
  if (!card) return null;

  const recipient = resolveLabRecipient(card.slug);
  if (!recipient) return null;

  const piHandle = card.pi.handle;
  const peopleHref = `/${card.slug}/people`;
  const shareHref = buildLabShareDeepLink(APP_ORIGIN, card.slug);
  const reachOutHref = buildPiProfileDeepLink(APP_ORIGIN, piHandle);
  const requestHref = buildRequestDataDeepLink(APP_ORIGIN, piHandle);

  return (
    <section aria-labelledby="collab-heading" className="mt-10">
      <h2
        id="collab-heading"
        className="mb-4 text-sm font-semibold text-foreground"
      >
        Collaborate with this lab
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Send data / share work. Deep link to the app-origin share handler.
            The visitor signs in on research-os.app and the RecipientShareDialog
            opens pre-addressed to this lab's PI. */}
        <Tooltip label="Opens ResearchOS on research-os.app to send a method, sequence, dataset, or figure to this lab.">
          <a
            href={shareHref}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-brand-action hover:shadow-sm"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
              <Icon name="share" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-foreground">
                Send data to this lab
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                Share a method, sequence, dataset, or figure. Sends to the PI
                directly.
              </span>
            </span>
          </a>
        </Tooltip>

        {/* Reach out for collaboration. Links to the PI's profile on the app
            origin where the existing ResearcherProfileModal share affordances live. */}
        <Tooltip label="Opens the PI's researcher profile on research-os.app where you can send a message or share work.">
          <a
            href={reachOutHref}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-brand-action hover:shadow-sm"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
              <Icon name="users" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-foreground">
                Reach out for collaboration
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                Visit the PI&rsquo;s profile on the network. Contact or share
                work straight to them.
              </span>
            </span>
          </a>
        </Tooltip>

        {/* Request data from this lab. Deep link to a pre-addressed compose on
            the app origin (PI profile with ?compose=request). Per the locked
            spec decision this is always a deep link, never a cookie-free POST.
            A real compose UI lives on the app origin behind the session gate. */}
        <Tooltip label="Opens a pre-addressed request on research-os.app. You sign in there and send the request to the lab's PI.">
          <a
            href={requestHref}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-brand-action hover:shadow-sm"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
              <Icon name="download" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-foreground">
                Request data from this lab
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                Ask the lab for a strain, dataset, or protocol. Sends a
                pre-addressed request to the PI.
              </span>
            </span>
          </a>
        </Tooltip>

        {/* Find people. Stays on the lab origin (read-only published page).
            The visitor picks the specific person they want and the per-researcher
            share happens on the app-origin profile, not here. */}
        <Tooltip label="Browse the lab's People page to find the right person to collaborate with.">
          <a
            href={peopleHref}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-brand-action hover:shadow-sm"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-foreground">
                Find people
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                See who is in the lab. Once you find the right person, share
                directly with them on the network.
              </span>
            </span>
          </a>
        </Tooltip>
      </div>
    </section>
  );
}

"use client";

// Lab directory card for the researcher network (demo-lab-network Phase 2, social
// lane).
//
// A discovery-and-trust card for a lab on /network: the lab handle, the PI and
// member @handles, a verified-domain badge, a key fingerprint, and two site chips
// (native lab site + BYO paper companion) showing one lab can publish both. The
// copy stays on the locked sharing positioning, NO follower counts, NO likes, NO
// feed.
//
// Phase 2 addition: a "Share to this lab" button that, on the APP ORIGIN
// (/network on research-os.app), opens RecipientShareDialog inline with the lab's
// PI as the resolved ShareRecipient. This is gated on SOCIAL_LAYER_ENABLED plus
// a resolved sharing identity plus a connected folder (same conditions as
// ResearcherProfileModal). When any gate is off the button is absent and the card
// is byte-identical to Phase 1.
//
// For the demo this is sourced from the pure DEMO_LAB_CARD fixture (which mirrors
// the seeded Option A row). It carries the sample-lab ribbon so a viewer always
// knows the lab is fabricated. It is demo-only by construction (its only caller
// passes the demo card), so it never renders a real lab.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import DemoSampleLabRibbon from "@/components/social/DemoSampleLabRibbon";
import RecipientShareDialog from "@/components/social/RecipientShareDialog";
import { SOCIAL_LAYER_ENABLED, LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import { LAB_SITE_BYO_PREFIX } from "@/lib/social/lab-byo";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { resolveLabRecipient } from "@/lib/social/lab-collab";
import {
  DEMO_BYO_HOST,
  type DemoLabCard,
  type DemoLabMember,
} from "@/lib/social/demo-lab";

/** Deterministic avatar colors so each handle reads as a distinct person. Pulled
 *  from the marketing palette range, stable by index. */
const AVATAR_COLORS = [
  "#f97316",
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#d4537e",
  "#0f6e56",
  "#b45309",
];

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

function Avatar({
  member,
  color,
  size = "md",
}: {
  member: DemoLabMember;
  color: string;
  size?: "md" | "sm";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-xs";
  return (
    <Tooltip label={`@${member.handle}, ${member.role}`}>
      <Link
        href={`/u/${member.handle}`}
        className={`flex ${dim} items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface`}
        style={{ backgroundColor: color }}
        aria-label={`${member.name}, @${member.handle}`}
      >
        {initials(member.name)}
      </Link>
    </Tooltip>
  );
}

export default function LabDirectoryCard({ card }: { card: DemoLabCard }) {
  const piColor = AVATAR_COLORS[0];
  // After the research-os.com origin cutover, the lab's public home is its
  // subdomain root and the BYO bundle lives under /_site there. Before the cutover
  // (flag off), the native site is still the app-origin path and BYO is the bare
  // subdomain host. The card is demo-only, so DEMO_BYO_HOST is this lab's subdomain.
  const onComOrigin = LAB_SITES_COM_ORIGIN_ENABLED;
  const nativeHref = onComOrigin ? `https://${DEMO_BYO_HOST}` : `/${card.slug}`;
  const nativeLabel = onComOrigin ? DEMO_BYO_HOST : `research-os.app/${card.slug}`;
  const byoHref = onComOrigin
    ? `https://${DEMO_BYO_HOST}${LAB_SITE_BYO_PREFIX}/`
    : `https://${DEMO_BYO_HOST}`;

  // Phase 2: inline share dialog (app origin only).
  // Hooks must run unconditionally; the gate is applied to canShare below.
  const identity = useSharingIdentity();
  const { currentUser } = useFileSystem();
  const [shareOpen, setShareOpen] = useState(false);

  // Resolve the lab to a ShareRecipient (PI for the demo lab, null for real labs
  // until Phase 4). The button is absent when resolution returns null, so a
  // non-demo card is byte-identical to Phase 1.
  const recipient = resolveLabRecipient(card.slug);

  // Mirror the same gate as ResearcherProfileModal: flag + sharing identity +
  // connected folder + a resolved recipient.
  const canShare =
    SOCIAL_LAYER_ENABLED && !!identity.email && !!currentUser && !!recipient;

  return (
    <>
    <article className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
      {/* Header: avatar, name, handle, sample-lab badge */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: piColor }}
          aria-hidden="true"
        >
          {initials(card.name.replace(/^The\s+/i, ""))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-semibold text-foreground">
              <Link href={nativeHref} className="hover:underline">
                {card.name}
              </Link>
            </h3>
            <DemoSampleLabRibbon tone="card" />
          </div>
          <Link
            href={nativeHref}
            className="text-meta text-brand-action underline-offset-2 hover:underline"
          >
            {nativeLabel}
          </Link>

          {/* Trust badges */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Tooltip label="Confirmed via a verified email domain">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                <Icon name="shield" className="h-3.5 w-3.5 text-brand-action" />
                Verified, {card.verifiedDomain}
              </span>
            </Tooltip>
            <Tooltip label="Key fingerprint, confirm the lab before you send">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 font-mono text-[11px] text-foreground-muted">
                <Icon name="lock" className="h-3.5 w-3.5" />
                {card.keyFingerprint}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      <p className="mt-4 text-meta leading-relaxed text-foreground-muted">
        {card.tagline}. Open to sharing methods and strain data with
        collaborators. Listing is opt-in, and an email is never shown.
      </p>

      {/* People row: PI, then a stack of members */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <Avatar member={card.pi} color={piColor} />
          <span className="leading-tight">
            <span className="block text-meta font-medium text-foreground">
              {card.pi.name}
            </span>
            <span className="block text-[11px] text-foreground-muted">
              {card.pi.role}, @{card.pi.handle}
            </span>
          </span>
        </div>
        <div className="flex items-center -space-x-2">
          {card.members.map((m, i) => (
            <Avatar
              key={m.handle}
              member={m}
              color={AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length]}
              size="sm"
            />
          ))}
        </div>
        <span className="text-[11px] text-foreground-muted">
          {card.members.length} members
        </span>
      </div>

      {/* Site chips: one lab can host both a native site and a BYO companion */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Link
          href={nativeHref}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-action px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
        >
          <Icon name="labTree" className="h-3.5 w-3.5" /> Visit lab site
        </Link>
        <a
          href={byoHref}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-action"
        >
          <Icon name="file" className="h-3.5 w-3.5" /> Paper companion
        </a>

        {/* Phase 2 share CTA. Present only when SOCIAL_LAYER_ENABLED and the
            visitor has a connected folder with a sharing identity. Opens
            RecipientShareDialog inline exactly like ResearcherProfileModal does,
            with the lab's PI as the resolved recipient. Absent when the gate is
            off, so the card is byte-identical to Phase 1. */}
        {canShare && (
          <Tooltip label="Send a method, sequence, dataset, or figure to this lab's PI directly.">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-action"
            >
              <Icon name="share" className="h-3.5 w-3.5" /> Share to this lab
            </button>
          </Tooltip>
        )}
      </div>
    </article>

    {/* Dialog mounts outside the article so its fixed overlay is not clipped. */}
    {shareOpen && recipient && identity.email && currentUser && (
      <RecipientShareDialog
        recipient={recipient}
        senderEmail={identity.email}
        ownerUsername={currentUser}
        onClose={() => setShareOpen(false)}
      />
    )}
  </>
  );
}

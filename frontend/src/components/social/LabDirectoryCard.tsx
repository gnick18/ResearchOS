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
// For the demo this is sourced from the pure DEMO_LAB_CARD fixture (which mirrors
// the seeded Option A row). It carries the sample-lab ribbon so a viewer always
// knows the lab is fabricated. It is demo-only by construction (its only caller
// passes the demo card), so it never renders a real lab.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import DemoSampleLabRibbon from "@/components/social/DemoSampleLabRibbon";
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
  return (
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
              <Link href={`/${card.slug}`} className="hover:underline">
                {card.name}
              </Link>
            </h3>
            <DemoSampleLabRibbon tone="card" />
          </div>
          <Link
            href={`/${card.slug}`}
            className="text-meta text-brand-action underline-offset-2 hover:underline"
          >
            research-os.app/{card.slug}
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
          href={`/${card.slug}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-action px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
        >
          <Icon name="labTree" className="h-3.5 w-3.5" /> Visit lab site
        </Link>
        <a
          href={`https://${DEMO_BYO_HOST}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-action"
        >
          <Icon name="file" className="h-3.5 w-3.5" /> Paper companion
        </a>
      </div>
    </article>
  );
}

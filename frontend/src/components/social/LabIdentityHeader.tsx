"use client";

// Lab identity header (Phase 1, lab-site network presence).
//
// The rich lab-level header that mirrors the identity block in LabDirectoryCard:
// lab avatar, lab name, PI name and handle, member stack, verified-domain badge,
// and key fingerprint. Extracted here so the directory card and the public lab
// page share one source of truth for that visual.
//
// Demo-only for Phase 1. The caller passes a DemoLabCard profile; real labs get
// this header in Phase 4 once a lab_sites profile column lands (Q4). The component
// itself is general: it accepts DemoLabCard so it can be reused on real cards once
// the profile shape is generalized. Nothing in this file triggers a DB read or a
// session check; it is a pure presentational component.
//
// Cookie isolation: no session, no folder. Safe on the .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { DemoLabCard, DemoLabMember } from "@/lib/social/demo-lab";

/** Stable avatar colors (same pool as LabDirectoryCard). */
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

function MemberAvatar({
  member,
  color,
  size = "md",
}: {
  member: DemoLabMember;
  color: string;
  size?: "md" | "sm";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
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

/**
 * The lab identity header for a public lab page. Accepts the DemoLabCard profile
 * (demo-only, Phase 1). Renders the avatar, name, verified-domain badge, key
 * fingerprint, PI row, member stack, and tagline.
 */
export default function LabIdentityHeader({ card }: { card: DemoLabCard }) {
  const piColor = AVATAR_COLORS[0];

  return (
    <div className="mb-6 mt-2">
      {/* Top row: avatar + name block */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-white shadow-sm"
          style={{ backgroundColor: piColor }}
          aria-hidden="true"
        >
          {initials(card.name.replace(/^The\s+/i, ""))}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {card.name}
          </h1>

          {/* Trust badges: verified domain + key fingerprint. Each renders only
              when present, so a real lab missing one (or both) shows no empty
              chip and the row collapses entirely when neither is known. */}
          {(card.verifiedDomain || card.keyFingerprint) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {card.verifiedDomain && (
                <Tooltip label="Confirmed via a verified email domain">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                    <Icon name="shield" className="h-3.5 w-3.5 text-brand-action" />
                    Verified, {card.verifiedDomain}
                  </span>
                </Tooltip>
              )}
              {card.keyFingerprint && (
                <Tooltip label="Key fingerprint. Confirm this before you send.">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 font-mono text-[11px] text-foreground-muted">
                    <Icon name="lock" className="h-3.5 w-3.5" />
                    {card.keyFingerprint}
                  </span>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tagline. The institution (or demo tagline) leads when present, then a
          generic, lab-agnostic collaboration line that is true for any listed
          lab (listing is opt-in). */}
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        {card.tagline ? `${card.tagline}. ` : ""}Open to sharing data and methods
        with collaborators. Listing is opt-in.
      </p>

      {/* People row: PI + member stack */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <MemberAvatar member={card.pi} color={piColor} />
          <span className="leading-tight">
            <span className="block text-sm font-medium text-foreground">
              {card.pi.name}
            </span>
            <span className="block text-[11px] text-foreground-muted">
              {card.pi.role}, @{card.pi.handle}
            </span>
          </span>
        </div>

        <div className="flex items-center -space-x-2">
          {card.members.map((m, i) => (
            <MemberAvatar
              key={m.handle}
              member={m}
              color={AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length]}
              size="sm"
            />
          ))}
        </div>

        <span className="text-[11px] text-foreground-muted">
          {card.memberCount ?? card.members.length} members
        </span>
      </div>
    </div>
  );
}

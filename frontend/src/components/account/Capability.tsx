"use client";

// Capability + AccountUpsell (capabilities bot, 2026-06-13).
//
// Two tiny presentational helpers that sit on top of useAccountCapabilities so
// surfaces declare intent instead of recombining primitives.
//
//   <Capability need="canShare">...</Capability>
//     renders its children only when the named capability is true. Pass an
//     optional `fallback` to show something else when it is off (e.g. an upsell
//     at a discovery surface). Deep-in-flow controls pass no fallback, so they
//     simply disappear.
//
//   <AccountUpsell />
//     a calm "comes with a free account" chip for discovery surfaces. It tells
//     the user the WHY (solo stays local, the cloud features need an account)
//     and where to make one, in the same voice as AccountBenefitsUpsell.
//
// Spec: docs/proposals/2026-06-13-unified-account-capabilities.md (Phase 1).
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import type { ReactNode } from "react";

import {
  useAccountCapabilities,
  type AccountCapabilities,
} from "@/hooks/useAccountCapabilities";

// Only the boolean capabilities are gateable by name (mode/email/etc. are not).
type BooleanCapabilityName = {
  [K in keyof AccountCapabilities]: AccountCapabilities[K] extends boolean
    ? K
    : never;
}[keyof AccountCapabilities];

export function Capability({
  need,
  fallback = null,
  children,
}: {
  /** The named capability that must be true for children to render. */
  need: BooleanCapabilityName;
  /** Optional element shown when the capability is off (e.g. an upsell). */
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const caps = useAccountCapabilities();
  return <>{caps[need] ? children : fallback}</>;
}

// Where a solo user goes to add an account. The Profile section of Settings
// holds Account and keys (the destination AccountBenefitsUpsell already names).
const ACCOUNT_SETUP_HREF = "/settings?section=profile";

export function AccountUpsell({
  /** Short, capability-specific lead-in, e.g. "BeakerBot AI". */
  feature = "This",
  className = "",
}: {
  feature?: string;
  className?: string;
}) {
  return (
    <a
      href={ACCOUNT_SETUP_HREF}
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border border-brand-action/30",
        "bg-brand-action/[0.06] px-2.5 py-1 text-meta font-medium text-foreground-muted",
        "transition-colors hover:border-brand-action hover:text-foreground",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {feature} comes with a free account
    </a>
  );
}

"use client";

// Dev scratch page: the badges v1 showcase (shelf + bin) on representative demo
// metrics, with a light/dark toggle. The /dev tree is gated off prod by
// proxy.ts (and this layout 404s in a prod build), so this is a local-only
// surface for Grant to see the medallions, pinning, and locked state.
//
// It additionally respects NEXT_PUBLIC_BADGES_ENABLED so the showcase only
// renders when the flag is on; when off it shows a one-line note instead of any
// badge UI, matching the dark-by-default contract.
//
// House style, no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { useCallback, useState } from "react";

import BadgeSection, { demoBadgeMetrics } from "@/components/badges/BadgeSection";
import { BADGES_ENABLED } from "@/lib/badges/config";

export default function DevBadgesPage() {
  const [dark, setDark] = useState(false);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      if (next) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      return next;
    });
  }, []);

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-center justify-between">
          <h1 className="text-display font-bold tracking-tight">
            Badges showcase
          </h1>
          <button
            type="button"
            onClick={toggle}
            className="rounded-full bg-surface-raised px-4 py-2 text-meta font-medium text-foreground ring-1 ring-inset ring-border"
          >
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>

        {BADGES_ENABLED ? (
          <BadgeSection profileId="dev-showcase" metrics={demoBadgeMetrics()} />
        ) : (
          <p className="mt-8 text-meta text-foreground-muted">
            Set NEXT_PUBLIC_BADGES_ENABLED=1 to render the badge surface.
          </p>
        )}
      </div>
    </div>
  );
}

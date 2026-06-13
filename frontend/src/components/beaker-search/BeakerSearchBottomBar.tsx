"use client";

// BeakerAI build. The permanent home for BeakerSearch, the bottom-center ask
// bar (Option A, approved by Grant 2026-06-12 in
// docs/mockups/beakersearch-home-comparison.html, spec at
// docs/proposals/beakersearch-home-bottom-bar.md).
//
// A slim, always-present pill docked bottom-center on every app route. It reads
// "Ask or search your work..." with a Cmd K hint on the right. On click it opens
// the SAME centered BeakerSearch surface the top-nav pill and Cmd K already
// open. This is NOT a second surface or a second store, only a new resting
// affordance / trigger for the one palette we ship.
//
// Open path. It calls useBeakerSearch().openPalette(), the exact trigger the
// existing BeakerSearchPill uses. The provider (BeakerSearchProvider) owns the
// open state and renders the one shared CommandPalette.
//
// Capture hiding. BeakerSearch is a flagship PRODUCT surface, not dev chrome, so
// it STAYS VISIBLE in marketing-video record mode (`?record=1`) on purpose, so
// demo clips can feature it. It is hidden only in the wiki-screenshot capture
// (`?wikiCapture=1`) via the hydration-safe `hidden` flag below (mounted-then-
// read, mirroring AppShell's showDevDock / isDemo pattern). It is deliberately
// NOT tagged `data-floating-dock`, so the record-mode CSS hide that strips the
// floating dock + BeakerBot flask does not touch it.
//
// Collision. The bar is centered (left-1/2, translate-x). The Calculators /
// Report-bug utility cluster stays bottom-right and is untouched. On the dense
// /sequences editor the bottom-right cluster relocates the Report-bug FAB to the
// bottom-LEFT and suppresses the Calculator FAB; the centered bar clears both
// the right inspector rail and the bottom-left FAB, so no extra handling is
// needed here (see the /sequences note in the build report).
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useEffect, useState } from "react";
import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import { useBeakerSearch } from "./BeakerSearchProvider";
import { isWikiCaptureMode } from "@/lib/file-system/wiki-capture-mock";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { AccountUpsell } from "@/components/account/Capability";

/** The permanent bottom-center ask bar. Opens the shared BeakerSearch surface. */
export default function BeakerSearchBottomBar() {
  const { openPalette } = useBeakerSearch();

  // BeakerBot AI is ACCOUNT-ONLY (Grant's lock). This bar is the PRIMARY
  // BeakerBot entry, a discovery surface, so a solo/locked user sees a gentle
  // upsell here instead of an ask bar that cannot ask. Search still has its own
  // home (the Cmd K palette and the /search page), so nothing is lost.
  // (capabilities bot, 2026-06-13)
  const { canUseAI } = useAccountCapabilities();

  // Hydration-safe capture hide. Hidden only in wiki-screenshot capture
  // (?wikiCapture=1). It STAYS VISIBLE in marketing-video record mode
  // (?record=1) so demo clips can showcase BeakerSearch, the flagship surface.
  // Read client-only after mount (mirrors AppShell's showDevDock / isDemo).
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(isWikiCaptureMode());
  }, []);

  if (hidden) return null;

  // Solo/locked accounts cannot ask BeakerBot (AI is account-only). Show the
  // gentle account upsell in the bar's spot instead of an ask bar that walls
  // them at the first message.
  if (!canUseAI) {
    return (
      <div
        className="fixed bottom-5 left-1/2 z-40 max-w-[calc(100%-9rem)] -translate-x-1/2"
        data-testid="beakersearch-bottom-bar-upsell"
      >
        <AccountUpsell feature="BeakerBot, the AI assistant," />
      </div>
    );
  }

  return (
    <div
      // Centered, so it never overlaps the bottom-right cluster. Intentionally
      // NOT tagged data-floating-dock: record mode keeps BeakerSearch visible so
      // demo clips can feature it (only the dev dock + flask get stripped).
      className="fixed bottom-5 left-1/2 z-40 w-[460px] max-w-[calc(100%-9rem)] -translate-x-1/2"
    >
      <button
        type="button"
        onClick={() => openPalette()}
        data-testid="beakersearch-bottom-bar"
        // Match the top-nav pill: closing the palette must not yank focus back
        // here and pop a stray focus ring against the page.
        data-palette-no-refocus=""
        aria-label="Ask or search your work (Cmd K)"
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-left shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)] transition-colors hover:border-brand-action focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
      >
        <BeakerBot
          pose="idle"
          animated={false}
          className="h-5 w-5 flex-none"
          ariaLabel="BeakerBot"
        />
        <Icon
          name="search"
          className="h-[15px] w-[15px] flex-none text-foreground-muted"
        />
        <span className="flex-1 truncate text-body text-foreground-muted">
          Ask or search your work...
        </span>
        <kbd className="flex-none rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold text-foreground-muted">
          Cmd K
        </kbd>
      </button>
    </div>
  );
}

"use client";

// /ai — BeakerBot landing (ai retire-dock bot, 2026-06-11).
//
// Phase 4 of BeakerSearch v2: the standalone docked panel is retired. This
// route simply opens the centered BeakerSearch palette in Ask mode so that any
// existing /ai link or bookmark still lands the user in BeakerBot. No second
// BeakerBotPanel is rendered here; the conversation persists in the root
// conversation store.
//
// The whole route gates on AI_ASSISTANT_ENABLED. When off, it renders the same
// calm "not enabled" state as before, so it stays dark on main and in prod
// until the assistant is further along.
//
// House style: brand + semantic tokens, no emojis, no em-dashes, no
// mid-sentence colons.

import { useEffect } from "react";
import AppShell from "@/components/AppShell";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import { useBeakerSearch } from "@/components/beaker-search/BeakerSearchProvider";

export default function AiPage() {
  const { openBeakerBot } = useBeakerSearch();

  // When the flag is on, navigating to /ai opens the palette in Ask mode.
  // Running this in an effect (not during render) keeps the state update out
  // of the render pass. The hook runs unconditionally; the effect self-gates
  // on the flag.
  useEffect(() => {
    if (AI_ASSISTANT_ENABLED) openBeakerBot();
  }, [openBeakerBot]);

  // Gate: render a calm "not enabled" state when the flag is off (mirrors the
  // /datahub gate). Never crash.
  if (!AI_ASSISTANT_ENABLED) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-20 text-center">
          <h2 className="text-heading font-semibold text-foreground">
            BeakerBot is not enabled
          </h2>
          <p className="mt-2 text-body text-foreground-muted">Check back soon.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md py-20 text-center">
        <h2 className="text-heading font-semibold text-foreground">BeakerBot</h2>
        <p className="mt-2 text-body text-foreground-muted">
          BeakerBot opens in the search palette. Ask it about your work in
          ResearchOS, and the conversation stays with you as you move between
          pages.
        </p>
      </div>
    </AppShell>
  );
}

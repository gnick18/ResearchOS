"use client";

// /ai — BeakerBot landing (ai docking bot, 2026-06-11).
//
// BeakerBot is now an app-wide docked panel mounted ONCE in AppShell (see
// BeakerBotDock), so its conversation persists across route changes. The docked
// panel is the new primary surface; this route is kept as a thin landing that
// simply opens the dock, so any existing /ai link or bookmark still lands the
// user in BeakerBot. We no longer render a second BeakerBotPanel here, which
// would double-mount the conversation and the navigation bridge.
//
// The whole route gates on AI_ASSISTANT_ENABLED. When off, it renders the same
// calm "not enabled" state as before (mirroring the /datahub gate), so it stays
// dark on main and in prod until the assistant is further along.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect } from "react";
import AppShell from "@/components/AppShell";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import { useBeakerBotPanel } from "@/lib/ai/panel-store";

export default function AiPage() {
  const openPanel = useBeakerBotPanel((s) => s.open);

  // When the flag is on, opening /ai opens the always-mounted docked panel. The
  // panel lives in AppShell, so it persists if the user navigates onward from
  // here. Running this in an effect (not during render) keeps the store update
  // out of the render pass. Hooks must run unconditionally, so the effect self
  // gates on the flag rather than sitting behind the early return below.
  useEffect(() => {
    if (AI_ASSISTANT_ENABLED) openPanel();
  }, [openPanel]);

  // Gate, render a calm "not enabled" state when the flag is off (mirror the
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
          BeakerBot is docked on the right. Ask it about your work in ResearchOS,
          and it stays with you as you move between pages.
        </p>
      </div>
    </AppShell>
  );
}

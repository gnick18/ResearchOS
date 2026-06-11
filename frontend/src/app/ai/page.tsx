"use client";

// /ai — BeakerBot, the optional AI assistant (ai foundation bot, 2026-06-10).
//
// The foundation slice: a flag-gated route that mounts the minimal docked
// BeakerBot panel, which round-trips one message to Llama through the local dev
// proxy at /api/ai/chat. It proves the plumbing only (BeakerBot can talk to
// Llama), no tools, no modes, no writes to user data, no RAG.
//
// The whole route gates on AI_ASSISTANT_ENABLED. When off, it renders a calm
// "not enabled" state (mirroring the /datahub gate), so the prototype stays
// self-contained and dark on `main` and in prod until the assistant is further
// along. New top-level route, excluded from the wiki-coverage gate pending its
// own wiki page (mirrors the /sequences and /datahub precedent).
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import AppShell from "@/components/AppShell";
import BeakerBotPanel from "@/components/ai/BeakerBotPanel";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";

export default function AiPage() {
  // Gate: render a calm "not enabled" state when the flag is off (mirror the
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
      <div className="flex h-full min-h-0 justify-end px-4 pb-4">
        <BeakerBotPanel />
      </div>
    </AppShell>
  );
}

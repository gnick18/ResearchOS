"use client";

// Dev play page for the BeakerBot chat GUI (beaker-ai lane, 2026-06-13).
//
// Lets Grant type freely and watch the full conversation surface, the morph
// animation, the live status line, per-message affordances (Copy, Regenerate,
// Revert-to-here), and the settled token summary, all driven by a mock model
// that never touches the network and costs no real tokens.
//
// How it works:
//   - On mount, setModelCallerOverride(mockModelCaller) redirects every call
//     that conversation-store.ts normally sends to callModelViaProxy into the
//     mock instead. The mock waits a realistic 1.5 to 4 seconds and returns a
//     scripted lab-flavored text reply with fake token counts. On unmount,
//     setModelCallerOverride(null) restores the real caller so navigating away
//     does not permanently break production.
//   - The BeakerSearch palette is opened in Ask mode via openBeakerBot(), the
//     same trigger the FAB uses. The morph animation (search bar grows into the
//     centered chat modal, with adaptive corner-dodge) plays exactly as it
//     would in production.
//   - A small on-page chrome explains the page and provides a button to reopen
//     the palette if the user closes it.
//
// Accessible at /dev/beakerbot in any environment (the route is
// undiscoverable from the production UI). The providers.tsx bypass at this
// route supplies BeakerSearchProvider and QueryClientProvider without requiring
// a connected folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

import {
  setModelCallerOverride,
} from "@/lib/ai/conversation-store";
import { mockModelCaller } from "@/lib/ai/dev/mock-model";
import { useBeakerSearch } from "@/components/beaker-search/BeakerSearchProvider";

// Inner component consumes the BeakerSearchProvider context.
function BeakerBotDevPageInner() {
  const { openBeakerBot, open } = useBeakerSearch();

  // Install the mock on mount. Restore the real caller on unmount so navigating
  // away does not permanently redirect production calls into the mock.
  useEffect(() => {
    setModelCallerOverride(mockModelCaller);
    return () => {
      setModelCallerOverride(null);
    };
  }, []);

  // Open the BeakerBot surface (in Ask mode) immediately on mount. The user
  // can close and reopen it with the button below.
  useEffect(() => {
    openBeakerBot();
  }, [openBeakerBot]);

  return (
    <main className="min-h-screen bg-surface text-foreground">
      {/* Page header */}
      <header className="border-b border-border bg-surface-raised px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-brand-ink">
              BeakerBot dev play page
            </h1>
            <p className="mt-0.5 text-meta text-foreground-muted">
              Mock model, no real tokens. Type anything to exercise the chat GUI.
            </p>
          </div>
          <button
            type="button"
            onClick={openBeakerBot}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-body font-semibold text-brand-action hover:bg-surface-raised"
          >
            {open ? "Palette is open" : "Open BeakerBot"}
          </button>
        </div>
      </header>

      {/* Reference card */}
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border border-border bg-surface-raised p-6 text-body text-foreground-muted">
          <p className="mb-3 font-semibold text-foreground">What to try</p>
          <ul className="space-y-2">
            <li>
              Type any message and watch the elapsed timer tick in the live status line.
            </li>
            <li>
              After the reply arrives, hover the assistant bubble to see the Copy button.
              Hover the user message to see Revert-to-here.
            </li>
            <li>
              The Regenerate button appears on the last assistant reply. It drops that
              reply, rewinds the history to the previous user message, and re-sends.
            </li>
            <li>
              Send a second message while the first is still running. The composer queues
              it and fires it automatically once the first turn settles.
            </li>
            <li>
              Close the palette with Escape or the X button. Reopen it with the button
              above (opens in Ask mode, preserving the conversation).
            </li>
            <li>
              The mock rotates through ten scripted replies and then cycles back. Fake
              token counts (8 to 40 k) appear in the settled summary line under each reply.
            </li>
          </ul>
          <p className="mt-4 text-meta">
            Steps panel note: the expandable steps panel shows tool calls. The mock is
            text-only (no tool_calls), so the panel stays empty here. Real tool turns
            from a connected folder exercise it.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function BeakerBotDevPage() {
  return <BeakerBotDevPageInner />;
}

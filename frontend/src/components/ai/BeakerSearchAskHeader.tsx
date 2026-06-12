"use client";

// BeakerSearchAskHeader (ai palette-morph bot, 2026-06-11).
//
// The chat chrome that appears inside the BeakerSearch palette when it is in
// Ask mode. Contains (left to right): back-to-search control, BeakerBot mark
// + "BeakerBot" title, Save-to control, New chat button, History stub, the
// review-mode control, and a static "uses credit" hint.
//
// Props:
//   onBack         -> return to search mode (back control click)
//   onNewChat      -> call clearConversation() to start fresh
//
// Save to: serializes the whole transcript (already markdown, with the embed
// links inline) and opens the destination picker. Picking a note / experiment
// drops the conversation in, where the same `#ros=` fragment makes the embeds
// render live. Disabled while there is nothing to save.
//
// History affordance: the clock/history icon is visible but wired to a no-op
// tooltip ("Past chats coming in v2.1"). The past-chats list is deferred.
//
// Review-mode control: reads and writes useBeakerBotReviewMode. Two modes,
// "Step-by-step" (review every step) and "Whole-plan" (approve the plan once,
// then it runs). There is no silent unattended mode.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";
import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import { useBeakerBotReviewMode } from "@/lib/ai/review-mode-store";
import { useConversationStore } from "@/lib/ai/conversation-store";
import {
  conversationToMarkdown,
  defaultConversationTitle,
} from "@/lib/ai/conversation-to-markdown";
import ExportConversationPicker from "@/components/references/ExportConversationPicker";

export default function BeakerSearchAskHeader({
  onBack,
  onNewChat,
}: {
  onBack: () => void;
  onNewChat: () => void;
}) {
  const reviewMode = useBeakerBotReviewMode((s) => s.mode);
  const toggleReviewMode = useBeakerBotReviewMode((s) => s.toggle);

  // The transcript has nothing to save until there is at least one message. We
  // read the count reactively so the Save-to control enables as soon as the
  // first turn lands.
  const messageCount = useConversationStore((s) => s.messages.length);
  // Export picker state. payload is captured at click time so the picker pushes
  // a stable snapshot even if the conversation keeps streaming behind it.
  const [exportPayload, setExportPayload] = useState<{
    markdown: string;
    defaultTitle: string;
  } | null>(null);
  // A small confirmation toast after a successful (or failed) save.
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(
    null,
  );

  const openExport = () => {
    const messages = useConversationStore.getState().messages;
    if (messages.length === 0) return;
    setExportPayload({
      markdown: conversationToMarkdown(messages),
      defaultTitle: defaultConversationTitle(messages),
    });
  };

  return (
    <>
      {exportPayload ? (
        <ExportConversationPicker
          markdown={exportPayload.markdown}
          defaultTitle={exportPayload.defaultTitle}
          onClose={() => setExportPayload(null)}
          onResult={(message, ok) => setToast({ message, ok })}
        />
      ) : null}
      {toast ? (
        <div
          role="status"
          data-testid="beakersearch-save-toast"
          className={`mx-3 mt-2 rounded-md border px-3 py-1.5 text-meta ${
            toast.ok
              ? "border-brand bg-brand/5 text-foreground"
              : "border-red-400 bg-red-50 text-red-700"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
      {renderHeader()}
    </>
  );

  function renderHeader() {
    return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {/* Back to search */}
      <Tooltip label="Back to search" placement="bottom">
        <button
          type="button"
          data-testid="beakersearch-back-to-search"
          aria-label="Back to search"
          onClick={onBack}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="chevronLeft" className="h-4 w-4" title="Back" />
        </button>
      </Tooltip>

      {/* BeakerBot mark + title */}
      <BeakerBot
        pose="idle"
        animated={false}
        className="h-5 w-5 flex-none"
        ariaLabel=""
      />
      <span className="flex-1 text-body font-semibold text-foreground">
        BeakerBot
      </span>

      {/* Save the conversation to a note or experiment */}
      <Tooltip
        label={
          messageCount === 0
            ? "Nothing to save yet"
            : "Save this conversation to a note or experiment"
        }
        placement="bottom"
      >
        <button
          type="button"
          data-testid="beakersearch-save-to"
          aria-label="Save this conversation to a note or experiment"
          onClick={openExport}
          disabled={messageCount === 0}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent"
        >
          <Icon name="export" className="h-4 w-4" title="Save to" />
        </button>
      </Tooltip>

      {/* History stub (v2.1 deferred) */}
      <Tooltip label="Past chats coming in v2.1" placement="bottom">
        <button
          type="button"
          data-testid="beakersearch-history"
          aria-label="Conversation history (coming soon)"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted opacity-50 cursor-default"
        >
          <Icon name="history" className="h-4 w-4" title="History" />
        </button>
      </Tooltip>

      {/* New chat */}
      <Tooltip label="New chat" placement="bottom">
        <button
          type="button"
          data-testid="beakersearch-new-chat"
          aria-label="Start a new chat"
          onClick={onNewChat}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="plus" className="h-4 w-4" title="New chat" />
        </button>
      </Tooltip>

      {/* Review-mode control. Two modes, click the inactive one to switch. There
          is no silent unattended mode, both modes review the work, step-by-step
          confirms each step and whole-plan confirms the whole plan once. */}
      <div
        role="group"
        aria-label="BeakerBot review mode"
        data-testid="beakersearch-review-mode"
        className="flex flex-shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
      >
        <Tooltip
          label="Step-by-step. BeakerBot shows each step and waits for you to approve it before it runs."
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakersearch-review-step"
            aria-label="Step-by-step review, approve each step"
            aria-pressed={reviewMode === "step"}
            onClick={reviewMode === "step" ? undefined : toggleReviewMode}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-meta font-medium transition-colors ${
              reviewMode === "step"
                ? "bg-brand text-white shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon name="check" className="h-3.5 w-3.5" title="Step-by-step" />
            Step-by-step
          </button>
        </Tooltip>
        <Tooltip
          label="Whole-plan. BeakerBot proposes the whole plan up front, you approve it once, then it runs every step."
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakersearch-review-plan"
            aria-label="Whole-plan review, approve the plan once"
            aria-pressed={reviewMode === "plan"}
            onClick={reviewMode === "plan" ? undefined : toggleReviewMode}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-meta font-medium transition-colors ${
              reviewMode === "plan"
                ? "bg-brand text-white shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon name="list" className="h-3.5 w-3.5" title="Whole-plan" />
            Whole-plan
          </button>
        </Tooltip>
      </div>

      {/* Static "uses credit" hint */}
      <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        uses credit
      </span>
    </div>
    );
  }
}

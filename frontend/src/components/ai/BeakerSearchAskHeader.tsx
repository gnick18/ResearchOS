"use client";

// BeakerSearchAskHeader (ai palette-morph bot, 2026-06-11).
//
// The chat chrome that appears inside the BeakerSearch palette when it is in
// Ask mode. Contains (left to right): back-to-search control, BeakerBot mark
// + "BeakerBot" title, New chat button, History stub, autonomy toggle, and a
// static "uses credit" hint.
//
// Props:
//   onBack         -> return to search mode (back control click)
//   onNewChat      -> call clearConversation() to start fresh
//
// History affordance: the clock/history icon is visible but wired to a no-op
// tooltip ("Past chats coming in v2.1"). The past-chats list is deferred.
//
// Autonomy toggle: reads and writes useBeakerBotAutonomy, the same store the
// dock's panel uses.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { Icon } from "@/components/icons";
import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import { useBeakerBotAutonomy } from "@/lib/ai/autonomy-store";

export default function BeakerSearchAskHeader({
  onBack,
  onNewChat,
}: {
  onBack: () => void;
  onNewChat: () => void;
}) {
  const autonomy = useBeakerBotAutonomy((s) => s.mode);
  const toggleAutonomy = useBeakerBotAutonomy((s) => s.toggle);

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

      {/* Autonomy toggle */}
      <Tooltip
        label={
          autonomy === "auto"
            ? "Auto mode. BeakerBot acts without asking, except for risky actions. Click to require approval."
            : "Ask mode. BeakerBot asks before it acts. Click to let it act automatically."
        }
        placement="bottom"
      >
        <button
          type="button"
          data-testid="beakersearch-autonomy-toggle"
          aria-label={
            autonomy === "auto"
              ? "BeakerBot autonomy, auto. Switch to ask before doing."
              : "BeakerBot autonomy, ask before doing. Switch to auto."
          }
          aria-pressed={autonomy === "auto"}
          onClick={toggleAutonomy}
          className={`flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition-colors ${
            autonomy === "auto"
              ? "border-brand bg-brand/10 text-brand"
              : "border-border text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
          }`}
        >
          <Icon
            name={autonomy === "auto" ? "bolt" : "ask"}
            className="h-3.5 w-3.5"
            title={autonomy === "auto" ? "Auto" : "Ask"}
          />
          {autonomy === "auto" ? "Auto" : "Ask"}
        </button>
      </Tooltip>

      {/* Static "uses credit" hint */}
      <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        uses credit
      </span>
    </div>
  );
}

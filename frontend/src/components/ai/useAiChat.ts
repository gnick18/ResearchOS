"use client";

// useAiChat (ai convo-store bot, 2026-06-11).
//
// Public hook for BeakerBot conversation state. Previously owned all state
// internally (useState / useRef). Now a thin selector over the persistent
// conversation store (lib/ai/conversation-store.ts), so the state survives
// any component unmount and is shareable across surfaces.
//
// The public shape is UNCHANGED. Every consumer (BeakerBotPanel,
// BeakerBotConversation, tests) can continue importing { useAiChat } from
// this path without modification.
//
// ChatMessage and ChatRole are re-exported from the store so imports from
// this path continue to resolve.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useConversationStore } from "@/lib/ai/conversation-store";

export type {
  ChatRole,
  ChatMessage,
  PendingApproval,
  TurnSummary,
  ToolStep,
} from "@/lib/ai/conversation-store";

export function useAiChat() {
  const messages = useConversationStore((s) => s.messages);
  const sending = useConversationStore((s) => s.sending);
  const status = useConversationStore((s) => s.status);
  const error = useConversationStore((s) => s.error);
  const pendingApproval = useConversationStore((s) => s.pendingApproval);
  const queuedText = useConversationStore((s) => s.queuedText);
  const send = useConversationStore((s) => s.send);
  const stop = useConversationStore((s) => s.stop);
  const clearQueue = useConversationStore((s) => s.clearQueue);
  const resolveApproval = useConversationStore((s) => s.resolveApproval);
  const resolveChoice = useConversationStore((s) => s.resolveChoice);
  // Per-message affordances (STAGE 2, 2026-06-13).
  const regenerate = useConversationStore((s) => s.regenerate);
  const revertToHere = useConversationStore((s) => s.revertToHere);
  // Live status-line fields (STAGE 1, 2026-06-13).
  const turnStartedAt = useConversationStore((s) => s.turnStartedAt);
  const turnElapsedMs = useConversationStore((s) => s.turnElapsedMs);
  const turnTokens = useConversationStore((s) => s.turnTokens);
  const runningToolCount = useConversationStore((s) => s.runningToolCount);
  const settledTurns = useConversationStore((s) => s.settledTurns);
  const turnToolSteps = useConversationStore((s) => s.turnToolSteps);
  // Vision image attachment (gated on NEXT_PUBLIC_BEAKERBOT_VISION in the UI).
  const pendingImages = useConversationStore((s) => s.pendingImages);
  const addPendingImage = useConversationStore((s) => s.addPendingImage);
  const removePendingImage = useConversationStore((s) => s.removePendingImage);
  const clearPendingImages = useConversationStore((s) => s.clearPendingImages);

  return {
    messages,
    sending,
    status,
    error,
    send,
    stop,
    clearQueue,
    pendingApproval,
    queuedText,
    resolveApproval,
    resolveChoice,
    // Per-message affordances (STAGE 2, 2026-06-13).
    regenerate,
    revertToHere,
    // Live status-line fields.
    turnStartedAt,
    turnElapsedMs,
    turnTokens,
    runningToolCount,
    settledTurns,
    turnToolSteps,
    // Vision image attachment.
    pendingImages,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
  };
}

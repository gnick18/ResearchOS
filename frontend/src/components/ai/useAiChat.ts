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
  };
}

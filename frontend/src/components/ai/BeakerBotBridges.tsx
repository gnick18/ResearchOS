"use client";

// BeakerBotBridges (ai palette-morph bot, 2026-06-11).
//
// A null-rendering root component that registers the navigation bridge and the
// message bridge EXACTLY ONCE at the root layout level. Both bridges are module-
// level singletons; they must be registered by exactly one component at a time.
//
// Phase 2 motivation: BeakerBotConversation can now render in TWO places (the
// dock AND the palette). If each mount registered both bridges, the second mount
// would clobber the first with a NEW handler reference, and the first would clear
// it on unmount (the fast-remount guard fires), opening a null-handler window on
// every palette open/close cycle. Registering here, once and unconditionally, means
// both rendering surfaces share the same stable handlers.
//
// BeakerBotConversation no longer calls useNavigationBridge or
// useBeakerBotMessageBridge directly (those calls were removed in Phase 2).
//
// The send function is read directly from the conversation store
// (useConversationStore.getState().send). That reference is stable for the lifetime
// of the module (Zustand actions are created once inside create()), so the bridge
// registration never re-fires and there is no null-handler window.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useNavigationBridge } from "./navigation-bridge";
import { useBeakerBotMessageBridge } from "./message-bridge";
import { useConversationStore } from "@/lib/ai/conversation-store";

export default function BeakerBotBridges() {
  // Register the soft-navigation handler (router.push, fixture-param-aware).
  useNavigationBridge();

  // Register the store send into the message bridge so sendToBeakerBot() delivers
  // to the persistent conversation regardless of which surface is currently
  // rendering the conversation. The send identity is stable (Zustand action).
  useBeakerBotMessageBridge(useConversationStore.getState().send);

  return null;
}

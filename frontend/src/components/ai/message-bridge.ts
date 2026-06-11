"use client";

// BeakerBot message bridge (ai beakersearch-v1 bot, 2026-06-11).
//
// A tiny event bus that lets the BeakerSearch command palette, which runs in
// the React tree OUTSIDE the BeakerBot panel, seed a query directly into
// BeakerBot's conversation. The palette cannot call useAiChat (no shared
// context, different subtree), so it dispatches a send request here and the
// panel flushes it via the registered send function once it is mounted.
//
// The pattern mirrors navigation-bridge.ts exactly: a module-level handler
// plus a queue-then-flush approach so a message requested before the panel
// mounts still lands once it does, rather than being lost silently.
//
// Why a queue rather than a hard drop: the escalation flow opens the panel
// and immediately sends the query. The open call triggers a React render; the
// panel's useEffect that registers the send function fires after that render.
// Without the queue the send arrives between the open and the first registration,
// which is a reliable null-handler window on every cold escalation.
//
// The fallback no-ops after a short timeout rather than throwing or hard-assigning
// (there is no meaningful URL to navigate to when BeakerBot is not mounted at all).
// It is always mounted when the flag is on, so a no-op fallback is safe.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

// The current send function, registered by BeakerBotPanel on mount, cleared on
// unmount only if it is still the same function instance (fast-remount guard).
type SendFn = (text: string) => void;
let sendFn: SendFn | null = null;

// A message queued while no send function was registered. Only one message is
// ever in flight (the last one wins if the escalation fires twice quickly).
let queuedMessage: string | null = null;

// Timer that clears a queued message after the panel has had enough time to
// mount. After the window closes the queue is dropped with no side-effect,
// because the panel is genuinely not mounted.
let queueTimer: ReturnType<typeof setTimeout> | null = null;

const QUEUE_FALLBACK_MS = 2000;

function clearQueueTimer(): void {
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

/** Drain a queued message through the current send function, if both are
 *  present. Clears the queue and the fallback timer. */
function flushQueue(): void {
  if (sendFn && queuedMessage !== null) {
    const msg = queuedMessage;
    queuedMessage = null;
    clearQueueTimer();
    sendFn(msg);
  }
}

/** Register a send function. Returns an unregister function that only clears
 *  the slot when it is still THIS function, so a fast remount cannot wipe a
 *  newer subscriber. Registering immediately flushes any queued message.
 *
 *  Exported so BeakerBotPanel and tests share one well-guarded registration
 *  path. */
export function registerBeakerBotSend(fn: SendFn): () => void {
  sendFn = fn;
  flushQueue();
  return () => {
    if (sendFn === fn) {
      sendFn = null;
    }
  };
}

/** Seed a query into the BeakerBot panel. When the panel is already mounted
 *  the message is delivered immediately via the registered send function. When
 *  the panel is mounting (a common case when the palette just opened it), the
 *  message is queued and flushed once the panel registers its send function.
 *  If the panel never registers within QUEUE_FALLBACK_MS the message is
 *  dropped silently (the panel is not mounted at all, so there is nowhere to
 *  deliver it).
 *
 *  Returns a Promise that resolves once the message is delivered or dropped,
 *  so callers can await it without a timeout of their own. */
export function sendToBeakerBot(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (sendFn) {
      sendFn(text);
      resolve();
      return;
    }

    if (typeof window === "undefined") {
      resolve();
      return;
    }

    // Panel not yet mounted. Queue the message and resolve once it is flushed
    // or the fallback window closes.
    queuedMessage = text;
    clearQueueTimer();
    queueTimer = setTimeout(() => {
      queueTimer = null;
      // If still queued, the panel never appeared. Drop the message and
      // resolve so the caller does not hang.
      if (queuedMessage !== null) {
        queuedMessage = null;
      }
      resolve();
    }, QUEUE_FALLBACK_MS);

    // We need to resolve when the flush happens too. Wrap the original
    // sendFn-based flush so it resolves the promise. The next registration
    // call will fire flushQueue, which calls the real send; here we just
    // need to watch for that moment. A small polling approach is avoided
    // entirely by wrapping: before the timeout fires, if a registration
    // comes in and flushes the queue, we clear the timer and resolve.
    const originalQueue = queuedMessage;
    const checkInterval = setInterval(() => {
      // If the message was flushed (queuedMessage cleared by flushQueue),
      // the timer already ran or flushed. Clean up.
      if (queuedMessage !== originalQueue) {
        clearInterval(checkInterval);
        clearQueueTimer();
        resolve();
      }
    }, 50);
    // Cap the interval check at the same window as the fallback timer.
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, QUEUE_FALLBACK_MS);
  });
}

/** True when a send function is currently registered. For tests. */
export function isBeakerBotReady(): boolean {
  return sendFn !== null;
}

/** Direct handler injection for tests (bypasses the useEffect layer). */
export function setBeakerBotSend(fn: SendFn | null): void {
  sendFn = fn;
  if (fn) flushQueue();
}

/** A queued message, or null. For tests. */
export function pendingBeakerBotMessage(): string | null {
  return queuedMessage;
}

/** React hook. Mount this in BeakerBotPanel to register its send function
 *  into the bridge. The handler is registered once per send-function identity
 *  (stable), so it is never transiently null while the panel is mounted. */
export function useBeakerBotMessageBridge(send: (text: string) => void): void {
  useEffect(() => {
    return registerBeakerBotSend(send);
  }, [send]);
}

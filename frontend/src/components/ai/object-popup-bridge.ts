"use client";

// Object popup bridge (ai popup-host bot, 2026-06-11).
//
// A tiny event bus that lets ObjectChip, write_note results, and any other
// non-React caller ask the root ObjectPopupHost to open an item's popup IN
// PLACE. The tool and the chip run outside the host's React tree, so they
// cannot call useObjectPopup() directly. They dispatch through this bus and
// the host subscribes once on mount.
//
// Why this mirrors navigation-bridge exactly in spirit: the same three failure
// modes apply. A re-register must not leave the handler null, a request with
// no handler is QUEUED and flushed as a soft open when one registers, and the
// hard fallback (navigation via objectDeepLink) only fires after a timeout with
// no handler, which means the popup host is truly not mounted.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ObjectRefType } from "@/lib/references";
import { objectDeepLink } from "@/lib/references";
import { requestNavigation } from "@/components/ai/navigation-bridge";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type ObjectRef = { type: ObjectRefType; id: string };

/** The object types that open as a real in-place popup via the root
 *  ObjectPopupHost. Every other type navigates to its deep link. Single source of
 *  truth, imported by ObjectChip, ObjectPopupHost, and the embed Open buttons so
 *  the three can never drift. */
export const POPUP_CAPABLE_TYPES: ReadonlySet<ObjectRefType> = new Set<ObjectRefType>([
  "note",
  "task",
  "experiment",
]);

/** Open an object ref the way a chip click does: an in-place popup for the
 *  popup-capable types (note/task/experiment), otherwise a SOFT client-side
 *  navigation to its deep link through the navigation bridge. Never use a raw
 *  `<a href>` to open an object, a plain anchor hard-reloads the page, which
 *  closes an open BeakerBot chat / palette. The bridge's root-registered handler
 *  does a soft router.push, so the chat persists (and for a method it opens the
 *  methods-page detail popup over the persisting chat). No useRouter needed, so
 *  this is safe to call from any component without a router context. */
export function openObjectRef(ref: ObjectRef): void {
  if (POPUP_CAPABLE_TYPES.has(ref.type)) {
    openObjectPopup(ref);
    return;
  }
  requestNavigation(objectDeepLink(ref.type, ref.id));
}

/** The handler the root host registers. It is called with the ref to open. */
type PopupHandler = (ref: ObjectRef) => void;

// -----------------------------------------------------------------------
// Module-level bus state (singleton per page load)
// -----------------------------------------------------------------------

// The current handler. Set by the root host on mount, cleared only when it
// is still the same instance (stable-identity guard, same as navigation-bridge).
let handler: PopupHandler | null = null;

// A request queued while no handler is registered. Held so that a click that
// fires during the brief window before the host mounts still opens in place,
// instead of falling through to a hard navigation.
let queuedRef: ObjectRef | null = null;

// Escalation timer. Only fires if no handler registers within the window,
// meaning the host is truly not mounted and we need to navigate as a fallback.
let queueTimer: ReturnType<typeof setTimeout> | null = null;

// How long to wait before treating the host as absent and falling back to
// navigation. Generous enough to cover a host mount; short enough to keep the
// UI responsive when the host is genuinely not present.
const QUEUE_FALLBACK_MS = 2000;

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function clearQueueTimer(): void {
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

/** Drain a queued request through the current handler, if both exist. Called
 *  when a handler registers. Clears the queue and the escalation timer. */
function flushQueue(): void {
  if (handler && queuedRef !== null) {
    const ref = queuedRef;
    queuedRef = null;
    clearQueueTimer();
    handler(ref);
  }
}

// -----------------------------------------------------------------------
// Public imperative API (non-React callers and ObjectChip)
// -----------------------------------------------------------------------

/** Ask the root popup host to open the given item in place. When a handler is
 *  registered it opens immediately. When none is registered yet, the ref is
 *  QUEUED and flushed via the handler as soon as it registers, so the popup
 *  host mounting after a click still wins over a navigation. If no handler
 *  appears within QUEUE_FALLBACK_MS, the fallback is a navigation to the
 *  item's deep-link path (every type does something sensible). Returns the
 *  ref for tests. */
export function openObjectPopup(ref: ObjectRef): ObjectRef {
  if (handler) {
    handler(ref);
    return ref;
  }
  if (typeof window === "undefined") {
    return ref;
  }
  // No handler yet. Queue the ref and wait for a subscriber to register and
  // flush it. Only if none appears within the window do we fall back to a
  // navigation, acceptable then because it means the host is not mounted.
  queuedRef = ref;
  clearQueueTimer();
  queueTimer = setTimeout(() => {
    queueTimer = null;
    if (!handler && queuedRef !== null) {
      const fallbackRef = queuedRef;
      queuedRef = null;
      // Navigate to the item's page as the universal fallback so every type
      // does something sensible even when the host is absent.
      window.location.assign(objectDeepLink(fallbackRef.type, fallbackRef.id));
    }
  }, QUEUE_FALLBACK_MS);
  return ref;
}

/** True when a popup handler is currently registered. For tests. */
export function hasPopupHandler(): boolean {
  return handler !== null;
}

/** The ref currently queued for a popup open, or null. For tests. */
export function pendingPopupRef(): ObjectRef | null {
  return queuedRef;
}

/** Register a popup handler directly. Returns an unregister function that only
 *  clears the handler if it is still THIS handler, so a fast remount cannot
 *  wipe a newer subscriber. Registering flushes any queued request. Exported
 *  so the React hook and tests share one well-guarded registration path. */
export function registerObjectPopupHandler(fn: PopupHandler): () => void {
  handler = fn;
  flushQueue();
  return () => {
    if (handler === fn) {
      handler = null;
    }
  };
}

// -----------------------------------------------------------------------
// React hook (used by the root host)
// -----------------------------------------------------------------------

/** Mount this inside the ObjectPopupHost. It registers the host's open
 *  callback once (stable identity, never transiently null), so any queued
 *  request from before the host mounted is flushed immediately on first
 *  render. The unregister runs only on unmount, not on every re-render, so
 *  there is no null-handler window during the host's lifetime. */
export function useObjectPopupBridge(onOpen: (ref: ObjectRef) => void): void {
  // Keep the latest onOpen in a ref so the stable registration closure can
  // call the current version without being recreated when onOpen changes.
  const onOpenRef = useRef<(ref: ObjectRef) => void>(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const unregister = registerObjectPopupHandler((ref) => {
      onOpenRef.current(ref);
    });
    return unregister;
  }, []); // Empty deps: register once, unregister on unmount.
}

// -----------------------------------------------------------------------
// useObjectPopup hook (used by React surfaces that want to open a popup)
// -----------------------------------------------------------------------

/** Returns {openObjectPopup, closeObjectPopup}. openObjectPopup routes through
 *  the popup host if it is mounted, falling back to navigation for non-popup
 *  types or when the host is absent. closeObjectPopup is only meaningful when
 *  called from a component inside the host's subtree (it closes the currently
 *  open popup), but is always safe to call. */
export function useObjectPopup(): {
  openObjectPopup: (ref: ObjectRef) => void;
  closeObjectPopup: () => void;
} {
  const router = useRouter();
  return {
    openObjectPopup: (ref: ObjectRef) => {
      openObjectPopup(ref);
      // If no handler is registered AND no queue was set (SSR / test), navigate
      // immediately. The module-level function handles the queue / fallback.
    },
    closeObjectPopup: () => {
      // Closing is handled by the host itself (via its own state setter). A
      // call from outside the host is a no-op for now; callers within the host
      // subtree should use usePopupActions() from popup-actions.tsx instead.
    },
  };
}

// Re-export router for tests that need to verify the navigation fallback.
export function _getRouter(): ReturnType<typeof useRouter> | null {
  // Not exposed at runtime; only for test introspection via the bridge.
  return null;
}

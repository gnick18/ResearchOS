"use client";

// BeakerBot navigation bridge (ai spotlight bot, 2026-06-10; ai nav-fix bot, 2026-06-11).
//
// A tiny event bus that lets the go_to_page / guide_to_element tools, which run
// OUTSIDE React in the agent loop, ask the app to soft-navigate to a route. The
// tool cannot call useRouter (no React context), so it dispatches a request here
// and a small React subscriber (useNavigationBridge, mounted in the BeakerBot
// panel) performs the actual router.push. This keeps navigation as a real SPA
// transition (no full reload) while letting the tool stay framework-free.
//
// Why a bus and not a global router ref: the App Router does not expose a stable
// imperative router outside React, and stashing a router instance on window is
// fragile across route changes. A request/handler bus is decoupled and testable.
//
// Robustness (ai nav-fix bot, 2026-06-11): a hard reload here is fatal. It wipes
// the docked panel's conversation state and kills the running agent loop. So the
// handler is registered ONCE with a stable identity (never transiently null on a
// navigation), and a request that arrives with no handler is QUEUED and flushed
// when a handler registers, rather than hard-assigning location. A hard assign is
// kept only as a genuine last resort when no handler ever appears, which means the
// panel is truly not mounted. A queued soft-nav always wins over a hard reload
// whenever the panel exists.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { withFixtureParam } from "@/components/FixtureLink";

// The current handler that performs navigation. Set by the React subscriber when
// it mounts, cleared on unmount only when it is still the same handler instance.
type NavHandler = (path: string) => void;
let handler: NavHandler | null = null;

// A path requested while no handler was registered. Held so that a navigation
// asked for during the brief window before the panel mounts (or while React is
// swapping handlers) still lands via a soft router.push once a handler appears,
// instead of falling through to a destructive hard reload.
let queuedPath: string | null = null;

// Timer that escalates a still-queued path to a hard assign. Only fires if no
// handler ever registers within the window, which means the panel is not mounted.
let queueTimer: ReturnType<typeof setTimeout> | null = null;

// How long to wait for a handler before treating the panel as truly absent and
// falling back to a hard assignment. Generous enough to cover a panel mount, short
// enough that a genuinely unmounted bridge still navigates the user.
const QUEUE_FALLBACK_MS = 2000;

function clearQueueTimer(): void {
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

/** Drain a queued navigation through the current handler, if both exist. Called
 *  when a handler registers. Clears the queue and the escalation timer. */
function flushQueue(): void {
  if (handler && queuedPath !== null) {
    const path = queuedPath;
    queuedPath = null;
    clearQueueTimer();
    handler(path);
  }
}

/** Ask the app to navigate to an internal path. Used by the go_to_page and
 *  spotlight tools. When a React subscriber is mounted it performs a soft
 *  router.push. When none is mounted yet the path is QUEUED and flushed as soon as
 *  a subscriber registers, so navigation never tears down the panel mid-session. A
 *  hard location assignment is used only as a last resort, after a timeout with no
 *  handler ever appearing (panel not mounted at all). Returns the requested path,
 *  for tests. */
export function requestNavigation(path: string): string {
  if (handler) {
    handler(path);
    return path;
  }
  if (typeof window === "undefined") {
    return path;
  }
  // No handler yet. Queue the path and wait for a subscriber to register and flush
  // it as a soft navigation. Only if none appears within the window do we fall back
  // to a hard assign, which is acceptable then because it means no panel is mounted
  // and there is no session state to protect.
  queuedPath = path;
  clearQueueTimer();
  queueTimer = setTimeout(() => {
    queueTimer = null;
    if (!handler && queuedPath !== null) {
      const target = queuedPath;
      queuedPath = null;
      window.location.assign(target);
    }
  }, QUEUE_FALLBACK_MS);
  return path;
}

/** True when a React navigation handler is currently registered. For tests. */
export function hasNavigationHandler(): boolean {
  return handler !== null;
}

/** A path currently queued for a soft navigation, or null. For tests. */
export function pendingNavigationPath(): string | null {
  return queuedPath;
}

/** Register a navigation handler directly. Returns an unregister function that
 *  only clears the handler if it is still THIS handler, so a fast remount cannot
 *  wipe a newer subscriber. Registering flushes any queued navigation. Exported so
 *  the React hook and tests share one well-guarded registration path. */
export function registerNavigationHandler(fn: NavHandler): () => void {
  handler = fn;
  flushQueue();
  return () => {
    if (handler === fn) {
      handler = null;
    }
  };
}

/** Mount this in a client component that lives near the BeakerBot panel. It
 *  registers a soft-navigation handler (router.push) that preserves the fixture
 *  capture param, so a spotlight navigation in demo or wiki-capture mode does not
 *  drop the gate.
 *
 *  The handler is registered ONCE per router instance (not per navigation), so its
 *  identity is stable and it is never transiently null while the panel is mounted.
 *  The latest fixture-capture param is read from a ref that a separate effect keeps
 *  current, so a param change does not force a re-register (which used to open a
 *  null-handler window that turned the next navigation into a hard reload).
 *
 *  Suspense-free by design (app-shell stability bot, 2026-06-12). This bridge is
 *  registered once at the ROOT layout (BeakerBotBridges), so any hook it calls
 *  runs in the shared server-render shell of every page. It used to read the
 *  wikiCapture param with next/navigation's useSearchParams, which forces a
 *  Suspense boundary around this root-level mount. Under rapid BeakerBot
 *  navigation an in-flight server render is aborted, and Next 16.1.6 surfaces
 *  that abort as a thrown `undefined` INTO the nearest Suspense boundary, which
 *  then crashes Next's own error handler (it reads `.digest` off the undefined)
 *  and takes the dev server down. So the capture param is now read lazily from
 *  window.location at navigation time instead, with no Suspense boundary in the
 *  shell. This mirrors the deliberate useSearchParams-avoidance in
 *  lib/providers.tsx and is also more correct (it reads the live URL at the
 *  moment of navigation rather than an effect-synced snapshot). */
export function useNavigationBridge(): void {
  const router = useRouter();

  useEffect(() => {
    const unregister = registerNavigationHandler((path: string) => {
      // Read the wiki-capture param at navigation time straight from the live
      // URL (Suspense-free, see the note above), so a spotlight navigation in
      // demo / wiki-capture mode keeps the gate without a useSearchParams
      // subscription in the root shell.
      const capture =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("wikiCapture")
          : null;
      const href = withFixtureParam(path, capture);
      const target = typeof href === "string" ? href : path;
      // Idempotency guard. BeakerBot's analysis tools each navigate to the
      // result they just stored, and several in a row (a whole-plan run) can
      // resolve to the SAME /datahub doc. Re-pushing the URL we are already on
      // re-renders a heavy route for nothing, which amplified a Next dev-server
      // render crash (the same /datahub URL recompiling+rendering on a loop).
      // Skip the push when the target equals the live location.
      if (typeof window !== "undefined") {
        const current = window.location.pathname + window.location.search;
        if (current === target) return;
      }
      router.push(target);
    });
    return unregister;
  }, [router]);
}

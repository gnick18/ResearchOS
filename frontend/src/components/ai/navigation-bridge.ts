"use client";

// BeakerBot navigation bridge (ai spotlight bot, 2026-06-10).
//
// A tiny event bus that lets the spotlight_ui_element tool, which runs OUTSIDE
// React in the agent loop, ask the app to soft-navigate to a route. The tool
// cannot call useRouter (no React context), so it dispatches a request here and a
// small React subscriber (useNavigationBridge, mounted in the BeakerBot panel)
// performs the actual router.push. This keeps navigation as a real SPA transition
// (no full reload) while letting the tool stay framework-free.
//
// Why a bus and not a global router ref: the App Router does not expose a stable
// imperative router outside React, and stashing a router instance on window is
// fragile across route changes. A request/handler bus is decoupled and testable.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { withFixtureParam } from "@/components/FixtureLink";

// The current handler that performs navigation. Set by the React subscriber when
// it mounts, cleared on unmount. Null when no subscriber is active (for example
// before the panel mounts), in which case requests fall back to assigning
// location, so a spotlight still works even without the bridge.
type NavHandler = (path: string) => void;
let handler: NavHandler | null = null;

/** Ask the app to navigate to an internal path. Used by the spotlight tool. When
 *  a React subscriber is mounted it performs a soft router.push, otherwise this
 *  falls back to a hard location assignment so navigation still happens. Returns
 *  the path it requested, for tests. */
export function requestNavigation(path: string): string {
  if (handler) {
    handler(path);
  } else if (typeof window !== "undefined") {
    // Fallback only. The bridge subscriber should normally be mounted, but a hard
    // assign guarantees the user still lands on the right page.
    window.location.assign(path);
  }
  return path;
}

/** True when a React navigation handler is currently registered. For tests. */
export function hasNavigationHandler(): boolean {
  return handler !== null;
}

/** Mount this in a client component that lives near the BeakerBot panel. It
 *  registers a soft-navigation handler (router.push) that preserves the fixture
 *  capture param, so a spotlight navigation in demo or wiki-capture mode does not
 *  drop the gate. */
export function useNavigationBridge(): void {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const capture = params?.get("wikiCapture") ?? null;
    handler = (path: string) => {
      const href = withFixtureParam(path, capture);
      router.push(typeof href === "string" ? href : path);
    };
    return () => {
      // Only clear if we are still the registered handler, so a fast remount does
      // not wipe a newer subscriber.
      handler = null;
    };
  }, [router, params]);
}

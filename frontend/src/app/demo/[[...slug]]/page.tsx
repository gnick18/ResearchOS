"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { demoRedirectTarget } from "@/lib/file-system/pre-demo-route";
import HomePage from "../../page";

/**
 * Public in-browser demo entry point.
 *
 * Optional-catch-all route at `/demo` and `/demo/<anything>`:
 *
 * - Bare `/demo` renders the app home page directly (fixture loaded,
 *   signed in as `alex`).
 * - `/demo/<slug>` (e.g., `/demo/methods`) waits for the fixture to
 *   finish installing, then redirects to `/<slug>`. The sticky
 *   `sessionStorage` demo flag set by `<FileSystemProvider>` keeps demo
 *   mode active across the redirect, so the user lands on `/methods`
 *   with fixture-backed data, the demo banner, and the floating exit
 *   button.
 *
 * The query string (and hash) are carried across the redirect, so a deep
 * link like `/demo/datahub?doc=<id>` lands on `/datahub?doc=<id>` and the
 * target page can read its param (a Data Hub document reference, a
 * pre-selected tab, and so on). `usePathname` drops the query, so the live
 * `window.location.search` is read in the redirect effect instead.
 *
 * Built as a single component instead of separate pages so the `/demo`
 * URL stays bookmark-friendly while still being able to deep-link to
 * any view from the wiki via `<TryInDemo href="/...">`.
 */
export default function DemoRoute() {
  const { isConnected, isLoading } = useFileSystem();
  const router = useRouter();
  const pathname = usePathname() ?? "/demo";
  // `/demo` → "" (render Home); `/demo/methods` → "/methods" (redirect to). The
  // query / hash are not on pathname; they are read live in the effect below.
  const hasTarget = pathname !== "/demo" && pathname.replace(/^\/demo/, "") !== "";

  useEffect(() => {
    if (!hasTarget || !isConnected || isLoading) return;
    // Preserve any query string + hash so parameterized deep links survive the
    // demo redirect (e.g. /demo/datahub?doc=5 → /datahub?doc=5).
    const target = demoRedirectTarget(
      pathname,
      typeof window !== "undefined" ? window.location.search : "",
      typeof window !== "undefined" ? window.location.hash : "",
    );
    if (target) router.replace(target);
  }, [hasTarget, pathname, isConnected, isLoading, router]);

  // While the redirect is pending, render nothing — the StagedLoadingScreen
  // from FileSystemProvider covers the gap on first visit, and the redirect
  // happens fast enough on subsequent loads that a flash of empty is fine.
  if (hasTarget) return null;
  return <HomePage />;
}

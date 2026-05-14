"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFileSystem } from "@/lib/file-system/file-system-context";
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
 * Built as a single component instead of separate pages so the `/demo`
 * URL stays bookmark-friendly while still being able to deep-link to
 * any view from the wiki via `<TryInDemo href="/...">`.
 */
export default function DemoRoute() {
  const { isConnected, isLoading } = useFileSystem();
  const router = useRouter();
  const pathname = usePathname() ?? "/demo";
  // `/demo` → "" (render Home); `/demo/methods` → "/methods" (redirect to).
  const target = pathname === "/demo" ? "" : pathname.replace(/^\/demo/, "");

  useEffect(() => {
    if (target && isConnected && !isLoading) {
      router.replace(target);
    }
  }, [target, isConnected, isLoading, router]);

  // While the redirect is pending, render nothing — the StagedLoadingScreen
  // from FileSystemProvider covers the gap on first visit, and the redirect
  // happens fast enough on subsequent loads that a flash of empty is fine.
  if (target) return null;
  return <HomePage />;
}

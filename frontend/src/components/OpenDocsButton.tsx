"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getDemoMode, isWikiCaptureMode } from "@/lib/file-system/wiki-capture-mock";
import { getWikiForRoute } from "@/lib/wiki/nav";

/**
 * Secondary affordance shown alongside `<FloatingLeaveDemoButton>` while
 * in demo mode. Resolves the current route to its wiki counterpart via
 * `getWikiForRoute()`; renders nothing if there's no match, so it
 * silently disappears on demo screens we haven't mapped yet.
 *
 * Same-tab navigation: the sticky `sessionStorage` demo flag survives
 * the trip to `/wiki/...`, so browser-back lands the user right back in
 * the demo with their state intact.
 *
 * Wiki-capture exemption: paired with the same `!isWikiCaptureMode()`
 * gate as `<FloatingLeaveDemoButton>` — when the capture script lands
 * on a `/demo` path with `?wikiCapture=1`, this button would otherwise
 * appear in the bottom-right of every screenshot.
 */
export default function OpenDocsButton() {
  const pathname = usePathname() ?? "";
  const [inDemo, setInDemo] = useState(false);

  // Re-check on every route change. The Read-the-docs link is a plain
  // `<a href>` (full browser nav, so the wiki gets a fresh document); a
  // browser-back from the wiki to `/methods` then runs a fresh page load
  // (or a BFCache restore). Either way, the previous mount-only read
  // could leave `inDemo=false` even though the sessionStorage demo flag
  // is still set. Reading on every pathname change keeps the button in
  // sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local React state with the external sessionStorage demo flag on every route change
    setInDemo(getDemoMode() && !isWikiCaptureMode());
  }, [pathname]);

  if (!inDemo) return null;
  // Wiki routes already are the docs; no value linking from wiki → wiki.
  if (pathname.startsWith("/wiki")) return null;

  const wikiHref = getWikiForRoute(pathname);
  if (!wikiHref) return null;

  return (
    <a
      href={wikiHref}
      className="fixed bottom-20 right-44 z-50 px-3 py-2 rounded-full bg-slate-900/85 hover:bg-slate-900 text-white text-sm font-medium shadow-lg flex items-center gap-1.5 border border-white/10 transition-colors"
      aria-label="Open the docs for this view"
    >
      <span aria-hidden>📖</span>
      <span>Read the docs</span>
      <span aria-hidden>↗</span>
    </a>
  );
}

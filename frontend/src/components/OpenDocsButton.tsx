"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getDemoMode,
  isRecordingMode,
  isWikiCaptureMode,
} from "@/lib/file-system/wiki-capture-mock";
import { getWikiForRoute } from "@/lib/wiki/nav";
import { Icon } from "@/components/icons";
import { DEMO_PILL_CLASS } from "./demo/floatingPill";

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
 * appear in the bottom-right of every screenshot. Recording mode
 * (`?record=1`) is suppressed the same way so a marketing-video surface
 * carries no demo chrome.
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
    setInDemo(getDemoMode() && !isWikiCaptureMode() && !isRecordingMode());
  }, [pathname]);

  if (!inDemo) return null;
  // Wiki routes already are the docs; no value linking from wiki → wiki.
  if (pathname.startsWith("/wiki")) return null;

  const wikiHref = getWikiForRoute(pathname);
  if (!wikiHref) return null;

  return (
    <a
      href={wikiHref}
      className={DEMO_PILL_CLASS}
      aria-label="Open the docs for this view"
    >
      <Icon name="book" className="h-3.5 w-3.5" />
      <span>Read the docs</span>
    </a>
  );
}

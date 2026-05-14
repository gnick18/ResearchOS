"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
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
 */
export default function OpenDocsButton() {
  const pathname = usePathname() ?? "";
  const [inDemo, setInDemo] = useState(false);

  useEffect(() => {
    setInDemo(getDemoMode());
  }, []);

  if (!inDemo) return null;
  // Wiki routes already are the docs; no value linking from wiki → wiki.
  if (pathname.startsWith("/wiki")) return null;

  const wikiHref = getWikiForRoute(pathname);
  if (!wikiHref) return null;

  return (
    <a
      href={wikiHref}
      className="fixed bottom-4 right-44 z-50 px-3 py-2 rounded-full bg-slate-900/85 hover:bg-slate-900 text-white text-sm font-medium shadow-lg flex items-center gap-1.5 border border-white/10 transition-colors"
      aria-label="Open the docs for this view"
    >
      <span aria-hidden>📖</span>
      <span>Read the docs</span>
      <span aria-hidden>↗</span>
    </a>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import BeakerBot from "../BeakerBot";

/**
 * Slim top bar shown above the wiki sidebar + content. Two affordances:
 *
 * - Wordmark on the left links straight to the app home (`/`).
 * - "Back to app" button on the right routes the user back to the exact
 *   path they came from when they clicked the `?` help icon. The `?`
 *   button in AppShell passes the current path through as a `?return=`
 *   query param; we read it on mount and cache it in sessionStorage so
 *   it survives in-wiki navigation (clicking around the sidebar). On
 *   click, the cached return path wins; failing that we try
 *   `router.back()` (still works for deep-link visitors with history);
 *   failing that we fall back to `/`.
 *
 * The wiki keeps its own layout (no AppShell, no folder gate) so brand-new
 * visitors can read the setup guide before connecting a folder — this bar
 * just makes that escape hatch unmissable.
 */
const RETURN_PATH_KEY = "researchOS.wikiReturnPath";

export default function WikiTopBar() {
  const router = useRouter();

  // Cache the `?return=<path>` query into sessionStorage on arrival so
  // it survives the next in-wiki click (sidebar links don't propagate
  // the param). Persists per-tab, which is what we want. Reading from
  // `window.location.search` rather than `useSearchParams()` avoids the
  // static-rendering Suspense-boundary requirement Next.js enforces on
  // the latter inside layouts wrapping prerendered pages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ret = new URLSearchParams(window.location.search).get("return");
    if (!ret) return;
    try {
      sessionStorage.setItem(RETURN_PATH_KEY, ret);
    } catch {
      // sessionStorage can throw in private windows; just no-op.
    }
  }, []);

  const handleBack = () => {
    if (typeof window === "undefined") {
      router.push("/");
      return;
    }
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(RETURN_PATH_KEY);
      // Clear immediately so the next round-trip starts fresh — otherwise a
      // later deep-link visit (no `?return=` param) would still find this
      // stale value and route back to the wrong origin.
      sessionStorage.removeItem(RETURN_PATH_KEY);
    } catch {
      // ignore
    }
    if (cached) {
      router.push(cached);
      return;
    }
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <div className="sticky top-0 z-40 bg-surface-raised/95 backdrop-blur border-b border-border">
      <div className="px-5 py-2 flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-body font-bold text-foreground tracking-tight hover:text-accent transition-colors"
          title="Go to ResearchOS home"
        >
          {/* BeakerBot brand-mark — static, sky-blue, sized to match the
              text-body wordmark next to it. Matches AppShell + login. */}
          <BeakerBot
            pose="idle"
            ariaLabel="ResearchOS BeakerBot logo"
            className="w-5 h-5 text-sky-500 shrink-0"
          />
          ResearchOS
        </Link>
        <span className="text-foreground-muted">/</span>
        <span className="text-body text-foreground-muted">Wiki</span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleBack}
          data-tour-target="wiki-back-to-app"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground bg-surface-raised border border-border hover:border-border hover:bg-surface-sunken rounded-lg transition-colors"
          title="Return to the app (Back)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to app
        </button>
      </div>
    </div>
  );
}

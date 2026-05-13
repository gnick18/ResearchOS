"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Slim top bar shown above the wiki sidebar + content. Two affordances:
 *
 * - Wordmark on the left links straight to the app home (`/`).
 * - "Back to app" button on the right calls `router.back()` when we have
 *   browser history (the common case: the user opened the wiki from a
 *   help icon inside the app) and falls back to `/` when the wiki was
 *   loaded directly (e.g. a /wiki/integrations/calendar-oauth deep link).
 *
 * The wiki keeps its own layout (no AppShell, no folder gate) so brand-new
 * visitors can read the setup guide before connecting a folder — this bar
 * just makes that escape hatch unmissable.
 */
export default function WikiTopBar() {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="px-5 py-2 flex items-center gap-3">
        <Link
          href="/"
          className="text-sm font-bold text-gray-900 tracking-tight hover:text-blue-700 transition-colors"
          title="Go to ResearchOS home"
        >
          ResearchOS
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-500">Wiki</span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
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

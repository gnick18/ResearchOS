"use client";

import Link from "next/link";
import Tooltip from "./Tooltip";

/**
 * Dev-only floating button that previews the first-time-visitor landing
 * ("sell") page. Mounted on UserLoginScreen (the account picker) so the
 * landing is reachable from a connected session without disconnecting.
 *
 * Navigates to `/` (the entry surface). The standalone `/welcome` route was
 * retired 2026-06-11, so a logged-out visitor sees the landing at `/`. It does
 * NOT disconnect the folder or clear the seen flag. (For the destructive "reset
 * to a truly-new state and test the real gate" flow, use the BeakerBot
 * Force-walkthrough button's "Landing page" option instead.)
 *
 * Renders nothing in production (NODE_ENV gate). Next.js inlines the literal
 * "development" at build time so the whole component is dropped as dead code
 * in production builds. Mirrors DevBeakerBotGalleryButton's structure; sits
 * at `bottom-4 right-20`, just left of the Force-walkthrough FAB.
 */
export default function DevForceLandingButton() {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <div className="fixed bottom-4 right-20 z-50">
      <Tooltip label="Preview the landing page (dev only)" placement="top">
        <Link
          href="/"
          aria-label="Preview the first-time landing page (dev only)"
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-sky-200 bg-white text-sky-500 shadow-lg transition-all hover:scale-105 hover:text-sky-700 hover:shadow-xl"
        >
          {/* Eye glyph: "preview". */}
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Link>
      </Tooltip>
    </div>
  );
}

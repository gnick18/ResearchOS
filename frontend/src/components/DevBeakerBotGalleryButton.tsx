"use client";

import Link from "next/link";
import Tooltip from "./Tooltip";

/**
 * Dev-only FAB that navigates to the BeakerBot animation gallery.
 * Lives alongside the other Dev* buttons in AppShell's bottom-right
 * cluster. Renders ONLY in development builds (NODE_ENV === "development")
 * so it never leaks to a production deploy.
 *
 * From the gallery, the user clicks the "Back to app" link there to
 * return to wherever they came from (via router.back()).
 */
export default function DevBeakerBotGalleryButton() {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <Tooltip label="BeakerBot animation gallery (dev)" placement="top">
      <Link
        href="/dev/beakerbot-gallery"
        aria-label="Open BeakerBot animation gallery (dev only)"
        className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-sky-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-sky-500 hover:text-sky-700"
      >
        {/* Tiny beaker glyph echoing the BeakerBot brand mark. */}
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 3v6.5L4 18a2 2 0 001.7 3h12.6a2 2 0 001.7-3L15 9.5V3M8 3h8"
          />
        </svg>
      </Link>
    </Tooltip>
  );
}

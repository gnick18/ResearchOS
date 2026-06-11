import type { Metadata } from "next";

import BusinessTracker from "@/components/admin/BusinessTracker";
import LightOnly from "@/components/LightOnly";

/**
 * Standalone `/business` route: the operator-only LLC business tracker.
 *
 * Grant-only. The page is just a shell; the data is gated by the
 * /api/admin/business endpoint (ADMIN_EMAILS + SHARING_ENABLED), which returns
 * 404 to anyone not on the allow-list, so loading the page leaks nothing. Like
 * /admin it renders without the AppShell or a connected folder and is excluded
 * from the wiki-coverage map (an operator tool, not a documented user feature).
 * Moved here from /admin/business 2026-06-10 (Grant) for a cleaner path; the old
 * route redirects here, and /admin and /business cross-link to each other.
 *
 * Pinned to light mode (Grant 2026-06-11): the operator surfaces always read in
 * the light palette regardless of the user's theme. The full-height
 * bg-surface-sunken root covers the viewport, so the LightOnly scope leaves no
 * dark peek behind it.
 */
export const metadata: Metadata = {
  title: "Business | ResearchOS",
  robots: { index: false, follow: false },
};

export default function BusinessPage() {
  return (
    <LightOnly>
      <BusinessTracker />
    </LightOnly>
  );
}

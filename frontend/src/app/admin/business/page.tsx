import type { Metadata } from "next";

import BusinessTracker from "@/components/admin/BusinessTracker";

/**
 * Standalone `/admin/business` route: the operator-only LLC business tab.
 *
 * Grant-only. The page is just a shell; the data is gated by the
 * /api/admin/business endpoint (ADMIN_EMAILS + SHARING_ENABLED), which returns
 * 404 to anyone not on the allow-list, so loading the page leaks nothing. Like
 * /admin it renders without the AppShell or a connected folder and is excluded
 * from the wiki-coverage map (an operator tool, not a documented user feature).
 */
export const metadata: Metadata = {
  title: "Business | ResearchOS",
  robots: { index: false, follow: false },
};

export default function BusinessPage() {
  return <BusinessTracker />;
}

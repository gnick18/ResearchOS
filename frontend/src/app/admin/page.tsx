import type { Metadata } from "next";

import AdminMetrics from "@/components/admin/AdminMetrics";

/**
 * Standalone `/admin` route: the operator metrics dashboard.
 *
 * Grant-only. The page is just a shell; the data is gated by the
 * /api/admin/metrics endpoint (ADMIN_EMAILS), which returns 404 to anyone not
 * on the allow-list, so loading the page leaks nothing. Like /open-source it
 * renders without the AppShell or a connected folder, and is excluded from the
 * wiki-coverage map (it is an operator tool, not a documented user feature).
 */
export const metadata: Metadata = {
  title: "Operator metrics | ResearchOS",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminMetrics />;
}

import type { Metadata } from "next";

import AdminMetrics from "@/components/admin/AdminMetrics";
import LightOnly from "@/components/LightOnly";

/**
 * Standalone `/admin` route: the operator metrics dashboard.
 *
 * Grant-only. The page is just a shell; the data is gated by the
 * /api/admin/metrics endpoint (ADMIN_EMAILS), which returns 404 to anyone not
 * on the allow-list, so loading the page leaks nothing. Like /open-source it
 * renders without the AppShell or a connected folder, and is excluded from the
 * wiki-coverage map (it is an operator tool, not a documented user feature).
 *
 * Pinned to light mode (Grant 2026-06-11): the operator surfaces (sign-in,
 * metrics, billing) always read in the light palette regardless of the user's
 * theme. The full-height bg-surface-sunken root covers the viewport, so the
 * LightOnly scope leaves no dark peek behind it.
 */
export const metadata: Metadata = {
  title: "Operator metrics | ResearchOS",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <LightOnly>
      <AdminMetrics />
    </LightOnly>
  );
}

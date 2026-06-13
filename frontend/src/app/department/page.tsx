"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import DeptAdminPanel from "@/components/dept/DeptAdminPanel";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";

/**
 * Department tier surface (org foundation). A STANDALONE, sign-in-gated portal,
 * not the in-app shell: it manages the dept plan, roster, and billing (all in
 * Neon) so it needs no connected folder and opens in any browser. Dark unless
 * the dept tier flag is on; a disabled visit bounces home.
 */
export default function DepartmentRoute() {
  const router = useRouter();
  useEffect(() => {
    if (!DEPT_TIER_ENABLED) router.replace("/");
  }, [router]);

  if (!DEPT_TIER_ENABLED) return null;

  return (
    <PortalShell
      title="Department admin"
      tagline="Manage your department's plan, roster, and billing. No research data, no file access, just the org admin tools."
    >
      <DeptAdminPanel />
    </PortalShell>
  );
}

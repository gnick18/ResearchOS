"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import DeptAdminPanel from "@/components/dept/DeptAdminPanel";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";

/**
 * Department tier Phase 1 surface (org foundation). Dark unless the dept tier
 * flag is on; a disabled visit bounces home. The panel itself handles the
 * create-a-department vs manage-roster states.
 */
export default function DepartmentRoute() {
  const router = useRouter();
  useEffect(() => {
    if (!DEPT_TIER_ENABLED) router.replace("/");
  }, [router]);

  if (!DEPT_TIER_ENABLED) return null;

  return (
    <AppShell>
      <DeptAdminPanel />
    </AppShell>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import InstitutionAdminPanel from "@/components/institution/InstitutionAdminPanel";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";

/**
 * Institution tier Phase 4 surface (org foundation, one tier up from
 * /department). Dark unless the institution tier flag is on; a disabled visit
 * bounces home. The panel itself handles the create-an-institution vs
 * manage-roster states.
 */
export default function InstitutionRoute() {
  const router = useRouter();
  useEffect(() => {
    if (!INSTITUTION_TIER_ENABLED) router.replace("/");
  }, [router]);

  if (!INSTITUTION_TIER_ENABLED) return null;

  return (
    <AppShell>
      <InstitutionAdminPanel />
    </AppShell>
  );
}

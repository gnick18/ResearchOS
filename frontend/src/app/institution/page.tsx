"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import InstitutionAdminPanel from "@/components/institution/InstitutionAdminPanel";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";

/**
 * Institution tier surface (org foundation, one tier up from /department). A
 * STANDALONE, sign-in-gated portal, not the in-app shell: it manages the
 * institution plan, departments, and billing (all in Neon) so it needs no
 * connected folder and opens in any browser. Dark unless the institution tier
 * flag is on; a disabled visit bounces home.
 */
export default function InstitutionRoute() {
  const router = useRouter();
  useEffect(() => {
    if (!INSTITUTION_TIER_ENABLED) router.replace("/");
  }, [router]);

  if (!INSTITUTION_TIER_ENABLED) return null;

  return (
    <PortalShell
      title="Institution admin"
      tagline="Manage your institution's plan, departments, and billing. No research data, no file access, just the org admin tools."
    >
      <InstitutionAdminPanel />
    </PortalShell>
  );
}

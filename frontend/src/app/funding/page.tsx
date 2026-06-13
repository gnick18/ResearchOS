"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabFundingPage from "@/components/funding/LabFundingPage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * PI-Mode Funding surface (FU-1, FU-2, Grant approved 2026-06-13). The lab's
 * grants as a first-class PI surface: spend versus budget per grant, rolled up
 * lab-wide. PI-only; a loaded non-PI bounces home.
 */
export default function FundingRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <LabFundingPage />
    </AppShell>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabWorkPage from "@/components/lab-work/LabWorkPage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * PI-Mode Lab Work surface (LW-1..3, Grant approved 2026-06-13). The PI's hub for
 * the lab's experiments, notes, and mentoring. PI-only; a loaded non-PI bounces
 * home.
 */
export default function LabWorkRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <LabWorkPage />
    </AppShell>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ApprovalsPage from "@/components/approvals/ApprovalsPage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * PI-Mode Approvals surface (AP-1..AP-3, Grant approved 2026-06-13). One unified
 * queue: pending purchase / supplies approvals with inline approve / decline, plus
 * the flag queue. PI-only; a loaded non-PI bounces home.
 */
export default function ApprovalsRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <ApprovalsPage />
    </AppShell>
  );
}

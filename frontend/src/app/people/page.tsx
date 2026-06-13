"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import PeoplePage from "@/components/people/PeoplePage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * PI-Mode People surface (PE-1, Grant approved 2026-06-13). A first-class
 * top-level page that gives the lab head one roster of their lab: per-member
 * workload, IDP-on-file status, and the cloud-seat chip, with each member opening
 * to their Check-ins and work. PI-only; a loaded non-PI bounces home.
 */
export default function PeopleRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <PeoplePage />
    </AppShell>
  );
}

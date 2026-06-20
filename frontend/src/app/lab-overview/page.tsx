"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import LabOverviewPage from "@/components/lab-overview/LabOverviewPage";
import LabHeadCopilotMount from "@/components/lab/LabHeadCopilotMount";
import UserLoginScreen from "@/components/UserLoginScreen";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useHasPiPowers } from "@/hooks/useIsLabManager";

/**
 * Lab Overview route (lab-overview-page bot, 2026-06-02), PHASE 1.
 *
 * Previously this route redirected to "/" (the unified widget canvas).
 * It now renders the new FIXED, curated `<LabOverviewPage>` for Lab Heads
 * (PIs). The "/" home canvas and the entire widget framework are left
 * untouched; Phase 2 handles "/" and finalizes member routing.
 *
 * Account-type gate: this page is for `accountType === "lab_head"`. A
 * non-PI hitting /lab-overview bounces to "/" for now (Phase 2 finalizes
 * member routing). The `?from=lab-overview` sentinel suppresses the
 * home dashboard's one-shot default-landing bounce so a redirected member
 * stays put on the dashboard.
 */
export default function LabOverviewRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser, isLoading: fsLoading } =
    useFileSystem();
  const currentUser = providerCurrentUser ?? "";
  // Lab Overview is a delegated power (Lab Manager Phase 1): the lab head OR a Lab
  // Manager may view it. undefined while the capability reads are in flight.
  const hasPiPowers = useHasPiPowers(currentUser || null);

  // Non-PI, non-manager: bounce to the home dashboard. Plain members get no
  // curated Lab Overview in Phase 1. Guard on a resolved user so we don't bounce
  // before the capability is known.
  useEffect(() => {
    if (fsLoading) return;
    if (!currentUser) return;
    // Capability read still in flight: do NOT bounce yet. Redirecting while
    // `hasPiPowers` is `undefined` ping-pongs with "/"'s role-based redirect
    // (which sends someone with PI powers straight back here) into an infinite
    // loop. Only bounce once we have a RESOLVED false.
    if (hasPiPowers === undefined) return;
    if (hasPiPowers === false) {
      router.replace("/?from=lab-overview");
    }
  }, [fsLoading, currentUser, hasPiPowers, router]);

  // Login gate, mirroring the home page.
  if (!fsLoading && !currentUser) {
    return (
      <UserLoginScreen
        onLogin={() => {
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  // While the user/capability resolves, or while a non-PI / non-manager is being
  // bounced, show a light spinner instead of flashing the PI page.
  if (fsLoading || !currentUser || hasPiPowers !== true) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-auto">
        <LabOverviewPage />
      </div>
      {/* The lab-head BeakerBot: scopes the tools to the PI-oversight set and
          renders the ask bar. The mount self-gates on account_type + the AI
          assistant flag so it is safe here even if the page gate ever softens. */}
      <LabHeadCopilotMount />
    </AppShell>
  );
}

"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabWorkPage, {
  resolveLabWorkTab,
} from "@/components/lab-work/LabWorkPage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * PI-Mode Lab Work surface (LW-1..3, Grant approved 2026-06-13). The PI's hub for
 * the lab's experiments, notes, and mentoring. PI-only; a loaded non-PI bounces
 * home.
 *
 * Deep-linkable via `?tab=experiments|notes|mentoring`. The two standalone
 * routes `/lab-experiments` and `/lab-notes` now redirect here with the matching
 * tab, so this hub is the single home for both surfaces. `useSearchParams` lives
 * inside a Suspense boundary to avoid the Next prerender bailout.
 */
function LabWorkRouteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const initialTab = resolveLabWorkTab(searchParams.get("tab"));

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <LabWorkPage initialTab={initialTab} />
    </AppShell>
  );
}

export default function LabWorkRoute() {
  return (
    <Suspense fallback={null}>
      <LabWorkRouteInner />
    </Suspense>
  );
}

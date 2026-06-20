"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { Icon } from "@/components/icons";
import { ExpandedView as LabActivityBody } from "@/components/lab-overview/widgets/LabActivityWidget";

/**
 * PI-Mode Activity surface (Grant approved 2026-06-13). A first-class top-level
 * page for the lab-wide activity feed (experiments, notes, comments, flags,
 * announcements) that previously only lived as a tile on Lab Overview. PI-only;
 * a loaded non-PI bounces home. The feed is self-contained.
 */
export default function ActivityRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  return (
    <AppShell>
      <PageContainer width="wide" className="py-6">
        <div className="mb-5 space-y-1">
          <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
            <Icon name="history" className="h-5 w-5" />
            Activity
          </h1>
          <p className="text-meta text-foreground-muted leading-relaxed">
            Everything happening across your lab, newest first. Filter by what
            kind of update you want to see.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
          <LabActivityBody surface="canvas" />
        </div>
      </PageContainer>
    </AppShell>
  );
}

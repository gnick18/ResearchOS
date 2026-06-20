"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import LabExperimentsPanel from "@/components/LabExperimentsPanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { tasksApi, type LabTask } from "@/lib/local-api";
import type { Task } from "@/lib/types";

/**
 * Lab experiments browse surface (PI capability revamp, 2026-06-07). A lab head
 * browses every member's experiments in one place and opens one read-only; the
 * "Edit as lab head" affordance inside TaskDetailPopup then unlocks editing via
 * the once-per-session confirm (writes route to the owner + audit).
 *
 * This wires the previously-orphaned LabExperimentsPanel, which had the lab-wide
 * data + card UI but was never rendered anywhere. Reached from the Lab Overview
 * "Browse lab experiments" button.
 */
export default function LabExperimentsRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users } = useLabData();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // PI-only surface. A loaded non-PI bounces home.
  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  // Show every lab member's experiments (the PI's own included, so the whole lab
  // lives in one view).
  const selectedUsernames = useMemo(
    () => new Set(users.map((u) => u.username)),
    [users],
  );

  // Cards carry the slim LabTask; fetch the full owner-scoped Task before opening
  // the popup (its read-only path does not refetch, so it needs the real record).
  const openExperiment = async (lt: LabTask) => {
    const full = await tasksApi.get(lt.id, lt.username);
    if (full) setSelectedTask(full);
  };

  return (
    <AppShell>
      <PageContainer width="full" className="py-6">
        <h1 className="text-display font-bold text-foreground mb-1">
          Lab experiments
        </h1>
        <p className="text-meta text-foreground-muted mb-5">
          Every member&apos;s experiments. Open one to review it, or edit it as
          the lab head.
        </p>
        <LabExperimentsPanel
          selectedUsernames={selectedUsernames}
          onExperimentClick={openExperiment}
        />
      </PageContainer>
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          readOnly
          username={selectedTask.owner ?? undefined}
          onClose={() => setSelectedTask(null)}
          onNavigateToTask={(t) => setSelectedTask(t)}
        />
      )}
    </AppShell>
  );
}

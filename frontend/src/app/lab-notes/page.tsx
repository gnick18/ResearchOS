"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import NotesPanel from "@/components/NotesPanel";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * Lab notes browse surface (PI capability revamp, 2026-06-07). A lab head
 * browses every member's notes in one place; NotesPanel in lab mode opens each
 * read-only via NoteDetailPopup, where the role-based "Edit as lab head" flow
 * (once-per-session confirm, owner-routed write, audit) lives. Reached from the
 * Lab Overview "Browse lab notes" button (was a dead link to the empty personal
 * /workbench).
 */
export default function LabNotesRoute() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users } = useLabData();

  // PI-only surface. A loaded non-PI bounces home.
  useEffect(() => {
    if (accountType === undefined) return;
    if (accountType !== "lab_head") router.replace("/");
  }, [accountType, router]);

  const selectedUsernames = useMemo(
    () => new Set(users.map((u) => u.username)),
    [users],
  );

  return (
    <AppShell>
      <PageContainer width="full" className="py-6">
        <h1 className="text-display font-bold text-foreground mb-1">Lab notes</h1>
        <p className="text-meta text-foreground-muted mb-5">
          Every member&apos;s notes. Open one to review it, or edit it as the lab
          head.
        </p>
        <NotesPanel isLabMode selectedUsernames={selectedUsernames} />
      </PageContainer>
    </AppShell>
  );
}

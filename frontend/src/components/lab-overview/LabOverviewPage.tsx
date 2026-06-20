"use client";

/**
 * Lab Overview page (PI Mode redesign OV-1..5, Grant approved 2026-06-13).
 *
 * The PI's command center, reshaped to lead with what needs them:
 *   OV-1  A "Needs you" HERO at the top (pending approvals, flagged records,
 *         @-mentions, overdue work). Leads the page; all-clear is a calm line.
 *   OV-2  A compact lab stat strip under the hero (members, active experiments,
 *         open + overdue tasks).
 *   OV-3  Lab activity feed beside a People snapshot (member workload + a link to
 *         the People page).
 *   OV-4  The PI-tools card and the browse link-outs are RETIRED: those entry
 *         points now live on the People and Approvals tabs. The audit-trail
 *         viewer (the one orphan) is preserved as a discreet header button. The
 *         embedded full roster is dropped (it lives on the People page now).
 *   OV-5  Announcements shrink to an inline composer (post to the lab); the full
 *         announcement list is no longer on the command center.
 *
 * Per the PI Mode principle (show the lab, not the self) and RS-3 (calendars stay
 * personal), the personal "Today's events" widget is no longer on this lab
 * surface; it stays on the personal Calendar tab.
 *
 * Account-type: PI-only. A non-PI hitting /lab-overview is redirected to "/".
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { labApi } from "@/lib/local-api";
import { isPurchasePending } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabData } from "@/hooks/useLabData";
import { Icon, type IconName } from "@/components/icons";
import { PageContainer } from "@/components/layout/PageContainer";
import AuditTrailViewer from "@/components/lab-head/AuditTrailViewer";

import NewProjectButton from "./NewProjectButton";
import ProjectCreateModal from "./ProjectCreateModal";
import { useLabOverviewBeakerSource } from "@/app/lab-overview/useLabOverviewBeakerSource";
import { ExpandedView as LabActivityBody } from "./widgets/LabActivityWidget";
import { ExpandedView as MemberWorkloadBody } from "./widgets/MemberWorkloadWidget";
import { Composer as AnnouncementComposer } from "./widgets/AnnouncementsWidget";
import ClassDashboardPanel from "./ClassDashboardPanel";
import ClassSubmissionsPanel from "./ClassSubmissionsPanel";
import ClassAssignmentsPanel from "./ClassAssignmentsPanel";
import { useIsClassMode } from "@/hooks/useIsClassMode";
import { useIsClassStudent } from "@/hooks/useIsClassStudent";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";

import type { Note, PurchaseItem } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// "Needs you" counts. Shares React Query keys with the underlying widgets, so
// this is render-side derivation with no duplicate network reads.
// ─────────────────────────────────────────────────────────────────────────────

type WithFlag = { flagged?: { by: string } | null };

function useNeedsYou(): {
  pending: number;
  flagged: number;
  mentions: number;
  overdue: number;
  isLoading: boolean;
} {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const isLabHead = accountType === "lab_head";
  const { tasks } = useLabData();

  const { data: items = [], isLoading: itemsLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: isLabHead,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const pending = useMemo(() => items.filter(isPurchasePending).length, [items]);

  const flagged = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    for (const t of tasks as Array<(typeof tasks)[number] & WithFlag>) {
      if (t.flagged?.by === currentUser) count++;
    }
    for (const it of items) {
      if (it.flagged?.by === currentUser) count++;
    }
    return count;
  }, [tasks, items, currentUser]);

  const mentions = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    for (const n of notes) {
      for (const c of n.comments ?? []) {
        if ((c.mentions ?? []).includes(currentUser)) count++;
      }
    }
    return count;
  }, [notes, currentUser]);

  const overdue = useMemo(() => {
    const today = todayIso();
    let count = 0;
    for (const t of tasks) {
      if (!t.is_complete && t.end_date && t.end_date < today) count++;
    }
    return count;
  }, [tasks]);

  return {
    pending,
    flagged,
    mentions,
    overdue,
    isLoading: itemsLoading || notesLoading,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OV-1: the "Needs you" hero. Leads the page with the work that needs the PI.
// ─────────────────────────────────────────────────────────────────────────────

interface NeedTileProps {
  icon: IconName;
  count: number;
  label: string;
  onClick: () => void;
  tone: string;
}

function NeedTile({ icon, count, label, onClick, tone }: NeedTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-[8rem] flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition hover:brightness-[0.97] ${tone}`}
    >
      <Icon name={icon} className="h-5 w-5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-heading font-bold leading-none tabular-nums">
          {count}
        </span>
        <span className="block text-meta font-medium">{label}</span>
      </span>
    </button>
  );
}

function NeedsYouHero() {
  const router = useRouter();
  const { pending, flagged, mentions, overdue, isLoading } = useNeedsYou();

  if (isLoading) return null;

  const total = pending + flagged + mentions + overdue;

  if (total === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <Icon
          name="check"
          className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
        />
        <div>
          <p className="text-body font-semibold text-foreground">
            You&apos;re all caught up
          </p>
          <p className="text-meta text-foreground-muted">
            Nothing needs your sign-off right now.
          </p>
        </div>
      </div>
    );
  }

  const tiles: NeedTileProps[] = [];
  if (pending > 0) {
    tiles.push({
      icon: "receipt",
      count: pending,
      label: pending === 1 ? "approval" : "approvals",
      onClick: () => router.push("/approvals"),
      tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    });
  }
  if (flagged > 0) {
    tiles.push({
      icon: "alert",
      count: flagged,
      label: "flagged",
      onClick: () => router.push("/approvals"),
      tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
    });
  }
  if (overdue > 0) {
    tiles.push({
      icon: "alarmClock",
      count: overdue,
      label: "overdue",
      onClick: () => router.push("/people"),
      tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
    });
  }
  if (mentions > 0) {
    tiles.push({
      icon: "annotate",
      count: mentions,
      label: mentions === 1 ? "mention" : "mentions",
      onClick: () => router.push("/lab-notes"),
      tone: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200",
    });
  }

  return (
    <section
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5"
      aria-label="What needs you"
    >
      <h2 className="mb-3 flex items-center gap-2 text-meta font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Icon name="shield" className="h-4 w-4" />
        What needs you
      </h2>
      <div className="flex flex-wrap gap-3">
        {tiles.map((t) => (
          <NeedTile key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OV-2: a compact lab stat strip.
// ─────────────────────────────────────────────────────────────────────────────

function LabStatStrip() {
  const { users, tasks } = useLabData();
  const stats = useMemo(() => {
    const today = todayIso();
    let activeExperiments = 0;
    let openTasks = 0;
    let overdue = 0;
    for (const t of tasks) {
      if (t.is_complete) continue;
      openTasks++;
      if (t.task_type === "experiment") activeExperiments++;
      if (t.end_date && t.end_date < today) overdue++;
    }
    return {
      members: users.length,
      activeExperiments,
      openTasks,
      overdue,
    };
  }, [users, tasks]);

  const cell = (icon: IconName, value: number, label: string) => (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <Icon name={icon} className="h-4 w-4 text-foreground-muted" />
      <span>
        <span className="text-body font-semibold tabular-nums text-foreground">
          {value}
        </span>{" "}
        <span className="text-meta text-foreground-muted">{label}</span>
      </span>
    </div>
  );

  return (
    <div className="flex flex-wrap divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
      {cell("users", stats.members, stats.members === 1 ? "member" : "members")}
      {cell("vial", stats.activeExperiments, "active experiments")}
      {cell("list", stats.openTasks, "open tasks")}
      {cell("alarmClock", stats.overdue, "overdue")}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section card — the uniform titled container the reused widget bodies sit in.
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface-raised shadow-sm ${className ?? ""}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h2 className="text-title font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-meta text-foreground-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LabOverviewPage() {
  const { currentUser } = useCurrentUser();
  const router = useRouter();

  const [auditOpen, setAuditOpen] = useState(false);

  // The announcement composer is the BeakerSearch "post announcement" target.
  const composerRef = useRef<HTMLDivElement | null>(null);
  const scrollToComposer = useCallback(() => {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const openProjectCreate = useCallback(() => setShowProjectCreate(true), []);

  // Class Mode (CT-5): the instructor-only "this folder is a class I head"
  // gate. CLASS_MODE_ENABLED short-circuits to a flag-off build (no folder ever
  // carries lab_kind === "class", so the hook would resolve false anyway, but the
  // flag check keeps the panel import inert on a flag-off render).
  const isClassMode = useIsClassMode(currentUser);
  const showClassDashboard = CLASS_MODE_ENABLED && isClassMode === true;

  // Class Mode (CT-2): the student-only "this folder is a class I am a member of"
  // gate. Mutually exclusive with showClassDashboard (one needs head, one needs
  // member), so the instructor and student class chrome never both render.
  const isClassStudent = useIsClassStudent(currentUser);
  const showStudentAssignments =
    CLASS_MODE_ENABLED && isClassStudent === true && !!currentUser;

  useLabOverviewBeakerSource({
    openProjectCreate,
    scrollToComposer,
    router,
  });

  return (
    <PageContainer width="full" className="space-y-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-bold text-foreground">Lab Overview</h1>
          <p className="mt-1 text-body text-foreground-muted">
            Everything that needs you, plus what your lab has been up to.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* OV-4: the audit-trail viewer, the one orphan from the retired PI
              tools card, kept as a discreet header action. */}
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground hover:bg-surface-sunken"
          >
            <Icon name="history" className="h-4 w-4" />
            Audit trail
          </button>
          {currentUser && (
            <NewProjectButton
              username={currentUser}
              tourTarget="create-project-button"
            />
          )}
        </div>
      </div>

      {/* OV-1 + OV-2: lead with what needs the PI, then a compact lab readout. */}
      <NeedsYouHero />
      <LabStatStrip />

      {/* Class dashboard authoring (CT-5 + CT-3): the instructor sets what every
          student's workbench looks like plus the class visibility default. Only
          on a class folder the active user heads (flag-gated). */}
      {showClassDashboard && (
        <SectionCard
          title="Class dashboard"
          description="Set the workbench every student in this class sees, and the default visibility for their work."
        >
          <ClassDashboardPanel />
        </SectionCard>
      )}

      {/* Class submissions (CT-4): the instructor reviews student notebook
          submissions for an assignment and returns them with feedback. Same
          instructor-only class gate as the dashboard. */}
      {showClassDashboard && (
        <SectionCard
          title="Class submissions"
          description="Review what students submitted for an assignment and return their work with feedback."
        >
          <ClassSubmissionsPanel />
        </SectionCard>
      )}

      {/* Class assignments (CT-2): the STUDENT sees the work assigned to them and
          opens a notebook to do + submit it. Student-only class gate, mutually
          exclusive with the instructor dashboard above. */}
      {showStudentAssignments && currentUser && (
        <SectionCard
          title="Your assignments"
          description="Open an assignment to start your notebook, then submit it when you are done."
        >
          <ClassAssignmentsPanel currentUser={currentUser} />
        </SectionCard>
      )}

      {/* OV-5: announcements shrink to an inline composer (post to the lab). */}
      {currentUser && (
        <div ref={composerRef} className="scroll-mt-4">
          <SectionCard
            title="Post an announcement"
            description="Share something with the whole lab."
          >
            <AnnouncementComposer username={currentUser} onPosted={() => {}} />
          </SectionCard>
        </div>
      )}

      {/* OV-3: People workload as a full-width strip, lab activity full-width
          below in flowing columns. Both use the laptop width instead of a
          short 1/3 column that left a void beside a long feed. */}
      <SectionCard
        title="People"
        description="Workload across your lab."
        action={
          <button
            type="button"
            onClick={() => router.push("/people")}
            className="shrink-0 rounded-md px-2.5 py-1 text-meta font-medium text-brand-action hover:underline"
          >
            View all
          </button>
        }
      >
        <MemberWorkloadBody surface="strip" />
      </SectionCard>
      <SectionCard
        title="Lab activity"
        description="A cross-lab feed of recent experiments, notes, and tasks."
      >
        <LabActivityBody surface="canvas" wide />
      </SectionCard>

      <AuditTrailViewer open={auditOpen} onClose={() => setAuditOpen(false)} />

      {showProjectCreate && currentUser && (
        <ProjectCreateModal
          username={currentUser}
          onClose={() => setShowProjectCreate(false)}
          onCreated={() => setShowProjectCreate(false)}
        />
      )}
    </PageContainer>
  );
}

"use client";

/**
 * Lab Overview page (lab-overview-page bot, 2026-06-02), PHASE 1.
 *
 * A FIXED, curated, action-first page for Lab Heads (PIs) that REPLACES
 * the customizable widget canvas as the /lab-overview surface. It reuses
 * the existing widget BODIES (each widget exports `ExpandedView`) as
 * static page sections, wrapped in titled section cards. No grid, no
 * drag-drop, no add/remove widget chrome.
 *
 * The old "/" home canvas framework (widget registry, snapshot canvas,
 * customizable sidebar, layout-persistence) was torn down in Phase 2;
 * this page renders the widget bodies directly as static sections.
 *
 * Layout (top to bottom), action-first so a PI sees what needs them
 * above the fold:
 *   1. ACTION BAR (renders only when something is pending): one compact
 *      row summarizing pending purchase approvals + the flag queue +
 *      unread @-mentions. Each segment links to the relevant surface.
 *      Nothing pending collapses to a thin "You're all caught up" line.
 *   2. LINK-OUTS: "Browse lab experiments" / "Browse lab notes" buttons.
 *   3. ANNOUNCEMENTS (full section): AnnouncementsWidget body.
 *   4. LAB ACTIVITY (centerpiece) + RIGHT RAIL (Today's events + Member
 *      workload). Two-column from lg; the rail stacks below the feed on
 *      narrow screens.
 *
 * The structured trainee relationship (weekly goals, meeting notes, agenda)
 * now lives on the Workbench Mentoring / Check-ins tab (the 1:1 surface), so
 * the old "Trainee notes & goals" widget was retired from this dashboard.
 *
 * Account-type: PI-only. A non-PI hitting /lab-overview is redirected to
 * "/" (Phase 2 finalizes member routing).
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
import LabRoster from "@/components/lab-head/LabRoster";
import AuditTrailViewer from "@/components/lab-head/AuditTrailViewer";

import NewProjectButton from "./NewProjectButton";
import ProjectCreateModal from "./ProjectCreateModal";
import { useLabOverviewBeakerSource } from "@/app/lab-overview/useLabOverviewBeakerSource";
import { ExpandedView as AnnouncementsBody } from "./widgets/AnnouncementsWidget";
import { ExpandedView as LabActivityBody } from "./widgets/LabActivityWidget";
import { ExpandedView as CalendarEventsTodayBody } from "./widgets/CalendarEventsTodayWidget";
import { ExpandedView as MemberWorkloadBody } from "./widgets/MemberWorkloadWidget";

import type { Note, PurchaseItem } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons (no emojis; inline SVG only — matches the widget bodies).
// ─────────────────────────────────────────────────────────────────────────────

const SHIELD_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const FLAG_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const MENTION_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
  </svg>
);

const ALL_CLEAR_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const BEAKER_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7 14h10" />
  </svg>
);

const NOTE_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const ARROW_RIGHT_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Action-bar data. Mirrors the data sources the relevant widgets read
// (PiActionsWidget for pending approvals + flags-by-me; CommentMentions /
// CommentFeed for @-mentions) so the bar can stand alone above the fold
// without mounting the full widget bodies. All three queries share React
// Query keys with the underlying widgets, so this is render-side derivation
// with no duplicate network reads.
// ─────────────────────────────────────────────────────────────────────────────

type WithFlag = { flagged?: { by: string } | null };

function useActionBarCounts(): {
  pending: number;
  flagged: number;
  mentions: number;
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

  const pending = useMemo(
    () => items.filter(isPurchasePending).length,
    [items],
  );

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

  return {
    pending,
    flagged,
    mentions,
    isLoading: itemsLoading || notesLoading,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action bar
// ─────────────────────────────────────────────────────────────────────────────

interface ActionSegmentProps {
  icon: ReactNode;
  count: number;
  label: string;
  tint: string;
  onClick: () => void;
}

function ActionSegment({ icon, count, label, tint, onClick }: ActionSegmentProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body font-medium transition-colors ${tint}`}
    >
      <span aria-hidden="true" className="flex-shrink-0">
        {icon}
      </span>
      <span className="tabular-nums font-semibold">{count}</span>
      <span>{label}</span>
    </button>
  );
}

function ActionBar() {
  const router = useRouter();
  const { pending, flagged, mentions, isLoading } = useActionBarCounts();

  if (isLoading) {
    // Render nothing while counts resolve to avoid a flash of the
    // all-caught-up line before the real numbers arrive.
    return null;
  }

  const total = pending + flagged + mentions;

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-meta text-foreground-muted">
        <span aria-hidden="true" className="text-emerald-500">
          {ALL_CLEAR_ICON}
        </span>
        You&apos;re all caught up.
      </div>
    );
  }

  const segments: ActionSegmentProps[] = [];
  if (pending > 0) {
    segments.push({
      icon: SHIELD_ICON,
      count: pending,
      label: pending === 1 ? "approval" : "approvals",
      tint: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 hover:bg-amber-200",
      // Pending purchase approvals live on the unified Approvals queue (PI Mode).
      onClick: () => router.push("/approvals"),
    });
  }
  if (flagged > 0) {
    segments.push({
      icon: FLAG_ICON,
      count: flagged,
      label: "flagged",
      tint: "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 hover:bg-red-200",
      // Flagged records join the same Approvals queue (AP-3).
      onClick: () => router.push("/approvals"),
    });
  }
  if (mentions > 0) {
    segments.push({
      icon: MENTION_ICON,
      count: mentions,
      label: mentions === 1 ? "mention" : "mentions",
      tint: "bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-200 hover:bg-blue-200",
      // @-mentions surface in the Lab Inbox comments view.
      onClick: () => router.push("/lab-inbox"),
    });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5"
      role="region"
      aria-label="What needs you"
    >
      <span className="mr-1 flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <span aria-hidden="true">{SHIELD_ICON}</span>
        What needs you
      </span>
      {segments.map((seg, i) => (
        <span key={seg.label} className="flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden="true" className="text-foreground-muted">
              ·
            </span>
          )}
          <ActionSegment {...seg} />
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Link-outs
// ─────────────────────────────────────────────────────────────────────────────

function LinkOuts() {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => router.push("/lab-experiments")}
        className="group inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-medium text-foreground shadow-sm transition-colors hover:border-border hover:bg-surface-sunken"
      >
        <span aria-hidden="true" className="text-foreground-muted">
          {BEAKER_ICON}
        </span>
        Browse lab experiments
        <span
          aria-hidden="true"
          className="text-foreground-muted transition-transform group-hover:translate-x-0.5"
        >
          {ARROW_RIGHT_ICON}
        </span>
      </button>
      <button
        type="button"
        onClick={() => router.push("/lab-notes")}
        className="group inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-medium text-foreground shadow-sm transition-colors hover:border-border hover:bg-surface-sunken"
      >
        <span aria-hidden="true" className="text-foreground-muted">
          {NOTE_ICON}
        </span>
        Browse lab notes
        <span
          aria-hidden="true"
          className="text-foreground-muted transition-transform group-hover:translate-x-0.5"
        >
          {ARROW_RIGHT_ICON}
        </span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section card — the uniform titled container every reused widget body
// sits inside. Matches the app's white-card / rounded-2xl / subtle-border
// section styling.
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** When true, the card body gets a capped, scrollable height so a long
   *  feed doesn't push the page endlessly. */
  className?: string;
}

function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface-raised shadow-sm ${className ?? ""}`}
    >
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-title font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-meta text-foreground-muted">{description}</p>
        )}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PI tools (Phase 3): one quick-access card gathering the lab head's unique
// powers as entry points, so they are discoverable in one place. Each tool
// reuses an EXISTING destination, the same routes the action bar already uses
// for approvals (/purchases) and the flag queue (/lab-inbox), plus the new
// audit-trail viewer and a scroll to the embedded roster below.
// ─────────────────────────────────────────────────────────────────────────────

interface PiToolProps {
  icon: IconName;
  label: string;
  description: string;
  onClick: () => void;
}

function PiTool({ icon, label, description, onClick }: PiToolProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3 text-left shadow-sm transition-colors hover:border-border hover:bg-surface-sunken"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 text-foreground-muted group-hover:text-foreground"
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">
          {label}
        </span>
        <span className="block text-meta text-foreground-muted">
          {description}
        </span>
      </span>
    </button>
  );
}

function PiToolsCard({ onJumpToRoster }: { onJumpToRoster: () => void }) {
  const router = useRouter();
  const [auditOpen, setAuditOpen] = useState(false);
  return (
    <SectionCard
      title="PI tools"
      description="The lab-head powers, all in one place."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PiTool
          icon="users"
          label="Lab roster"
          description="Manage members, archive or restore."
          onClick={onJumpToRoster}
        />
        <PiTool
          icon="history"
          label="Audit trail"
          description="Review your edits to members' records."
          onClick={() => setAuditOpen(true)}
        />
        <PiTool
          icon="check"
          label="Pending approvals"
          description="Approve or decline purchase requests."
          // The unified Approvals queue (PI Mode), the same route the action
          // bar's "approvals" segment uses.
          onClick={() => router.push("/approvals")}
        />
        <PiTool
          icon="alert"
          label="Flag queue"
          description="Records you flagged for follow-up."
          // The flag queue joins the same Approvals queue (AP-3).
          onClick={() => router.push("/approvals")}
        />
      </div>
      <AuditTrailViewer open={auditOpen} onClose={() => setAuditOpen(false)} />
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LabOverviewPage() {
  const { currentUser } = useCurrentUser();
  const router = useRouter();
  // The "Lab roster" PI tool scrolls to the embedded roster section below
  // rather than navigating away, keeping the PI on the overview.
  const rosterRef = useRef<HTMLDivElement | null>(null);
  const jumpToRoster = useCallback(() => {
    rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Project-create modal the BeakerSearch "New project" command opens (the
  // header NewProjectButton owns its own; this is the palette's entry point).
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const openProjectCreate = useCallback(() => setShowProjectCreate(true), []);

  // Register the Lab Overview BeakerSearch source (lab head only; the hook
  // returns null for a member so nothing is merged).
  useLabOverviewBeakerSource({
    openProjectCreate,
    scrollToRoster: jumpToRoster,
    router,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-heading font-bold text-foreground">Lab Overview</h1>
            <p className="mt-1 text-body text-foreground-muted">
              Everything that needs you, plus what your lab has been up to.
            </p>
          </div>
          {/* Project creation moved here from the retired widget canvas
              (widget-framework teardown v2). Stable tour anchor for §6.1. */}
          {currentUser && (
            <NewProjectButton
              username={currentUser}
              tourTarget="create-project-button"
            />
          )}
        </div>
        <ActionBar />
        <LinkOuts />
      </div>

      {/* PI tools (Phase 3): quick access to the lab head's unique powers,
          discoverable in one place, before the deeper feeds. */}
      <PiToolsCard onJumpToRoster={jumpToRoster} />

      <SectionCard
        title="Announcements"
        description="Post to the whole lab and see recent announcements."
      >
        <AnnouncementsBody surface="canvas" />
      </SectionCard>

      {/* Lab roster embedded inline (Phase 3): the self-contained roster as its
          own section. The "Lab roster" PI tool scrolls here. */}
      <div ref={rosterRef} className="scroll-mt-4">
        <SectionCard
          title="Lab roster"
          description="Active and archived lab members. Archive a departed member to hide them from day-to-day surfaces while keeping their data searchable."
        >
          <LabRoster />
        </SectionCard>
      </div>

      {/* Activity feed + right rail. Single column below lg; two columns
          (feed wider than the rail) from lg up. The rail stacks BELOW the
          feed on narrow screens. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="Lab activity"
            description="A cross-lab feed of recent experiments, notes, and tasks."
          >
            <LabActivityBody surface="canvas" />
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Today's events">
            <CalendarEventsTodayBody surface="sidebar" />
          </SectionCard>
          <SectionCard title="Member workload">
            <MemberWorkloadBody surface="sidebar" />
          </SectionCard>
        </div>
      </div>

      {showProjectCreate && currentUser && (
        <ProjectCreateModal
          username={currentUser}
          onClose={() => setShowProjectCreate(false)}
          onCreated={() => {
            // Do NOT navigate into the new project on create (felt intrusive,
            // Grant 2026-06-09). The modal self-closes + invalidates the
            // ["projects"] query, so the new card just appears in the list.
            setShowProjectCreate(false);
          }}
        />
      )}
    </div>
  );
}

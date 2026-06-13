"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/FixtureLink";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectsApi as rawProjectsApi,
  purchasesApi,
  sequencesApi,
  tasksApi,
} from "@/lib/local-api";
import type { ProjectUpdate } from "@/lib/local-api";
import type { FundingAccount, Task } from "@/lib/types";
import {
  taskResultsBase,
  resolveTabAttachmentBase,
} from "@/lib/tasks/results-paths";
import { listImagesInFolder } from "@/lib/attachments/image-folder";
import { readProjectActivity } from "@/lib/project-activity/event-log";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import ProjectDepositDialog from "@/components/ProjectDepositDialog";
import Tooltip from "@/components/Tooltip";
import { focusWithoutTooltip } from "@/components/tooltip-focus";
import ProjectFundingSection from "@/components/project-surface/ProjectFundingSection";
import OverviewSection from "@/components/project-surface/OverviewSection";
import ResultsGallery from "@/components/project-surface/ResultsGallery";
import MethodsInventory from "@/components/project-surface/MethodsInventory";
import SequencesInventory from "@/components/project-surface/SequencesInventory";
import GoalsSection from "@/components/project-surface/GoalsSection";
import ActivityFeed from "@/components/project-surface/ActivityFeed";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { useAccountType } from "@/hooks/useAccountType";
import type { Project, ProjectRestorePayload } from "@/lib/types";
// VC Phase 3 (VC-Phase3-Project sub-bot of HR, 2026-05-31): version-history +
// restore wiring for the Project surface. Mirrors TaskDetailPopup.
import { RESTORE_ENABLED, canonicalize } from "@/lib/history";
import {
  useVersionRestore,
  type VersionRestoreApi,
} from "@/lib/history/useVersionRestore";
import { canRead, canWrite } from "@/lib/sharing/unified";
import { projectAdapter } from "@/lib/history/project-viewer";
import EntityVersionHistorySidebar, {
  type VersionPreview,
} from "@/components/history/EntityVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";

const DEFAULT_COLOR = "#3b82f6";
const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// Tab set is derived per-render from feature_picks + content presence (see
// `sections` below): the Goals entry only appears when L11's gating condition
// is met, and Methods / Sequences only when those sections have content.
// Results is ALWAYS shown (issue #4: users look for it; its empty-state is
// actionable, not a dead tab). These are REAL tabs backed by local React state
// (see `activeTab`), not scroll anchors: only the active section's content
// renders at a time, so a near-empty project never shows a tab that scrolls
// nowhere. (Original beta bug #4 was the dead-tab case.)
// Sequences (de-bloat arc Phase 3b) is PRESENTATION-ONLY: it lists the project's
// linked plasmids/sequences from the sequence arc's `sequencesApi.listByProject`
// and links OUT to /sequences; it does not embed the editor or write data.
type SectionId =
  | "overview"
  | "results"
  | "methods"
  | "sequences"
  | "goals"
  | "activity";

interface SectionDef {
  id: SectionId;
  label: string;
}

const OVERVIEW_SECTION: SectionDef = { id: "overview", label: "Overview" };
const RESULTS_SECTION: SectionDef = { id: "results", label: "Results" };
const METHODS_SECTION: SectionDef = { id: "methods", label: "Methods" };
const SEQUENCES_SECTION: SectionDef = { id: "sequences", label: "Sequences" };
const GOALS_SECTION: SectionDef = { id: "goals", label: "Goals" };
const ACTIVITY_SECTION: SectionDef = { id: "activity", label: "Activity" };

// Content-presence signal for the auto-hiding tabs. These hooks re-run the
// SAME react-query queries (identical query keys) that ResultsGallery /
// MethodsInventory / ActivityFeed already run, so the cache is shared and no
// extra disk reads happen: the parent just reads the cached result to decide
// tab visibility. Methods presence is derived purely from the task list
// (an experiment's `method_attachments`), so it needs no extra resolution.
interface SectionPresence {
  hasResults: boolean;
  hasMethods: boolean;
  hasSequences: boolean;
  hasActivity: boolean;
}

function useSectionPresence(project: Project | null | undefined): SectionPresence {
  const owner = project?.owner ?? "";
  const projectId = project?.id ?? 0;
  const isSharedWithMe = project?.is_shared_with_me === true;
  const isArchived = project?.is_archived === true;
  const taskListOwner = isSharedWithMe ? owner : undefined;

  const { data: ownTasks = [] } = useQuery({
    queryKey: ["tasks", isSharedWithMe ? `${owner}:${projectId}` : `self:${projectId}`],
    queryFn: () => tasksApi.listByProject(projectId, taskListOwner),
    enabled: !!project,
  });

  const { data: hostedTasks = [] } = useQuery({
    queryKey: ["projects", owner, projectId, "hosted-tasks"],
    queryFn: () => rawProjectsApi.listHostedTasks(owner, projectId),
    enabled: !!project && !isArchived,
  });

  const experimentTasks: Task[] = useMemo(() => {
    const own = ownTasks.filter((t) => t.task_type === "experiment");
    const hosted = hostedTasks.filter((t) => t.task_type === "experiment");
    return [...own, ...hosted];
  }, [ownTasks, hostedTasks]);

  // Methods presence: any experiment with at least one method attachment.
  const hasMethods = useMemo(
    () => experimentTasks.some((t) => (t.method_attachments?.length ?? 0) > 0),
    [experimentTasks],
  );

  // Results presence: at least one result image across the experiments. Shares
  // ResultsGallery's exact query key so it reads from (and warms) the same
  // cache entry instead of double-scanning the folders.
  const experimentKey = useMemo(
    () => experimentTasks.map((t) => `${t.owner}:${t.id}`).join(","),
    [experimentTasks],
  );
  const { data: totalImages = 0 } = useQuery({
    queryKey: ["project-results-presence", owner, projectId, experimentKey],
    queryFn: async (): Promise<number> => {
      let count = 0;
      for (const task of experimentTasks) {
        const outerBase = taskResultsBase(task);
        const basePath = await resolveTabAttachmentBase(task, "results", outerBase);
        try {
          const images = await listImagesInFolder(basePath);
          count += images.length;
          if (count > 0) break;
        } catch {
          // No Images folder yet — treat as empty.
        }
      }
      return count;
    },
    enabled: !!project && experimentTasks.length > 0,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["project-activity", owner, projectId],
    queryFn: () => readProjectActivity(owner, projectId),
    enabled: !!project,
  });

  // Sequences presence: any plasmid/sequence in the current user's library
  // linked to this project (project_ids membership). Shares SequencesInventory's
  // exact query key so the tab probe and the rendered section read from one
  // warmed cache entry. PRESENTATION-ONLY: we consume the sequence arc's live
  // `sequencesApi.listByProject` (lib/local-api.ts) and never write sequence
  // data. The seam returns [] until the sequence arc fills it, so the tab and
  // section stay hidden for projects with no linked sequences.
  const { data: sequences = [] } = useQuery({
    queryKey: ["project-sequences", owner, projectId],
    queryFn: () => sequencesApi.listByProject(projectId),
    enabled: !!project,
  });

  return {
    hasResults: totalImages > 0,
    hasMethods,
    hasSequences: sequences.length > 0,
    hasActivity: events.length > 0,
  };
}

// Mirrors ProjectDetailPopup's owner-routing for mutations. When the viewer is
// a receiver of a shared project with edit permission, every mutation needs to
// write back to the OWNER's directory. View-only receivers and own-project
// viewers pass undefined.
function effectiveOwnerOf(project: Project): string | undefined {
  return project.is_shared_with_me && project.shared_permission === "edit"
    ? project.owner
    : undefined;
}

interface ProjectRouteProps {
  projectId: number;
  ownerHint: string | null;
}

export default function ProjectRoute({ projectId, ownerHint }: ProjectRouteProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // L11 gate: Goals section + jump anchor are conditional on the viewer's
  // own feature_picks.goals === "yes" (the wizard's Q4 outcome). undefined
  // (still loading) and null (existing user) both fall through to "hidden",
  // which means migrated users never see the surface until they opt in via
  // Settings. Matches W11GoalsTourStep / Q4GoalsStep's gating check.
  const { currentUser } = useCurrentUser();
  const featurePicks = useFeaturePicks(currentUser);
  const goalsEnabled = featurePicks?.goals === "yes";

  // ownerHint comes from the URL `?owner=` query. When present, treat this as
  // a shared-project view and read from that user's directory. When absent,
  // read from the current user's own namespace.
  const { data: project, isLoading, isError } = useQuery<Project | null>({
    queryKey: ["projects", ownerHint ?? "self", projectId, "surface"],
    queryFn: () => rawProjectsApi.get(projectId, ownerHint ?? undefined),
  });

  // Active tab for the real (state-backed, non-routing) project section tabs.
  // "overview" is the default landing tab. If the active tab's section is
  // hidden by content-presence on a later render (e.g. its only image was
  // deleted) the render path below falls back to Overview.
  const [activeTab, setActiveTab] = useState<SectionId>("overview");

  // Content presence drives auto-hiding of the Results / Methods / Activity
  // tabs. Runs unconditionally (rules-of-hooks) and no-ops with `enabled`
  // guards while the project is still loading.
  const presence = useSectionPresence(project);

  const [showSharePopup, setShowSharePopup] = useState(false);
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Onboarding v4 §6.2 NAV sub-step uses this dispatch to know when the
  // cursor's click on the home-page project card has landed on the
  // project route. The follow-up PROSE sub-step's cursor script then
  // runs against the textarea with a fresh overlay mount (a single
  // cursor script can't span the navigation because
  // `InProductWalkthroughOverlay` unmounts on route change). See
  // `watchProjectRouteEntered` in
  // `components/onboarding/v4/steps/walkthrough/lib/tour-events.ts`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("tour:project-route-entered"));
  }, [projectId]);

  const projectsApi = useMemo(() => {
    if (!project) return null;
    const owner = effectiveOwnerOf(project);
    return {
      update: (id: number, data: ProjectUpdate) => rawProjectsApi.update(id, data, owner),
      archive: (id: number, isArchived: boolean) =>
        rawProjectsApi.archive(id, isArchived, owner),
      delete: (id: number) => rawProjectsApi.delete(id),
    };
  }, [project]);

  const handleArchive = useCallback(async () => {
    if (!project || !projectsApi) return;
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, !project.is_archived);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
      ]);
    } catch {
      alert("Failed to update archive state");
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  }, [project, projectsApi, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!project || !projectsApi) return;
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
      ]);
      router.push("/");
    } catch {
      alert("Failed to delete project");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [project, projectsApi, queryClient, router]);

  // ── VC Phase 3 (Project): version-history viewer + restore-a-version + 24h
  // undo-restore. Mirrors TaskDetailPopup. ALL hooks below run unconditionally
  // and BEFORE the loading / not-found early returns (React rules-of-hooks); the
  // handlers no-op while `project` is null. The history file lives under the
  // PROJECT OWNER's folder (users/<owner>/_history/project/<id>.jsonl).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(
    null,
  );
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setVersionPreview(null);
    focusWithoutTooltip(historyTriggerRef.current);
  }, []);

  // canRestore: can the current viewer write this project (and thus restore a
  // version)? Owner writes; a shared-edit receiver writes. The old PI-passcode
  // edit-session cross-owner override was removed, so a lab head editing
  // another member's project follows standard share permissions.
  const accountType = useAccountType(currentUser);
  const restoreViewer = useMemo(
    () => ({
      username: currentUser ?? "",
      account_type: (accountType === "lab_head" ? "lab_head" : "lab") as
        | "solo"
        | "lab"
        | "lab_head",
    }),
    [currentUser, accountType],
  );
  const canRestore =
    !!project &&
    canRead(project, restoreViewer) &&
    canWrite(project, restoreViewer);

  // The PI-passcode unlock path was removed; the affordance is simply hidden
  // for a read-only viewer who cannot write.
  const restoreNeedsUnlock = false;

  // The owner folder the history file lives under + the cross-owner write route.
  const historyOwner = project?.owner || currentUser || "";
  const restoreOwnerArg =
    project?.is_shared_with_me && project?.shared_permission === "edit"
      ? project.owner
      : undefined;

  // The entity API the restore hook binds. Routes get/update to the project
  // OWNER's folder when this is a shared-with-edit view, and threads the
  // historyMeta stamp so the restore / undo rows are marked "revert" /
  // "undo-revert". Mirrors TaskDetailPopup.restoreApi.
  const restoreApi = useMemo<VersionRestoreApi<Project>>(
    () => ({
      get: (id, owner) => rawProjectsApi.get(id, owner ?? restoreOwnerArg),
      update: (id, payload, historyMeta) =>
        rawProjectsApi.update(
          id,
          payload as ProjectRestorePayload,
          restoreOwnerArg,
          historyMeta,
        ),
    }),
    [restoreOwnerArg],
  );

  // Reflect the restored record by refetching the project surface query (the
  // query is the source of truth here; there is no local project state to set).
  // The hook hands the freshly-written record up; we ignore it and refetch so
  // the overview prose query + the activity feed also re-resolve.
  const reflectRestoredProject = useCallback(
    (_updated: Project) => {
      void queryClient.refetchQueries({
        queryKey: ["projects", ownerHint ?? "self", projectId, "surface"],
      });
      void queryClient.refetchQueries({ queryKey: ["projects"] });
    },
    [queryClient, ownerHint, projectId],
  );

  // Canonical tracked state of the LIVE project (HEAD). Threaded into the
  // sidebar so the engine can resolve a BARE-GENESIS anchor (a project that
  // existed before its first tracked save). Same HEAD source useVersionRestore
  // uses, so the viewer + restore path agree byte-for-byte. A null project
  // canonicalizes to "null"; the sidebar only mounts when project is present.
  const liveProjectCanonical = useMemo(
    () => (project ? canonicalize(project) : ""),
    [project],
  );

  // A stable record for the hook (it requires a non-null record even though the
  // handlers no-op until the project loads). Cast id to number for the hook's
  // RestorableRecord shape.
  const restoreRecord = (project ?? { id: projectId, owner: "" }) as Project;

  const {
    handleRestore,
    handleUndoRestore,
    undoConfirmPending,
    confirmUndoRestore,
    dismissUndoConfirm,
    undoWindowActive,
    isBusy: restoreBusy,
    restoreError,
  } = useVersionRestore<Project>({
    entityType: "project",
    record: restoreRecord,
    id: projectId,
    owner: historyOwner,
    api: restoreApi,
    currentUser,
    onUpdate: reflectRestoredProject,
    // Project immutable keys: never overwritten by a restore payload. `owner` is
    // the routing/sharing field; `created_at` is the genesis stamp; `id` is the
    // identity. Everything else (name, tags, color, schedule, funding, archive
    // state) is restored.
    immutableKeys: ["id", "owner", "created_at"],
    onAfterRestore: closeHistory,
  });

  // Esc exits the version-history sidebar first (before any route-level close).
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeHistory();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [historyOpen, closeHistory]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-body text-foreground-muted">Loading…</p>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
        <p className="text-title text-foreground font-medium">Project not found</p>
        <p className="text-body text-foreground-muted max-w-md text-center">
          We couldn&apos;t load this project. It may have been deleted, or you don&apos;t
          have access to it.
        </p>
        <Link
          href="/"
          className="mt-2 text-body text-blue-600 dark:text-blue-300 hover:text-blue-700 hover:underline"
        >
          ← Back to projects
        </Link>
      </div>
    );
  }

  const projectColor = project.color || DEFAULT_COLOR;
  const isMiscellaneousProject = project.name === "Miscellaneous";
  const isViewOnlyReceiver =
    project.is_shared_with_me === true && project.shared_permission === "view";
  const isAnyReceiver = project.is_shared_with_me === true;

  // Build the visible tab list. Overview always shows. Results / Methods hide
  // when their section has no content. Goals only when its feature gate is on
  // (placed just above Activity, mirroring the proposal's §4 surface order).
  // Activity shows when it has any events (a fresh project's creation events
  // make this true; a truly empty activity log hides the tab). The required
  // outcome: a near-empty project ("test" with only an Overview) shows
  // essentially just the Overview tab, never a dead Results/Methods tab.
  const sections: SectionDef[] = [
    OVERVIEW_SECTION,
    // Results is ALWAYS shown (issue #4): users look for it on a project, and
    // when empty it renders an actionable empty-state (results live in
    // experiments + a Create experiment button), so it is never a dead tab.
    // Methods / Sequences / Activity stay hide-when-empty.
    RESULTS_SECTION,
    ...(presence.hasMethods ? [METHODS_SECTION] : []),
    ...(presence.hasSequences ? [SEQUENCES_SECTION] : []),
    ...(goalsEnabled ? [GOALS_SECTION] : []),
    ...(presence.hasActivity ? [ACTIVITY_SECTION] : []),
  ];

  // Guard: if the active tab is no longer in the visible set (its content
  // disappeared, or the feature gate flipped), fall back to Overview for
  // this render. The next interaction re-pins via setActiveTab.
  const effectiveTab: SectionId = sections.some((s) => s.id === activeTab)
    ? activeTab
    : "overview";

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-surface-raised">
      <div className="h-2 flex-shrink-0" style={{ backgroundColor: projectColor }} />

      <div
        className="sticky top-0 z-10 bg-surface-raised border-b border-border"
        data-testid="project-route-topbar"
        // Onboarding v4 §6.2 topbar anchor (now orphaned). It used to
        // back the `project-overview-context` step, which the 2026-06-03
        // tour-simplification collapse removed (the four §6.2 beats folded
        // into the single `project-overview-typing-demo` beat). The stamp
        // is kept harmless rather than touching the page markup. Selector
        // wired via `targets.ts` -> projectOverviewTopbar.
        data-tour-target="project-overview-topbar"
      >
        <div className="px-6 pt-4 pb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/"
                className="text-body text-foreground-muted hover:text-foreground hover:underline flex-shrink-0"
              >
                ← Projects
              </Link>
              <span className="text-foreground-muted">/</span>
              <h1 className="text-heading font-semibold text-foreground truncate">
                {project.name}
              </h1>
              {project.is_archived && (
                <span className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full flex-shrink-0">
                  Archived
                </span>
              )}
              {project.is_shared_with_me && (
                <span className="text-meta px-2 py-0.5 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 rounded-full flex-shrink-0">
                  Shared by {project.owner}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                href={`/gantt?project=${encodeURIComponent(`${project.owner}:${project.id}`)}`}
                className="text-body text-foreground-muted hover:text-foreground hover:underline whitespace-nowrap"
              >
                View timeline →
              </Link>
              <div className="flex items-center gap-1">
              {/* VC Phase 3 (Project): "Undo restore" button. Visible (flag ON)
                  while a 24h undo window is live for this project. Enabled for
                  the owner / PI-with-unlock; DISABLED with an unlock Tooltip for
                  a PI who could unlock but has not; HIDDEN for a read-only shared
                  viewer. Render-gated on expiry. Mirrors TaskDetailPopup. */}
              {!isMiscellaneousProject &&
                RESTORE_ENABLED &&
                undoWindowActive &&
                (canRestore || restoreNeedsUnlock) && (
                  <Tooltip
                    label={
                      restoreNeedsUnlock
                        ? "Unlock edit mode (PI passcode) to undo the restore"
                        : restoreBusy
                          ? "Undoing the restore..."
                          : "Undo the restore (returns the project to its pre-restore version)"
                    }
                    placement="bottom"
                  >
                    <button
                      onClick={
                        canRestore && !restoreBusy ? handleUndoRestore : undefined
                      }
                      disabled={!canRestore || restoreBusy}
                      data-testid="project-undo-restore-button"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-meta font-medium rounded-lg transition-colors ${
                        canRestore && !restoreBusy
                          ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/20"
                          : "text-foreground-muted bg-surface-sunken cursor-not-allowed"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 14L4 9l5-5" />
                        <path d="M4 9h11a4 4 0 0 1 0 8h-1" />
                      </svg>
                      {restoreBusy ? "Undoing..." : "Undo restore"}
                    </button>
                  </Tooltip>
                )}
              {/* VC Phase 3 (Project): version-history entry button. Shown to
                  anyone with read access (the route only renders on readable
                  projects). Toggles the version viewer; opening flips the body to
                  a read-only diff preview. Mirrors TaskDetailPopup. */}
              {!isMiscellaneousProject && (
                <Tooltip label="Version history" placement="bottom">
                  <button
                    ref={historyTriggerRef}
                    onClick={() => {
                      if (historyOpen) {
                        closeHistory();
                      } else {
                        setHistoryOpen(true);
                      }
                    }}
                    data-testid="project-history-button"
                    aria-pressed={historyOpen}
                    className={`p-2 rounded-lg transition-colors ${
                      historyOpen
                        ? "text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15"
                        : "text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken"
                    }`}
                    aria-label="Version history"
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 3v5h5" />
                      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              {!isMiscellaneousProject && (
                <Tooltip
                  label={
                    historyOpen
                      ? "Close version history to edit this project"
                      : isViewOnlyReceiver
                        ? `Only the owner (${project.owner}) and edit-permission collaborators can edit this project`
                        : "Edit project"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={() => setShowEditModal(true)}
                    disabled={isViewOnlyReceiver || historyOpen}
                    className={`p-2 rounded-lg transition-colors ${
                      isViewOnlyReceiver || historyOpen
                        ? "text-foreground-muted cursor-not-allowed"
                        : "text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken"
                    }`}
                    aria-label="Edit project"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {/* One Share button opens the two-tab UnifiedShareDialog (lab ACL
                  + cross-boundary send), replacing the separate "Share project"
                  and "Share outside this folder" buttons. */}
              {!isMiscellaneousProject && !project.is_shared_with_me && (
                <Tooltip label="Share" placement="bottom">
                  <button
                    onClick={() => setShowSharePopup(true)}
                    className="p-2 text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
                    aria-label="Share"
                    data-testid="project-share-button"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isMiscellaneousProject && (
                <Tooltip label="Deposit to a repository" placement="bottom">
                  <button
                    onClick={() => setShowDepositDialog(true)}
                    className="p-2 text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
                    aria-label="Deposit to a repository"
                    data-testid="project-deposit-button"
                  >
                    {/* Repository / archive-with-upload-arrow glyph (inline SVG;
                        no icon library, no emoji). Mirrors the per-experiment
                        deposit button in TaskDetailPopup. */}
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 8v13H3V8" />
                      <rect x="1" y="3" width="22" height="5" rx="1" />
                      <path d="M12 17V11" />
                      <polyline points="9 14 12 11 15 14" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isMiscellaneousProject && (
                <Tooltip
                  label={
                    isViewOnlyReceiver
                      ? `Only the owner (${project.owner}) and edit-permission collaborators can ${project.is_archived ? "unarchive" : "archive"} this project`
                      : project.is_archived
                        ? "Unarchive this project"
                        : "Archive this project"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={() =>
                      project.is_archived ? handleArchive() : setShowArchiveConfirm(true)
                    }
                    disabled={archiving || isViewOnlyReceiver}
                    className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                      isViewOnlyReceiver
                        ? "text-foreground-muted cursor-not-allowed"
                        : project.is_archived
                          ? "text-green-600 dark:text-green-300 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-500/20"
                          : "text-amber-600 dark:text-amber-300 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-500/20"
                    }`}
                    aria-label={project.is_archived ? "Unarchive project" : "Archive project"}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isMiscellaneousProject && (
                <Tooltip
                  label={
                    isAnyReceiver
                      ? `Only the owner (${project.owner}) can delete this project`
                      : "Delete this project"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting || isAnyReceiver}
                    className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                      isAnyReceiver
                        ? "text-foreground-muted cursor-not-allowed"
                        : "text-red-600 dark:text-red-300 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/20"
                    }`}
                    aria-label="Delete project"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              </div>
            </div>
          </div>

          {/* Real tabs (beta bug #4): state-backed, no routing, no scroll
              anchors. Only the active section renders in the body below.
              Tabs with no content are omitted from `sections` so a near-empty
              project never shows a dead Results/Methods tab. */}
          <nav
            className="flex items-center gap-1 -mb-px"
            role="tablist"
            aria-label="Project sections"
          >
            {sections.map((section) => {
              const isActive = section.id === effectiveTab;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(section.id)}
                  className={`px-3 py-1.5 text-body font-medium border-b-2 -mb-px transition-colors ${
                    isActive
                      ? "text-foreground border-gray-900"
                      : "text-foreground-muted border-transparent hover:text-foreground hover:border-border"
                  }`}
                >
                  {section.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* VC Phase 3 (Project): the in-app undo-restore confirm (real edits
          landed since the restore). Inline, non-blocking; NEVER a native
          confirm() (house rule). Shown regardless of whether the history
          sidebar is open, since the "Undo restore" button lives in the topbar.
          Mirrors TaskDetailPopup. */}
      {undoConfirmPending && (
        <div className="px-6 pt-3">
          <div
            data-testid="project-undo-confirm"
            className="text-meta text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug max-w-4xl"
          >
            <p>
              You have edited this project since the restore. Undoing will
              discard those edits and return it to its pre-restore state.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void confirmUndoRestore()}
                disabled={restoreBusy}
                data-testid="project-undo-confirm-button"
                className="px-2.5 py-1 text-meta font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-md transition-colors"
              >
                {restoreBusy ? "Undoing..." : "Discard edits and undo"}
              </button>
              <button
                type="button"
                onClick={dismissUndoConfirm}
                disabled={restoreBusy}
                data-testid="project-undo-cancel-button"
                className="px-2.5 py-1 text-meta font-medium text-foreground-muted bg-surface-sunken hover:bg-surface-sunken disabled:opacity-60 rounded-md transition-colors"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}

      {project.tags && project.tags.length > 0 && (
        <div className="px-6 pt-4 flex gap-1 flex-wrap">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Body. When the version-history sidebar is open the whole content
          region flips to a READ-ONLY diff column + the docked sidebar (mirrors
          TaskDetailPopup's editor-column + sidebar layout). Closing returns to
          the live sections. */}
      {historyOpen ? (
        <div className="flex-1 flex flex-row min-h-0">
          <div className="flex-1 min-w-0 overflow-y-auto">
            {versionPreview ? (
              <div className="px-6 py-6 max-w-4xl" data-testid="project-version-diff-column">
                <VersionDiffView
                  before={versionPreview.before}
                  after={versionPreview.after}
                  editor={versionPreview.editor}
                  editorLabel={versionPreview.editorLabel}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-foreground-muted text-body p-6">
                <p>Select a version to preview it here.</p>
              </div>
            )}
            {restoreError && (
              <div className="px-6 pb-6 max-w-4xl">
                <p
                  data-testid="project-restore-error"
                  className="text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
                  role="alert"
                >
                  {restoreError}
                </p>
              </div>
            )}
          </div>
          {/* Version-history sidebar (docked right). Mounts only while open so
              the history file read happens on demand. The owner folder is the
              project's `owner` (the history file lives under
              users/<owner>/_history/project/<id>.jsonl); fall back to the
              signed-in user for a legacy project with an empty owner. */}
          <EntityVersionHistorySidebar
            entityType="project"
            id={project.id}
            owner={historyOwner}
            adapter={projectAdapter}
            onClose={closeHistory}
            onPreviewChange={setVersionPreview}
            headCanonical={liveProjectCanonical}
            // The Restore footer only appears when the flag is ON, the viewer
            // can write the project, AND a non-HEAD version is selected (the
            // sidebar enforces the last condition).
            canRestore={RESTORE_ENABLED && canRestore}
            onRestore={handleRestore}
          />
        </div>
      ) : (
        <div className="px-6 py-6 flex flex-col gap-10 max-w-4xl">
          {/* Project funding (funding-niceties bot, 2026-05-28): the stored
              primary grant link plus the DERIVED set of grants actually charged
              in this project. Always-visible context (NOT a tab); self-hides
              when the project has no funding. Kept at the top of the body so it
              frames whichever section is active. */}
          <ProjectFundingSection project={project} />
          {/* Active project tab body. Results is always shown (actionable
              empty-state, issue #4); Methods / Activity stay hide-when-empty,
              so only the selected section renders here. The onboarding v4
              `project-overview-rollup` narration beat that used to spotlight
              this wrapper was removed in the real-tabs redesign (tour-teardown
              audit 2026-06-03), so the dead spotlight anchor is gone. */}
          <div className="flex flex-col gap-10">
            {effectiveTab === "overview" && (
              <OverviewSection
                project={project}
                ownerHint={ownerHint}
                editOwner={effectiveOwnerOf(project)}
                readOnly={isViewOnlyReceiver}
              />
            )}
            {effectiveTab === "results" && <ResultsGallery project={project} />}
            {effectiveTab === "methods" && <MethodsInventory project={project} />}
            {effectiveTab === "sequences" && (
              <SequencesInventory project={project} />
            )}
            {effectiveTab === "goals" && goalsEnabled && (
              <GoalsSection project={project} />
            )}
            {effectiveTab === "activity" && <ActivityFeed project={project} />}
          </div>
        </div>
      )}

      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{ kind: "project", project, owner: project.owner }}
          onClose={() => setShowSharePopup(false)}
          onShared={() => queryClient.refetchQueries({ queryKey: ["projects"] })}
        />
      )}

      <ProjectDepositDialog
        isOpen={showDepositDialog}
        project={project}
        currentUser={currentUser}
        ownerHint={effectiveOwnerOf(project)}
        onClose={() => setShowDepositDialog(false)}
      />

      {showEditModal && projectsApi && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSave={async (patch) => {
            await projectsApi.update(project.id, patch);
            await queryClient.refetchQueries({ queryKey: ["projects"] });
          }}
        />
      )}

      {showArchiveConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowArchiveConfirm(false)}
        >
          <div
            className="bg-surface-raised rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-heading font-bold text-foreground mb-2">Archive project?</h3>
            <p className="text-body text-foreground-muted mb-4">
              Are you sure you want to archive &quot;{project.name}&quot;?
            </p>
            <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3 mb-4">
              <p className="text-meta text-amber-700 dark:text-amber-300">
                <strong>This will:</strong>
              </p>
              <ul className="text-meta text-amber-600 dark:text-amber-300 mt-1 list-disc list-inside">
                <li>Hide the project from the main project list</li>
                <li>Remove tasks from Gantt chart and task sidebar</li>
                <li>Prevent adding new tasks to this project</li>
              </ul>
              <p className="text-meta text-amber-700 dark:text-amber-300 mt-2">
                <strong>All data will be preserved</strong> and you can unarchive at any time.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="px-4 py-2 text-body text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {archiving ? "Archiving..." : "Archive project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface-raised rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-heading font-bold text-foreground mb-2">Delete project?</h3>
            <p className="text-body text-foreground-muted mb-6">
              Are you sure you want to delete &quot;{project.name}&quot;? This will also
              delete all tasks associated with this project. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-body text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSave: (patch: ProjectUpdate) => Promise<void>;
}

export function EditProjectModal({ project, onClose, onSave }: EditProjectModalProps) {
  const [name, setName] = useState(project.name);
  const [tagsText, setTagsText] = useState(project.tags?.join(", ") || "");
  const [color, setColor] = useState(project.color || DEFAULT_COLORS[0]);
  const [weekendActive, setWeekendActive] = useState(project.weekend_active);
  // Project -> grant link (metadata implementation bot, 2026-05-28). Empty
  // string in the <select> = "None" (unlinked); maps to null on save.
  const [fundingAccountId, setFundingAccountId] = useState<string>(
    project.funding_account_id != null ? String(project.funding_account_id) : "",
  );
  const [saving, setSaving] = useState(false);

  // Populate the grant select from the existing funding-accounts list.
  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        color,
        weekend_active: weekendActive,
        // null clears the link; a number sets it.
        funding_account_id: fundingAccountId === "" ? null : Number(fundingAccountId),
      });
      onClose();
    } catch {
      alert("Failed to save project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-heading font-bold text-foreground mb-4">Edit project</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">Color</label>
            <div className="flex gap-2 flex-wrap">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Use color ${c}`}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={weekendActive}
              onChange={(e) => setWeekendActive(e.target.checked)}
              className="rounded border-border text-blue-600 dark:text-blue-300"
            />
            <span className="text-body text-foreground-muted">7-day schedule (weekends active)</span>
          </label>
          {/* Project -> grant link (metadata implementation bot,
              2026-05-28). Optional single funding account per project.
              "None" = unlinked (the default / current behavior). */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Funding account / grant
            </label>
            <select
              value={fundingAccountId}
              onChange={(e) => setFundingAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">None</option>
              {fundingAccounts.map((acc) => (
                <option key={acc.id} value={String(acc.id)}>
                  {acc.name}
                  {acc.award_number ? ` (${acc.award_number})` : ""}
                </option>
              ))}
            </select>
            <p className="text-meta text-foreground-muted mt-1">
              Link this project to a grant so its outputs can carry the
              funding metadata later.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

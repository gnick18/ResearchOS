"use client";

// ProjectDetailPopup: the project's HOME BASE, a focused popup that replaces
// the retired full-page ProjectRoute layout.
//
// Approved redesign (Grant 2026-06-09, docs/proposals/PROJECT_POPUP_REDESIGN.md).
// The popup composes itself from what EXISTS (THE DYNAMIC PRINCIPLE): it answers
// "what is this, how's it going, where do I go next", owns the project-level
// unique actions (Share / Deposit / Version history), and LAUNCHES into the
// heavy views (Timeline / Results / Methods / Sequences) rather than embedding
// them as permanent tabs. Sections hide when empty; no "go link X" nags. The
// only gentle exception is a slim "Add an overview" affordance.
//
// Reuses every existing wiring: ProjectCardKebab's mutations live in the kebab
// itself; the version-history + restore hooks mirror the old ProjectRoute; the
// doorway targets (ResultsGallery / MethodsInventory / SequencesInventory) and
// the dialogs (UnifiedShareDialog / ProjectDepositDialog) are imported as-is.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectsApi as rawProjectsApi,
  purchasesApi,
  sequencesApi,
  tasksApi,
} from "@/lib/local-api";
import type { ProjectUpdate } from "@/lib/local-api";
import type {
  Project,
  ProjectRestorePayload,
  Task,
  FundingAccount,
} from "@/lib/types";
import {
  taskResultsBase,
  resolveTabAttachmentBase,
} from "@/lib/tasks/results-paths";
import { listImagesInFolder } from "@/lib/attachments/image-folder";
import {
  readProjectActivity,
  type ProjectActivityEvent,
} from "@/lib/project-activity/event-log";
import CalmPopupShell from "@/components/ui/CalmPopupShell";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import ProjectDepositDialog from "@/components/ProjectDepositDialog";
import Tooltip from "@/components/Tooltip";
import OverviewSection from "@/components/project-surface/OverviewSection";
import ResultsGallery from "@/components/project-surface/ResultsGallery";
import MethodsInventory from "@/components/project-surface/MethodsInventory";
import SequencesInventory from "@/components/project-surface/SequencesInventory";
import MoleculesInventory from "@/components/project-surface/MoleculesInventory";
import { moleculesApi } from "@/lib/chemistry/api";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";
import { EditProjectModal } from "@/components/project-surface/ProjectRoute";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
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

// When the viewer is a receiver of a shared project with edit permission, every
// mutation writes back to the OWNER's directory. View-only receivers and
// own-project viewers pass undefined. Mirrors ProjectRoute.effectiveOwnerOf.
function effectiveOwnerOf(project: Project): string | undefined {
  return project.is_shared_with_me && project.shared_permission === "edit"
    ? project.owner
    : undefined;
}

// ── Status glance + doorway-presence ────────────────────────────────────────
// The popup reads the SAME react-query queries (identical keys) the doorway
// components run, so the cache is shared and no extra disk reads happen.

interface ProjectGlance {
  experiments: number;
  experimentsComplete: number;
  tasks: number;
  tasksComplete: number;
  lastActiveIso: string | null;
  hasResults: boolean;
  hasMethods: boolean;
  hasSequences: boolean;
  hasMolecules: boolean;
  events: ProjectActivityEvent[];
}

function useProjectGlance(project: Project): ProjectGlance {
  const owner = project.owner;
  const projectId = project.id;
  const isSharedWithMe = project.is_shared_with_me === true;
  const isArchived = project.is_archived === true;
  const taskListOwner = isSharedWithMe ? owner : undefined;

  const { data: ownTasks = [] } = useQuery({
    queryKey: ["tasks", isSharedWithMe ? `${owner}:${projectId}` : `self:${projectId}`],
    queryFn: () => tasksApi.listByProject(projectId, taskListOwner),
  });

  const { data: hostedTasks = [] } = useQuery({
    queryKey: ["projects", owner, projectId, "hosted-tasks"],
    queryFn: () => rawProjectsApi.listHostedTasks(owner, projectId),
    enabled: !isArchived,
  });

  const allTasks: Task[] = useMemo(
    () => [...ownTasks, ...hostedTasks],
    [ownTasks, hostedTasks],
  );

  const experimentTasks: Task[] = useMemo(
    () => allTasks.filter((t) => t.task_type === "experiment"),
    [allTasks],
  );

  const hasMethods = useMemo(
    () => experimentTasks.some((t) => (t.method_attachments?.length ?? 0) > 0),
    [experimentTasks],
  );

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
    enabled: experimentTasks.length > 0,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["project-activity", owner, projectId],
    queryFn: () => readProjectActivity(owner, projectId),
  });

  const { data: sequences = [] } = useQuery({
    queryKey: ["project-sequences", owner, projectId],
    queryFn: () => sequencesApi.listByProject(projectId),
  });

  // Chemistry is an opt-in module; skip the disk scan entirely when it is off.
  const { data: molecules = [] } = useQuery({
    queryKey: ["project-molecules", owner, projectId],
    queryFn: () => moleculesApi.listByProject(String(projectId), owner),
    enabled: CHEMISTRY_ENABLED,
  });

  return useMemo(() => {
    const experiments = experimentTasks.length;
    const experimentsComplete = experimentTasks.filter((t) => t.is_complete).length;
    const tasksComplete = allTasks.filter((t) => t.is_complete).length;
    // Last active = most recent activity event, falling back to the project's
    // own edit/creation stamp.
    const lastActiveIso =
      events.length > 0
        ? events.reduce((max, e) => (e.ts > max ? e.ts : max), events[0].ts)
        : project.last_edited_at ?? project.created_at ?? null;
    return {
      experiments,
      experimentsComplete,
      tasks: allTasks.length,
      tasksComplete,
      lastActiveIso,
      hasResults: totalImages > 0,
      hasMethods,
      hasSequences: sequences.length > 0,
      hasMolecules: molecules.length > 0,
      events,
    };
  }, [
    experimentTasks,
    allTasks,
    events,
    totalImages,
    hasMethods,
    sequences,
    molecules,
    project.last_edited_at,
    project.created_at,
  ]);
}

// "2 hours ago" / "3 days ago". Small inline helper (no date-fns dependency,
// matching ActivityFeed).
function relativeTime(iso: string, now: number): string {
  const ts = Date.parse(iso);
  if (!isFinite(ts)) return "";
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo === 1 ? "" : "s"} ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} year${diffYr === 1 ? "" : "s"} ago`;
}

function eventSummary(event: ProjectActivityEvent): string {
  switch (event.type) {
    case "task_completed":
      return `Completed ${event.task_name}`;
    case "image_added":
      return `Added image ${event.image_name}`;
    case "method_added":
      return `Attached ${event.method_name ?? `method #${event.method_id}`}`;
    case "method_removed":
      return `Removed ${event.method_name ?? `method #${event.method_id}`}`;
    case "prose_edited":
      return "Edited the project overview";
    case "project_shared":
      return `Shared with ${event.recipient}`;
    case "project_archived":
      return event.archived ? "Archived the project" : "Unarchived the project";
  }
}

type InnerView =
  | "home"
  | "results"
  | "methods"
  | "sequences"
  | "molecules"
  | "history";

export interface ProjectDetailPopupProps {
  /** The project to show. The popup re-reads the canonical record itself so a
   *  mutation refresh is reflected; this is the seed + identity. */
  project: Project;
  open: boolean;
  onClose: () => void;
  /** Screen point the open was triggered from (for the zoom animation). */
  origin?: OpenOrigin | null;
}

export default function ProjectDetailPopup({
  project: seedProject,
  open,
  onClose,
  origin,
}: ProjectDetailPopupProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();

  const ownerHint = seedProject.is_shared_with_me ? seedProject.owner : null;
  const projectId = seedProject.id;

  // Re-read the canonical record so edits (rename, color, funding link) reflect
  // live. Seeded with the card's project so the popup paints instantly.
  const { data: fetched } = useQuery<Project | null>({
    queryKey: ["projects", ownerHint ?? "self", projectId, "surface"],
    queryFn: () => rawProjectsApi.get(projectId, ownerHint ?? undefined),
    initialData: seedProject,
  });
  const project = fetched ?? seedProject;

  const [view, setView] = useState<InnerView>("home");
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  // Account-capability gate (capabilities bot, 2026-06-13). Share is a deep
  // in-flow control, so it HIDES for solo/locked accounts.
  const { canShare } = useAccountCapabilities();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const [now] = useState(() => Date.now());

  // Reset to the home view each time the popup re-opens for a fresh project.
  // Uses the "store information from previous renders" pattern (React docs)
  // instead of an effect that calls setState, so opening always lands on Home
  // without a cascading-render lint error.
  const [lastOpenedFor, setLastOpenedFor] = useState<string | null>(null);
  const openKey = open ? `${ownerHint ?? "self"}:${projectId}` : null;
  if (openKey !== null && openKey !== lastOpenedFor) {
    setLastOpenedFor(openKey);
    if (view !== "home") setView("home");
  }

  // Close the kebab on outside click.
  useEffect(() => {
    if (!kebabOpen) return;
    const onClick = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [kebabOpen]);

  const projectColor = project.color || DEFAULT_COLOR;
  const isMiscellaneousProject = project.name === "Miscellaneous";
  const isViewOnlyReceiver =
    project.is_shared_with_me === true && project.shared_permission === "view";
  const isAnyReceiver = project.is_shared_with_me === true;

  const glance = useProjectGlance(project);

  // ── Mutations (reuse rawProjectsApi, owner-routed). Same shape as the kebab.
  const projectsApi = useMemo(() => {
    const owner = effectiveOwnerOf(project);
    return {
      update: (id: number, data: ProjectUpdate) => rawProjectsApi.update(id, data, owner),
      archive: (id: number, isArchived: boolean) =>
        rawProjectsApi.archive(id, isArchived, owner),
      delete: (id: number) => rawProjectsApi.delete(id),
    };
  }, [project]);

  const refreshProject = useCallback(() => {
    return Promise.all([
      queryClient.refetchQueries({
        queryKey: ["projects", ownerHint ?? "self", projectId, "surface"],
      }),
      queryClient.refetchQueries({ queryKey: ["projects"] }),
      queryClient.refetchQueries({ queryKey: ["tasks"] }),
    ]);
  }, [queryClient, ownerHint, projectId]);

  const handleArchive = useCallback(async () => {
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, !project.is_archived);
      await refreshProject();
    } catch {
      alert("Failed to update archive state");
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  }, [project.id, project.is_archived, projectsApi, refreshProject]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
      ]);
      onClose();
    } catch {
      alert("Failed to delete project");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [project.id, projectsApi, queryClient, onClose]);

  // ── Version history + restore (mirrors ProjectRoute). All hooks run
  // unconditionally; the handlers no-op while not applicable.
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(null);
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
  const canRestore = canRead(project, restoreViewer) && canWrite(project, restoreViewer);
  const historyOwner = project.owner || currentUser || "";
  const restoreOwnerArg =
    project.is_shared_with_me && project.shared_permission === "edit"
      ? project.owner
      : undefined;

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

  const reflectRestoredProject = useCallback(
    (_updated: Project) => {
      void refreshProject();
    },
    [refreshProject],
  );

  const liveProjectCanonical = useMemo(() => canonicalize(project), [project]);

  const closeHistory = useCallback(() => {
    setView("home");
    setVersionPreview(null);
  }, []);

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
    record: project,
    id: projectId,
    owner: historyOwner,
    api: restoreApi,
    currentUser,
    onUpdate: reflectRestoredProject,
    immutableKeys: ["id", "owner", "created_at"],
    onAfterRestore: closeHistory,
  });

  // ── Derived display ──────────────────────────────────────────────────────
  const pct =
    glance.tasks > 0 ? Math.round((glance.tasksComplete / glance.tasks) * 100) : 0;
  const isBrandNew = glance.experiments === 0 && glance.tasks === 0;
  const recentEvents = useMemo(
    () =>
      [...glance.events]
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 2),
    [glance.events],
  );

  const showResultsDoorway = glance.hasResults;
  const showMethodsDoorway = glance.hasMethods;
  const showSequencesDoorway = glance.hasSequences;
  const showMoleculesDoorway = CHEMISTRY_ENABLED && glance.hasMolecules;

  const gantt = `/gantt?project=${encodeURIComponent(`${project.owner}:${project.id}`)}`;

  // ── Header slots (mapped onto CalmPopupShell). On the home view the title is
  // the project name, the meta is the Archived / Shared-by badge row, and the
  // overflow is the kebab. On a sub-view the title becomes that view's name with
  // no badges or kebab; the in-body BackBar keeps the exact back navigation.
  const subViewTitle: Record<Exclude<InnerView, "home">, string> = {
    results: "Results",
    methods: "Methods",
    sequences: "Sequences",
    molecules: "Molecules",
    history: "Version history",
  };

  const titleSlot = view === "home" ? project.name : subViewTitle[view];

  const metaSlot =
    view === "home" && (project.is_archived || project.is_shared_with_me) ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {project.is_archived && (
          <span className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full">
            Archived
          </span>
        )}
        {project.is_shared_with_me && (
          <span className="text-meta px-2 py-0.5 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 rounded-full">
            Shared by {project.owner}
          </span>
        )}
      </div>
    ) : null;

  const overflowSlot =
    view === "home" && !isMiscellaneousProject ? (
      <div ref={kebabRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setKebabOpen((v) => !v)}
          aria-label="Project actions"
          aria-expanded={kebabOpen}
          aria-haspopup="menu"
          className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <circle cx="4" cy="10" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="16" cy="10" r="1.5" />
          </svg>
        </button>
        {kebabOpen && (
          <div
            role="menu"
            className="absolute top-full right-0 mt-1 w-40 bg-surface-raised border border-border rounded-lg shadow-lg py-1 z-50"
          >
            <button
              role="menuitem"
              disabled={isViewOnlyReceiver}
              onClick={() => {
                setKebabOpen(false);
                setShowEditModal(true);
              }}
              className={`w-full text-left px-3 py-1.5 text-body transition-colors ${
                isViewOnlyReceiver
                  ? "text-foreground-muted cursor-not-allowed"
                  : "text-foreground hover:bg-surface-sunken"
              }`}
            >
              Edit
            </button>
            <button
              role="menuitem"
              disabled={isViewOnlyReceiver || archiving}
              onClick={() => {
                setKebabOpen(false);
                if (project.is_archived) void handleArchive();
                else setShowArchiveConfirm(true);
              }}
              className={`w-full text-left px-3 py-1.5 text-body transition-colors ${
                isViewOnlyReceiver
                  ? "text-foreground-muted cursor-not-allowed"
                  : "text-foreground hover:bg-surface-sunken"
              }`}
            >
              {project.is_archived ? "Unarchive" : "Archive"}
            </button>
            <button
              role="menuitem"
              disabled={isAnyReceiver || deleting}
              onClick={() => {
                setKebabOpen(false);
                setShowDeleteConfirm(true);
              }}
              className={`w-full text-left px-3 py-1.5 text-body transition-colors ${
                isAnyReceiver
                  ? "text-foreground-muted cursor-not-allowed"
                  : "text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20"
              }`}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    ) : null;

  return (
    <>
    <CalmPopupShell
      open={open}
      onClose={onClose}
      origin={origin}
      label={project.name || "Project"}
      title={titleSlot}
      meta={metaSlot}
      overflow={overflowSlot}
      accentColor={projectColor}
      expandable={false}
      dockedWidthClassName="max-w-xl"
    >
      {/* HOME VIEW */}
      {view === "home" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2">
          {/* Scrollable body. */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-5">
            {/* Status glance. Adapts for a brand-new project. */}
            <section data-testid="project-status-glance">
              {isBrandNew ? (
                <p className="text-body text-foreground-muted">
                  Just created, no experiments yet.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-meta text-foreground-muted">
                      {glance.tasksComplete} of {glance.tasks} complete
                    </span>
                    <span className="text-meta font-medium text-foreground-muted">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: projectColor }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-foreground-muted">
                    <span>
                      <span className="font-medium text-foreground">
                        {glance.experiments}
                      </span>{" "}
                      experiment{glance.experiments === 1 ? "" : "s"}
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        {glance.tasks}
                      </span>{" "}
                      task{glance.tasks === 1 ? "" : "s"}
                    </span>
                    {glance.lastActiveIso && (
                      <span>Last active {relativeTime(glance.lastActiveIso, now)}</span>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Funding chip — only when a grant is linked. */}
            {project.funding_account_id != null && (
              <FundingChip
                project={project}
                editOwner={effectiveOwnerOf(project)}
              />
            )}

            {/* Tags row — only when the project has tags. */}
            {project.tags && project.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
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

            {/* About overview — the centerpiece. */}
            <section data-testid="project-overview">
              <h3 className="text-title font-semibold text-foreground mb-2">About</h3>
              <OverviewSection
                project={project}
                ownerHint={ownerHint}
                editOwner={effectiveOwnerOf(project)}
                readOnly={isViewOnlyReceiver}
                hideHeading
              />
            </section>

            {/* Doorways. Timeline always shows; the rest only when they have
                content. */}
            <section>
              <h3 className="text-title font-semibold text-foreground mb-2">Go to</h3>
              <div className="grid grid-cols-2 gap-2">
                <Doorway
                  label="Timeline"
                  onClick={() => router.push(gantt)}
                  icon={
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  }
                />
                {showResultsDoorway && (
                  <Doorway
                    label="Results"
                    onClick={() => setView("results")}
                    icon={
                      <>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 15l5-5 4 4 4-4 5 5" />
                      </>
                    }
                  />
                )}
                {showMethodsDoorway && (
                  <Doorway
                    label="Methods"
                    onClick={() => setView("methods")}
                    icon={
                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    }
                  />
                )}
                {showSequencesDoorway && (
                  <Doorway
                    label="Sequences"
                    onClick={() => setView("sequences")}
                    icon={<path d="M12 3a9 9 0 1 0 6.364 2.636" />}
                  />
                )}
                {showMoleculesDoorway && (
                  <Doorway
                    label="Molecules"
                    onClick={() => setView("molecules")}
                    icon={
                      <path d="M9 3h6M10 3v5L5 18.5A1.5 1.5 0 0 0 6.4 21h11.2a1.5 1.5 0 0 0 1.4-2.5L14 8V3" />
                    }
                  />
                )}
              </div>
            </section>

            {/* Project-unique actions grouped. */}
            {!isMiscellaneousProject && (
              <section>
                <h3 className="text-title font-semibold text-foreground mb-2">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  {!project.is_shared_with_me && canShare && (
                    <ActionButton
                      label="Share"
                      onClick={() => setShowSharePopup(true)}
                      testId="project-share-button"
                    />
                  )}
                  <ActionButton
                    label="Deposit to a repository"
                    onClick={() => setShowDepositDialog(true)}
                    testId="project-deposit-button"
                  />
                  <ActionButton
                    label="Version history"
                    onClick={() => setView("history")}
                    testId="project-history-button"
                  />
                </div>
                {RESTORE_ENABLED && undoWindowActive && canRestore && (
                  <button
                    type="button"
                    onClick={!restoreBusy ? handleUndoRestore : undefined}
                    disabled={restoreBusy}
                    data-testid="project-undo-restore-button"
                    className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-meta font-medium rounded-lg text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                  >
                    {restoreBusy ? "Undoing..." : "Undo restore"}
                  </button>
                )}
                {undoConfirmPending && (
                  <div
                    data-testid="project-undo-confirm"
                    className="mt-2 text-meta text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
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
                        className="ros-btn-raise px-2.5 py-1 text-meta font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-md transition-colors"
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
                )}
              </section>
            )}

            {/* Recent activity — hidden entirely on a brand-new project with no
                events. */}
            {recentEvents.length > 0 && (
              <section data-testid="project-recent-activity">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-title font-semibold text-foreground">
                    Recent activity
                  </h3>
                  <button
                    type="button"
                    onClick={() => router.push(gantt)}
                    className="text-meta text-foreground-muted hover:text-foreground hover:underline"
                  >
                    See all
                  </button>
                </div>
                <ol className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
                  {recentEvents.map((event) => (
                    <li
                      key={event.id}
                      className="px-3 py-2 flex items-start justify-between gap-2 text-body"
                    >
                      <span className="text-foreground truncate">
                        {eventSummary(event)}
                      </span>
                      <span className="flex-shrink-0 text-meta text-foreground-muted">
                        {relativeTime(event.ts, now)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      )}

      {/* DOORWAY VIEWS */}
      {view === "results" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2 pt-2">
          <div>
            <BackBar onBack={() => setView("home")} />
          </div>
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1">
            <ResultsGallery project={project} />
          </div>
        </div>
      )}
      {view === "methods" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2 pt-2">
          <div>
            <BackBar onBack={() => setView("home")} />
          </div>
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1">
            <MethodsInventory project={project} />
          </div>
        </div>
      )}
      {view === "sequences" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2 pt-2">
          <div>
            <BackBar onBack={() => setView("home")} />
          </div>
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1">
            <SequencesInventory project={project} />
          </div>
        </div>
      )}
      {view === "molecules" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2 pt-2">
          <div>
            <BackBar onBack={() => setView("home")} />
          </div>
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1">
            <MoleculesInventory project={project} />
          </div>
        </div>
      )}

      {/* VERSION HISTORY VIEW */}
      {view === "history" && (
        <div className="flex flex-col min-h-0 flex-1 px-6 pb-2 pt-2">
          <div>
            <BackBar onBack={() => setView("home")} />
          </div>
          <div className="mt-3 flex-1 min-h-0 flex flex-row gap-3 overflow-hidden">
            <div className="flex-1 min-w-0 overflow-y-auto">
              {versionPreview ? (
                <div data-testid="project-version-diff-column">
                  <VersionDiffView
                    before={versionPreview.before}
                    after={versionPreview.after}
                    editor={versionPreview.editor}
                    editorLabel={versionPreview.editorLabel}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-foreground-muted text-body">
                  <p>Select a version to preview it here.</p>
                </div>
              )}
              {restoreError && (
                <p
                  data-testid="project-restore-error"
                  className="mt-3 text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
                  role="alert"
                >
                  {restoreError}
                </p>
              )}
            </div>
            <EntityVersionHistorySidebar
              entityType="project"
              id={project.id}
              owner={historyOwner}
              adapter={projectAdapter}
              onClose={closeHistory}
              onPreviewChange={setVersionPreview}
              headCanonical={liveProjectCanonical}
              canRestore={RESTORE_ENABLED && canRestore}
              onRestore={handleRestore}
            />
          </div>
        </div>
      )}

    </CalmPopupShell>

      {/* ── Dialogs + confirms (reused wirings). Rendered as siblings of the
          shell so they portal/overlay on top of it, exactly as before. ──── */}
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

      {showEditModal && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSave={async (patch) => {
            await projectsApi.update(project.id, patch);
            await refreshProject();
          }}
        />
      )}

      {showArchiveConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
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
                onClick={() => void handleArchive()}
                disabled={archiving}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {archiving ? "Archiving..." : "Archive project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
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
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Small presentational pieces ──────────────────────────────────────────────

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-body text-foreground-muted hover:text-foreground transition-colors"
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      Back to project
    </button>
  );
}

function Doorway({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left text-body font-medium text-foreground hover:border-foreground-muted/40 hover:bg-surface-sunken transition-colors"
    >
      <svg
        className="w-5 h-5 text-foreground-muted shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icon}
      </svg>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <svg
        className="w-4 h-4 text-foreground-muted shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  testId,
}: {
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-body font-medium text-foreground hover:bg-surface-sunken transition-colors"
      >
        {label}
      </button>
    </Tooltip>
  );
}

// Inline funding chip. Resolves the primary grant's display name from the
// stored funding_account_id; renders nothing if it can't resolve (the parent
// already gates on funding_account_id != null, but a deleted grant yields no
// name). Owner-routing is irrelevant here: funding accounts are always the
// current viewer's lab folder.
function FundingChip({
  project,
}: {
  project: Project;
  editOwner: string | undefined;
}) {
  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
  });
  const account = useMemo(
    () => fundingAccounts.find((a) => a.id === project.funding_account_id) ?? null,
    [fundingAccounts, project.funding_account_id],
  );
  if (!account) return null;
  return (
    <div
      data-testid="project-funding-chip"
      className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-surface-sunken px-2.5 py-1 text-meta text-foreground"
    >
      <svg
        className="w-3.5 h-3.5 text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5" />
      </svg>
      <span className="font-medium">{account.name}</span>
      {account.award_number && (
        <span className="text-foreground-muted">({account.award_number})</span>
      )}
    </div>
  );
}

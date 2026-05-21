"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/FixtureLink";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi as rawProjectsApi } from "@/lib/local-api";
import type { ProjectUpdate } from "@/lib/local-api";
import SharePopup from "@/components/SharePopup";
import Tooltip from "@/components/Tooltip";
import ResultsGallery from "@/components/project-surface/ResultsGallery";
import MethodsInventory from "@/components/project-surface/MethodsInventory";
import GoalsSection from "@/components/project-surface/GoalsSection";
import ActivityFeed from "@/components/project-surface/ActivityFeed";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import type { Project } from "@/lib/types";

const DEFAULT_COLOR = "#3b82f6";
const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// Anchor set is derived per-render from feature_picks (see `sections` below)
// so the Goals entry only appears when L11's gating condition is met. The
// L2 literal anchor set is preserved for users without goals enabled.
const BASE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "results", label: "Results" },
  { id: "methods", label: "Methods" },
  { id: "activity", label: "Activity" },
] as const;

const GOALS_SECTION = { id: "goals", label: "Goals" } as const;

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

  const [showSharePopup, setShowSharePopup] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
        <p className="text-base text-gray-700 font-medium">Project not found</p>
        <p className="text-sm text-gray-400 max-w-md text-center">
          We couldn&apos;t load this project. It may have been deleted, or you don&apos;t
          have access to it.
        </p>
        <Link
          href="/"
          className="mt-2 text-sm text-blue-600 hover:text-blue-700 hover:underline"
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

  // Splice the Goals anchor between Methods and Activity to mirror the
  // rendered section order below. The proposal's §4 surface inventory and
  // L11 both place Goals just above Activity.
  const sections = goalsEnabled
    ? [
        BASE_SECTIONS[0],
        BASE_SECTIONS[1],
        BASE_SECTIONS[2],
        GOALS_SECTION,
        BASE_SECTIONS[3],
      ]
    : BASE_SECTIONS;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-white">
      <div className="h-2 flex-shrink-0" style={{ backgroundColor: projectColor }} />

      <div
        className="sticky top-0 z-10 bg-white border-b border-gray-200"
        data-testid="project-route-topbar"
      >
        <div className="px-6 pt-4 pb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/"
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline flex-shrink-0"
              >
                ← Projects
              </Link>
              <span className="text-gray-300">/</span>
              <h1 className="text-lg font-semibold text-gray-900 truncate">
                {project.name}
              </h1>
              {project.is_archived && (
                <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full flex-shrink-0">
                  Archived
                </span>
              )}
              {project.is_shared_with_me && (
                <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full flex-shrink-0">
                  Shared by {project.owner}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                href={`/gantt?project=${project.id}`}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline whitespace-nowrap"
              >
                View timeline →
              </Link>
              <div className="flex items-center gap-1">
              {!isMiscellaneousProject && (
                <Tooltip
                  label={
                    isViewOnlyReceiver
                      ? `Only the owner (${project.owner}) and edit-permission collaborators can edit this project`
                      : "Edit project"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={() => setShowEditModal(true)}
                    disabled={isViewOnlyReceiver}
                    className={`p-2 rounded-lg transition-colors ${
                      isViewOnlyReceiver
                        ? "text-gray-300 cursor-not-allowed"
                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    }`}
                    aria-label="Edit project"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </Tooltip>
              )}

              {!isMiscellaneousProject && !project.is_shared_with_me && (
                <Tooltip label="Share project" placement="bottom">
                  <button
                    onClick={() => setShowSharePopup(true)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Share project"
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
                        ? "text-gray-300 cursor-not-allowed"
                        : project.is_archived
                          ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                          : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
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
                        ? "text-gray-300 cursor-not-allowed"
                        : "text-red-600 hover:text-red-700 hover:bg-red-50"
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

          <nav className="flex items-center gap-1 -mb-px" aria-label="Project sections">
            {sections.map((section, idx) => (
              <span key={section.id} className="flex items-center">
                {idx > 0 && <span className="text-gray-300 mx-1">│</span>}
                <a
                  href={`#${section.id}`}
                  className="px-2 py-1 text-sm text-gray-500 hover:text-gray-900 rounded transition-colors"
                >
                  {section.label}
                </a>
              </span>
            ))}
          </nav>
        </div>
      </div>

      {project.tags && project.tags.length > 0 && (
        <div className="px-6 pt-4 flex gap-1 flex-wrap">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="px-6 py-6 flex flex-col gap-10 max-w-4xl">
        <OverviewSection
          project={project}
          ownerHint={ownerHint}
          editOwner={effectiveOwnerOf(project)}
          readOnly={isViewOnlyReceiver}
        />
        <ResultsGallery project={project} />
        <MethodsInventory project={project} />
        {goalsEnabled && <GoalsSection project={project} />}
        <ActivityFeed project={project} />
      </div>

      {showSharePopup && (
        <SharePopup
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          itemType="project"
          itemId={project.id}
          itemName={project.name}
          currentOwner={project.owner}
          currentSharedWith={project.shared_with || []}
          onShared={() => queryClient.refetchQueries({ queryKey: ["projects"] })}
        />
      )}

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
            className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-2">Archive project?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to archive &quot;{project.name}&quot;?
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-700">
                <strong>This will:</strong>
              </p>
              <ul className="text-xs text-amber-600 mt-1 list-disc list-inside">
                <li>Hide the project from the main project list</li>
                <li>Remove tasks from Gantt chart and task sidebar</li>
                <li>Prevent adding new tasks to this project</li>
              </ul>
              <p className="text-xs text-amber-700 mt-2">
                <strong>All data will be preserved</strong> and you can unarchive at any time.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="px-4 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
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
            className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete project?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete &quot;{project.name}&quot;? This will also
              delete all tasks associated with this project. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
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

// Autosave debounce for overview prose. Matches NoteDetailPopup's
// running-log entry autosave (1500ms after the last keystroke) so the
// UX stays consistent across long-form markdown surfaces.
const OVERVIEW_AUTOSAVE_DELAY_MS = 1500;

interface OverviewSectionProps {
  project: Project;
  // The URL `?owner=` hint used for READS. When present, the overview is
  // loaded from that user's directory. View-only receivers and edit-permission
  // receivers both pass the same hint here.
  ownerHint: string | null;
  // The owner-routing target for WRITES. Set only for edit-permission
  // receivers (the shared project's actual owner); undefined for own
  // projects (writes go to the current user). View-only receivers never
  // reach the write path because `readOnly` short-circuits autosave.
  editOwner: string | undefined;
  readOnly: boolean;
}

function OverviewSection({ project, ownerHint, editOwner, readOnly }: OverviewSectionProps) {
  const queryClient = useQueryClient();
  const projectId = project.id;

  const queryKey = useMemo(
    () => ["projects", ownerHint ?? "self", projectId, "overview"] as const,
    [projectId, ownerHint]
  );

  const {
    data: serverValue,
    isLoading,
    isError,
  } = useQuery<string>({
    queryKey,
    queryFn: () => rawProjectsApi.getOverview(projectId, ownerHint ?? undefined),
  });

  // Local-first edit buffer: typing updates this immediately, the debounced
  // save flushes to disk. Without a local mirror, every keystroke would
  // round-trip through React Query refetch and the cursor would jump.
  //
  // The "store information from previous renders" pattern (React docs) is
  // used here in place of a useEffect that calls setState — that latter
  // shape triggers a cascading-render lint error and is discouraged.
  // React bails out of the current render and re-renders cleanly when
  // setState is called during render with a different value.
  const [draft, setDraft] = useState<string>("");
  const [lastSyncedServer, setLastSyncedServer] = useState<string | null>(null);
  if (serverValue !== undefined && lastSyncedServer !== serverValue) {
    setLastSyncedServer(serverValue);
    setDraft(serverValue);
  }

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (next: string) => {
      if (readOnly) return;
      setDraft(next);
      setSaveStatus("saving");
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await rawProjectsApi.setOverview(projectId, next, editOwner);
          // Mirror the write back into React Query AND advance the
          // "last synced from server" cursor in lockstep — otherwise the
          // render-time prop-sync check above would see the new server
          // value and overwrite the user's freshly-typed draft.
          queryClient.setQueryData(queryKey, next);
          setLastSyncedServer(next);
          setSaveStatus("saved");
          if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current);
          savedFlashTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
        } catch (err) {
          console.error("[ProjectRoute] Failed to save overview:", err);
          setSaveStatus("error");
        }
      }, OVERVIEW_AUTOSAVE_DELAY_MS);
    },
    [readOnly, projectId, editOwner, queryClient, queryKey]
  );

  return (
    <section id="overview" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">Overview</h2>
        {!readOnly && saveStatus !== "idle" && (
          <span
            className={`text-xs ${
              saveStatus === "error"
                ? "text-red-500"
                : saveStatus === "saving"
                  ? "text-gray-400"
                  : "text-gray-400"
            }`}
            aria-live="polite"
          >
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "error" && "Couldn't save"}
          </span>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading overview…</p>
      ) : isError ? (
        <p className="text-sm text-red-500">Couldn&apos;t load this project&apos;s overview.</p>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={
            readOnly
              ? "No overview yet."
              : "Capture the hypothesis, motivation, and big-picture context for this project…"
          }
          disabled={readOnly}
          className="w-full min-h-[180px] p-3 text-sm text-gray-800 border border-gray-200 rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      )}
    </section>
  );
}

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSave: (patch: ProjectUpdate) => Promise<void>;
}

function EditProjectModal({ project, onClose, onSave }: EditProjectModalProps) {
  const [name, setName] = useState(project.name);
  const [tagsText, setTagsText] = useState(project.tags?.join(", ") || "");
  const [color, setColor] = useState(project.color || DEFAULT_COLORS[0]);
  const [weekendActive, setWeekendActive] = useState(project.weekend_active);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        color,
        weekend_active: weekendActive,
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
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-4">Edit project</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
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
              className="rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-600">7-day schedule (weekends active)</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

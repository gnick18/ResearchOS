"use client";

import { useState, useMemo } from "react";
import Link from "@/components/FixtureLink";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi as rawProjectsApi, tasksApi as rawTasksApi } from "@/lib/local-api";
import type { ProjectUpdate } from "@/lib/local-api";
import SharePopup from "@/components/SharePopup";
import Tooltip from "@/components/Tooltip";
import type { Project } from "@/lib/types";

/**
 * When the current viewer is a receiver of a shared project with edit
 * permission, every mutation needs to write back to the OWNER's directory
 * (e.g. `users/Kritika/projects/1.json`), not the current user's. Plain own
 * projects (or read-only views) pass undefined and the writes go to the
 * current user's directory. Mirrors the pattern in TaskDetailPopup.
 */
function effectiveOwnerOf(project: Project): string | undefined {
  return project.is_shared_with_me && project.shared_permission === "edit"
    ? project.owner
    : undefined;
}

function ownerScopedProjectsApi(project: Project) {
  const owner = effectiveOwnerOf(project);
  return {
    ...rawProjectsApi,
    get: (id: number) => rawProjectsApi.get(id, owner),
    update: (id: number, data: ProjectUpdate) => rawProjectsApi.update(id, data, owner),
    archive: (id: number, isArchived: boolean) =>
      rawProjectsApi.archive(id, isArchived, owner),
    // `delete` intentionally not owner-routed: only the original owner should
    // be able to destroy the file.
  };
}

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface ProjectDetailPopupProps {
  project: Project;
  onClose: () => void;
}

export default function ProjectDetailPopup({ project, onClose }: ProjectDetailPopupProps) {
  const queryClient = useQueryClient();
  // Owner-aware view of projectsApi: when this popup is showing a project
  // shared with the current user with edit permission, every mutating call
  // routes through the owner's directory instead of the current user's.
  const projectsApi = useMemo(() => ownerScopedProjectsApi(project), [project]);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [tags, setTags] = useState(project.tags?.join(", ") || "");
  const [color, setColor] = useState(project.color || DEFAULT_COLORS[0]);
  const [weekendActive, setWeekendActive] = useState(project.weekend_active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // For share popup
  const [showSharePopup, setShowSharePopup] = useState(false);

  // Check if this is the Miscellaneous project (protected)
  const isMiscellaneousProject = project.name === "Miscellaneous";

  // Receiver gates. View-only receivers cannot archive/unarchive because
  // `projectsApi.archive` is owner-routed only when `shared_permission === "edit"`;
  // any receiver (view OR edit) cannot delete because `projectsApi.delete` is
  // intentionally NOT owner-routed — only the original owner should destroy the file.
  const isViewOnlyReceiver =
    project.is_shared_with_me === true && project.shared_permission === "view";
  const isAnyReceiver = project.is_shared_with_me === true;

  // Fetch tasks for this project — kept (post-P7 slim-down) ONLY to power the
  // three count chips in the stats panel below (total / completed / overdue).
  // The full task lists were stripped per L3 of PROJECT_SURFACE_PROPOSAL.md;
  // the project route at /workbench/projects/<id> is now the place those lists
  // live. For shared projects, the tasks live in the owner's directory — read
  // access only requires `is_shared_with_me`, independent of edit permission,
  // so this thread-through differs from the edit-only `effectiveOwnerOf` used
  // for mutations above.
  const taskListOwner = project.is_shared_with_me ? project.owner : undefined;
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", project.is_shared_with_me ? `${project.owner}:${project.id}` : `self:${project.id}`],
    queryFn: () => rawTasksApi.listByProject(project.id, taskListOwner),
  });

  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return tasks.filter((t) => !t.is_complete && t.end_date < today).length;
  }, [tasks]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await projectsApi.update(project.id, {
        name: name.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        color,
        weekend_active: weekendActive,
      });
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      setIsEditing(false);
    } catch {
      alert("Failed to save project");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      // Close popup immediately after successful deletion
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to delete project");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, true);
      // Close popup immediately after successful archive
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to archive project");
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleUnarchive = async () => {
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, false);
      // Close popup immediately after successful unarchive
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to unarchive project");
    } finally {
      setArchiving(false);
    }
  };

  const projectColor = project.color || DEFAULT_COLORS[0];

  // Format archived date
  const formatArchivedDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  // P7: the popup links out to the route page where the full surface lives.
  // `?owner=` matches the shape ProjectRoute reads in /workbench/projects/[id]/page.tsx.
  const projectHref =
    `/workbench/projects/${project.id}` +
    (project.is_shared_with_me ? `?owner=${encodeURIComponent(project.owner)}` : "");

  // Miscellaneous is a permanent catch-all bucket; the route view assumes a
  // real project, so suppress both the header link and the bottom CTA there.
  const showOpenFullView = !isMiscellaneousProject;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-2 flex-shrink-0" style={{ backgroundColor: isEditing ? color : projectColor }} />

        <div className="p-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            {isEditing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 focus:border-blue-500 focus:outline-none pb-1 flex-1 mr-4"
                autoFocus
              />
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{project.name}</h2>
                {project.is_archived && (
                  <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full">
                    Archived
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              {!isEditing && showOpenFullView && (
                <Link
                  href={projectHref}
                  onClick={onClose}
                  className="text-xs text-gray-500 hover:text-blue-600 hover:underline whitespace-nowrap"
                >
                  Open full view →
                </Link>
              )}
              {!isEditing && !project.is_archived && !isMiscellaneousProject && (
                <Tooltip
                  label={
                    isViewOnlyReceiver
                      ? `Only the owner (${project.owner}) and edit-permission collaborators can edit this project`
                      : "Edit project"
                  }
                  placement="bottom"
                >
                  <button
                    disabled={isViewOnlyReceiver}
                    onClick={() => setIsEditing(true)}
                    className={`p-2 rounded-lg transition-colors ${
                      isViewOnlyReceiver
                        ? "text-gray-300 cursor-not-allowed"
                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              {/* Share button — hidden when the project was shared TO us
                   (receivers can't re-share what isn't theirs to grant access to). */}
              {!isEditing && !isMiscellaneousProject && !project.is_shared_with_me && (
                <Tooltip label="Share project" placement="bottom">
                  <button
                    onClick={() => setShowSharePopup(true)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="18" cy="5" r="3"/>
                      <circle cx="6" cy="12" r="3"/>
                      <circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Close" placement="bottom">
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Archived date notice */}
          {project.is_archived && project.archived_at && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">
                <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                Archived on {formatArchivedDate(project.archived_at)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                This project is archived. Tasks won&apos;t appear in Gantt chart or task sidebar.
              </p>
            </div>
          )}

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      title={`Use color ${c}`}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                      }`}
                      style={{ backgroundColor: c }}
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
                <span className="text-sm text-gray-600">
                  7-day schedule (weekends active)
                </span>
              </label>

              <div className="flex justify-between pt-4 border-t border-gray-100">
                {/* Hide delete button for Miscellaneous project; disable for
                    any receiver (view OR edit). `projectsApi.delete` is not
                    owner-routed, so a receiver's click would silently write
                    to their own (nonexistent) directory and diverge from the
                    owner's copy. */}
                {!isMiscellaneousProject && (
                  <Tooltip
                    label={
                      isAnyReceiver
                        ? `Only the owner (${project.owner}) can delete this project`
                        : "Delete this project"
                    }
                    placement="top"
                  >
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleting || isAnyReceiver}
                      className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                        isAnyReceiver
                          ? "text-gray-300 cursor-not-allowed"
                          : "text-red-600 hover:bg-red-50"
                      }`}
                    >
                      Delete Project
                    </button>
                  </Tooltip>
                )}
                {isMiscellaneousProject && <div />}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setName(project.name);
                      setTags(project.tags?.join(", ") || "");
                      setColor(project.color || DEFAULT_COLORS[0]);
                      setWeekendActive(project.weekend_active);
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !name.trim()}
                    className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Tags */}
              {project.tags && project.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mb-4">
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

              {/* Stats */}
              <div className="flex gap-6 mb-4 text-sm">
                <div>
                  <span className="text-gray-400">Total Tasks</span>
                  <p className="font-semibold text-gray-700">{tasks.length}</p>
                </div>
                <div>
                  <span className="text-gray-400">Completed</span>
                  <p className="font-semibold text-gray-700">{tasks.filter((t) => t.is_complete).length}</p>
                </div>
                {overdueCount > 0 && (
                  <div>
                    <span className="text-red-400">Overdue</span>
                    <p className="font-semibold text-red-600">{overdueCount}</p>
                  </div>
                )}
              </div>

              {/* Archive/Unarchive buttons - hide for Miscellaneous project.
                  Disabled for view-only receivers: `projectsApi.archive` is
                  only owner-routed when `shared_permission === "edit"`, so a
                  view-only click would silently write to the receiver's own
                  directory and diverge from the owner's copy. */}
              {!isMiscellaneousProject && (
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  {project.is_archived ? (
                    <Tooltip
                      label={
                        isViewOnlyReceiver
                          ? `Only the owner (${project.owner}) and edit-permission collaborators can unarchive this project`
                          : "Unarchive this project"
                      }
                      placement="top"
                    >
                      <button
                        onClick={handleUnarchive}
                        disabled={archiving || isViewOnlyReceiver}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${
                          isViewOnlyReceiver
                            ? "text-gray-300 cursor-not-allowed"
                            : "text-green-600 hover:bg-green-50"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {archiving ? "Unarchiving..." : "Unarchive Project"}
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      label={
                        isViewOnlyReceiver
                          ? `Only the owner (${project.owner}) and edit-permission collaborators can archive this project`
                          : "Archive this project"
                      }
                      placement="top"
                    >
                      <button
                        onClick={() => setShowArchiveConfirm(true)}
                        disabled={archiving || isViewOnlyReceiver}
                        data-onboarding-target="archive-projects"
                        className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${
                          isViewOnlyReceiver
                            ? "text-gray-300 cursor-not-allowed"
                            : "text-amber-600 hover:bg-amber-50"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                        Archive Project
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
              {/* Show info message for Miscellaneous project */}
              {isMiscellaneousProject && (
                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 italic">
                    The Miscellaneous project is a permanent category for standalone tasks that don&apos;t belong to a specific research project.
                  </p>
                </div>
              )}

              {/* P7: full-width CTA to the project route. This popup is the
                  inspector; the route page is where every surface (Gantt,
                  methods, results, activity, overview) actually lives. */}
              {showOpenFullView && (
                <div className="pt-4">
                  <Link
                    href={projectHref}
                    onClick={onClose}
                    className="flex items-center justify-center w-full h-10 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                  >
                    Open full view →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowDeleteConfirm(false)}>
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Project?</h3>
              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete &quot;{project.name}&quot;? This will also delete all tasks associated with this project. This action cannot be undone.
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

        {/* Archive Confirmation Dialog */}
        {showArchiveConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowArchiveConfirm(false)}>
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">Archive Project?</h3>
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
                  {archiving ? "Archiving..." : "Archive Project"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share Popup */}
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
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { projectsApi as rawProjectsApi } from "@/lib/local-api";
import type { ProjectUpdate } from "@/lib/local-api";
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import { EditProjectModal } from "@/components/project-surface/ProjectRoute";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import type { Project } from "@/lib/types";

// Owner-routed mutation api: for shared projects with edit permission,
// writes go to the OWNER's directory; for own projects, writes go to the
// current user. Delete is intentionally not owner-routed (only the owner
// should destroy the file). Mirrors ProjectRoute's effectiveOwnerOf.
function effectiveEditOwner(project: Project): string | undefined {
  return project.is_shared_with_me && project.shared_permission === "edit"
    ? project.owner
    : undefined;
}

interface ProjectCardKebabProps {
  project: Project;
}

/**
 * Hover-reveal three-dots menu on the home-page project card. Standard
 * Linear/Notion-style list-item pattern: hover the card -> kebab appears
 * in the corner -> click opens dropdown with Edit / Share / Archive /
 * Delete. Suppressed entirely for the Miscellaneous catch-all (the route
 * page also hides all four CRUD buttons for it).
 *
 * The card itself navigates to the project route on click; the kebab
 * stops event propagation so kebab clicks don't trigger navigation.
 */
export default function ProjectCardKebab({ project }: ProjectCardKebabProps) {
  const queryClient = useQueryClient();
  const { canShare } = useAccountCapabilities();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the kebab dropdown (app-wide convention), matching the
  // click-outside handler. Only bound while the menu is open; opening any
  // sub-modal closes the menu first, so this never fights a nested overlay.
  useEscapeToClose(() => setOpen(false), open);

  const isMiscellaneousProject = project.name === "Miscellaneous";
  const isViewOnlyReceiver =
    project.is_shared_with_me === true && project.shared_permission === "view";
  const isAnyReceiver = project.is_shared_with_me === true;

  const projectsApi = useMemo(() => {
    const owner = effectiveEditOwner(project);
    return {
      update: (id: number, data: ProjectUpdate) => rawProjectsApi.update(id, data, owner),
      archive: (id: number, isArchived: boolean) =>
        rawProjectsApi.archive(id, isArchived, owner),
      delete: (id: number) => rawProjectsApi.delete(id),
    };
  }, [project]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleArchive = async () => {
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
  };

  // A record is malformed if it lacks a valid integer id OR has a blank
  // name. The orphan-card bug surfaced this case (a project on disk with
  // name="" that the home page rendered as a ghost card). Standard
  // projectsApi.delete(id) cannot resolve a bad id, so for malformed
  // records we fall back to a content-scan sweep via purgeMalformed().
  const isMalformedRecord =
    !Number.isInteger(project.id) ||
    project.id <= 0 ||
    !project.name ||
    project.name.trim().length === 0;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (isMalformedRecord) {
        // purgeMalformed lives on the raw module-level projectsApi
        // (not on the owner-routed wrapper above — the wrapper only
        // exposes update/archive/delete because those are the only
        // owner-routed mutations). Calling it via the wrapper used to
        // throw "projectsApi.purgeMalformed is not a function" and
        // surface as an alert to the user, which is exactly the
        // "blocked from deleting" symptom Grant hit. (orphan v2 fix)
        const removed = await rawProjectsApi.purgeMalformed();
        if (removed.length === 0) {
          throw new Error("No malformed records found to purge");
        }
      } else {
        await projectsApi.delete(project.id);
      }
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(
        `Failed to delete project (id=${String(project.id)}, name=${JSON.stringify(project.name)}): ${msg}`,
      );
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Miscellaneous: route page hides all four CRUD buttons, so the kebab
  // has nothing to offer either. Suppress entirely.
  if (isMiscellaneousProject) return null;

  // Malformed records: keep the kebab visible (no opacity-0) so a user
  // doesn't have to discover hover to find the Delete action on a card
  // that has no name to indicate why it's there. The whole point of the
  // visible kebab on these cards is "you can clean this up". (orphan v2)
  const kebabVisibilityClass = isMalformedRecord
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

  return (
    <div
      ref={menuRef}
      className={`absolute top-2 right-2 transition-opacity z-10 ${kebabVisibilityClass}`}
      onClick={stop}
      data-force-hover-controls-target
    >
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        aria-label="Project actions"
        aria-expanded={open}
        aria-haspopup="menu"
        className="p-1 rounded text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 w-40 bg-surface-raised border border-border rounded-lg shadow-lg py-1 z-50"
        >
          <button
            role="menuitem"
            disabled={isViewOnlyReceiver}
            onClick={(e) => {
              stop(e);
              setOpen(false);
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
          {!project.is_shared_with_me && canShare && (
            <button
              role="menuitem"
              onClick={(e) => {
                stop(e);
                setOpen(false);
                setShowSharePopup(true);
              }}
              className="w-full text-left px-3 py-1.5 text-body text-foreground hover:bg-surface-sunken transition-colors"
            >
              Share
            </button>
          )}
          <button
            role="menuitem"
            disabled={isViewOnlyReceiver || archiving}
            onClick={(e) => {
              stop(e);
              setOpen(false);
              if (project.is_archived) {
                void handleArchive();
              } else {
                setShowArchiveConfirm(true);
              }
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
            onClick={(e) => {
              stop(e);
              setOpen(false);
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

      {showEditModal && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSave={async (patch) => {
            await projectsApi.update(project.id, patch);
            await queryClient.refetchQueries({ queryKey: ["projects"] });
          }}
        />
      )}

      {showSharePopup && (
        <ShareDialogAdapter
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          recordType="project"
          recordId={project.id}
          recordName={project.name}
          ownerUsername={project.owner}
          currentSharedWith={project.shared_with || []}
          onShared={() => queryClient.refetchQueries({ queryKey: ["projects"] })}
        />
      )}

      {showArchiveConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
          onClick={(e) => {
            stop(e);
            setShowArchiveConfirm(false);
          }}
        >
          <div
            className="bg-surface-raised rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={stop}
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
                onClick={(e) => {
                  stop(e);
                  setShowArchiveConfirm(false);
                }}
                className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  stop(e);
                  void handleArchive();
                }}
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
          onClick={(e) => {
            stop(e);
            setShowDeleteConfirm(false);
          }}
        >
          <div
            className="bg-surface-raised rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={stop}
          >
            <h3 className="text-heading font-bold text-foreground mb-2">Delete project?</h3>
            <p className="text-body text-foreground-muted mb-6">
              Are you sure you want to delete &quot;{project.name}&quot;? This will also
              delete all tasks associated with this project. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={(e) => {
                  stop(e);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  stop(e);
                  void handleDelete();
                }}
                disabled={deleting}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
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

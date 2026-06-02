"use client";

// save-checkpoint bot (2026-06-02): the version-history surface for a task's
// Lab Notes / Results MARKDOWN document. Wraps the generic
// EntityVersionHistorySidebar + VersionDiffView (the same components the Notes
// and structured-Task pilots use) for a plain markdown document keyed by
// (owner, taskId).
//
// What it owns:
//   - the history toggle button (icon-only clock + counter-arrow, Tooltip),
//     surfaced in the editor toolbar trailing area,
//   - the docked sidebar + in-place read-only diff column (rendered by the
//     consuming tab in its editor slot when `isOpen`),
//   - the REVERT handler: reverse-walk to the target version, write the
//     reconstructed markdown back to the .md file on disk (NOT an entity api),
//     then record a "revert" version. This adapts useVersionRestore's pattern
//     (which assumes a structured entity with an api.update + revert_undo_window)
//     to the file-backed document model. There is no 24h undo window for the
//     markdown docs in this pass: the document has no record to stamp the window
//     on, and the restored content is itself a new, fully-revertible checkpoint
//     in the same history file (the user can revert again to the pre-restore
//     version, which the timeline labels "Restored an earlier version").
//
// The component NEVER parses unified-diff text: it consumes reconstructed
// canonical states from the engine and the taskDoc adapter's projectBody.

import { useCallback, useRef, useState } from "react";
import {
  historyEngine,
  canonicalize,
  HistoryCompactedTargetError,
  taskDocAdapter,
  taskDocEntityType,
  taskDocPayload,
  projectTaskDocState,
  recordTaskDocHistory,
  type TaskDocSurface,
} from "@/lib/history";
import EntityVersionHistorySidebar, {
  type VersionPreview,
} from "@/components/history/EntityVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";
import Tooltip from "@/components/Tooltip";

export interface UseTaskDocHistoryArgs {
  surface: TaskDocSurface;
  /** Task id (the document key). */
  taskId: number;
  /** Owner folder the history file lives under. */
  owner: string;
  /** Signed-in user, credited as the actor on the revert row. */
  actor: string;
  /** The LIVE markdown content on disk (HEAD), for anchor resolution + revert. */
  liveContent: string;
  /**
   * Write the reconstructed markdown back to disk and reflect it into the
   * editor. The consuming tab owns the actual filesApi.writeFile + local-state
   * update (it already has the path + setters), so the hook hands it the
   * restored content and the tab persists + reflects it.
   */
  writeRestored: (content: string) => Promise<void>;
  /** Whether the viewer may restore (write access). Gates the sidebar footer. */
  canRestore: boolean;
}

export interface TaskDocHistoryController {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  preview: VersionPreview | null;
  setPreview: (p: VersionPreview | null) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  handleRestore: (targetVersion: number) => Promise<void>;
  /** Live HEAD canonical, threaded to the sidebar for bare-genesis anchors. */
  headCanonical: string;
}

/**
 * Controller hook for a task-document version-history surface. Owns the open /
 * preview state + the file-backed revert handler. The consuming tab renders the
 * button (TaskDocHistoryButton), the diff column (TaskDocDiffColumn), and the
 * sidebar (TaskDocHistorySidebar) off this controller.
 */
export function useTaskDocHistory({
  surface,
  taskId,
  owner,
  actor,
  liveContent,
  writeRestored,
  canRestore,
}: UseTaskDocHistoryArgs): TaskDocHistoryController {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);

  const headCanonical = canonicalize(taskDocPayload(liveContent));

  const close = useCallback(() => {
    setIsOpen(false);
    setPreview(null);
    triggerRef.current?.focus();
  }, []);
  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => {
    setIsOpen((v) => {
      if (v) {
        setPreview(null);
        triggerRef.current?.focus();
        return false;
      }
      return true;
    });
  }, []);

  // Revert: reverse-walk from the LIVE HEAD content to the target version,
  // write the reconstructed markdown back to disk, then record a "revert"
  // version. Adapted from useVersionRestore.handleRestore, but writing the .md
  // file (via writeRestored) instead of calling an entity api.update.
  const handleRestore = useCallback(
    async (targetVersion: number) => {
      if (busyRef.current) return;
      if (!canRestore) return;
      busyRef.current = true;
      try {
        const entityType = taskDocEntityType(surface);
        const rows = await historyEngine.readHistory(entityType, owner, taskId);
        if (rows.length === 0) return;

        // HEAD canonical comes from the LIVE on-disk content, NOT
        // reconstructState: a document whose history was first laid on top of a
        // pre-existing notes.md has a bare genesis anchored at a non-empty
        // pre-image, which reconstructState cannot resolve without HEAD. The
        // live content IS the HEAD and matches the latest row's post_hash by
        // construction (the recorder canonicalizes the same payload).
        const headCanon = canonicalize(taskDocPayload(liveContent));
        let targetCanonical: string;
        try {
          targetCanonical = historyEngine.reverseWalkTo(
            rows,
            targetVersion,
            headCanon,
          );
        } catch (err) {
          if (err instanceof HistoryCompactedTargetError) {
            // Case C: the target was folded into a boundary snapshot. Surface a
            // non-throwing log; the sidebar stays open so the user can pick the
            // summarized boundary point instead.
            console.warn(
              `[history] task-doc revert target ${targetVersion} was summarized for ${entityType}/${taskId}; cannot restore exactly`,
            );
            return;
          }
          throw err;
        }

        const restoredContent = projectTaskDocState(targetCanonical).body;

        // Write the restored markdown back to disk + reflect into the editor.
        // The tab's writeRestored does filesApi.writeFile + setContent.
        await writeRestored(restoredContent);

        // Record the revert as its own forward "revert" row (prev = live HEAD,
        // next = restored content) so the timeline shows "Restored an earlier
        // version" and the restore is itself revertible.
        await recordTaskDocHistory({
          surface,
          type: "revert",
          id: taskId,
          owner,
          actor,
          prevContent: liveContent,
          nextContent: restoredContent,
          revertTargetVersion: targetVersion,
        });

        close();
      } catch (err) {
        console.error("[useTaskDocHistory] restore failed:", err);
      } finally {
        busyRef.current = false;
      }
    },
    [surface, owner, taskId, actor, liveContent, writeRestored, canRestore, close],
  );

  return {
    isOpen,
    open,
    close,
    toggle,
    preview,
    setPreview,
    triggerRef,
    handleRestore,
    headCanonical,
  };
}

/** The icon-only history toggle button for the editor toolbar trailing area. */
export function TaskDocHistoryButton({
  controller,
}: {
  controller: TaskDocHistoryController;
}) {
  return (
    <Tooltip label="Version history" placement="bottom">
      <button
        type="button"
        ref={controller.triggerRef}
        onClick={controller.toggle}
        data-testid="task-doc-history-button"
        aria-pressed={controller.isOpen}
        className={`p-1.5 rounded-lg transition-colors ${
          controller.isOpen
            ? "text-emerald-600 bg-emerald-50"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
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
          <path d="M3 3v5h5" />
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
    </Tooltip>
  );
}

/** The in-place read-only diff column shown in the editor slot when history is
 *  open. Falls back to a "select a version" hint before a selection. */
export function TaskDocDiffColumn({
  controller,
}: {
  controller: TaskDocHistoryController;
}) {
  if (controller.preview) {
    return (
      <div className="p-6 overflow-y-auto h-full" data-testid="task-doc-diff-column">
        <VersionDiffView
          before={controller.preview.before}
          after={controller.preview.after}
          editor={controller.preview.editor}
          editorLabel={controller.preview.editorLabel}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm p-6">
      <p>Select a version to preview it here.</p>
    </div>
  );
}

/** The docked right sidebar, bound to this document's entity type + taskId. */
export function TaskDocHistorySidebar({
  controller,
  surface,
  taskId,
  owner,
  canRestore,
}: {
  controller: TaskDocHistoryController;
  surface: TaskDocSurface;
  taskId: number;
  owner: string;
  canRestore: boolean;
}) {
  return (
    <EntityVersionHistorySidebar
      entityType={taskDocEntityType(surface)}
      id={taskId}
      owner={owner}
      adapter={taskDocAdapter}
      onClose={controller.close}
      onPreviewChange={controller.setPreview}
      headCanonical={controller.headCanonical}
      canRestore={canRestore}
      onRestore={controller.handleRestore}
    />
  );
}

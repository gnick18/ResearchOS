"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { filesApi, methodsApi, projectsApi, dependenciesApi, fetchAllTasks, fetchAllProjectsIncludingShared, purchasesApi, tasksApi as rawTasksApi, type DuplicateCheckResult } from "@/lib/local-api";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import { STANDALONE_FILTER_KEY } from "@/lib/search/filterKey";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import PurchaseEditor from "./PurchaseEditor";
import DynamicAnimation from "./DynamicAnimation";
import MethodTabs from "./MethodTabs";
import TaskPicker from "./TaskPicker";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import CommentsThread from "./CommentsThread";
import CommentsSidebar from "./CommentsSidebar";
import ReceivedFromBadge from "./ReceivedFromBadge";
import Tooltip from "./Tooltip";
import { Icon } from "@/components/icons";
import { usePhonePaired } from "@/hooks/usePhonePaired";
import { focusWithoutTooltip } from "./tooltip-focus";
import LivingPopup from "@/components/ui/LivingPopup";
import HeaderOverflowMenu, { HeaderOverflowLabel } from "@/components/ui/HeaderOverflowMenu";
import { useAppStore } from "@/lib/store";
import { taskKey } from "@/lib/types";
import type { Task, Project, ShiftResult, SubTask, SharedUser } from "@/lib/types";
import { createNewFileContent, normalizeStampFormat, hasLegacyStampFormat } from "@/lib/stamp-utils";
// TODO(manager): unstub once Sub-bot A lands frontend/src/lib/export/orchestrate.ts.
import { exportExperiments, downloadResult } from "@/lib/export/orchestrate";
import type { ExportFormat } from "@/lib/export/types";
import ExportFormatDialog from "@/components/ExportFormatDialog";
import DepositDialog from "@/components/DepositDialog";
import ProgressEntertainer from "@/components/progress/ProgressEntertainer";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import { useDuplicateResolver } from "@/components/DuplicateUploadDialog";
import { checkForDuplicates } from "@/lib/attachments/duplicate-check";
import { fileService } from "@/lib/file-system/file-service";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import RehydrateMissingImagesModal from "@/components/labarchives/RehydrateMissingImagesModal";
import { readMissingInlineImageCount } from "@/lib/import/eln/rehydrate";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import {
  resolveTabAttachmentBase,
  resolveTaskResultsBase,
  taskNotesBase,
  taskResultsBase,
  taskResultsTabBase,
} from "@/lib/tasks/results-paths";
import { migrateTaskAttachmentsToFiles, splitTaskAttachments } from "@/lib/tasks/migrate-attachments";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { imageEvents } from "@/lib/attachments/image-events";
import { recordProjectActivity } from "@/lib/project-activity/event-log";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useAccountType } from "@/hooks/useAccountType";
import AssignTaskButton from "./lab-head/AssignTaskButton";
import FlagForReviewButton from "./lab-head/FlagForReviewButton";
import PiEditButton from "./lab-head/PiEditButton";
import PiEditConfirmDialog from "./lab-head/PiEditConfirmDialog";
import PiEditAuditNote from "./lab-head/PiEditAuditNote";
import PiActionsHeaderButton from "./lab-head/PiActionsHeaderButton";
import { usePiEditGate } from "@/hooks/usePiEditGate";
import FlagBanner from "./lab-head/FlagBanner";
// VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): version history +
// restore for the Task / Experiment entity. Mirrors NoteDetailPopup's wiring.
import { RESTORE_ENABLED, canonicalize } from "@/lib/history";
import {
  useVersionRestore,
  type VersionRestoreApi,
} from "@/lib/history/useVersionRestore";
import { canRead, canWrite } from "@/lib/sharing/unified";
import { taskAdapter } from "@/lib/history/task-viewer";
import EntityVersionHistorySidebar, {
  type VersionPreview,
} from "@/components/history/EntityVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";
// save-checkpoint bot (2026-06-02): version-control wiring for the task Lab
// Notes / Results MARKDOWN documents (notes.md / results.md). Separate additive
// entity types ("task_notes" / "task_results") from the structured-Task history.
import { recordTaskDocHistory } from "@/lib/history";
import {
  useTaskDocHistory,
  TaskDocHistoryButton,
  TaskDocDiffColumn,
  TaskDocHistorySidebar,
} from "@/components/history/TaskDocVersionHistory";
import type { TaskRestorePayload } from "@/lib/types";
// Experiment-collab chunk 1 (experiment-collab sub-bot, 2026-06-06): wire the
// Lab Notes tab onto the Loro collab engine, mirroring NoteDetailPopup. The
// collab path is entity-agnostic: openTaskDoc adopts the DO canonical, the
// editor binds the task's single "content" text, and grant-on-share reuses the
// same docId-keyed server grant notes use (no task-specific server route).
import { LORO_PILOT_ENABLED } from "@/lib/loro/config";
import { appendTaskLine } from "@/lib/loro/task-doc";
import { openTaskDoc, type TaskDocHandle } from "@/lib/loro/task-store";
import { useCollabSession } from "@/lib/loro/collab/use-collab-session";
import { peerColorClass } from "@/lib/loro/collab/safe-ephemeral-plugin";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { grantCollabOnShare } from "@/lib/collab/client/grant-on-share";
import { setCollabSignerEmail } from "@/lib/collab/client/current-email";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";

interface TaskDetailPopupProps {
  task: Task;
  project?: Project;
  onClose: () => void;
  onNavigateToTask?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  username?: string; // When provided, fetch user-specific data (for lab mode)
  /** Tab to land on when the popup opens. Falls back to "purchases" for
   *  purchase tasks and "details" otherwise. Used by the /results route to
   *  open straight into the Results tab. */
  initialTab?: Tab;
  /** Open with the comments rail already expanded + composer focused (used by
   *  the right-click "Add a comment" action). Experiment tasks only. */
  initialCommentsOpen?: boolean;
}

type Tab = "details" | "notes" | "method" | "results" | "purchases";

export default function TaskDetailPopup({
  task: initialTask,
  project,
  onClose,
  onNavigateToTask,
  readOnly: propReadOnly = false,
  username,
  initialTab,
  initialCommentsOpen = false,
}: TaskDetailPopupProps) {
  const queryClient = useQueryClient();
  // The effective `readOnly` is computed below, after the PI edit gate (it needs
  // currentUser / accountType / task, which are set further down). A lab head
  // viewing a MEMBER's task can still assign / flag it (role privileges) via
  // canActAsLabHead, and now also edit it via the once-per-session PI gate.
  const isExperiment = initialTask.task_type === "experiment";
  const isPurchase = initialTask.task_type === "purchase";
  const isSimpleTask = initialTask.task_type === "list";
  // Hand-walk fix 2026-05-27 (Grant): experiment popups now default to
  // Details, not Lab Notes. Reasoning: the popup is the experiment's
  // landing surface — schedule, project, tags, methods. Opening on
  // Lab Notes hides all that orientation context behind a tab the user
  // didn't actively pick. Purchases still default to the items tab
  // (their primary action), list tasks still default to details
  // (sub-tasks live in the Details tab). `initialTab` callers (tours,
  // deep-links) still win.
  //
  // (Prior comment retained for archaeology: R1 fix-pass 2026-05-23
  //  reasoned that "users open an experiment to write lab notes" so
  //  defaulted to notes. Hand-walk pushback flipped that.)
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab ?? (isPurchase ? "purchases" : "details")
  );
  // Tracks which markdown-editor tab the user last viewed. Drops on
  // non-editor surfaces (Details, Methods, the header, anywhere outside the
  // editor card) route to this tab's per-tab attachment folder. Defaults
  // to "notes" so first-time drops on Details have a sensible target.
  // Updated in `selectTab` below — not in an effect — so cascading rerenders
  // don't fire on every activeTab change.
  const [lastEditorTab, setLastEditorTab] = useState<"notes" | "results">(
    initialTab === "results" ? "results" : "notes"
  );
  const selectTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    if (tab === "notes") setLastEditorTab("notes");
    else if (tab === "results") setLastEditorTab("results");
    // Onboarding v4 §6.6 `experiment-attach-method-tab` sub-step advances
    // on this event. Same pattern as the bell/silence/delete and
    // project-route-entered dispatches: a window-level CustomEvent so
    // the tour module never needs to import the popup's internals.
    // Cheap when no tour is active (one dispatchEvent per tab click).
    if (tab === "method" && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:experiment-methods-tab-active"),
      );
    }
  }, []);
  const [task, setTask] = useState(initialTask);
  // L3 unified header: short calm date for the metadata subline. Mirrors
  // NoteDetailPopup's local helper (no shared import needed for one line).
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };
  const [isExpanded, setIsExpanded] = useState(false);
  const [animationPosition, setAnimationPosition] = useState<{ x: number; y: number } | null>(null);
  const [showSharePopup, setShowSharePopup] = useState(false);
  // Account-capability gate (capabilities bot, 2026-06-13). Share is a deep
  // in-flow control, so it HIDES for solo/locked users (per Grant's lock) rather
  // than showing a dead button that walls them inside the dialog.
  const { canShare } = useAccountCapabilities();
  // R1 fix-pass: pending-enter-edit handshake between the header Edit
  // button and DetailsTab. The header click sets this flag (after
  // selectTab("details") if needed); DetailsTab consumes it on mount /
  // when it flips true and calls handleEnterEdit, then clears it. Lets
  // the tour script click Edit immediately on popup open even when the
  // popup defaults to Notes for experiments — the tab swap happens
  // first then the pending flag fires the edit-mode transition.
  const [pendingEnterEdit, setPendingEnterEdit] = useState(false);
  const { currentUser } = useCurrentUser();
  // True when a phone is paired, so the header can show that a snapped photo
  // will route to the open experiment (and which tab) rather than the inbox.
  const phonePaired = usePhonePaired();
  // Imperative flush+save handle the active editor tab registers, so an
  // auto-switch (a phone capture routed to a non-visible tab) can persist
  // unsaved work before switching. Null when the active tab is not an editor.
  const activeTabFlushSaveRef = useRef<(() => Promise<void>) | null>(null);
  const registerActiveTabFlushSave = useCallback(
    (fn: (() => Promise<void>) | null) => {
      activeTabFlushSaveRef.current = fn;
    },
    [],
  );
  // Unified editor surface (L3, continuous-surface shell). The shell's ambient
  // save indicator must tell the TRUTH, but the experiment's save state is owned
  // per-tab (each editor tab + DetailsTab keeps its OWN hasUnsavedChanges /
  // saving). So the active editor tab LIFTS its dirty + saving state up here via
  // this registration; the shell reads it to render an honest indicator and to
  // enable Done. A tab that registers nothing (Method, Order items) reports no
  // state, and the shell shows NO save claim for it rather than a misleading
  // "Saved". This changes presentation only — the per-tab manual save (Save
  // button + flush) is untouched.
  const [activeEditorState, setActiveEditorState] = useState<{
    dirty: boolean;
    saving: boolean;
  } | null>(null);
  const registerActiveTabDirtyState = useCallback(
    (state: { dirty: boolean; saving: boolean } | null) => {
      setActiveEditorState(state);
    },
    [],
  );
  // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §3B / §9, U1).
  // The popup MODAL GROWS in place — same DOM, a CSS size transition on the
  // card below (transition-all duration-300). The tab bar stays pinned and
  // navigable while expanded, and the active editor subtree is never
  // unmounted/remounted across the transition (so no buffer loss). This single
  // toggle is shared by the header fullscreen button and the editor's own
  // Focus button (via onRequestExpand threaded into the Lab Notes / Results
  // tabs). It flushes the active editor's in-flight buffer BEFORE growing so no
  // in-flight text is lost across the size transition.
  const toggleExpanded = useCallback(() => {
    void (async () => {
      try {
        await activeTabFlushSaveRef.current?.();
      } catch {
        // Best-effort flush; draft persistence still holds the unsaved text.
      }
      setIsExpanded((prev) => !prev);
    })();
  }, []);
  // L3 plain "Done" for the expanded shell: flush the active editor tab through
  // its EXISTING manual-save (registered via activeTabFlushSaveRef, which only
  // writes when the doc actually changed) then collapse back to the docked
  // popup. No close, no new write path — Done, the fullscreen toggle, and the
  // X are three always-reachable exits so the expanded shell is never
  // soft-locked. Mirrors toggleExpanded's flush-then-resize, which is why the
  // ambient indicator can honestly read "Saved" right after Done resolves.
  const handleDone = useCallback(() => {
    void (async () => {
      try {
        await activeTabFlushSaveRef.current?.();
      } catch {
        // Best-effort flush; draft persistence still holds the unsaved text.
      }
      setIsExpanded(false);
    })();
  }, []);
  // Phase 2: append-line handle. The active tab (LabNotesTab or ResultsTab)
  // registers a function that appends a plain text line via Loro (pilot) or
  // via legacy state + handleSave. Null when no editor tab is mounted.
  const activeTabAppendLineRef = useRef<((line: string) => void) | null>(null);
  const registerActiveTabAppendLine = useCallback(
    (fn: ((line: string) => void) | null) => {
      activeTabAppendLineRef.current = fn;
    },
    [],
  );
  const accountType = useAccountType(currentUser);
  // The PI-role boolean for the header button, derived from accountType so the
  // loading `undefined` is preserved (matching useIsLabHead). accountType is
  // still read directly below for the canActAsLabHead gate and the unified
  // viewer mapping, so it stays.
  const isLabHead =
    accountType === "lab_head"
      ? true
      : accountType === undefined
        ? undefined
        : false;
  // A lab head viewing a member's task (read-only lab-mode view of someone
  // else's record) keeps the assign / flag role affordances. These are PI
  // privileges, not record writes, so they survive the edit-session removal.
  const recordOwnerForGate = username ?? initialTask.owner ?? null;
  const canActAsLabHead =
    propReadOnly &&
    accountType === "lab_head" &&
    !!recordOwnerForGate &&
    !!currentUser &&
    recordOwnerForGate !== currentUser;

  // PI capability revamp (2026-06-07): role-based PI edit of a member's task.
  // A lab head on a member's task sees it read-only with an "Edit as lab head"
  // button until they cross the once-per-session confirm; afterward writes route
  // to the owner's folder + audit (tasksApi memo below). No password, no session.
  const piGate = usePiEditGate({
    owner: recordOwnerForGate,
    sharedWith: initialTask.shared_with,
    recordType: "task",
    recordId: initialTask.id,
    propReadOnly,
  });
  const piActive = piGate.isPiEdit && piGate.confirmed;
  // The effective readOnly: a PI on a member's task stays read-only until they
  // confirm; everyone else keeps the prop-passed (share-permission) flag.
  const readOnly = piGate.isPiEdit ? !piGate.confirmed : propReadOnly;

  // VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): version-history
  // viewer state, mirroring NoteDetailPopup. Opening the right-sidebar version
  // list flips the body into a READ-ONLY diff preview; `versionPreview` carries
  // the selected version's {before, after} diff. Closing returns to the live
  // tabbed view.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Lab comments now dock as a right rail, mutually exclusive with the history
  // sidebar (opening one closes the other).
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen && isExperiment);
  const commentCount = task.comments?.length ?? 0;
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(
    null,
  );
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setVersionPreview(null);
    focusWithoutTooltip(historyTriggerRef.current);
  }, []);

  // Owner-aware view of tasksApi: when this popup is showing a task that was
  // shared to the current user with edit permission, every mutating call routes
  // through the owner's directory instead of the current user's. When a lab head
  // is editing a member's task on the role (piActive), pass the PI edit args so
  // writes route to the owner + emit audit.
  const tasksApi = useMemo(
    () =>
      ownerScopedTasksApi(
        task,
        piActive && currentUser ? { actor: currentUser } : undefined,
      ),
    [task, piActive, currentUser],
  );

  // ── VC Phase 3 (Task): restore-a-version + 24h undo-restore ───────────────
  // The history file lives under the TASK OWNER's folder
  // (users/<owner>/_history/task/<id>.jsonl); fall back to the signed-in user
  // for legacy tasks with an empty owner. Mirrors NoteDetailPopup.historyOwner.
  const historyOwner = task.owner || currentUser || "";

  // canRestore: can the current viewer write this task (and thus restore a
  // version)? Owner writes; a shared-edit receiver writes. The old PI-passcode
  // edit-session cross-owner override was removed, so a lab head editing
  // another member's task follows standard share permissions.
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
    canRead(task, restoreViewer) && canWrite(task, restoreViewer);

  // The PI-passcode unlock path was removed; the affordance is simply hidden
  // for a read-only viewer who cannot write.
  const restoreNeedsUnlock = false;

  // The entity API the restore hook binds. Routes get/update to the task
  // OWNER's folder when this is a shared-with-edit view (mirrors
  // ownerScopedTasksApi), and threads the historyMeta stamp so the restore /
  // undo rows are marked "revert" / "undo-revert".
  const restoreOwnerArg =
    task.is_shared_with_me && task.shared_permission === "edit"
      ? task.owner
      : undefined;
  const restoreApi = useMemo<VersionRestoreApi<Task>>(
    () => ({
      get: (id, owner) => rawTasksApi.get(id, owner ?? restoreOwnerArg),
      update: (id, payload, historyMeta) =>
        rawTasksApi.update(
          id,
          payload as TaskRestorePayload,
          restoreOwnerArg,
          historyMeta,
        ),
    }),
    [restoreOwnerArg],
  );

  // Reflect the restored record into the popup's local task state AND bubble it
  // up. This is the only restore step that stays in the popup (the hook is
  // editor-state agnostic). Mirrors NoteDetailPopup.reflectRestoredNote.
  const reflectRestoredTask = useCallback(
    (updated: Task) => {
      setTask(updated);
      void queryClient.refetchQueries({ queryKey: ["tasks"] });
      void queryClient.refetchQueries({ queryKey: ["task", taskKey(updated)] });
    },
    [queryClient],
  );

  // Canonical tracked state of the LIVE task (HEAD). Threaded into the sidebar
  // so the engine can resolve a BARE-GENESIS anchor (a task that existed before
  // its first tracked save). Same HEAD source useVersionRestore uses, so the
  // viewer + restore path agree byte-for-byte.
  const liveTaskCanonical = useMemo(() => canonicalize(task), [task]);

  const {
    handleRestore,
    handleUndoRestore,
    undoConfirmPending,
    confirmUndoRestore,
    dismissUndoConfirm,
    undoWindowActive,
    isBusy: restoreBusy,
    restoreError,
  } = useVersionRestore<Task>({
    entityType: "task",
    record: task,
    id: task.id,
    owner: historyOwner,
    api: restoreApi,
    currentUser,
    onUpdate: reflectRestoredTask,
    // Task immutable keys: never overwritten by a restore payload. `owner` is
    // the routing/sharing field (analogous to Note's `username`); `created_at`
    // is not stored on tasks today but is denylisted defensively.
    immutableKeys: ["id", "owner", "created_at"],
    onAfterRestore: closeHistory,
  });

  // Cross-owner unshare: clears `external_project` on the task AND removes
  // the manifest entry on the destination project's side. Available on the
  // share badge near the title (only renders when the task IS hosted in a
  // foreign project AND the current user is the task owner — receivers
  // can't unshare what isn't theirs to host).
  const [unsharingFromProjectTop, setUnsharingFromProjectTop] = useState(false);
  const handleUnshareFromProjectTop = useCallback(async () => {
    if (!task.external_project || !currentUser) return;
    if (
      !confirm(
        `Remove this task from ${task.external_project.owner}'s project? ` +
          "It stays in your library."
      )
    ) {
      return;
    }
    setUnsharingFromProjectTop(true);
    try {
      const taskOwner = task.owner || currentUser;
      await rawTasksApi.unshareFromProject(
        taskOwner,
        task.id,
        task.external_project.owner,
        task.external_project.id
      );
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["projects", "with-shared"] }),
      ]);
    } catch (err) {
      console.error("Failed to unshare task:", err);
      alert("Failed to unshare task from project");
    } finally {
      setUnsharingFromProjectTop(false);
    }
  }, [task, currentUser, queryClient]);

  // Universal drop: any file dragged anywhere onto the popup card uploads to
  // the most-recently-viewed editor tab's per-tab attachment folder
  // (Lab Notes → `task-N/notes/{Files,Images}`, Results →
  // `task-N/results/{Files,Images}`). Defaults to Lab Notes so first-time
  // drops on Details have a target. LiveMarkdownEditor instances inside
  // Lab Notes / Results already handle their own drops and stopPropagation,
  // so this handler only fires for drops outside an editor (Details,
  // Methods rendered content, header, etc).
  const popupBasePath = useMemo(() => taskResultsBase(task), [task]);
  const [universalDropToast, setUniversalDropToast] = useState<
    { msg: string; x: number; y: number } | null
  >(null);
  const {
    resolve: resolveUniversalDuplicates,
    DialogComponent: UniversalDuplicateDialog,
  } = useDuplicateResolver();
  const handleUniversalDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleUniversalDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      // stopPropagation so the window-level GlobalDropGuard doesn't also fire
      // its "no attachment target" toast on top of our success toast.
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const dropX = e.clientX;
      const dropY = e.clientY;
      const landed: string[] = [];

      // Route to whichever editor tab was last active. If the per-tab
      // scoped folder isn't populated yet (and legacy shared `Files/`+
      // `Images/` still hold this task's attachments at the outer base),
      // we still target the scoped folder — the editor's first drop is the
      // moment the migration is expected to kick in, and writing into the
      // legacy shared folder here would re-introduce the cross-tab bleed
      // we're trying to fix.
      const tabRoot = lastEditorTab === "results"
        ? `${popupBasePath}/results`
        : `${popupBasePath}/notes`;
      const labelForTab = lastEditorTab === "results" ? "Results" : "Lab Notes";

      // Partition by Images/Files routing AND duplicate-check status. The
      // universal drop routes images to Images/ and other files to Files/,
      // so we check each subdir's existing set separately.
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      const otherFiles = files.filter((f) => !f.type.startsWith("image/"));
      const imagesDir = `${tabRoot}/Images`;
      const filesDir = `${tabRoot}/Files`;
      const [existingImages, existingFiles] = await Promise.all([
        imageFiles.length > 0
          ? fileService.listFiles(imagesDir).then((n) => new Set(n))
          : Promise.resolve(new Set<string>()),
        otherFiles.length > 0
          ? fileService.listFiles(filesDir).then((n) => new Set(n))
          : Promise.resolve(new Set<string>()),
      ]);
      const imagePartition = checkForDuplicates(imageFiles, existingImages);
      const filePartition = checkForDuplicates(otherFiles, existingFiles);

      const writeOne = async (
        file: File,
        finalName: string,
        isImage: boolean,
      ) => {
        const folder = isImage ? "Images" : "Files";
        const dir = `${tabRoot}/${folder}`;
        await fileService.writeFileFromBlob(`${dir}/${finalName}`, file);
        const detail = { basePath: tabRoot, relativePath: `${folder}/${finalName}` };
        if (isImage) imageEvents.emitAttached(detail);
        else fileEvents.emitAttached(detail);
        if (isImage && task.project_id !== 0) {
          void recordProjectActivity(
            task.external_project?.owner ?? task.owner,
            task.project_id,
            {
              type: "image_added",
              image_name: finalName,
              surface: lastEditorTab === "results" ? "task_results" : "task_notes",
              task_id: task.id,
              task_owner: task.owner,
              task_name: task.name,
            }
          );
        }
        landed.push(finalName);
      };

      // Safe-to-write files go through immediately.
      for (const file of imagePartition.uniqueFiles) {
        try {
          await writeOne(file, file.name, true);
        } catch (err) {
          console.error("Failed to upload", file.name, err);
        }
      }
      for (const file of filePartition.uniqueFiles) {
        try {
          await writeOne(file, file.name, false);
        } catch (err) {
          console.error("Failed to upload", file.name, err);
        }
      }

      // Surface collisions via dialog. Images and Files share the same
      // resolver instance — the user sees one merged queue. The dialog
      // doesn't care about the destination split; the per-collision
      // resolution carries enough info for us to route on the back end.
      const allCollisions = [
        ...imagePartition.collisions,
        ...filePartition.collisions,
      ];
      if (allCollisions.length > 0) {
        const resolutions = await resolveUniversalDuplicates(allCollisions);
        const writeCollision = async (
          info: { file: File; existingName: string; suggestedName: string },
          isImage: boolean,
        ) => {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") return;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName;
          try {
            if (choice.action === "replace") {
              const folder = isImage ? "Images" : "Files";
              await fileService.deleteFile(
                `${tabRoot}/${folder}/${info.existingName}`,
              );
            }
            await writeOne(info.file, finalName, isImage);
          } catch (err) {
            console.error("Failed to upload", finalName, err);
          }
        };
        for (const info of imagePartition.collisions) await writeCollision(info, true);
        for (const info of filePartition.collisions) await writeCollision(info, false);
      }

      if (landed.length > 0) {
        const msg =
          landed.length === 1
            ? `Added ${landed[0]} to ${labelForTab}.`
            : `Added ${landed.length} files to ${labelForTab}.`;
        setUniversalDropToast({ msg, x: dropX, y: dropY });
        window.setTimeout(() => setUniversalDropToast(null), 3000);
      }
    },
    [
      lastEditorTab,
      popupBasePath,
      resolveUniversalDuplicates,
      task.id,
      task.name,
      task.owner,
      task.project_id,
      task.external_project,
    ]
  );

  // Get the selected animation type from the store
  const animationType = useAppStore((s) => s.animationType);

  // Expose this task as the "active task" while the popup is open, so the
  // Telegram image router knows where to drop inbound photos.
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  useEffect(() => {
    setActiveTask({ id: task.id, owner: task.owner, name: task.name });
    return () => setActiveTask(null);
  }, [setActiveTask, task.id, task.owner, task.name]);

  // Mirror the visible editor tab into the store so FocusContextPublisher can
  // include the correct tab in the sealed focus context it sends to paired phones.
  // Mapping: "notes" -> "notes", "results" -> "results", any other tab -> "other".
  const setActiveTaskTab = useAppStore((s) => s.setActiveTaskTab);
  useEffect(() => {
    const mapped: "notes" | "results" | "other" =
      activeTab === "notes" ? "notes"
      : activeTab === "results" ? "results"
      : "other";
    setActiveTaskTab(mapped);
    return () => setActiveTaskTab(null);
  }, [setActiveTaskTab, activeTab]);

  // Auto-switch on an incoming routed capture (locked decision A/B). poll.ts
  // dispatches `capture:routed` after landing a phone photo in a task tab; if it
  // targets THIS experiment, save any unsaved editor work first, then switch to
  // that tab so the user sees the photo land where the phone sent it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { taskId?: number; owner?: string; tab?: "notes" | "results" }
        | undefined;
      if (!detail || detail.taskId !== task.id || detail.owner !== task.owner) {
        return;
      }
      const targetTab: Tab = detail.tab === "results" ? "results" : "notes";
      void (async () => {
        try {
          // Persist the current editor before yanking the user to another tab.
          await activeTabFlushSaveRef.current?.();
        } catch {
          // Best-effort, draft persistence still holds the unsaved text.
        }
        selectTab(targetTab);
      })();
    };
    window.addEventListener("capture:routed", handler);
    return () => window.removeEventListener("capture:routed", handler);
  }, [task.id, task.owner, selectTab]);

  // Phase 2: receive an append-line event from the poll loop. When the target
  // matches this popup's experiment, switch to the right tab (flushing unsaved
  // work first as with capture:routed) and then call the active tab's
  // appendLine handle so the line lands live in the editor.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { taskId?: number; owner?: string; tab?: "notes" | "results"; text?: string }
        | undefined;
      if (!detail || detail.taskId !== task.id || detail.owner !== task.owner) {
        return;
      }
      const targetTab: Tab = detail.tab === "results" ? "results" : "notes";
      const text = detail.text ?? "";
      void (async () => {
        try {
          await activeTabFlushSaveRef.current?.();
        } catch {
          // Best-effort flush.
        }
        selectTab(targetTab);
        // The tab switch is synchronous in state but the tab component may need
        // one render tick to re-register its appendLine handle. Defer the append
        // slightly so the newly-visible tab's effect fires first.
        setTimeout(() => {
          activeTabAppendLineRef.current?.(text);
        }, 80);
      })();
    };
    window.addEventListener("notebook:append-line", handler);
    return () => window.removeEventListener("notebook:append-line", handler);
  }, [task.id, task.owner, selectTab]);

  // Onboarding v4 §6.6 `experiment-attach-method-open` sub-step advances
  // on this event so the follow-up sub-step's cursor script runs against
  // the now-mounted popup DOM. Only fires for experiment tasks (the §6.6
  // teach is experiment-specific). See `watchExperimentPopupOpened` in
  // `components/onboarding/v4/steps/walkthrough/lib/tour-events.ts`.
  useEffect(() => {
    if (!isExperiment) return;
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("tour:experiment-popup-opened", {
        detail: { experimentId: initialTask.id },
      }),
    );
  }, [isExperiment, initialTask.id]);
  
  // Stable callback for animation completion to prevent re-triggering
  const handleAnimationComplete = useCallback(() => {
    setAnimationPosition(null);
  }, []);

  // Refresh task data — but only when the viewer owns the task.
  //
  // In readOnly mode (Lab Mode or shared-with-me views) `initialTask` belongs to
  // another user (`username` prop). `tasksApi.get` always reads from the CURRENT
  // user's directory and each user has their own ID space, so refetching here
  // would silently overwrite the popup with whatever task happens to share the
  // same numeric id in the viewer's folder — the "screen freakout" symptom.
  // For shared tasks the on-disk record lives in the owner's directory, so the
  // refetch must thread `initialTask.owner` (standard read-side owner-routing
  // pattern). Distinct from `ownerScopedTasksApi`, which only routes
  // when `shared_permission === "edit"` — reads should follow the same
  // directory regardless of whether the receiver can mutate.
  // A shared-into-me task's on-disk file lives in the OWNER's directory, so
  // the fetch must owner-route to it. (The old PI edit-session owner-routing
  // branch was removed.)
  const ownerForTask = initialTask.is_shared_with_me
    ? initialTask.owner
    : undefined;
  const { data: freshTask } = useQuery({
    queryKey: ["task", taskKey(initialTask)],
    queryFn: () => rawTasksApi.get(initialTask.id, ownerForTask),
    initialData: initialTask,
    enabled: !readOnly,
  });

  // Sync local task state with the freshly-fetched record from disk while
  // preserving the sharing-metadata overlay from the prop (the on-disk file
  // never carries it). Legitimate external-state-into-React sync.
  useEffect(() => {
    if (!freshTask) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTask({
      ...freshTask,
      owner: initialTask.owner || freshTask.owner,
      is_shared_with_me: initialTask.is_shared_with_me,
      shared_permission: initialTask.shared_permission,
    });
  }, [freshTask, initialTask.owner, initialTask.is_shared_with_me, initialTask.shared_permission]);

  // Handle escape key — context-sensitive.
  //
  // esc-context fix manager (2026-05-27, Grant hand-walk fix):
  //   1. If focus is on an editor surface inside the popup (textarea,
  //      contenteditable, or text input), let Esc fall through to that
  //      element's own onKeyDown handler so it can handle its own
  //      commit / blur logic without the popup intercepting.
  //   2. Otherwise if the popup is fullscreen, shrink it instead of
  //      closing.
  //   3. Otherwise close (the original behavior).
  useEffect(() => {
    const isTextInputEl = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type;
        // Treat any text-shaped input as "Esc cancels the field, not
        // the popup". Number / date / etc. also accept text editing.
        return (
          type === "text" ||
          type === "search" ||
          type === "email" ||
          type === "url" ||
          type === "tel" ||
          type === "password" ||
          type === "number" ||
          type === "date" ||
          type === "datetime-local"
        );
      }
      return false;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Bail when a nested overlay (UnifiedShareDialog, ExportFormatDialog,
      // DepositDialog, PiEditConfirmDialog) already handled this Escape, so
      // dismissing it does not also advance this popup's state machine on the
      // same press.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = typeof document !== "undefined"
        ? document.activeElement
        : null;
      if (isTextInputEl(active)) {
        // Branch 1: text input has focus, let it own the Escape.
        // The field's onKeyDown handler is responsible for blurring
        // and calling stopPropagation. If the field doesn't stop the
        // event we still don't close: dropping out of edit mode is
        // enough, and Grant's tour scripts rely on the popup surviving.
        // We do NOT mark the event handled here, so the field keeps control.
        return;
      }
      // From here every branch acts on the Escape, so mark it handled (mirrors
      // useEscapeToClose) before dispatching.
      e.preventDefault();
      e.stopPropagation();
      if (historyOpen) {
        // Branch 1.5 (VC Phase 3): when the version-history sidebar is open,
        // Esc exits HISTORY first and returns to the live record, rather than
        // closing the whole popup. Mirrors NoteDetailPopup's precedence.
        setHistoryOpen(false);
        setVersionPreview(null);
        focusWithoutTooltip(historyTriggerRef.current);
        return;
      }
      if (commentsOpen) {
        setCommentsOpen(false);
        return;
      }
      if (isExpanded) {
        // Branch 2: shrink before closing so the fullscreen state can
        // persist across multi-step demos. A second Esc closes.
        setIsExpanded(false);
        return;
      }
      // Branch 3: normal close.
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, onClose, historyOpen, commentsOpen]);

  // Orphan-items probe: non-purchase tasks can still have purchase_items
  // attached (the "Items on non-purchase tasks" surface on the spending
  // dashboard). Without this lookup the Items tab — and PurchaseEditor's
  // amber non-purchase-task warning at PurchaseEditor.tsx:409 — were
  // unreachable from non-purchase TaskDetailPopups (PURCHASES_PAGE_PROPOSAL.md
  // §5 Path 2). Skipped for purchase tasks (already get the tab) and for the
  // simple-task minimal-popup branch (no tabs rendered). Owner-routed via the
  // same `ownerForTask` the task refetch uses, so shared tasks read from the
  // correct directory.
  const { data: orphanItems } = useQuery({
    queryKey: ["task-purchase-items", taskKey(initialTask)],
    queryFn: () => purchasesApi.listByTask(initialTask.id, ownerForTask),
    enabled: !isPurchase && !isSimpleTask,
  });
  const hasOrphanItems = (orphanItems?.length ?? 0) > 0;

  const baseTabs: Tab[] = isExperiment
    ? ["details", "notes", "method", "results"]
    : isPurchase
    ? ["purchases", "details"]
    : ["details"];
  const tabs: Tab[] = hasOrphanItems && !isPurchase
    ? [...baseTabs, "purchases"]
    : baseTabs;

  // L3 honest ambient save state for the expanded shell, derived ENTIRELY from
  // the active editor tab's own dirty/saving state (lifted via
  // registerActiveTabDirtyState). null when the active tab does not report a
  // save state (Method / Order items own their own flows) — the shell then
  // renders NO save claim rather than a misleading "Saved". The experiment
  // tabs are manual-save, so this honestly reads "Unsaved changes" until the
  // user saves (or clicks Done, which flushes), never a premature "Saved".
  const ambientSaveState: "saving" | "unsaved" | "saved" | null = !activeEditorState
    ? null
    : activeEditorState.saving
      ? "saving"
      : activeEditorState.dirty
        ? "unsaved"
        : "saved";

  // For simple tasks, render a minimal popup showing only the list and sublists
  if (isSimpleTask && !isExpanded) {
    return (
      // Minimal list-task popup. The card owns its own header close + expand,
      // and Escape precedence lives in the manual handler above, so opt out of
      // LivingPopup's Escape + corner X. No blur: this is the small variant
      // (was bg-black/20), and little popups never blur.
      <LivingPopup
        open
        onClose={onClose}
        label="Task"
        card={false}
        selfSize
        closeOnEscape={false}
        showClose={false}
      >
        {animationPosition && (
          <DynamicAnimation
            type={animationType}
            x={animationPosition.x}
            y={animationPosition.y}
            onComplete={handleAnimationComplete}
          />
        )}
        <div
          className="pointer-events-auto bg-surface-raised rounded-2xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col overflow-hidden max-h-[90vh]"
          style={{
            boxShadow:
              "0 1px 3px rgba(0,0,0,0.06), 0 16px 40px -8px rgba(0,0,0,0.22)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Project accent strip — slim color band along the top so the
              project color stays a present-but-quiet identifier without
              the off-balance left-bar feel. */}
          <div
            aria-hidden
            className="h-1 w-full flex-shrink-0"
            style={{ backgroundColor: project?.color || "#3b82f6" }}
          />
          {/* Minimal Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 flex-1 mr-2 min-w-0">
              {/* Completion checkbox — circular pill mirrors the experiment
                  popup's "Mark complete" affordance but stays compact for the
                  list popup's narrower header. */}
              {!readOnly && (
                <Tooltip label={task.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
                  <button
                    onClick={async (event) => {
                      // Celebrate on false -> true only. Parity with the
                      // workbench inline card and the subtask checkbox: the
                      // parent mark-complete button is the "list is done"
                      // moment and should fire the same animation.
                      const willComplete = !task.is_complete;
                      const rect = willComplete
                        ? event.currentTarget.getBoundingClientRect()
                        : null;
                      try {
                        await tasksApi.update(task.id, { is_complete: !task.is_complete });
                        await Promise.all([
                          await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                          await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                        ]);
                        if (rect) {
                          setAnimationPosition({
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                          });
                        }
                      } catch {
                        alert("Failed to update task");
                      }
                    }}
                    data-tour-target="workbench-list-mark-complete"
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                      task.is_complete
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-border hover:border-emerald-400 text-transparent hover:text-emerald-400"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  </button>
                </Tooltip>
              )}
              {readOnly && (
                <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                  task.is_complete
                    ? "bg-emerald-500 text-white"
                    : "border-2 border-border text-transparent"
                }`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </span>
              )}
              <h3 className={`text-title font-semibold truncate min-w-0 ${task.is_complete ? "text-foreground-muted line-through" : "text-foreground"}`}>
                {task.name}
              </h3>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {!readOnly && (
                <Tooltip label={task.is_shared_with_me ? `Only the owner (${task.owner}) can delete this task` : "Delete task"} placement="bottom">
                  <button
                    disabled={task.is_shared_with_me}
                    onClick={async () => {
                      if (confirm(`Delete task "${task.name}"?`)) {
                        try {
                          await tasksApi.delete(task.id);
                          onClose();
                          await Promise.all([
                            await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                            await queryClient.refetchQueries({ queryKey: ["task"] }),
                          ]);
                          queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
                        } catch {
                          alert("Failed to delete task");
                        }
                      }
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${task.is_shared_with_me ? "text-foreground-muted cursor-not-allowed" : "text-foreground-muted hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Expand to full view" placement="bottom">
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label="Close (Esc)" placement="bottom">
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="text-foreground-muted hover:text-foreground hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Sub-tasks checklist */}
          <SimpleTaskChecklist
            task={task}
            onAnimationTrigger={(pos) => setAnimationPosition(pos)}
            readOnly={readOnly}
            piActor={piActive && currentUser ? currentUser : undefined}
          />
        </div>
      </LivingPopup>
    );
  }

  return (
    <>
    {/* Universal-drop duplicate-name resolver. Inner tabs (LabNotesTab,
        ResultsTab) own their OWN resolver instances since their upload
        handlers are gated on per-tab state. This one fires only for
        drops that land outside an editor card. */}
    <UniversalDuplicateDialog />
    <LivingPopup
      open
      onClose={onClose}
      label="Task"
      blur
      card={false}
      selfSize
      // The card owns Escape precedence (text field, then history/comments,
      // then fullscreen, then close) in the manual handler above, and it has
      // its own header close, so opt out of LivingPopup's Escape + corner X.
      closeOnEscape={false}
      showClose={false}
    >
      {animationPosition && (
        <DynamicAnimation
          type={animationType}
          x={animationPosition.x}
          y={animationPosition.y}
          onComplete={handleAnimationComplete}
        />
      )}
      <div
        className={`pointer-events-auto rounded-2xl shadow-2xl w-full mx-4 flex flex-col transition-all duration-300 overflow-hidden ${
          isExpanded
            ? "ros-calm-surface inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
            : "bg-surface-raised max-w-5xl h-[90vh] max-h-[860px]"
        }`}
        // Accent bar via inset border-top so the card stays squared off without
        // the off-balance left-bar feel. The earlier `border-l-4` left a
        // raw colored stripe down one edge that the new chrome doesn't need.
        style={{
          boxShadow:
            "0 1px 3px rgba(0,0,0,0.06), 0 20px 50px -10px rgba(0,0,0,0.25)",
        }}
        // LiveMarkdownEditor walks up to this attribute and draws its
        // file-drag ring on the popup card so the ring isn't clipped by
        // the editor's overflow parents.
        data-drag-ring-target=""
        onClick={(e) => e.stopPropagation()}
        onDragOver={handleUniversalDragOver}
        onDrop={handleUniversalDrop}
      >
        {/* Project accent strip — slim color band along the top so the
            project color stays a present-but-quiet identifier without the
            old border-left-4 feeling like a sidebar leak. */}
        <div
          aria-hidden
          className="h-1 w-full flex-shrink-0"
          style={{ backgroundColor: project?.color || "#3b82f6" }}
        />
        {/* Header */}
        {/* R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
            Removed the ringed-colored-dot type indicator. The dot, the
            colored type pill, and the underlying color all triggered
            on `task_type`; three signals saying the same thing read
            as visual noise. The pill stays (accessible label) and the
            top accent strip carries the color tone. Added flex-wrap
            so the action rail wraps below the title at narrow viewports
            instead of jamming together. */}
        <div className={`flex items-start justify-between gap-4 px-6 py-4 flex-wrap ${
          isExpanded ? "" : "border-b border-border"
        }`}>
          <div className="flex items-start min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={`font-semibold text-foreground leading-tight truncate max-w-[60ch] ${
                    isExpanded ? "text-3xl" : "text-2xl"
                  }`}
                >
                  {task.name}
                </h3>
                {/* Type chip (Experiment / Purchase / Task). Hidden at
                    fullscreen (fullscreen-chrome slim) so the Writing-Room
                    title reads clean; docked keeps it. */}
                {!isExpanded && (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-meta font-medium uppercase tracking-wide ${
                      isExperiment
                        ? "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300"
                        : isPurchase
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    }`}
                  >
                    {isExperiment ? "Experiment" : isPurchase ? "Purchase" : "Task"}
                  </span>
                )}
                {/* Cross-boundary provenance. Self-hides on a native experiment
                    (received_from absent), so only an experiment imported from a
                    received bundle shows "Received from {email}, verified". */}
                {task.received_from && (
                  <ReceivedFromBadge
                    receivedFrom={task.received_from}
                    fingerprint={task.received_from_fingerprint}
                    receivedAt={task.received_at}
                  />
                )}
                {/* Cross-owner "shared into project" pill. The X removes the
                    share — both the originating task owner AND the
                    destination project owner are allowed to unshare in v1
                    (this badge only renders for the task owner). */}
                {task.external_project && !task.is_shared_with_me && !readOnly && (
                  <Tooltip
                    label={`Click X to remove from ${task.external_project.owner}'s project`}
                    placement="bottom"
                  >
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 text-meta font-medium text-amber-700 dark:text-amber-300">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                      Shared into {task.external_project.owner}&apos;s project
                      <button
                        type="button"
                        disabled={unsharingFromProjectTop}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnshareFromProjectTop();
                        }}
                        className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-wait"
                        aria-label="Remove from project"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-1 text-meta text-foreground-muted">
                {project?.name && (
                  <>
                    <span className="font-medium text-foreground-muted">{project.name}</span>
                    <span className="text-foreground-muted">·</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1 text-foreground-muted">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {task.start_date} → {task.end_date}
                </span>
                <span className="text-foreground-muted">·</span>
                <span>
                  {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
                </span>
                {task.is_complete && (
                  <>
                    <span className="text-foreground-muted">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Complete
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* R1 fix-pass: drop flex-shrink-0 + add flex-wrap so the rail
              wraps onto a second line at narrow viewports (≤~600px)
              instead of jamming against the title block. */}
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {/* PI capability revamp (2026-06-07): role-based edit affordance.
                A lab head on a member's task sees "Edit as lab head" until they
                cross the once-per-session confirm; afterward the inline audit
                note replaces it. No password. */}
            {piGate.isPiEdit && !piGate.confirmed && (
              <PiEditButton
                memberName={recordOwnerForGate}
                onClick={piGate.beginEdit}
              />
            )}
            {piActive && (
              <PiEditAuditNote memberName={recordOwnerForGate} className="mr-1" />
            )}
            {/* PI Phase 2 pass 2 (2026-06-07): consolidated "Lab head actions"
                kebab. Self-gates on isPiViewingMemberRecord (a lab head viewing
                a member's task), opens the shared PI menu (flag toggle + assign)
                with "Edit as lab head" omitted since the task is already open. */}
            <PiActionsHeaderButton
              recordType="task"
              record={{
                owner: task.owner,
                id: task.id,
                flagged: !!task.flagged,
              }}
              viewerUsername={currentUser}
              isLabHead={isLabHead}
              onEditAsPi={() => {}}
            />
            {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
                Assign + Flag-for-review buttons. A lab head viewing a
                member's task can still assign + flag it (role privileges,
                not record writes). */}
            {canActAsLabHead && currentUser && (
              <>
                <AssignTaskButton
                  task={task}
                  actor={currentUser}
                  onAssigned={() => {
                    void queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
                  }}
                />
                <FlagForReviewButton
                  recordType="task"
                  recordId={task.id}
                  recordName={task.name}
                  targetOwner={task.owner}
                  actor={currentUser}
                  currentFlag={task.flagged ?? null}
                  onFlagged={() => {
                    void queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
                  }}
                />
              </>
            )}
            {/* L3 unified header (2026-06-14): the phone-paired indicator and
                the completion pill are no longer header chips at any size. The
                phone status folds into the "..." overflow menu as a quiet
                "Phone linked" row, and completion lives in the calm
                "status . owner . sharing" subline below (the toggle stays
                reachable via the Details tab's own status control). This keeps
                the editorial title uncluttered at BOTH docked + fullscreen. */}
            {/* Icon-button rail — compact + neutral so the actions don't
                steal focus from the title. */}
            <div className="ml-1 flex items-center gap-0.5">
              {/* R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
                  Lifted the Edit affordance from the Properties card header
                  into the header action rail so editing dates/duration is
                  one click from popup-open instead of three. Always
                  visible (not gated on activeTab) so tour scripts that
                  click this immediately after mounting the popup still
                  work; clicking it from Notes/Method/Results swaps to
                  Details first. Uses a parent-state "pending enter edit"
                  flag (not a CustomEvent) so DetailsTab consumes the
                  signal once it mounts after the tab swap. Preserves the
                  `task-popup-edit-button` tour target.

                  L3 unified header (2026-06-14): these secondary actions
                  (Edit properties, Export, Deposit, Undo restore, Version
                  history, Share) fold into the single "..." overflow menu below
                  at BOTH docked + fullscreen, so they stop competing with the
                  editorial title. Each row keeps its EXACT handler +
                  data-tour-target / data-testid in the menu so tour scripts and
                  automation still find it. */}
              {/* VC Phase 3 (Task): version-history entry button. Shown to
                  anyone with read access (the popup only opens on readable
                  tasks). Toggles the right-sidebar version viewer; opening flips
                  the body to a read-only diff preview. Mirrors NoteDetailPopup.
                  Comments stays a PRIMARY header button at both sizes (its
                  unread badge stays); Version history now lives only in the
                  overflow menu (no docked twin) so its testid + trigger ref are
                  single-owned. */}
              {isExperiment && (
                <Tooltip label="Comments" placement="bottom">
                  <button
                    onClick={() => {
                      setCommentsOpen((open) => {
                        const next = !open;
                        if (next) setHistoryOpen(false);
                        return next;
                      });
                    }}
                    data-testid="task-comments-button"
                    aria-pressed={commentsOpen}
                    className={`relative p-1.5 rounded-lg transition-colors ${
                      commentsOpen
                        ? "text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10"
                        : "text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
                    </svg>
                    {commentCount > 0 ? (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-meta font-semibold text-white tabular-nums">
                        {commentCount}
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
              )}
              {/* L3 unified header (2026-06-14): the single "..." overflow menu,
                  now shown at BOTH docked + fullscreen. It folds the SECONDARY
                  header actions (Edit properties, Export, Deposit, Version
                  history, Undo restore, Share) plus the quiet "Phone linked"
                  status into one dismissable menu (Esc + outside-click close, no
                  focus trap) so they stop competing with the editorial title.
                  Each row keeps its EXACT handler + data-testid / data-tour-target.
                  The always-reachable exits (Done, the fullscreen toggle, the X)
                  and the primary Comments button stay OUTSIDE the menu, so folding
                  actions in here can never soft-lock the shell. */}
              {(
                <HeaderOverflowMenu label="More actions" testId="task-header-overflow">
                  {/* Save checkpoint (fullscreen-chrome slim). At fullscreen the
                      editor pill's "Save checkpoint" button is removed to keep
                      the Writing-Room pill minimal; it relocates here so a
                      permanent, revertible version save is still one click away.
                      Routes through the active tab's registered flush+save (the
                      SAME path the pill button used — flush the live buffer, then
                      write only when changed). Disabled when there's nothing to
                      save. Only shown at fullscreen and only for a writable
                      editor tab that reports save state (notes / results). */}
                  {isExpanded && !readOnly && ambientSaveState != null && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="task-header-save-checkpoint"
                      disabled={ambientSaveState !== "unsaved"}
                      onClick={() => {
                        void activeTabFlushSaveRef.current?.();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Icon name="check" className="w-4 h-4 text-foreground-muted" />
                      <span>
                        {ambientSaveState === "saving" ? "Saving..." : "Save checkpoint"}
                      </span>
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (activeTab !== "details") selectTab("details");
                        setPendingEnterEdit(true);
                      }}
                      data-tour-target="task-popup-edit-button"
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
                    >
                      <Icon name="pencil" className="w-4 h-4 text-foreground-muted" />
                      <span>Edit properties</span>
                    </button>
                  )}
                  {isExperiment && <TaskExportButton task={task} menuRow />}
                  {isExperiment && <TaskDepositButton task={task} menuRow />}
                  <button
                    type="button"
                    role="menuitem"
                    ref={historyTriggerRef}
                    onClick={() => {
                      if (historyOpen) {
                        closeHistory();
                      } else {
                        setCommentsOpen(false);
                        setHistoryOpen(true);
                      }
                    }}
                    data-testid="task-history-button"
                    aria-pressed={historyOpen}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
                  >
                    <Icon name="history" className="w-4 h-4 text-foreground-muted" />
                    <span>Version history</span>
                  </button>
                  {RESTORE_ENABLED &&
                    undoWindowActive &&
                    (canRestore || restoreNeedsUnlock) && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={
                          canRestore && !restoreBusy ? handleUndoRestore : undefined
                        }
                        disabled={!canRestore || restoreBusy}
                        data-testid="task-undo-restore-button"
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Icon name="undo" className="w-4 h-4" />
                        <span>{restoreBusy ? "Undoing..." : "Undo restore"}</span>
                      </button>
                    )}
                  {!readOnly && !task.is_shared_with_me && canShare && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setShowSharePopup(true)}
                      data-tour-target="task-popup-share-button"
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
                    >
                      <Icon name="share" className="w-4 h-4 text-foreground-muted" />
                      <span>Share</span>
                    </button>
                  )}
                  {phonePaired && !isPurchase && (
                    <HeaderOverflowLabel
                      icon={<Icon name="phone" className="h-3.5 w-3.5" />}
                    >
                      Phone linked
                    </HeaderOverflowLabel>
                  )}
                </HeaderOverflowMenu>
              )}
              {/* L3 ambient save state + plain Done, now shown at BOTH docked +
                  fullscreen (unified header). The indicator is HONEST: it
                  reflects the ACTIVE editor tab's own dirty/saving state (lifted
                  from the tab), and shows NOTHING for tabs that own their own
                  flow (Method / Order items) rather than a false "Saved". Done
                  flushes the active tab through its existing save then collapses
                  — one of three always-reachable exits (Done, the fullscreen
                  toggle, the X) so the shell is never soft-locked. */}
              {(
                <>
                  {ambientSaveState && (
                    <span
                      data-testid="task-ambient-save"
                      aria-live="polite"
                      aria-atomic="true"
                      className={`mr-1 inline-flex items-center gap-1.5 text-meta font-medium ${
                        ambientSaveState === "unsaved"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-foreground-muted"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${
                          ambientSaveState === "saving"
                            ? "bg-amber-400 animate-pulse"
                            : ambientSaveState === "unsaved"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                      />
                      {ambientSaveState === "saving"
                        ? "Saving..."
                        : ambientSaveState === "unsaved"
                          ? "Unsaved changes"
                          : "Saved"}
                    </span>
                  )}
                  <button
                    onClick={handleDone}
                    data-testid="task-done"
                    className="mr-1 px-3 py-1.5 text-meta font-medium rounded-lg bg-surface-sunken text-foreground hover:bg-foreground-muted/15 transition-colors"
                  >
                    Done
                  </button>
                </>
              )}
              <Tooltip label={isExpanded ? "Exit focus" : "Focus"} placement="bottom">
                <button
                  onClick={() => toggleExpanded()}
                  data-tour-target="task-popup-fullscreen"
                  aria-label={isExpanded ? "Exit focus" : "Focus"}
                  aria-pressed={isExpanded}
                  className="text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
                >
                  {isExpanded ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                  )}
                </button>
              </Tooltip>
              {!readOnly && (
                <Tooltip
                  label={
                    task.is_shared_with_me
                      ? `Only the owner (${task.owner}) can delete this task`
                      : "Delete task"
                  }
                  placement="bottom"
                >
                  <button
                    disabled={task.is_shared_with_me}
                    onClick={async () => {
                      if (confirm(`Delete task "${task.name}"?`)) {
                        try {
                          await tasksApi.delete(task.id);
                          onClose();
                          await Promise.all([
                            queryClient.refetchQueries({ queryKey: ["tasks"] }),
                            queryClient.refetchQueries({ queryKey: ["task"] }),
                          ]);
                          queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
                        } catch {
                          alert("Failed to delete task");
                        }
                      }
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      task.is_shared_with_me
                        ? "text-foreground-muted cursor-not-allowed"
                        : "text-foreground-muted hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Close (Esc)" placement="bottom">
                <button
                  onClick={onClose}
                  data-tour-target="task-popup-close"
                  className="text-foreground-muted hover:text-foreground hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Metadata zone — flag banner, assignee, sharing chips and the
            attribution stamps share ONE padded block with a single vertical
            rhythm (space-y-2) so they read as one quiet band under the header
            instead of four separately-padded strips with uneven gaps. Each
            element still renders/hides on its own condition; only the spacing
            is unified. Tour mounts still happen via each child's own
            data-tour-target / data-testid.
            PI Phase 3 flag banner + assignee, R1b sharing chips, and VCP R3
            attribution stamps (createdAt null until §3g) all live here. */}
        <div className="px-6 pt-2 space-y-2">
          {/* The flag banner is actionable + important, so it stays in EVERY
              state (never folded away). */}
          {task.flagged && (
            <FlagBanner
              flag={task.flagged}
              recordType="task"
              recordId={task.id}
              owner={task.owner}
              activeUser={currentUser}
              onCleared={() => {
                void queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
              }}
            />
          )}
          {/* L3 unified header (2026-06-14): ONE quiet "date · author · status ·
              sharing" subline at BOTH docked + fullscreen. It absorbs the former
              assignee/owner chips, the SharingChips row, AND the standalone
              attribution stamp ("Last edited by …"). The capabilities behind
              them stay reachable — the status pill + Save live on the Details
              tab, and Share lives in the "..." overflow menu — so nothing is
              lost, only quieted. Tasks carry no reliable created_at (the record
              is recomputed), so the date is the last-edited stamp. */}
          <p data-testid="task-meta-subline" className="text-meta text-foreground-muted">
            {[
              formatDate(task.last_edited_at || ""),
              task.last_edited_by || task.owner || "",
              task.is_complete ? "Complete" : "In progress",
              task.assignee && task.assignee !== task.owner
                ? `Assigned to ${task.assignee}`
                : "",
              (task.shared_with?.length ?? 0) > 0
                ? `Shared with ${task.shared_with!.length}`
                : task.is_shared_with_me
                  ? `Shared by ${task.owner}`
                  : "Private",
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>

        {/* Tabs — clean underline pattern with a quiet hover state. The old
            tabs sat on a gray strip with the active tab back on white,
            which read as a chrome leak from the header. Now they sit on
            the same surface as the header for a smoother seam. */}
        <div
          className={`flex items-stretch gap-1 px-6 ${
            isExpanded ? "" : "border-b border-border"
          }`}
          data-tour-target="experiment-tab-container"
          role="tablist"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                onClick={() => selectTab(tab)}
                data-tour-target={
                  tab === "method"
                    ? "experiment-methods-tab"
                    : tab === "notes"
                      ? "experiment-notes-tab"
                      : tab === "results"
                        ? "experiment-results-tab"
                        : undefined
                }
                className={`relative px-3.5 py-3 text-body font-medium transition-colors -mb-px ${
                  isActive
                    ? "text-blue-600 dark:text-blue-300"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab === "details" && "Details"}
                {tab === "notes" && "Lab Notes"}
                {tab === "method" && "Method"}
                {tab === "results" && "Results"}
                {tab === "purchases" && "Order items"}
                {/* R1 fix-pass: bumped from h-0.5 to h-1 and switched to
                    rounded-t-full so the active-tab indicator reads as an
                    intentional underline cap instead of a thin Material
                    rule. Stays subtle (no fill, no chrome change) but
                    visually punchier when scanning tabs. */}
                <span
                  aria-hidden
                  className={`absolute left-2 right-2 -bottom-px h-1 rounded-t-full transition-colors ${
                    isActive ? "bg-blue-500" : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* VC Phase 3 (Task): restore / undo-restore error + Case-C fallback
            message + the in-app undo confirm. Inline, non-blocking; clears on
            the next attempt. Mirrors NoteDetailPopup. */}
        {(restoreError || undoConfirmPending) && (
          <div className="px-6 pt-2">
            {restoreError && (
              <p
                data-testid="task-restore-error"
                className="text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
              >
                {restoreError}
              </p>
            )}
            {undoConfirmPending && (
              <div
                data-testid="task-undo-confirm"
                className="mt-2 text-meta text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
              >
                <p>
                  You have edited this experiment since the restore. Undoing will
                  discard those edits and return it to its pre-restore state.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void confirmUndoRestore()}
                    disabled={restoreBusy}
                    data-testid="task-undo-confirm-button"
                    className="px-2.5 py-1 text-meta font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-md transition-colors"
                  >
                    {restoreBusy ? "Undoing..." : "Discard edits and undo"}
                  </button>
                  <button
                    type="button"
                    onClick={dismissUndoConfirm}
                    disabled={restoreBusy}
                    data-testid="task-undo-cancel-button"
                    className="px-2.5 py-1 text-meta font-medium text-foreground-muted bg-surface-sunken hover:bg-foreground-muted/15 disabled:opacity-60 rounded-md transition-colors"
                  >
                    Keep editing
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab content (or, when the history sidebar is open, the in-place
            read-only diff for the selected version + the docked version
            sidebar). Wrapped in a flex-row so the sidebar docks right, mirroring
            NoteDetailPopup's editor-column + sidebar layout. */}
        <div className="flex-1 overflow-hidden flex flex-row min-h-0">
          <div className="flex-1 min-w-0 overflow-y-auto">
            {historyOpen ? (
              versionPreview ? (
                <div className="p-6" data-testid="task-version-diff-column">
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
              )
            ) : (
              <>
                {activeTab === "details" && (
                  <DetailsTab
                    task={task}
                    project={project}
                    onClose={onClose}
                    onAnimationTrigger={(pos) => setAnimationPosition(pos)}
                    onNavigateToTask={onNavigateToTask}
                    readOnly={readOnly}
                    pendingEnterEdit={pendingEnterEdit}
                    onConsumePendingEnterEdit={() => setPendingEnterEdit(false)}
                    onRegisterDirtyState={registerActiveTabDirtyState}
                    piActor={piActive && currentUser ? currentUser : undefined}
                  />
                )}
                {/* PI capability revamp: a confirmed PI edit makes these tabs
                    editable too. LabNotes/Results route to the member via their
                    Loro doc owner (task.owner) + the legacyOwner fallback, and
                    MethodTabs routes + audits via piActor. */}
                {activeTab === "notes" && <LabNotesTab task={task} readOnly={readOnly || (task.is_shared_with_me === true && task.shared_permission === "view")} ownerUsername={username} onRegisterFlushSave={registerActiveTabFlushSave} onRegisterAppendLine={registerActiveTabAppendLine} onRegisterDirtyState={registerActiveTabDirtyState} expanded={isExpanded} onRequestExpand={toggleExpanded} />}
                {activeTab === "method" && (
                  <MethodTabs
                    task={task}
                    onTaskUpdate={(updatedTask) => setTask(updatedTask)}
                    readOnly={readOnly}
                    piActor={piActive && currentUser ? currentUser : undefined}
                  />
                )}
                {activeTab === "results" && <ResultsTab task={task} readOnly={readOnly || (task.is_shared_with_me === true && task.shared_permission === "view")} ownerUsername={username} onRegisterFlushSave={registerActiveTabFlushSave} onRegisterAppendLine={registerActiveTabAppendLine} onRegisterDirtyState={registerActiveTabDirtyState} expanded={isExpanded} onRequestExpand={toggleExpanded} />}
                {activeTab === "purchases" && (
                  <PurchaseEditor
                    taskId={task.id}
                    readOnly={readOnly || piActive || (task.is_shared_with_me === true && task.shared_permission === "view")}
                    username={username ?? (task.is_shared_with_me ? task.owner : undefined)}
                    taskType={task.task_type}
                    // Existing readOnly gate only covers shared+VIEW. For
                    // shared+EDIT the editor is mounted writable, but
                    // purchasesApi.create/update/delete are current-user scoped
                    // (no owner arg), so writes would land items under the
                    // receiver's data dir at the shared task's numeric id —
                    // clobbering or orphaning items. isSharedWithMe disables the
                    // write affordances with an owner-aware Tooltip, mirroring
                    // the destructive-button gate at a87dfeb0.
                    isSharedWithMe={task.is_shared_with_me ?? false}
                    ownerLabel={task.is_shared_with_me ? task.owner : undefined}
                  />
                )}
              </>
            )}
          </div>

          {/* Version-history sidebar (docked right). Mounts only while open so
              the history file read happens on demand. The owner folder is the
              task's `owner` (the history file lives under
              users/<owner>/_history/task/<id>.jsonl); fall back to the signed-in
              user for a legacy task with an empty owner. */}
          {historyOpen && (
            <EntityVersionHistorySidebar
              entityType="task"
              id={task.id}
              owner={historyOwner}
              adapter={taskAdapter}
              onClose={closeHistory}
              onPreviewChange={setVersionPreview}
              // Live HEAD canonical: lets the engine resolve a bare-genesis
              // anchor (existing task -> first tracked edit) so every version
              // reconstructs + the diffs are non-empty.
              headCanonical={liveTaskCanonical}
              // The Restore footer only appears when the flag is ON, the viewer
              // can write the task, AND a non-HEAD version is selected (the
              // sidebar enforces the last condition).
              canRestore={RESTORE_ENABLED && canRestore}
              onRestore={handleRestore}
            />
          )}

          {/* Lab comments: now a docked right rail (mirrors NoteDetailPopup),
              mutually exclusive with the history sidebar. Experiments only;
              purchase/list tasks have no lab-comment use case in v1. */}
          {commentsOpen && isExperiment && (
            <CommentsSidebar count={commentCount} onClose={() => setCommentsOpen(false)}>
              <CommentsThread
                variant="sidebar"
                autoFocusComposer={initialCommentsOpen}
                entityKind="task"
                entityId={task.id}
                entityOwner={task.owner}
                comments={task.comments ?? []}
                isShared={(task.shared_with?.length ?? 0) > 0 || !!task.is_shared_with_me}
                notSharedHint="This task isn't shared with the lab. Share it to let lab mates comment."
                readOnly={readOnly || (task.is_shared_with_me === true && task.shared_permission === "view")}
                onAdd={async (text, author, options) => {
                  await tasksApi.addComment(task.id, text, author, options);
                  await Promise.all([
                    queryClient.refetchQueries({ queryKey: ["tasks"] }),
                    queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                  ]);
                }}
                onDelete={async (commentId) => {
                  await tasksApi.deleteComment(task.id, commentId);
                  await Promise.all([
                    queryClient.refetchQueries({ queryKey: ["tasks"] }),
                    queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                  ]);
                }}
              />
            </CommentsSidebar>
          )}
        </div>

        {universalDropToast && (
          <div
            className="fixed z-50 max-w-sm rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-surface-raised px-3 py-2 text-body text-emerald-900 dark:text-emerald-200 shadow-lg pointer-events-none flex items-center gap-2"
            style={{
              left: Math.max(8, Math.min(universalDropToast.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 400)),
              top: Math.max(8, Math.min(universalDropToast.y + 12, (typeof window !== "undefined" ? window.innerHeight : 768) - 100)),
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-300 flex-shrink-0" aria-hidden>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{universalDropToast.msg}</span>
          </div>
        )}
      </div>
    </LivingPopup>
    {/* PI capability revamp: the once-per-session confirm a lab head crosses
        before editing this member's task. LivingPopup portals itself. */}
    <PiEditConfirmDialog
      open={piGate.confirmDialogOpen}
      memberName={recordOwnerForGate}
      recordLabel={task.name ? `task ${task.name}` : "task"}
      onConfirm={piGate.confirmEdit}
      onCancel={piGate.cancelEdit}
    />
    {/* Share dialog. Now on LivingPopup itself, so it joins the shared popup
        stack (single dim, no double-scrim) and, rendered AFTER the host popup,
        paints above it by DOM order. No z-index wrapper needed. */}
    {showSharePopup && (
      <UnifiedShareDialog
        isOpen
        target={{ kind: "experiment", task, owner: task.owner }}
        onClose={() => setShowSharePopup(false)}
        onShared={() =>
          queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] })
        }
      />
    )}
    </>
  );
}

// ── Simple Task Checklist (for "list" task type) ──────────────────────────────

function SimpleTaskChecklist({
  task,
  onAnimationTrigger,
  readOnly = false,
  piActor,
}: {
  task: Task;
  onAnimationTrigger: (pos: { x: number; y: number }) => void;
  readOnly?: boolean;
  /** PI capability revamp: the lab head's username when editing this member's
      task on the role, so writes route to the owner + audit. */
  piActor?: string;
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(
    () => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined),
    [task, piActor],
  );
  // Initialize with task's sub_tasks immediately
  const [subTasks, setSubTasks] = useState<SubTask[]>(() => task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const [saving, setSaving] = useState(false);
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Sync subTasks state when task prop changes (e.g., after API refresh)
  useEffect(() => {
    setSubTasks(task.sub_tasks || []);
  }, [task.sub_tasks]);

  const handleToggleSubTask = useCallback(async (subTaskId: string, _event: React.MouseEvent) => {
    const checkbox = checkboxRefs.current.get(subTaskId);
    const rect = checkbox?.getBoundingClientRect();
    
    const updatedSubTasks = subTasks.map(st => 
      st.id === subTaskId ? { ...st, is_complete: !st.is_complete } : st
    );
    
    // If we're checking it (not unchecking), trigger animation
    const subTask = subTasks.find(st => st.id === subTaskId);
    if (subTask && !subTask.is_complete && rect) {
      onAnimationTrigger({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await Promise.all([
        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
      ]);
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient, onAnimationTrigger]);

  const handleAddSubTask = useCallback(async () => {
    if (!newSubTaskText.trim()) return;
    
    const newSubTask: SubTask = {
      id: `st-${Date.now()}`,
      text: newSubTaskText.trim(),
      is_complete: false,
    };
    
    const updatedSubTasks = [...subTasks, newSubTask];
    setSubTasks(updatedSubTasks);
    setNewSubTaskText("");
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task, tasksApi, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient]);

  return (
    <div className="p-3 flex-1 min-h-0 flex flex-col">
      {/* Sub-tasks list */}
      <div className="space-y-1 mb-2.5 flex-1 min-h-0 overflow-y-auto">
        {subTasks.map((st, idx) => (
          <div
            key={st.id}
            className={`flex items-center gap-2.5 group py-1.5 px-2.5 rounded-md hover:bg-surface-sunken transition-colors ${
              st.is_complete ? "opacity-50" : ""
            }`}
          >
            <Tooltip label={st.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
              <button
                ref={(el) => { if (el) checkboxRefs.current.set(st.id, el); }}
                onClick={readOnly ? undefined : (e) => handleToggleSubTask(st.id, e)}
                disabled={saving || readOnly}
                // Workbench expansion manager 2026-05-22 (§6.7b): the
                // first sub-task checkbox gets a render-scoped tour
                // anchor so the workbench-list-mark-done cursor demo
                // checks the same item every time. Re-stamped on
                // every render so a back-step lands on whatever item
                // is first now.
                data-tour-target={idx === 0 ? "workbench-list-item-checkbox" : undefined}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  st.is_complete
                    ? "bg-brand-action border-brand-action"
                    : "border-border hover:border-blue-400"
                } ${readOnly ? "cursor-default" : ""}`}
              >
                {st.is_complete && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </Tooltip>
            <span className={`flex-1 text-body ${st.is_complete ? "line-through text-foreground-muted" : "text-foreground"}`}>
              {st.text}
            </span>
            {!readOnly && (
              <Tooltip label="Delete item" placement="bottom">
                <button
                  onClick={() => handleDeleteSubTask(st.id)}
                  className="opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-500 dark:hover:text-red-300 transition-opacity"
                  data-force-hover-controls-target
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </Tooltip>
            )}
          </div>
        ))}
      </div>

      {/* Add new sub-task - hidden in readOnly mode */}
      {!readOnly && (
        <div className="flex gap-2 flex-shrink-0 pt-1">
          <input
            type="text"
            value={newSubTaskText}
            onChange={(e) => setNewSubTaskText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSubTask()}
            placeholder="Add item..."
            data-tour-target="workbench-list-add-item-input"
            className="flex-1 px-3 py-2 text-body border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <Tooltip label="Add item" placement="bottom">
            <button
              onClick={handleAddSubTask}
              disabled={!newSubTaskText.trim() || saving}
              className="px-3 py-2 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              +
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ── Property Grid (read-only view of the DetailsTab properties card) ─────────

/**
 * Read-only render of a task's core properties — name, project, type,
 * schedule, status, plus weekend-override / tags / deviation-log when
 * present. Mounted inside the DetailsTab "Properties" card when the user
 * is NOT in edit mode; the edit-mode branch right next to it uses the
 * same labels/order so the read↔edit transition reads as field-state
 * changes, not a layout swap.
 */
function PropertyGrid({
  task,
  project,
  hasDependencies,
}: {
  task: Task;
  project?: Project;
  hasDependencies: boolean;
}) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide">Project</dt>
          <dd className="text-body text-foreground mt-1">
            {project?.name || (task.is_shared_with_me ? `Shared project (by ${task.owner})` : "—")}
          </dd>
        </div>
        <div>
          <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide">Type</dt>
          <dd className="text-body text-foreground mt-1 capitalize">{task.task_type}</dd>
        </div>
        {!hasDependencies && (
          <>
            <div>
              <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide">Start</dt>
              <dd className="text-body text-foreground mt-1 font-mono">{task.start_date}</dd>
            </div>
            <div>
              <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide">End</dt>
              <dd className="text-body text-foreground mt-1 font-mono">{task.end_date}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide">Duration</dt>
          <dd className="text-body text-foreground mt-1">
            {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
          </dd>
        </div>
        {/* R1 fix-pass: Status pill now lives in the Properties card header
            row alongside the title — keeping it here as a labeled dl row
            would be a duplicate signal. */}
      </dl>
      {task.weekend_override && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-meta text-amber-800 dark:text-amber-200">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Weekend work enabled for this task.
        </div>
      )}
      {task.tags && task.tags.length > 0 && (
        <div>
          <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">Tags</dt>
          <div className="flex gap-1 flex-wrap">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {task.deviation_log && (
        <div>
          <dt className="text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
            Deviation log
          </dt>
          <div className="prose prose-sm prose-gray max-w-none bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/25 rounded-lg p-3">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
              {task.deviation_log}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Details Tab ──────────────────────────────────────────────────────────────

function DetailsTab({
  task,
  project,
  onClose,
  onAnimationTrigger,
  onNavigateToTask,
  readOnly = false,
  pendingEnterEdit = false,
  onConsumePendingEnterEdit,
  onRegisterDirtyState,
  piActor,
}: {
  task: Task;
  project?: Project;
  onClose: () => void;
  onAnimationTrigger?: (pos: { x: number; y: number }) => void;
  onNavigateToTask?: (task: Task) => void;
  readOnly?: boolean;
  /** R1 fix-pass: when the parent header's Edit button is clicked, this
      flips true. DetailsTab enters edit mode and calls the consumer to
      clear the flag. Lets the popup header's Edit affordance work even
      when activeTab !== 'details' at click time (tab swap + edit-mode
      transition both happen via this handshake). */
  pendingEnterEdit?: boolean;
  onConsumePendingEnterEdit?: () => void;
  /** L3: lift the in-card form dirty/saving state to the popup shell so the
      expanded shell's ambient indicator is honest. Only true while editing
      the Properties form; at rest the form is clean ("Saved"). */
  onRegisterDirtyState?: (state: { dirty: boolean; saving: boolean } | null) => void;
  /** PI capability revamp: set to the lab head's username when they are
      editing this member's task on the role (after the confirm), so writes
      route to the owner's folder + audit. */
  piActor?: string;
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(
    () => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined),
    [task, piActor],
  );
  const { currentUser } = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [projectId, setProjectId] = useState(task.project_id);
  // Composite "<owner>:<id>" identifier for the project the user has selected
  // in the edit-mode dropdown. Tracks BOTH own projects (where owner ===
  // current user → falls through to a normal project_id update) and foreign
  // projects (owner !== current user → triggers the cross-owner share flow).
  // null = "no project". See `selectedProjectInfo` below for the resolved
  // (owner, id) pair.
  const initialProjectKey = (() => {
    if (task.external_project) {
      return `${task.external_project.owner}:${task.external_project.id}`;
    }
    // Orphan tasks (created in the "Miscellaneous / standalone" slot)
    // persist with project_id 0 on disk (null is normalized to 0 in
    // local-api.ts) but the wire/transitional shape can also surface
    // literal null. Surface either as the standalone sentinel option
    // rather than a malformed "<owner>:null" composite key (which
    // would parse to NaN -> 0 downstream).
    if (task.project_id === null || task.project_id === 0) {
      return STANDALONE_FILTER_KEY;
    }
    return `${task.owner || currentUser || ""}:${task.project_id}`;
  })();
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>(initialProjectKey);
  // Cross-owner share confirmation modal state.
  const [pendingShareTarget, setPendingShareTarget] = useState<{
    owner: string;
    id: number;
    name: string;
  } | null>(null);
  const [sharingIntoProject, setSharingIntoProject] = useState(false);
  const [startDate, setStartDate] = useState(task.start_date);
  const [durationDays, setDurationDays] = useState(task.duration_days);
  const isComplete = task.is_complete;
  const [weekendOverride, setWeekendOverride] = useState<boolean | null>(task.weekend_override);
  // Snapshot of the values as they were when edit mode was entered. Used to
  // compute `hasUnsavedChanges` (so Save can be disabled when clean and we
  // can surface an "Unsaved changes" cue) and to restore on Cancel. Mirrors
  // the methods-editor pattern from commit e2f3bb39.
  const [originalValues, setOriginalValues] = useState({
    name: task.name,
    projectId: task.project_id,
    startDate: task.start_date,
    durationDays: task.duration_days,
    weekendOverride: task.weekend_override,
  });
  const [saving, setSaving] = useState(false);
  const [showShiftConfirm, setShowShiftConfirm] = useState(false);
  const [shiftResult, setShiftResult] = useState<ShiftResult | null>(null);
  const [pendingStartDate, setPendingStartDate] = useState<string | null>(null);
  
  // New dependency fields
  const [newParentTaskId, setNewParentTaskId] = useState<number | null>(null);
  const [newDepType, setNewDepType] = useState<"FS" | "SS" | "SF">("FS");
  const [showParentPicker, setShowParentPicker] = useState(false);
  
  // Sub-tasks state
  const [subTasks, setSubTasks] = useState<SubTask[]>(task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  
  // Remove from chain state
  const [showRemoveFromChain, setShowRemoveFromChain] = useState(false);
  const [removeStartDate, setRemoveStartDate] = useState(task.start_date);
  
  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  
  // Task type conversion state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertToType, setConvertToType] = useState<"experiment" | "purchase" | "list">("list");
  const [converting, setConverting] = useState(false);

  // Sync subTasks state when task prop changes (e.g., after API refresh)
  useEffect(() => {
    setSubTasks(task.sub_tasks || []);
  }, [task.sub_tasks]);

  // Sync selectedProjectKey when the task changes (e.g., right after a share
  // mutation invalidates and refetches). Without this the dropdown stays
  // stuck on stale state.
  useEffect(() => {
    if (task.external_project) {
      setSelectedProjectKey(`${task.external_project.owner}:${task.external_project.id}`);
    } else if (task.project_id === null || task.project_id === 0) {
      setSelectedProjectKey(STANDALONE_FILTER_KEY);
    } else {
      setSelectedProjectKey(`${task.owner || currentUser || ""}:${task.project_id}`);
    }
  }, [task.external_project, task.project_id, task.owner, currentUser]);

  // Whether the user has typed/changed anything since entering edit mode.
  // Drives the Save button's disabled state and the "Unsaved changes" label
  // — without this, the only edit-mode cue is a subtle focus ring on whichever
  // field has focus, which the user can lose by tabbing to a button.
  const hasUnsavedChanges =
    editing &&
    (name !== originalValues.name ||
      projectId !== originalValues.projectId ||
      selectedProjectKey !== initialProjectKey ||
      startDate !== originalValues.startDate ||
      durationDays !== originalValues.durationDays ||
      weekendOverride !== originalValues.weekendOverride);

  // L3: lift the Properties-form dirty/saving up to the popup shell so the
  // expanded shell's ambient indicator is honest on the Details tab. Same
  // hasUnsavedChanges/saving the in-card Save button uses; clears on unmount.
  useEffect(() => {
    onRegisterDirtyState?.({ dirty: hasUnsavedChanges, saving });
    return () => onRegisterDirtyState?.(null);
  }, [onRegisterDirtyState, hasUnsavedChanges, saving]);

  // Enter edit mode: snapshot current values as the baseline so Cancel
  // restores them and hasUnsavedChanges has a stable reference.
  const handleEnterEdit = useCallback(() => {
    setOriginalValues({
      name: task.name,
      projectId: task.project_id,
      startDate: task.start_date,
      durationDays: task.duration_days,
      weekendOverride: task.weekend_override,
    });
    setName(task.name);
    setProjectId(task.project_id);
    setSelectedProjectKey(initialProjectKey);
    setStartDate(task.start_date);
    setDurationDays(task.duration_days);
    setWeekendOverride(task.weekend_override);
    setEditing(true);
  }, [task, initialProjectKey]);

  // R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
  // Consume the pending-enter-edit handshake from the popup header's
  // Edit button. Runs on every render — when the flag is true and
  // we're not already editing, enter edit mode and clear the flag.
  // The parent handles the tab swap separately (selectTab("details"))
  // so by the time DetailsTab mounts this effect fires immediately.
  useEffect(() => {
    if (!pendingEnterEdit || editing) return;
    handleEnterEdit();
    onConsumePendingEnterEdit?.();
  }, [pendingEnterEdit, editing, handleEnterEdit, onConsumePendingEnterEdit]);

  // Cancel: restore baseline values then leave edit mode. Without resetting
  // the in-memory form state, re-entering edit would resurrect dirty edits.
  const handleCancelEdit = useCallback(() => {
    setName(originalValues.name);
    setProjectId(originalValues.projectId);
    setSelectedProjectKey(initialProjectKey);
    setStartDate(originalValues.startDate);
    setDurationDays(originalValues.durationDays);
    setWeekendOverride(originalValues.weekendOverride);
    setEditing(false);
  }, [originalValues, initialProjectKey]);

  // Load projects for the dropdown. Pulls own + cross-owner shared projects
  // so users can host a task into someone else's project (Option C — see
  // `lib/sharing/project-hosting.ts`). The select element distinguishes them
  // by encoding the value as `<owner>:<id>` so per-user id collisions don't
  // cause the wrong project to be picked.
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "with-shared"],
    queryFn: fetchAllProjectsIncludingShared,
    enabled: editing,
  });

  // Resolve the selected dropdown value back to a (owner, id) pair. The
  // standalone sentinel resolves to (owner: "", id: 0) which the save
  // path translates into project_id null below (mirroring TaskModal's
  // `projectId === 0 -> null` rule).
  const selectedProjectInfo = useMemo(() => {
    if (selectedProjectKey === STANDALONE_FILTER_KEY) {
      return { owner: "", id: 0 };
    }
    const [owner, rawId] = selectedProjectKey.split(":");
    const id = Number(rawId);
    return { owner: owner ?? "", id: Number.isFinite(id) ? id : 0 };
  }, [selectedProjectKey]);

  // Whose-project-is-this-anyway sentinel. Drives the save flow's
  // "share into project" vs "regular project_id update" branch. The
  // standalone option is never foreign (it has no owner; reassignment
  // simply nulls project_id on the current task).
  const isSelectedProjectForeign = useMemo(() => {
    if (!currentUser) return false;
    if (selectedProjectKey === STANDALONE_FILTER_KEY) return false;
    // The task's own owner. For shared-with-me tasks (receiver editing),
    // that's the owner field; for own tasks it's the current user.
    const taskOwner = task.owner || currentUser;
    return selectedProjectInfo.owner && selectedProjectInfo.owner !== taskOwner;
  }, [currentUser, task.owner, selectedProjectInfo.owner, selectedProjectKey]);

  // Load all tasks for dependency display
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  // Load dependencies
  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies"],
    queryFn: () => dependenciesApi.list(),
  });

  // Namespace scoping for the dependency chain (Grant 2026-05-28).
  // Dependency records are stored per-user with namespace-local ids (the
  // Dependency type has no owner field; parent_id / child_id reference
  // the CURRENT user's own task ids). For a shared-in experiment the
  // owner's dependency graph lives in the OWNER's namespace, which this
  // viewer never has loaded, so the viewer's `dependencies` are simply
  // the wrong data. Because matching is by bare numeric id, a per-user
  // id collision then renders the VIEWER's chain inside the foreign
  // experiment: opening @beakerbot's "Make some coffee together" showed
  // @Test's Fake A -> First Experiment -> Fake B with "First Experiment
  // (this task)". Scope to empty for shared-in tasks so no bogus chain
  // renders; owned tasks keep the full list.
  //
  // Robustness (Grant 2026-05-28 followup, still repro'd): rely on owner
  // mismatch in addition to the is_shared_with_me flag. The tour spawns
  // "Make some coffee together" in BeakerBot's namespace and delivers it
  // via _shared_with_me.json, but the loaded task object did not always
  // carry is_shared_with_me=true, so the flag-only gate missed it. A
  // task whose `owner` is set and differs from the current user is
  // foreign-owned regardless of the flag. Own tasks (owner unset or ===
  // currentUser) keep their chain.
  const isForeignOwnedTask =
    task.is_shared_with_me ||
    (!!task.owner && !!currentUser && task.owner !== currentUser);
  const scopedDependencies = isForeignOwnedTask ? [] : dependencies;

  // Find dependencies for this task
  const taskDependencies = scopedDependencies.filter(d => d.child_id === task.id);
  const dependentTasks = scopedDependencies.filter(d => d.parent_id === task.id);

  // Get parent task names. Resolve only against own-namespace tasks
  // (!is_shared_with_me): the dep's parent_id is a current-user id, so a
  // shared-in task that happens to share that numeric id must not be
  // pulled in (same per-user id-collision class as the chain bug above).
  const parentTasks = taskDependencies
    .map(dep => allTasks.find(t => t.id === dep.parent_id && !t.is_shared_with_me))
    .filter(Boolean) as Task[];

  // Get child task names (own-namespace only, same rationale).
  const childTasks = dependentTasks
    .map(dep => allTasks.find(t => t.id === dep.child_id && !t.is_shared_with_me))
    .filter(Boolean) as Task[];

  // Check if task has any dependencies
  const hasDependencies = parentTasks.length > 0 || childTasks.length > 0;

  // Available tasks to add as parent (exclude self, existing parents, and non-experiment tasks)
  // Only experiment tasks can participate in dependencies
  const availableParentTasks = allTasks.filter(t => 
    t.id !== task.id && 
    !taskDependencies.some(d => d.parent_id === t.id) &&
    t.task_type === "experiment"
  );

  // Check if this task can have dependencies (only experiments)
  const canHaveDependencies = task.task_type === "experiment";

  // Calculate suggested start date based on selected parent
  const selectedNewParent = availableParentTasks.find(t => t.id === newParentTaskId);
  const suggestedNewStartDate = useMemo(() => {
    if (!selectedNewParent) return startDate;
    
    const parentEnd = new Date(selectedNewParent.end_date);
    const parentStart = new Date(selectedNewParent.start_date);
    
    if (newDepType === "FS") {
      parentEnd.setDate(parentEnd.getDate() + 1);
      return parentEnd.toISOString().split("T")[0];
    } else if (newDepType === "SS") {
      return selectedNewParent.start_date;
    } else if (newDepType === "SF") {
      // SF strict-gap (dep semantics manager 2026-05-27): child finishes
      // strictly before parent starts, so child.end = parent.start - 1
      // and child.start = parent.start - duration. Matches GanttChart's
      // dialog handler + the engine's shift.ts SF branch.
      const newStart = new Date(parentStart);
      newStart.setDate(newStart.getDate() - durationDays);
      return newStart.toISOString().split("T")[0];
    }
    return startDate;
  }, [selectedNewParent, newDepType, durationDays, startDate]);

  const handleSave = useCallback(async () => {
    // Cross-owner share branch: if the user picked a foreign project from
    // the dropdown, defer to the confirmation modal. The modal owns the
    // actual `tasksApi.shareIntoProject` call so the user can back out
    // ("share into someone else's project" is a meaningful surface).
    if (isSelectedProjectForeign) {
      const target = projects.find(
        (p) => p.owner === selectedProjectInfo.owner && p.id === selectedProjectInfo.id
      );
      if (!target) {
        // Defensive: the selected project disappeared between dropdown
        // open and save. Bail out of the share branch and revert the picker.
        setSelectedProjectKey(initialProjectKey);
        return;
      }
      setPendingShareTarget({
        owner: target.owner,
        id: target.id,
        name: target.name,
      });
      return;
    }

    setSaving(true);
    try {
      // Check for duplicate name if name has changed
      if (name.trim() !== task.name) {
        try {
          const duplicateCheck = await tasksApi.checkDuplicate(projectId, name.trim(), task.task_type, task.id);
          if (duplicateCheck.has_duplicate) {
            setDuplicateWarning(duplicateCheck);
            setSaving(false);
            return;
          }
        } catch (error) {
          console.error("Failed to check for duplicates:", error);
          // Continue with save if check fails
        }
      }
      
      // Check if start date changed and task has dependents
      // Skip start date check if task has parent dependencies (date is determined by dependency)
      const shouldCheckDateChange = parentTasks.length === 0 && startDate !== task.start_date;
      
      if (shouldCheckDateChange && dependentTasks.length > 0) {
        // Try to move with confirmation check
        const result = await tasksApi.move(task.id, {
          new_start_date: startDate,
          confirmed: false,
        });
        
        if (result.requires_confirmation) {
          setShiftResult(result);
          setPendingStartDate(startDate);
          setShowShiftConfirm(true);
          setSaving(false);
          return;
        }
        
        // No confirmation needed, apply the move
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      } else {
        // Regular update - don't send start_date if task has parent dependencies.
        // Mirror TaskModal's `projectId === 0 -> null` rule so picking the
        // Standalone (no project) option in the dropdown nulls project_id
        // on disk, matching the orphan-task representation other code
        // already expects.
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId === 0 ? null : projectId,
          task_type: task.task_type,
          duration_days: durationDays,
          is_complete: isComplete,
          weekend_override: weekendOverride,
        };
        
        // Only include start_date if task doesn't have parent dependencies
        if (parentTasks.length === 0) {
          updateData.start_date = startDate;
        }
        
        await tasksApi.update(task.id, updateData);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      }
      // Refresh the baseline so a subsequent edit cycle (without remounting
      // the popup) compares against the just-saved values, not stale ones.
      setOriginalValues({
        name: name.trim(),
        projectId,
        startDate,
        durationDays,
        weekendOverride,
      });
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length, isSelectedProjectForeign, projects, selectedProjectInfo, initialProjectKey]);

  // Cross-owner share confirmation flow. Triggered by `handleSave` when the
  // user picked a project owned by someone else; the modal is the actual
  // commit point. `pendingShareTarget` carries the destination project
  // info; clearing it cancels.
  const handleConfirmShareIntoProject = useCallback(async () => {
    if (!pendingShareTarget || !currentUser) return;
    setSharingIntoProject(true);
    try {
      // The task owner is the only legal `taskOwner` for v1 — receivers
      // can't reshare a task they don't own. Defensive null-guard.
      const taskOwner = task.owner || currentUser;
      await rawTasksApi.shareIntoProject(
        taskOwner,
        task.id,
        pendingShareTarget.owner,
        pendingShareTarget.id
      );
      // Refresh both the task itself and the tasks/projects lists. Hosted
      // tasks surface through `fetchAllTasksIncludingShared`, so that key
      // must invalidate too.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
        queryClient.refetchQueries({ queryKey: ["projects"] }),
        queryClient.refetchQueries({ queryKey: ["projects", "with-shared"] }),
      ]);
      setPendingShareTarget(null);
      setEditing(false);
    } catch (err) {
      console.error("Failed to share task into project:", err);
      alert(
        err instanceof Error && err.message
          ? `Failed to share: ${err.message}`
          : "Failed to share task into project"
      );
    } finally {
      setSharingIntoProject(false);
    }
  }, [pendingShareTarget, currentUser, task, queryClient]);

  // Function to proceed with save despite duplicate warning
  const handleProceedWithDuplicate = useCallback(async () => {
    setDuplicateWarning(null);
    setSaving(true);
    try {
      // Check if start date changed and task has dependents
      const shouldCheckDateChange = parentTasks.length === 0 && startDate !== task.start_date;
      
      if (shouldCheckDateChange && dependentTasks.length > 0) {
        const result = await tasksApi.move(task.id, {
          new_start_date: startDate,
          confirmed: false,
        });
        
        if (result.requires_confirmation) {
          setShiftResult(result);
          setPendingStartDate(startDate);
          setShowShiftConfirm(true);
          setSaving(false);
          return;
        }
        
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      } else {
        // Mirror handleSave: standalone option (projectId 0) nulls out
        // project_id on disk so the task lands in the orphan bucket.
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId === 0 ? null : projectId,
          task_type: task.task_type,
          duration_days: durationDays,
          is_complete: isComplete,
          weekend_override: weekendOverride,
        };
        
        if (parentTasks.length === 0) {
          updateData.start_date = startDate;
        }
        
        await tasksApi.update(task.id, updateData);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      }
      // Refresh the baseline so a subsequent edit cycle compares against the
      // just-saved values.
      setOriginalValues({
        name: name.trim(),
        projectId,
        startDate,
        durationDays,
        weekendOverride,
      });
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length]);

  const handleConfirmShift = useCallback(async () => {
    if (!pendingStartDate) return;
    setSaving(true);
    try {
      await tasksApi.move(task.id, {
        new_start_date: pendingStartDate,
        confirmed: true,
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      setShowShiftConfirm(false);
      setShiftResult(null);
      setPendingStartDate(null);
      // Refresh the baseline after the shift-confirmed save lands.
      setOriginalValues({
        name: name.trim(),
        projectId,
        startDate: pendingStartDate,
        durationDays,
        weekendOverride,
      });
      setEditing(false);
    } catch {
      alert("Failed to move task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, pendingStartDate, queryClient, name, projectId, durationDays, weekendOverride]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    try {
      await tasksApi.delete(task.id);
      // Close popup immediately after successful deletion
      onClose();
      // Invalidate all task-related queries
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task"] });
      queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete task");
    }
  }, [task, tasksApi, queryClient, onClose]);

  // Handle adding a new dependency
  const handleAddDependency = useCallback(async () => {
    if (!newParentTaskId) return;
    setSaving(true);
    try {
      // Create the dependency
      await dependenciesApi.create({
        parent_id: newParentTaskId,
        child_id: task.id,
        dep_type: newDepType,
      });
      
      // Update the task's start date based on dependency type
      await tasksApi.update(task.id, {
        start_date: suggestedNewStartDate,
      });
      
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      setNewParentTaskId(null);
      setNewDepType("FS");
    } catch {
      alert("Failed to add dependency");
    } finally {
      setSaving(false);
    }
  }, [newParentTaskId, task, tasksApi, newDepType, suggestedNewStartDate, queryClient]);

  // Build the ordered dependency chain for the tree visualization
  // Returns an array of "levels" - each level contains tasks that start at the same time
  // Tasks at the same level should be displayed horizontally (parallel)
  // Different levels should be displayed vertically (sequential)
  const buildDependencyChain = useCallback((): Task[][] => {
    // Shared-in / foreign-owned experiments have no viewer-side chain
    // (see scopedDependencies rationale above); return empty so the
    // Dependency-chain section never renders a foreign / colliding graph.
    if (isForeignOwnedTask) return [];

    // First, collect all tasks in the dependency graph
    const chainTasks = new Set<number>();
    const visited = new Set<number>();

    // Helper to find all tasks in the chain (both upstream and downstream)
    const collectChainTasks = (taskId: number) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      chainTasks.add(taskId);

      // Add parents (tasks this depends on)
      const parentDeps = scopedDependencies.filter(d => d.child_id === taskId);
      for (const dep of parentDeps) {
        collectChainTasks(dep.parent_id);
      }

      // Add children (tasks that depend on this)
      const childDeps = scopedDependencies.filter(d => d.parent_id === taskId);
      for (const dep of childDeps) {
        collectChainTasks(dep.child_id);
      }
    };

    // Collect all tasks in this chain
    collectChainTasks(task.id);

    // Get all tasks in the chain with their data. Own-namespace only
    // (!is_shared_with_me): chain ids are current-user ids, so a shared-in
    // task with a colliding numeric id must not be pulled into the chain.
    const tasksInChain = allTasks.filter(
      (t) => chainTasks.has(t.id) && !t.is_shared_with_me,
    );
    
    // Group tasks by start date
    const tasksByStartDate = new Map<string, Task[]>();
    for (const t of tasksInChain) {
      const existing = tasksByStartDate.get(t.start_date) || [];
      existing.push(t);
      tasksByStartDate.set(t.start_date, existing);
    }
    
    // Sort the dates and create levels
    const sortedDates = Array.from(tasksByStartDate.keys()).sort();
    const levels: Task[][] = sortedDates.map(date => {
      // Sort tasks within a level by name for consistent ordering
      return (tasksByStartDate.get(date) || []).sort((a, b) => a.name.localeCompare(b.name));
    });
    
    return levels;
  }, [task.id, isForeignOwnedTask, allTasks, scopedDependencies]);

  // Get the ordered chain levels
  const dependencyChainLevels = useMemo(() => buildDependencyChain(), [buildDependencyChain]);

  // Handle "Remove from dependency chain" checkbox
  const handleRemoveFromChain = useCallback(async () => {
    if (!showRemoveFromChain) return;
    
    setSaving(true);
    try {
      // Find and delete all dependencies for this task
      const depsToDelete = dependencies.filter(
        d => d.parent_id === task.id || d.child_id === task.id
      );
      
      for (const dep of depsToDelete) {
        await dependenciesApi.delete(dep.id);
      }
      
      // Update the task's start date
      await tasksApi.update(task.id, { start_date: removeStartDate });
      
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      setShowRemoveFromChain(false);
    } catch (err) {
      console.error("Failed to remove from chain:", err);
      alert("Failed to remove from dependency chain");
    } finally {
      setSaving(false);
    }
  }, [showRemoveFromChain, task, tasksApi, removeStartDate, dependencies, queryClient]);

  // Sub-task handlers
  const handleToggleSubTask = useCallback(async (subTaskId: string, _event: React.MouseEvent) => {
    const checkbox = checkboxRefs.current.get(subTaskId);
    const rect = checkbox?.getBoundingClientRect();
    
    const updatedSubTasks = subTasks.map(st => 
      st.id === subTaskId ? { ...st, is_complete: !st.is_complete } : st
    );
    
    // If we're checking it (not unchecking), trigger animation
    const subTask = subTasks.find(st => st.id === subTaskId);
    if (subTask && !subTask.is_complete && rect && onAnimationTrigger) {
      onAnimationTrigger({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient, onAnimationTrigger]);

  const handleAddSubTask = useCallback(async () => {
    if (!newSubTaskText.trim()) return;
    
    const newSubTask: SubTask = {
      id: `st-${Date.now()}`,
      text: newSubTaskText.trim(),
      is_complete: false,
    };
    
    const updatedSubTasks = [...subTasks, newSubTask];
    setSubTasks(updatedSubTasks);
    setNewSubTaskText("");
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task, tasksApi, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient]);

  // Handle task type conversion
  const handleConvertTaskType = useCallback(async () => {
    setConverting(true);
    try {
      await tasksApi.convertType(task.id, convertToType);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
      ]);
      setShowConvertModal(false);
    } catch (error) {
      console.error("Failed to convert task type:", error);
      alert("Failed to convert task type");
    } finally {
      setConverting(false);
    }
  }, [task, tasksApi, convertToType, queryClient]);

  // Get warning message for task type conversion
  const getConversionWarnings = useCallback((fromType: string) => {
    const warnings: string[] = [];
    
    if (fromType === "experiment") {
      warnings.push("Linked methods and their PCR data will be removed");
      warnings.push("Deviation log will be cleared");
      warnings.push("Experiment color will be removed");
    }
    if (fromType === "purchase") {
      warnings.push("All purchase items will be permanently deleted");
    }
    if (fromType === "list") {
      warnings.push("All sub-tasks will be cleared");
    }
    
    return warnings;
  }, []);

  // Get available conversion types
  const availableConversionTypes = useMemo(() => {
    const types: { value: "experiment" | "purchase" | "list"; label: string }[] = [];
    if (task.task_type !== "experiment") {
      types.push({ value: "experiment", label: "Experiment" });
    }
    if (task.task_type !== "purchase") {
      types.push({ value: "purchase", label: "Purchase" });
    }
    if (task.task_type !== "list") {
      types.push({ value: "list", label: "List" });
    }
    return types;
  }, [task.task_type]);

  return (
    <div className="p-6 space-y-5">
      {/* Duplicate Warning Modal — surfaced as a high-priority callout above
          the form so the user can pick a path before scrolling. Same
          chrome family as FlagBanner / shift-confirm / convert-type:
          tinted card with semantic accent. */}
      {duplicateWarning && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600 dark:text-rose-300">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-body font-semibold text-rose-900 dark:text-rose-200">
                Duplicate task name
              </h4>
              <p className="text-meta text-rose-800 dark:text-rose-200 mt-0.5">
                A task with this name already exists in this project:
              </p>
              <ul className="mt-2 space-y-1">
                {duplicateWarning.matching_tasks.map((t) => (
                  <li key={t.id} className="text-meta text-rose-800 dark:text-rose-200 flex items-center gap-2 bg-surface-raised border border-rose-100 dark:border-rose-500/25 rounded-lg px-2 py-1">
                    <strong className="text-rose-900 dark:text-rose-200">{t.name}</strong>
                    <span className="text-rose-500 dark:text-rose-300">
                      Started {t.start_date} · {t.is_complete ? "Completed" : "In Progress"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDuplicateWarning(null)}
                  className="px-3 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
                >
                  Change name
                </button>
                <button
                  onClick={handleProceedWithDuplicate}
                  className="px-3 py-1.5 text-meta font-medium text-rose-700 dark:text-rose-300 ring-1 ring-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-lg transition-colors"
                >
                  Save anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Type Conversion Modal — destructive action; matches the
          tinted-callout chrome. */}
      {showConvertModal && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600 dark:text-rose-300">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-body font-semibold text-rose-900 dark:text-rose-200">
                Convert task type
              </h4>
              <p className="text-meta text-rose-800 dark:text-rose-200 mt-0.5">
                Converting from <strong className="capitalize">{task.task_type}</strong> will permanently delete type-specific data:
              </p>
              <ul className="mt-2 space-y-1 text-meta text-rose-700 dark:text-rose-300">
                {getConversionWarnings(task.task_type).map((warning, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1 w-1 h-1 rounded-full bg-rose-400 flex-shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              <p className="text-meta text-rose-800 dark:text-rose-200 mt-3">
                <strong>Kept:</strong> name, dates, duration, project, completion status, and tags.
              </p>
              <div className="mt-3">
                <label className="block text-meta font-medium text-rose-700 dark:text-rose-300 uppercase tracking-wide mb-1">
                  Convert to
                </label>
                <select
                  value={convertToType}
                  onChange={(e) => setConvertToType(e.target.value as "experiment" | "purchase" | "list")}
                  className="w-full px-3 py-2 bg-surface-raised border border-rose-200 dark:border-rose-500/30 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {availableConversionTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setShowConvertModal(false)}
                  className="px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConvertTaskType}
                  disabled={converting}
                  className="px-3 py-1.5 text-meta font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {converting ? "Converting..." : "Convert task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tasks Section - only for list type tasks */}
      {task.task_type === "list" && (
        <section className="bg-surface-raised border border-border rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h4 className="text-title font-semibold text-foreground">Sub-tasks</h4>
            {subTasks.length > 0 && (
              <span className="text-meta text-foreground-muted">
                {subTasks.filter(st => st.is_complete).length} of {subTasks.length} complete
              </span>
            )}
          </div>
          
          {/* Progress bar */}
          {subTasks.length > 0 && (
            <div className="mb-3">
              <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                {/* R1 fix-pass: orange→yellow gradient leaked the legacy
                    sub-task palette into the new blue-centric chrome. Flat
                    blue matches the rest of the popup. */}
                <div
                  className="h-full bg-brand-action transition-all duration-300"
                  style={{ width: `${(subTasks.filter(st => st.is_complete).length / subTasks.length) * 100}%` }}
                />
              </div>
            </div>
          )}
          
          {/* Sub-tasks list */}
          <div className="space-y-1.5 mb-3">
            {subTasks.map((st, idx) => (
              <div
                key={st.id}
                className={`flex items-center gap-2 group py-1.5 px-2 rounded-lg hover:bg-surface-raised transition-colors ${
                  st.is_complete ? "opacity-60" : ""
                }`}
              >
                <Tooltip label={st.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
                  <button
                    ref={(el) => { if (el) checkboxRefs.current.set(st.id, el); }}
                    onClick={(e) => handleToggleSubTask(st.id, e)}
                    disabled={saving}
                    // Workbench expansion manager 2026-05-22 (§6.7b):
                    // render-scoped first-item anchor — same shape as
                    // the SubTasksTab variant above so whichever tab the
                    // list task opens on, the first checkbox is
                    // reachable by the workbench-list-mark-done cursor.
                    data-tour-target={idx === 0 ? "workbench-list-item-checkbox" : undefined}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      st.is_complete
                        ? "bg-brand-action border-brand-action"
                        : "border-border hover:border-blue-400"
                    }`}
                  >
                    {st.is_complete && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
                <span className={`flex-1 text-body ${st.is_complete ? "line-through text-foreground-muted" : "text-foreground"}`}>
                  {st.text}
                </span>
                <Tooltip label="Delete sub-task" placement="bottom">
                  <button
                    onClick={() => handleDeleteSubTask(st.id)}
                    className="opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-500 dark:hover:text-red-300 transition-opacity"
                    data-force-hover-controls-target
                    aria-label="Delete sub-task"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>

          {/* Add new sub-task */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newSubTaskText}
              onChange={(e) => setNewSubTaskText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddSubTask()}
              placeholder="Add a sub-task..."
              data-tour-target="workbench-list-add-item-input"
              className="flex-1 px-3 py-1.5 text-body border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleAddSubTask}
              disabled={!newSubTaskText.trim() || saving}
              className="px-3 py-1.5 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </section>
      )}

      {/* Shift Confirmation Modal */}
      {showShiftConfirm && shiftResult && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700 dark:text-amber-300">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-body font-semibold text-amber-900 dark:text-amber-200">
                This change will affect {shiftResult.affected_tasks.length} task{shiftResult.affected_tasks.length !== 1 ? "s" : ""}
              </h4>
              <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
                {shiftResult.affected_tasks.map((t) => (
                  <div key={t.task_id} className="text-meta text-amber-800 dark:text-amber-200 flex items-center gap-2 bg-surface-raised border border-amber-100 dark:border-amber-500/25 rounded-lg px-2 py-1">
                    <strong className="text-amber-900 dark:text-amber-200">{t.name}</strong>
                    <span className="text-amber-600 dark:text-amber-300">{t.old_start} → {t.new_start}</span>
                  </div>
                ))}
              </div>
              {shiftResult.warnings.length > 0 && (
                <div className="mt-3 border-t border-amber-200 dark:border-amber-500/30 pt-3">
                  <p className="text-meta font-medium text-rose-700 dark:text-rose-300 mb-1">Warnings</p>
                  <ul className="text-meta text-rose-600 dark:text-rose-300 space-y-1">
                    {shiftResult.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setShowShiftConfirm(false);
                    setShiftResult(null);
                    setPendingStartDate(null);
                  }}
                  className="px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-raised rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmShift}
                  disabled={saving}
                  className="px-3 py-1.5 text-meta font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? "Applying..." : "Apply changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dependency Tree Section */}
      {hasDependencies && (
        <section className="bg-surface-raised border border-border rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h4 className="text-title font-semibold text-foreground">Dependency chain</h4>
            <span className="text-meta text-foreground-muted">
              {dependencyChainLevels.flat().length} task{dependencyChainLevels.flat().length !== 1 ? "s" : ""} linked
            </span>
          </div>
          
          {/* Levels-based chain - tasks at same level shown horizontally */}
          <div className="flex flex-col items-center">
            {dependencyChainLevels.map((levelTasks, levelIndex) => {
              const isMultiTaskLevel = levelTasks.length > 1;
              
              return (
                <div key={`level-${levelIndex}`} className="flex flex-col items-center">
                  {/* Connector line above (except for first level) */}
                  {levelIndex > 0 && (
                    <div className="flex items-center justify-center w-full mb-2">
                      {isMultiTaskLevel ? (
                        // Multiple connectors for parallel tasks
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-0.5 bg-border" />
                          <svg width="16" height="16" viewBox="0 0 16 16" className="text-foreground-muted">
                            <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                          </svg>
                          <div className="w-8 h-0.5 bg-border" />
                        </div>
                      ) : (
                        <div className="w-0.5 h-4 bg-gradient-to-b from-gray-300 to-gray-400" />
                      )}
                    </div>
                  )}
                  
                  {/* Tasks at this level - horizontal if multiple */}
                  <div className={`flex items-center gap-3 ${isMultiTaskLevel ? 'flex-wrap justify-center' : ''}`}>
                    {levelTasks.map((chainTask) => {
                      const isCurrentTask = chainTask.id === task.id;
                      
                      return (
                        <div key={chainTask.id} className="relative">
                          {/* Task node */}
                          {/* R1 fix-pass: softened the current-task node from
                              solid-fill blue with offset ring to a tinted
                              callout matching the calmer status-pill pattern
                              elsewhere in the popup. Loud "you are here"
                              styling was competing visually with the
                              actionable nodes around it. */}
                          <div
                            className={`relative px-4 py-2 rounded-lg text-body transition-all ${
                              isCurrentTask
                                ? "bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-100 font-medium ring-1 ring-blue-200 dark:ring-blue-400/50"
                                : "bg-surface-raised text-foreground border border-border hover:border-blue-400 hover:shadow-md cursor-pointer hover:bg-blue-50 dark:hover:bg-brand-action/10"
                            }`}
                            onClick={() => {
                              if (!isCurrentTask && onNavigateToTask) {
                                onNavigateToTask(chainTask);
                              }
                            }}
                            title={!isCurrentTask ? `Click to view: ${chainTask.name}` : undefined}
                          >
                            <span className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${isCurrentTask ? "bg-blue-500" : "bg-foreground-muted"}`} />
                              <span className="max-w-[200px] truncate">{chainTask.name}</span>
                              {isCurrentTask && (
                                <span className="text-meta opacity-75">(this task)</span>
                              )}
                              {!isCurrentTask && onNavigateToTask && (
                                <svg className="w-3 h-3 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Connector line below (except for last level) */}
                  {levelIndex < dependencyChainLevels.length - 1 && (
                    <div className="flex items-center justify-center w-full mt-2">
                      {(() => {
                        const nextLevel = dependencyChainLevels[levelIndex + 1];
                        const nextIsMulti = nextLevel.length > 1;
                        if (nextIsMulti) {
                          return (
                            <div className="flex items-center gap-4">
                              <div className="w-8 h-0.5 bg-border" />
                              <svg width="16" height="16" viewBox="0 0 16 16" className="text-foreground-muted">
                                <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                              </svg>
                              <div className="w-8 h-0.5 bg-border" />
                            </div>
                          );
                        }
                        return <div className="w-0.5 h-4 bg-gradient-to-b from-gray-400 to-gray-300" />;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Remove-from-chain action lives in the chain viewer (the surface
              where users reason about the chain), not buried inside the
              Properties edit form. Gated on hasDependencies (the section
              itself only renders when a chain exists), so the checkbox
              never shows without a chain to remove from. */}
          <div className="mt-5 pt-4 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showRemoveFromChain}
                onChange={(e) => {
                  setShowRemoveFromChain(e.target.checked);
                  if (e.target.checked) {
                    setRemoveStartDate(task.start_date);
                  }
                }}
                className="w-4 h-4 text-red-500 dark:text-red-300 border-border rounded focus:ring-red-500"
              />
              <span className="text-body text-red-600 dark:text-red-300 font-medium">
                Remove from dependency chain
              </span>
            </label>

            {showRemoveFromChain && (
              <div className="mt-3 pl-6 space-y-2">
                <p className="text-meta text-foreground-muted">
                  This task will become standalone. Set its new start date:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={removeStartDate}
                    onChange={(e) => setRemoveStartDate(e.target.value)}
                    className="px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveFromChain}
                    disabled={saving}
                    className="px-3 py-1.5 text-meta text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                  >
                    {saving ? "Removing..." : "Remove from Chain"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Properties card — single section that toggles between read-only
          rows and inline editable inputs. Same shape in both modes so the
          read↔edit transition reads as a state change on the same fields,
          not a layout swap (the old "Edit / Exit edit mode" pattern flipped
          the whole layout out from under the user). */}
      <section className="bg-surface-raised border border-border rounded-xl overflow-hidden">
        {/* R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
            Dropped the "Name, project, schedule, and other fields" subtitle
            — "Properties" already says that. Surface the completion-status
            pill in the same row so the read-only header carries actual
            signal instead of filler. Edit affordance lifted to the popup
            header rail (Edit pencil there now); Cancel/Save still live
            here because they're scoped to the in-card form state. */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <h4 className="text-title font-semibold text-foreground">Properties</h4>
            {!editing && (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-meta font-medium ${
                  task.is_complete
                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300"
                }`}
              >
                <span
                  aria-hidden
                  className={`w-1.5 h-1.5 rounded-full ${task.is_complete ? "bg-emerald-500" : "bg-blue-500"}`}
                />
                {task.is_complete ? "Complete" : "In progress"}
              </span>
            )}
            {editing && (
              <span className="text-meta text-foreground-muted">Editing, save when done</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <span className="inline-flex items-center gap-1 text-meta text-amber-700 dark:text-amber-300 font-medium">
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}
            {editing && (
              <>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  data-tour-target="task-popup-save-button"
                  className={`px-3 py-1.5 text-meta font-medium rounded-lg transition-colors ${
                    hasUnsavedChanges && !saving
                      ? "text-white bg-brand-action hover:bg-brand-action/90"
                      : "text-foreground-muted bg-surface-sunken cursor-not-allowed"
                  }`}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-5">
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-tour-target="task-popup-name-input"
              className="w-full px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Project — own projects appear normally; cross-owner shared
              projects appear under "Share into…" and trigger a confirmation
              modal on save. */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
              Project
            </label>
            <select
              value={selectedProjectKey}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedProjectKey(next);
                // Standalone sentinel: drop the task off any project
                // (project_id null). Mirrors TaskModal's `projectId === 0
                // -> null` rule by storing 0 in the legacy projectId
                // state, then translating to null in handleSave.
                if (next === STANDALONE_FILTER_KEY) {
                  setProjectId(0);
                  return;
                }
                // Keep the legacy projectId state in sync for own-project
                // picks so handleSave's existing `tasksApi.update` call
                // gets the right id. Foreign picks branch off in handleSave.
                const [nextOwner, nextRawId] = next.split(":");
                const nextId = Number(nextRawId);
                if (nextOwner === (task.owner || currentUser || "")) {
                  setProjectId(Number.isFinite(nextId) ? nextId : 0);
                }
              }}
              className="w-full px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <optgroup label="My projects">
                {projects
                  .filter((p) => !p.is_shared_with_me)
                  .map((p) => (
                    <option key={`${p.owner}:${p.id}`} value={`${p.owner}:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                {/* Standalone / orphan option (project_id null). Reassigning
                    here is the user-facing way to drop a task off any
                    project, or to lift an orphan out of the standalone
                    bucket once the user picks a real project. */}
                <option value={STANDALONE_FILTER_KEY}>
                  Standalone (no project)
                </option>
              </optgroup>
              {projects.some((p) => p.is_shared_with_me) && (
                <optgroup label="Share into someone else's project">
                  {projects
                    .filter((p) => p.is_shared_with_me)
                    .map((p) => (
                      <option key={`${p.owner}:${p.id}`} value={`${p.owner}:${p.id}`}>
                        {p.name} (shared by {p.owner})
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            {isSelectedProjectForeign && (
              <p className="mt-1 text-meta text-amber-600 dark:text-amber-300">
                This task will be shared into {selectedProjectInfo.owner}&apos;s project.
                It stays in your library; {selectedProjectInfo.owner} will see it on their Gantt.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Hide start date field if task has parent dependencies */}
            {parentTasks.length === 0 && (
              <div>
                <label className="block text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {dependentTasks.length > 0 && startDate !== task.start_date && (
                  <p className="text-meta text-amber-600 dark:text-amber-300 mt-1 inline-flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" aria-hidden>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Will shift {dependentTasks.length} dependent task(s)
                  </p>
                )}
              </div>
            )}
            <div className={parentTasks.length > 0 ? "col-span-2" : ""}>
              <label className="block text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
                Duration (days)
              </label>
              <input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Add Dependency Section - only for experiment tasks */}
          {canHaveDependencies && (
            <div className="border-t border-border pt-4">
              <label className="block text-meta font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Add Dependency (optional)
              </label>
              <div className="space-y-2">
                {selectedNewParent ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border border-border rounded-lg bg-surface-raised text-body">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">
                        {selectedNewParent.name}
                      </span>
                      <span className="text-meta text-foreground-muted shrink-0">
                        {selectedNewParent.start_date} → {selectedNewParent.end_date}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewParentTaskId(null)}
                      className="text-meta text-foreground-muted hover:text-foreground-muted shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowParentPicker(true)}
                    disabled={availableParentTasks.length === 0}
                    className="w-full text-left px-3 py-2 border border-dashed border-border rounded-lg text-body text-foreground-muted hover:border-blue-400 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {availableParentTasks.length === 0
                      ? "No eligible experiments to depend on"
                      : "Select an experiment this depends on…"}
                  </button>
                )}

                {newParentTaskId && (
                  <>
                    <select
                      value={newDepType}
                      onChange={(e) => setNewDepType(e.target.value as "FS" | "SS" | "SF")}
                      className="w-full px-3 py-2 border border-border rounded-lg text-body transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="FS">Start after (after parent ends)</option>
                      <option value="SS">Start at same time (as parent)</option>
                      <option value="SF">Finish before (parent starts)</option>
                    </select>
                    
                    {/* R1 fix-pass: re-skinned to the new tinted-callout
                        family (matches the weekend-override amber card +
                        Duplicate/Convert/Shift callouts) instead of the
                        legacy orange. Same amber semantic = "heads-up,
                        confirm before applying". */}
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3">
                      <p className="text-meta text-amber-800 dark:text-amber-200">
                        <strong>New Start Date:</strong> {suggestedNewStartDate}
                      </p>
                      <p className="text-meta text-amber-700 dark:text-amber-300 mt-1">
                        {newDepType === "FS" && `Will start after "${selectedNewParent?.name}" ends`}
                        {newDepType === "SS" && `Will start at same time as "${selectedNewParent?.name}"`}
                        {newDepType === "SF" && `Will finish when "${selectedNewParent?.name}" starts`}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddDependency}
                      disabled={saving}
                      className="px-3 py-1.5 text-meta text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Adding..." : "Add Dependency"}
                    </button>
                  </>
                )}
              </div>
              <TaskPicker
                open={showParentPicker}
                availableTasks={availableParentTasks}
                currentProjectId={task.project_id}
                title="Add dependency"
                placeholder="Search experiments by name or #tag…"
                onSelect={(id) => {
                  setNewParentTaskId(id);
                  setShowParentPicker(false);
                }}
                onClose={() => setShowParentPicker(false)}
              />
            </div>
          )}

          {/* Weekend Override - only show if project is not 7-day */}
          {(() => {
            const taskProject = projects.find(p => p.id === projectId);
            const is7DayProject = taskProject?.weekend_active ?? false;
            if (is7DayProject) return null;
            return (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={weekendOverride === true}
                    onChange={(e) => setWeekendOverride(e.target.checked ? true : null)}
                    className="w-4 h-4 text-amber-600 dark:text-amber-300 border-amber-300 rounded focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="text-body text-amber-800 dark:text-amber-200 font-medium">
                      I&apos;m okay with working on the weekend
                    </span>
                    <p className="text-meta text-amber-600 dark:text-amber-300 mt-0.5">
                      By default, tasks that span weekends show weekend days as non-working. 
                      Check this to indicate you plan to work on weekends.
                    </p>
                  </div>
                </label>
              </div>
            );
          })()}

        </div>
      ) : (
        <PropertyGrid
          task={task}
          project={project}
          hasDependencies={hasDependencies}
        />
      )}
        </div>
      </section>

      {/* Footer actions — Convert / Delete moved out of the floating top
          row so they aren't competing with the primary "Edit" affordance.
          Mounted on a quiet divider so they read as administrative
          actions, not part of the field flow. */}
      {!readOnly && !editing && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={() => {
              setConvertToType(availableConversionTypes[0]?.value || "list");
              setShowConvertModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground-muted hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            Convert type
          </button>
          {/* R1 fix-pass: wrap the footer Delete button with the Tooltip
              component instead of the native `title=` attribute, which is
              functionally invisible per the project's tooltip rule (see
              memory: "Use the Tooltip component, not title="). The header
              Delete (line ~1041) already does this correctly. */}
          <Tooltip
            label={task.is_shared_with_me ? `Only the owner (${task.owner}) can delete this task` : "Delete this task"}
            placement="top"
          >
            <button
              disabled={task.is_shared_with_me}
              onClick={handleDelete}
              data-tour-target="task-popup-delete-button"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg transition-colors ${
                task.is_shared_with_me
                  ? "text-foreground-muted cursor-not-allowed"
                  : "text-foreground-muted hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete task
            </button>
          </Tooltip>
        </div>
      )}

      {/* Cross-owner share confirmation modal. Triggered by `handleSave`
          when the user picked a project owned by someone else. The modal
          is the actual commit point — picking the dropdown option doesn't
          share, confirming here does. Fullscreen overlay so it sits above
          the popup card. */}
      {pendingShareTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          // Marker for TourSpotlight (popup-occluding sweep manager,
          // 2026-05-27).
          data-tour-popup-occluding="task-detail-share-confirm"
          onClick={() => {
            if (!sharingIntoProject) setPendingShareTarget(null);
          }}
        >
          <div
            className="bg-surface-raised rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-300">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-title font-semibold text-foreground">
                  Share into {pendingShareTarget.owner}&apos;s project?
                </h3>
                <p className="text-body text-foreground-muted mt-0.5">
                  <strong>{pendingShareTarget.name}</strong> belongs to{" "}
                  <strong>{pendingShareTarget.owner}</strong>.
                </p>
              </div>
            </div>
            <ul className="text-body text-foreground space-y-2 mb-4 bg-surface-sunken rounded-lg p-3 border border-border">
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-300 mt-0.5 flex-shrink-0" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  The task <strong>stays in your library</strong> — you remain its owner.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-300 mt-0.5 flex-shrink-0" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  {pendingShareTarget.owner} sees it on their Gantt next to their own tasks.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-300 mt-0.5 flex-shrink-0" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Either of you can remove the share later.</span>
              </li>
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={sharingIntoProject}
                onClick={() => setPendingShareTarget(null)}
                className="px-4 py-2 text-body font-medium text-foreground hover:bg-surface-sunken rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sharingIntoProject}
                onClick={handleConfirmShareIntoProject}
                className="px-4 py-2 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50"
              >
                {sharingIntoProject ? "Sharing..." : "Share into project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lab Notes Tab (with LiveMarkdownEditor) ──────────────────────────────────

function LabNotesTab({ task, readOnly = false, ownerUsername, onRegisterFlushSave, onRegisterAppendLine, onRegisterDirtyState, expanded = false, onRequestExpand }: { task: Task; readOnly?: boolean; ownerUsername?: string; onRegisterFlushSave?: (fn: (() => Promise<void>) | null) => void; onRegisterAppendLine?: (fn: ((line: string) => void) | null) => void; onRegisterDirtyState?: (state: { dirty: boolean; saving: boolean } | null) => void; expanded?: boolean; onRequestExpand?: () => void }) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const { currentUser } = useCurrentUser();
  // The device's own directory email (canonical), used to SIGN collab requests
  // when the experiment is shared. Null when this device has no sharing identity
  // (collab then stays live-only). Mirrors NoteDetailPopup.
  const { email: myDirectoryEmail } = useSharingIdentity();

  // ── Experiment-collab chunk 1: Loro wiring for the Lab Notes doc ──────────
  // One handle per (owner, task, "notes") surface; opened once, closed on task
  // identity change or unmount. Null when the flag is off or the async open is
  // in flight / failed. Mirrors NoteDetailPopup's loroHandle / loroOpenFailed.
  const [loroHandle, setLoroHandle] = useState<TaskDocHandle | null>(null);
  const [loroOpenFailed, setLoroOpenFailed] = useState(false);
  // The task owner is the doc owner for the collab path (where the sidecar
  // lives). Falls back to currentUser for an unowned local task.
  const loroOwner = task.owner || currentUser || "";
  const collabRef = task.id != null ? { owner: loroOwner, id: task.id } : null;

  // Publish the device's directory email to the lazy collab signer so the
  // sync hooks can sign Neon requests. Reactive: becomes available as soon as
  // the sharing identity sidecar loads.
  useEffect(() => {
    setCollabSignerEmail(myDirectoryEmail);
  }, [myDirectoryEmail]);

  // Live-collab session (flag-gated). useCollabSession is called
  // unconditionally (Rules of Hooks) but stays idle when the flag is off or the
  // handle is null. For the same-user MVP the collaborator is currentUser.
  const collab = useCollabSession({
    doc: loroHandle?.doc ?? null,
    enabled: LORO_PILOT_ENABLED,
    owner: loroOwner || undefined,
    collaboratorUsername: currentUser ?? undefined,
  });
  const collabActive = LORO_PILOT_ENABLED && collab.state.status === "live";
  // Cursor identity for this peer: signed-in name + a deterministic color
  // derived from the doc's peer id. Stable after the handle opens.
  const collabUser = useMemo(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) return undefined;
    return {
      name: currentUser ?? "collaborator",
      colorClassName: peerColorClass(loroHandle.doc.peerIdStr),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle?.doc.peerIdStr, currentUser]);

  // Open / close the Loro handle when the task identity changes. No-op when the
  // flag is off. On open failure the editor falls back to the legacy disk-load
  // surface (loroHandle stays null, so no Loro props are passed).
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!collabRef) return;

    let active = true;
    setLoroOpenFailed(false);

    openTaskDoc(collabRef, "notes", currentUser ?? undefined)
      .then((handle) => {
        if (!active) return;
        setLoroHandle(handle);
      })
      .catch((err) => {
        console.error("[LabNotesTab] Loro openTaskDoc failed:", err);
        if (active) setLoroOpenFailed(true);
      });

    return () => {
      active = false;
      setLoroHandle((prev) => {
        if (prev) void prev.close();
        return null;
      });
    };
    // Keyed on task identity + owner only (one handle per task notes surface).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.owner, currentUser]);

  // While the handle is still opening (flag on, not yet ready, not failed) we
  // hold the editor on the existing `loading` placeholder below by ORing this
  // into the loading gate, so CM6 only mounts once its final mode (Loro vs
  // legacy) is known. Mounting before the handle arrives would build the editor
  // in legacy mode and never switch (its mount effect runs once).
  const loroOpening =
    LORO_PILOT_ENABLED && loroHandle === null && !loroOpenFailed;

  // Auto-save status parity with the Notes pilot (experiment-collab follow-up).
  // Mirrors NoteDetailPopup's loroCommitPending: tracks whether a debounced
  // commit is queued or in flight so the Saving/Saved pill stays accurate. Only
  // meaningful when the pilot flag is on and the handle is open; false (settled)
  // otherwise. subscribeCommitPending fires immediately with the current value
  // so the pill initialises without a one-frame flash.
  const [loroCommitPending, setLoroCommitPending] = useState(false);
  useEffect(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) {
      setLoroCommitPending(false);
      return;
    }
    return loroHandle.subscribeCommitPending(setLoroCommitPending);
  }, [loroHandle]);

  // Auto-connect to the live session when a SHARED experiment opens. A shared
  // task has a collab_doc_id in its Loro meta (minted by grant-on-share on the
  // sharer's side, carried by the bundle on import). Mirrors NoteDetailPopup's
  // connectFromDocId effect, including the import-bootstrap from task.collab_doc_id.
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (collab.state.status !== "idle") return;

    let docId = getCollabDocId(loroHandle.doc);

    // Bootstrap: a freshly-imported task has collab_doc_id in its JSON but not
    // yet in the Loro sidecar. Seed the meta map with that exact id so the
    // sidecar derives the same relay room as the sharer.
    if (!docId && task.collab_doc_id) {
      loroHandle.doc.getMap("meta").set("collab_doc_id", task.collab_doc_id);
      loroHandle.doc.commit({ message: "seed-collab-doc-id-from-import" });
      docId = task.collab_doc_id;
    }

    if (!docId) return; // unshared experiment, nothing to do

    collab.connectFromDocId(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, collab.state.status, task.collab_doc_id]);

  // ── Piece 5: mint + grant collab_doc_id when the experiment is shared ─────
  // The Share dialog lives at the popup level and only refetches the task on
  // success, so it never has the Lab Notes LoroDoc to mint against. This effect
  // closes that gap the same way NoteDetailPopup handles shared-notebook notes:
  // when the handle is open AND the task is shared with anyone, mint the id into
  // the task notes sidecar (if absent) and grant the shared members on the
  // server, then auto-connect.
  //
  // grantCollabOnShare is entity-agnostic (operates on a LoroDoc + the shared
  // lists) and the server grant route is keyed purely on docId + emails, so the
  // task notes doc reuses the exact same path notes use -- NO task-specific
  // server route is needed.
  //
  // Re-share on member growth: the effect must NOT bail out just because a
  // collab_doc_id already exists. An already-collaborative experiment that gains
  // a NEW member needs grantCollabOnShare to run again so the durable Neon grant
  // (grantCollabMember) fires for that member; the live relay session is a
  // capability derived from the shared docId and would work regardless, but
  // without the durable grant the member's membership is never persisted
  // server-side. We track the membership we last granted in a ref and re-fire
  // with previousSharedWith/nextSharedWith so grantCollabOnShare's diff grants
  // ONLY the newly-added members (and skips the owner re-grant, since
  // previousSharedWith is non-empty on growth). A plain reopen (doc id already
  // present, membership unchanged) still short-circuits to the auto-connect
  // effect above.
  //
  // Idempotent: getOrMintCollabDocId only mints when absent, and the server
  // accepts duplicate grants silently.
  //
  // FLAG (data-shape): writes collab_doc_id into the task notes Loro meta map
  // (the sidecar under the owner's folder). Same key + semantics notes use.
  const grantedSharedWithRef = useRef<SharedUser[] | null>(null);
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (!currentUser) return;
    if (collab.state.status !== "idle") return;
    const sharedWith = task.shared_with ?? [];
    if (sharedWith.length === 0) return; // not shared, nothing to mint

    const alreadyCollab = !!getCollabDocId(loroHandle.doc);
    // First run for this handle: seed the "already granted" baseline. If the doc
    // is already collaborative (prior share or imported with a collab_doc_id),
    // treat its current members as already granted so a plain reopen does not
    // re-grant them; only genuine growth re-fires. A brand-new share starts from
    // an empty baseline so grantCollabOnShare runs its first-share path.
    if (grantedSharedWithRef.current === null) {
      grantedSharedWithRef.current = alreadyCollab ? sharedWith : [];
    }

    const previousSharedWith = grantedSharedWithRef.current;
    const prevUsernames = new Set(previousSharedWith.map((s) => s.username));
    const grew = sharedWith.some((s) => !prevUsernames.has(s.username));
    // Already collaborative and no new members: the auto-connect effect handles
    // the live connect; nothing to grant.
    if (alreadyCollab && !grew) return;

    grantedSharedWithRef.current = sharedWith;

    void grantCollabOnShare({
      doc: loroHandle.doc,
      ownerEmail: myDirectoryEmail ?? "",
      // Diff against the membership we last granted so only the newly-added
      // members are registered on the server (and the owner is granted only on
      // the very first share, when previousSharedWith is empty).
      previousSharedWith,
      nextSharedWith: sharedWith,
    }).then((docId) => {
      if (docId && collab.state.status === "idle") {
        collab.connectFromDocId(docId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, task.shared_with, currentUser]);

  // Imperative flush handle published by the embedded editor. Calling it
  // commits the editor's in-flight block buffer, fires onChange, and returns
  // the freshest full-document string, so the popup "Save notes" button can
  // persist the very latest edit even if the user never left the active block.
  const editorSaveRef = useRef<(() => string) | null>(null);
  // Mirrors the editor's in-flight buffer-dirty flag. Because the editor
  // buffers keystrokes and only flushes to `content` on commit, `content`
  // (and thus hasUnsavedChanges) lags while the user is mid-block. We OR this
  // into the Save button's enabled state so the button lights up the instant
  // typing starts, not only after a block switch.
  const [editorDirty, setEditorDirty] = useState(false);
  // Holds the draft captured by `useDraftPersistence`'s onRestore until the
  // disk load below finishes. Pattern: onRestore fires on mount BEFORE the
  // async disk read resolves, so we can't set `content` directly (the disk
  // load would race past us). Instead we stash the draft here; the loader
  // checks the ref after `originalContent` is set, and if a draft exists,
  // promotes it to `content`. The originalContent stays as the disk value
  // so `hasUnsavedChanges = content !== originalContent` correctly flags
  // the restored draft as dirty (and the Save button enables).
  const pendingDraftRef = useRef<string | null>(null);

  // LabArchives-import rehydration banner state. Populated by an
  // _import_source.json probe; banner is rendered iff `missing.length > 0`
  // AND the current user owns the task (receivers can't rehydrate someone
  // else's import — see comment on the render site for the gating rule).
  const [missingInline, setMissingInline] = useState<MissingInlineImage[] | null>(null);
  const [rehydrateModalOpen, setRehydrateModalOpen] = useState(false);
  // Bumped after a successful apply so the markdown body re-reads from
  // disk (the rehydrate helper rewrites `Images/missing-…` refs in place).
  const [rehydrateReloadKey, setRehydrateReloadKey] = useState(0);

  // Resolved lazily: the per-user path is canonical, but if legacy global
  // `results/task-{id}/` is the only one with data we read from there until
  // the owner triggers a one-time copy (see resolveTaskResultsBase).
  //
  // `outerBase`: directory holding notes.md + results.md + the NotesPDFs/
  // and ResultsPDFs/ panels. Per-tab scoped attachments live one level
  // deeper (`outerBase/notes` and `outerBase/results`).
  // `attachBase`: where Files/ + Images/ for THIS tab resolve. In normal
  // operation == `outerBase/notes`; falls back to `outerBase` (legacy
  // shared layout) when the tab folder hasn't been populated yet.
  const legacyOwner = ownerUsername || task.owner;
  const [outerBase, setOuterBase] = useState<string>(() => taskResultsBase(task));
  const [attachBase, setAttachBase] = useState<string>(() => taskNotesBase(task));
  const notesPath = `${outerBase}/notes.md`;
  const pdfsDir = `${outerBase}/NotesPDFs`;
  const tabBase = useMemo(() => `${outerBase}/notes`, [outerBase]);
  const inLegacyAttachMode = attachBase === outerBase;
  // Markdown embed hybrid P7-1a: the per-document embed-pins sidecar for the Lab
  // Notes doc. Pinning freezes a block embed here so the editor renders the frozen
  // snapshot and offers Pin / Unpin. Only wired when editable, a read-only viewer
  // gets no pin control (a missing context renders embeds live, unchanged).
  const embedPinContext = useMemo(
    () =>
      readOnly
        ? undefined
        : { sidecarPath: `${outerBase}/notes.ros-embeds.json` },
    [outerBase, readOnly],
  );

  // Look up the project name so a fresh notes.md gets a real project in its
  // stamp instead of "Unknown Project". Reuses the same query key as the
  // export button (`TaskExportButton`).
  const { data: stampProject } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  // SPA-nav-safe draft persistence. Notes-tab content is persisted to
  // sessionStorage on every keystroke (debounced inside the hook). A
  // refresh / nav-link click / accidental tab close re-mounts this tab and
  // the draft is auto-restored on top of the freshly-loaded disk content.
  // Per-user + per-task-owner + per-task-id key so two browsers logged in
  // as different users never share a draft.
  const notesDraftKey = `researchos:draft:task-notes:${currentUser ?? ""}:${task.owner}:${task.id}`;
  const { clearDraft: clearNotesDraft } = useDraftPersistence(
    notesDraftKey,
    content,
    hasUnsavedChanges,
    {
      onRestore: (saved) => {
        if (typeof saved !== "string" || saved.length === 0) return;
        // Stash the draft until the disk load resolves — applying it
        // directly here would race against the async loader below and
        // get overwritten by `setContent(stampNormalizedContent)`.
        pendingDraftRef.current = saved;
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = currentUser
          ? await resolveTaskResultsBase({ id: task.id, owner: task.owner }, currentUser)
          : taskResultsBase({ id: task.id, owner: task.owner });
        if (cancelled) return;
        setOuterBase(resolved);
        // Lazy fallback for the attachment base. Default to the per-tab
        // scoped folder; if that's empty and legacy shared `Files/`+`Images/`
        // exist at the outer base, read from there until the next write or
        // the Settings split button migrates them.
        const resolvedAttach = await resolveTabAttachmentBase(
          { id: task.id, owner: task.owner },
          "notes",
          resolved
        );
        if (cancelled) return;
        setAttachBase(resolvedAttach);
        const resolvedNotes = `${resolved}/notes.md`;
        const file = await filesApi.readFile(resolvedNotes);
        const raw = file.content;
        if (readOnly) {
          if (!cancelled) {
            setContent(raw);
            setOriginalContent(raw);
            setLoading(false);
          }
          return;
        }
        // Lazy-migrate any legacy `Attachments/` content into `Files/` on the
        // owner's first read. Cheap no-op if the folder doesn't exist.
        // Operates on the OUTER base — the per-tab split is deferred to
        // either the Settings repair button or the next write (see
        // `ensureAttachmentsSplit` below).
        const attachMig = await migrateTaskAttachmentsToFiles(resolved, raw);
        const startContent = attachMig.contentRewritten ? attachMig.content : raw;
        const { content: migrated, didMigrate } = await migrateNoteImages(startContent, task.id, resolved, legacyOwner);
        // Lazy-normalize legacy stamp formats so the rendered preview stops
        // leaking the `[stamp-end]: # (hidden)` marker as visible text.
        const stampNormalizedContent = hasLegacyStampFormat(migrated)
          ? normalizeStampFormat(migrated)
          : migrated;
        const stampDidNormalize = stampNormalizedContent !== migrated;
        if (didMigrate || attachMig.contentRewritten || stampDidNormalize) {
          await filesApi.writeFile(resolvedNotes, stampNormalizedContent, `Migrate image references for: ${task.name}`);
        }
        if (!cancelled) {
          setOriginalContent(stampNormalizedContent);
          // Promote a pending SPA-nav draft on top of the disk content if
          // one was captured by useDraftPersistence's onRestore. The
          // draft was persisted while the user was actively typing, so
          // it's strictly newer than the disk content; promoting it
          // recovers the in-flight work. If no draft exists (or the
          // draft text equals the disk content already) we fall through
          // to the normal disk-baseline path.
          const pending = pendingDraftRef.current;
          pendingDraftRef.current = null;
          if (pending && pending !== stampNormalizedContent) {
            setContent(pending);
          } else {
            setContent(stampNormalizedContent);
          }
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        const projectName = stampProject?.name ?? "Unknown Project";
        const newContent = createNewFileContent(task.name, projectName, 'notes');
        setOriginalContent(newContent);
        const pending = pendingDraftRef.current;
        pendingDraftRef.current = null;
        setContent(pending && pending !== newContent ? pending : newContent);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.name, task.owner, task.project_id, currentUser, legacyOwner, readOnly, stampProject?.name, rehydrateReloadKey]);

  // LabArchives import sidecar probe. Drives the rehydration banner: a
  // non-zero `missing` count surfaces a callout above the editor letting
  // the owner pull the still-online images in via the same 3-tab UI the
  // wizard's step 5 uses. Re-runs on `rehydrateReloadKey` bumps so the
  // count refreshes after a successful apply.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await readMissingInlineImageCount(attachBase);
        if (cancelled) return;
        setMissingInline(probe ? probe.missing : []);
      } catch {
        if (!cancelled) setMissingInline([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachBase, rehydrateReloadKey]);

  // Warn before navigating away (F5 / tab close) with unsaved changes. SPA
  // route changes are NOT covered by beforeunload — the draft-persistence
  // hook above handles that case by surviving the remount.
  useUnsavedChangesGuard(hasUnsavedChanges);

  // L3: lift this tab's dirty/saving state up to the popup shell so the
  // expanded shell's ambient indicator is HONEST (it reflects the SAME
  // hasUnsavedChanges/editorDirty/saving the in-tab Save button uses — no new
  // state, no autosave). editorDirty covers the mid-block buffer so the shell
  // flips to "Unsaved changes" the instant typing starts. Clears to null on
  // unmount so a non-reporting tab (Method / Order items) shows no save claim.
  useEffect(() => {
    onRegisterDirtyState?.({ dirty: hasUnsavedChanges || editorDirty, saving });
    return () => onRegisterDirtyState?.(null);
  }, [onRegisterDirtyState, hasUnsavedChanges, editorDirty, saving]);

  // When the tab is in legacy attach mode (shared `Files/`+`Images/` at the
  // outer base), perform the split-on-write migration so new drops land in
  // the per-tab scoped folder and refs stay self-contained. Returns the
  // post-migration notes content so callers can use it as their next
  // `setContent` baseline. No-op when already on the scoped folder.
  const ensureAttachmentsSplit = useCallback(
    async (
      latestContent: string
    ): Promise<{ notesContent: string; migrated: boolean }> => {
      if (!inLegacyAttachMode) {
        return { notesContent: latestContent, migrated: false };
      }
      // Read the OTHER tab's body off disk — the user might not have opened
      // it during this session.
      let otherContent = "";
      try {
        const f = await filesApi.readFile(`${outerBase}/results.md`);
        otherContent = f.content;
      } catch {
        otherContent = "";
      }
      const split = await splitTaskAttachments(
        { id: task.id, owner: task.owner },
        latestContent,
        otherContent
      );
      if (split.notesContentRewritten) {
        try {
          await filesApi.writeFile(
            `${outerBase}/notes.md`,
            split.notesContent,
            `Split attachments for: ${task.name}`
          );
        } catch {
          // best-effort — the rewrite + content state still apply
        }
      }
      if (split.resultsContentRewritten) {
        try {
          await filesApi.writeFile(
            `${outerBase}/results.md`,
            split.resultsContent,
            `Split attachments for: ${task.name}`
          );
        } catch {
          // best-effort
        }
      }
      setAttachBase(tabBase);
      return { notesContent: split.notesContent, migrated: true };
    },
    [inLegacyAttachMode, outerBase, tabBase, task.id, task.name, task.owner]
  );

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const split = await ensureAttachmentsSplit(content);
      if (split.migrated) {
        // Use the rewritten body as the baseline so subsequent setContent
        // calls don't replay stale refs.
        setContent(split.notesContent);
        setOriginalContent(split.notesContent);
      }

      // Per-file rename popup first, then batch duplicate-check.
      const renamedFiles: File[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      const imagesDir = `${tabBase}/Images`;
      const existing = new Set(await fileService.listFiles(imagesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      // Drop writes the file to Images/ and emits an attached event (the
      // bottom ImageStrip picks it up). We deliberately do NOT splice a
      // markdown ref into the body here — the user places it via an
      // explicit drag from the strip into the editor body. Keeps the
      // drop = "attach" gesture cleanly separated from the drag-from-strip
      // = "place inline" gesture.
      for (const file of uniqueFiles) {
        try {
          await attachImageToTask({
            ownerUsername: task.owner,
            taskId: task.id,
            basePath: tabBase,
            blob: file,
            suggestedFilename: file.name,
          });
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

      if (collisions.length > 0) {
        const resolutions = await resolveDuplicates(collisions);
        for (const info of collisions) {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") continue;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName;
          try {
            if (choice.action === "replace") {
              await fileService.deleteFile(`${imagesDir}/${info.existingName}`);
            }
            const renamed = new File([info.file], finalName, {
              type: info.file.type,
            });
            await attachImageToTask({
              ownerUsername: task.owner,
              taskId: task.id,
              basePath: tabBase,
              blob: renamed,
              suggestedFilename: finalName,
            });
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [content, ensureAttachmentsSplit, requestRename, resolveDuplicates, tabBase, task.id, task.owner]
  );

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const split = await ensureAttachmentsSplit(content);
      if (split.migrated) {
        setContent(split.notesContent);
        setOriginalContent(split.notesContent);
      }
      const filesDir = `${tabBase}/Files`;

      const renamedFiles: File[] = [];
      for (const file of files) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      const existing = new Set(await fileService.listFiles(filesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      const writeOne = async (file: File, finalName: string) => {
        const destPath = `${filesDir}/${finalName}`;
        await fileService.writeFileFromBlob(destPath, file);
        fileEvents.emitAttached({ basePath: tabBase, relativePath: `Files/${finalName}` });
      };

      for (const file of uniqueFiles) {
        try {
          await writeOne(file, file.name);
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

      if (collisions.length > 0) {
        const resolutions = await resolveDuplicates(collisions);
        for (const info of collisions) {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") continue;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName;
          try {
            await writeOne(info.file, finalName);
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [content, ensureAttachmentsSplit, requestRename, resolveDuplicates, tabBase]
  );

  // When `explicitValue` is supplied (the popup Save button flushes the
  // editor buffer first and passes the freshest doc), persist that instead of
  // the async-lagging `content` state. Falls back to `content` otherwise.
  const handleSave = useCallback(async (explicitValue?: string) => {
    const latest = typeof explicitValue === "string" ? explicitValue : content;
    setSaving(true);
    try {
      // save-checkpoint bot: read the CURRENT on-disk content BEFORE writing so
      // the version recorder can diff prev -> next. Best-effort: a read failure
      // (fresh notes.md) falls back to the empty string, and the recorder is a
      // side-channel that never blocks the save.
      let prevContent = "";
      try {
        const before = await filesApi.readFile(notesPath);
        prevContent = before.content ?? "";
      } catch {
        prevContent = "";
      }
      const split = await ensureAttachmentsSplit(latest);
      const toWrite = split.migrated ? split.notesContent : latest;
      await filesApi.writeFile(notesPath, toWrite, `Update lab notes for: ${task.name}`);
      setContent(toWrite);
      setOriginalContent(toWrite);
      // Saved content now lives on disk — drop the SPA-nav draft so the
      // next mount doesn't re-promote the now-redundant copy.
      clearNotesDraft();
      // save-checkpoint bot: record a permanent, revertible version of the Lab
      // Notes document. Skip a true no-op (prev === next) so re-saving an
      // unchanged doc never mints a phantom version. AFTER the write so a
      // history failure cannot lose the user's save.
      if (prevContent !== toWrite) {
        void recordTaskDocHistory({
          surface: "notes",
          type: "update",
          id: task.id,
          owner: task.owner || currentUser || "",
          actor: currentUser ?? task.owner ?? "",
          prevContent,
          nextContent: toWrite,
        });
      }
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [content, ensureAttachmentsSplit, notesPath, task.name, task.id, task.owner, currentUser, clearNotesDraft]);

  // Register a flush+save handle so the parent can persist this tab before an
  // auto-switch (a phone capture routed to the other tab). Flushes the editor's
  // in-flight buffer first, then writes to disk only when the doc changed. A
  // read-only viewer registers nothing (there is nothing to save).
  useEffect(() => {
    if (readOnly || !onRegisterFlushSave) return;
    onRegisterFlushSave(async () => {
      const fresh = editorSaveRef.current?.();
      const latest = typeof fresh === "string" ? fresh : content;
      if (latest !== originalContent) {
        await handleSave(latest);
      }
    });
    return () => onRegisterFlushSave(null);
  }, [readOnly, onRegisterFlushSave, content, originalContent, handleSave]);

  // Phase 2: register an append-line handle so the parent can append a calc
  // result from the phone into this doc without replacing it (safe under live
  // editing). Loro pilot path inserts via CRDT; legacy path updates state and
  // calls handleSave. Read-only tabs register nothing.
  useEffect(() => {
    if (readOnly || !onRegisterAppendLine) return;
    onRegisterAppendLine((line: string) => {
      if (LORO_PILOT_ENABLED && loroHandle) {
        // Loro path: single CRDT insert at the end, streams into CM6 via the
        // sync plugin. Commit so the autosave path persists it to disk.
        appendTaskLine(loroHandle.doc, line);
        loroHandle.doc.commit({ message: "phone:append-calc-line" });
      } else {
        // Legacy path: update React state and trigger a save.
        setContent((c) => {
          const base = c.replace(/\s+$/, "");
          return base ? base + "\n" + line : line;
        });
        // handleSave runs asynchronously; we pass the new value explicitly so
        // it does not race against the async state update.
        const base = content.replace(/\s+$/, "");
        const next = base ? base + "\n" + line : line;
        void handleSave(next);
      }
    });
    return () => onRegisterAppendLine(null);
  // loroHandle is the key dependency: when it changes (opens or closes) we
  // must re-register so the handle body captures the current doc reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, onRegisterAppendLine, loroHandle, content, handleSave]);

  // save-checkpoint bot: version-history controller for the Lab Notes document.
  // `writeRestored` writes the reconstructed markdown back to notes.md + reflects
  // it into the editor, then the controller records the "revert" version.
  const docHistory = useTaskDocHistory({
    surface: "notes",
    taskId: task.id,
    owner: task.owner || currentUser || "",
    actor: currentUser ?? task.owner ?? "",
    liveContent: originalContent,
    canRestore: !readOnly,
    writeRestored: async (restored) => {
      await filesApi.writeFile(notesPath, restored, `Restore lab notes for: ${task.name}`);
      setContent(restored);
      setOriginalContent(restored);
      clearNotesDraft();
    },
  });

  // Right-side controls for the editor's unified toolbar: the version-history
  // button plus the Save button. The "Unsaved changes" cue is folded into the
  // Save button's amber-dot + enabled state (no separate text bar). Hidden in
  // readOnly mode (lab view) where there is nothing to save. The old
  // "Markdown | Files" sub-tab switcher is retired: files now live in the
  // single bottom attachments strip (file-unify bot).
  const editorToolbarTrailing = !readOnly ? (
    <>
      {/* experiment-collab follow-up: auto-save Saving/Saved pill, parity with
          the Notes pilot (see NoteDetailPopup note-autosave-status). Only shown
          while the pilot flag is on and the Loro handle is open. Fullscreen-chrome
          slim: hidden at fullscreen — the popup header's `task-ambient-save`
          already shows the live save state, so a second "Saved" in the pill is
          a duplicate. Docked keeps it. */}
      {!expanded && LORO_PILOT_ENABLED && !!loroHandle && (
        <span
          data-testid="task-notes-autosave-status"
          aria-live="polite"
          aria-atomic="true"
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium ring-1 transition-colors ${
            loroCommitPending
              ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30"
              : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30"
          }`}
        >
          {loroCommitPending ? "Saving..." : "Saved"}
        </span>
      )}
      {/* save-checkpoint bot: version-history entry button (icon-only clock +
          counter-arrow, Tooltip per house rule). Opens the docked sidebar +
          in-place diff for the Lab Notes document. */}
      <TaskDocHistoryButton controller={docHistory} />
      {/* save-checkpoint bot: "Save checkpoint" makes it obvious every save is a
          permanent, revertible version. Tooltip spells that out. Fullscreen-chrome
          slim: at fullscreen this relocates to the popup header's `...` overflow
          (task-header-save-checkpoint) to keep the Writing-Room pill minimal;
          docked keeps the inline button here. */}
      {!expanded && (
        <Tooltip label="Saves a permanent version you can revert to anytime." placement="bottom">
          <button
            data-tour-target="task-popup-notes-save"
            onClick={() => {
              // Flush the editor's in-flight block buffer first so the
              // last in-progress edit lands on disk, then persist.
              const latest = editorSaveRef.current?.() ?? content;
              void handleSave(latest);
            }}
            disabled={saving || (!hasUnsavedChanges && !editorDirty)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg transition-colors ${
              (hasUnsavedChanges || editorDirty) && !saving
                ? "text-white bg-brand-action hover:bg-brand-action/90"
                : "text-foreground-muted bg-surface-sunken cursor-not-allowed"
            }`}
          >
            {(hasUnsavedChanges || editorDirty) && !saving && (
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-300" />
            )}
            {saving ? "Saving..." : "Save checkpoint"}
          </button>
        </Tooltip>
      )}
    </>
  ) : undefined;

  return (
    <>
      <FileRenamePopup />
      <DuplicateDialog />
      <div className="flex flex-col h-full">
        {(
          <>

            {/* File size warning */}
            {uploadWarning && (
              <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30">
                <div className="flex items-start gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 dark:text-amber-300 flex-shrink-0 mt-0.5" aria-hidden>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-body text-amber-800 dark:text-amber-200">{uploadWarning}</p>
                  </div>
                  <Tooltip label="Dismiss warning" placement="bottom">
                    <button
                      onClick={() => setUploadWarning(null)}
                      className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 p-0.5 -m-0.5 rounded transition-colors"
                      aria-label="Dismiss warning"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}

            {/* LabArchives rehydration banner — persistent rescue path for
                Form-B inline images that didn't come through at import
                time. Only shown to the task owner (receivers can't
                rehydrate someone else's import; the sidecar lives in the
                owner's namespace). Hidden in readOnly mode (lab view).

                Gated on `!hasUnsavedChanges` because the rehydrate helper
                rewrites notes.md on disk and we then bump rehydrateReloadKey
                to re-read; any in-flight editor edits would get clobbered.
                When the user has unsaved work we still surface the banner
                so they know there's something to do, but the button asks
                them to save first. */}
            {missingInline && missingInline.length > 0 && !readOnly && !task.is_shared_with_me && (
              <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30">
                <div className="flex items-start gap-3">
                  <svg
                    aria-hidden
                    className="w-5 h-5 text-amber-500 dark:text-amber-300 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16l4-8 4 4 5-10 5 14M3 20h18"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="text-body font-medium text-amber-900 dark:text-amber-200">
                      {missingInline.length} inline image
                      {missingInline.length === 1 ? "" : "s"} from your
                      LabArchives import didn&apos;t come through
                    </p>
                    <p className="text-meta text-amber-800 dark:text-amber-200 mt-0.5">
                      They were stored online by LabArchives and weren&apos;t bundled in
                      the offline ZIP. Pull them in now so they render inline.
                    </p>
                  </div>
                  <Tooltip
                    label={hasUnsavedChanges ? "Save your notes first — the rehydrate flow rewrites notes.md on disk." : "Open the 3-tab fetch panel"}
                    placement="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => setRehydrateModalOpen(true)}
                      disabled={hasUnsavedChanges}
                      className="shrink-0 px-3 py-1.5 text-meta font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Pull them in →
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}

            {/* Editor — give it a sized flex slot so the editor scrolls
                internally (the markdown body, toolbar, and image strip
                stay anchored) instead of pushing the whole popup tab
                to scroll as a unit. save-checkpoint bot: when version
                history is open the editor slot splits into the read-only
                diff column + the docked history sidebar (mirrors the Notes
                pilot). */}
            <div className="flex-1 min-h-0 flex">
              <div className="flex-1 min-h-0 flex flex-col">
              {loading || loroOpening ? (
                <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-foreground-muted/15 rounded" />
                <div className="h-3 w-full bg-foreground-muted/15 rounded" />
                <div className="h-3 w-5/6 bg-foreground-muted/15 rounded" />
                <div className="h-3 w-4/5 bg-surface-sunken rounded" />
              </div>
              ) : docHistory.isOpen ? (
                <TaskDocDiffColumn controller={docHistory} />
              ) : (
                <LiveMarkdownEditor
                  value={content}
                  onChange={setContent}
                  // experiment-collab follow-up: a view-only collaborator (or
                  // lab-view readOnly) gets a LIVE read of the Loro-bound text
                  // (remote edits still stream in via LoroSyncPlugin) but must
                  // never write. `disabled` makes CM6 editable=false, so no
                  // local ops are produced and nothing is committed/synced back.
                  disabled={readOnly}
                  placeholder="Click to start writing lab notes..."
                  onImageDrop={handleImageUpload}
                  onFileDrop={handleFileUpload}
                  allowAnyFileType={true}
                  imageBasePath={attachBase}
                  // Plumbs the disk path so native image drops can be
                  // filename-matched against the task's
                  // `_import_source.json` sidecar and routed through the
                  // LabArchives Form-B rehydration path. No-op when the
                  // sidecar is absent (= not an ELN-imported task).
                  notesMarkdownPath={notesPath}
                  // Markdown embed hybrid P7-1a: per-document Lab Notes pins sidecar.
                  embedPinContext={embedPinContext}
                  showToolbar={true}
                  // The popup owns its own version-controlled "Save checkpoint"
                  // button (above), so hide the editor's internal one to
                  // avoid two Save buttons. saveRef lets that button flush
                  // the live buffer; onExplicitSave routes Cmd+S to disk;
                  // onDirtyChange keeps that button enabled while mid-edit.
                  hideSaveButton
                  saveRef={editorSaveRef}
                  onExplicitSave={(v) => { void handleSave(v); }}
                  onDirtyChange={setEditorDirty}
                  // Fold the "Save checkpoint" button + version history into
                  // the editor's single unified toolbar instead of stacking
                  // parent bars above it.
                  toolbarTrailing={editorToolbarTrailing}
                  // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §9,
                  // U1): the editor's Focus button grows the POPUP (same DOM,
                  // CSS size transition) instead of teleporting into its own
                  // body-level overlay. The popup flushes this editor's buffer
                  // before growing via the registered flush bridge.
                  onRequestExpand={onRequestExpand}
                  expanded={expanded}
                  // file-unify bot: the single bottom attachments strip now
                  // UNION-reads the retired Files panel's `NotesPDFs/` folder
                  // so files attached there still appear (and can be viewed /
                  // deleted). New uploads write to Images/ + Files/ only.
                  legacyAttachmentsDir={pdfsDir}
                  // Experiment-collab chunk 1: when the pilot flag is on and the
                  // task notes handle is open, the CRDT owns the live text (the
                  // editor seeds from + syncs to the doc's "content"). The task
                  // surface is a single text, so loroEntryIndex is 0 and there is
                  // no loroBaseNote. collab cursors render only while a session is
                  // live. Flag-off / open-failure leaves these undefined so the
                  // legacy disk path is unchanged.
                  loroHandle={
                    LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined
                  }
                  loroEntryIndex={LORO_PILOT_ENABLED ? 0 : undefined}
                  collabEphemeral={collabActive ? collab.ephemeral : undefined}
                  collabUser={collabActive ? collabUser : undefined}
                  // Chemistry Phase 3: reference picker.
                  enableReferencePicker
                />
              )}
              </div>
              {docHistory.isOpen && (
                <TaskDocHistorySidebar
                  controller={docHistory}
                  surface="notes"
                  taskId={task.id}
                  owner={task.owner || currentUser || ""}
                  canRestore={!readOnly}
                />
              )}
            </div>
          </>
        )}
      </div>

      <RehydrateMissingImagesModal
        open={
          rehydrateModalOpen &&
          !!missingInline &&
          missingInline.length > 0 &&
          !!currentUser
        }
        notesBase={attachBase}
        notesMarkdownPath={notesPath}
        missingImages={missingInline ?? []}
        onApplied={() => {
          // Bump the reload key so the markdown re-reads from disk
          // (rehydrate.ts rewrote the body in place) and the sidecar
          // probe re-runs to shrink the banner count.
          setRehydrateReloadKey((k) => k + 1);
        }}
        onClose={() => setRehydrateModalOpen(false)}
      />
    </>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ task, readOnly = false, ownerUsername, onRegisterFlushSave, onRegisterAppendLine, onRegisterDirtyState, expanded = false, onRequestExpand }: { task: Task; readOnly?: boolean; ownerUsername?: string; onRegisterFlushSave?: (fn: (() => Promise<void>) | null) => void; onRegisterAppendLine?: (fn: ((line: string) => void) | null) => void; onRegisterDirtyState?: (state: { dirty: boolean; saving: boolean } | null) => void; expanded?: boolean; onRequestExpand?: () => void }) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const { currentUser } = useCurrentUser();
  // The device's own directory email (canonical), used to SIGN collab requests
  // when the experiment is shared. Null when this device has no sharing identity
  // (collab then stays live-only). Mirrors LabNotesTab.
  const { email: myDirectoryEmail } = useSharingIdentity();

  // ── Experiment-collab chunk 2: Loro wiring for the Results doc ────────────
  // A SEPARATE collab doc from Lab Notes: opened via openTaskDoc(..., "results")
  // so it has its own owner:id:results module-cache entry, its own sidecar, its
  // own minted id (results_collab_doc_id, NOT collab_doc_id), and its own relay
  // room. One handle per (owner, task, "results") surface; opened once, closed
  // on task identity change or unmount. Null when the flag is off or the async
  // open is in flight / failed. Mirrors LabNotesTab's loroHandle / loroOpenFailed.
  const [loroHandle, setLoroHandle] = useState<TaskDocHandle | null>(null);
  const [loroOpenFailed, setLoroOpenFailed] = useState(false);
  // The task owner is the doc owner for the collab path (where the sidecar
  // lives). Falls back to currentUser for an unowned local task.
  const loroOwner = task.owner || currentUser || "";
  const collabRef = task.id != null ? { owner: loroOwner, id: task.id } : null;

  // Publish the device's directory email to the lazy collab signer so the
  // sync hooks can sign Neon requests. Reactive: becomes available as soon as
  // the sharing identity sidecar loads.
  useEffect(() => {
    setCollabSignerEmail(myDirectoryEmail);
  }, [myDirectoryEmail]);

  // Live-collab session (flag-gated). useCollabSession is called
  // unconditionally (Rules of Hooks) but stays idle when the flag is off or the
  // handle is null. For the same-user MVP the collaborator is currentUser. This
  // is a DISTINCT session from the Lab Notes tab's (keyed on the results doc).
  const collab = useCollabSession({
    doc: loroHandle?.doc ?? null,
    enabled: LORO_PILOT_ENABLED,
    owner: loroOwner || undefined,
    collaboratorUsername: currentUser ?? undefined,
  });
  const collabActive = LORO_PILOT_ENABLED && collab.state.status === "live";
  // Cursor identity for this peer: signed-in name + a deterministic color
  // derived from the doc's peer id. Stable after the handle opens.
  const collabUser = useMemo(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) return undefined;
    return {
      name: currentUser ?? "collaborator",
      colorClassName: peerColorClass(loroHandle.doc.peerIdStr),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle?.doc.peerIdStr, currentUser]);

  // Open / close the Loro handle when the task identity changes. No-op when the
  // flag is off. On open failure the editor falls back to the legacy disk-load
  // surface (loroHandle stays null, so no Loro props are passed).
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!collabRef) return;

    let active = true;
    setLoroOpenFailed(false);

    openTaskDoc(collabRef, "results", currentUser ?? undefined)
      .then((handle) => {
        if (!active) return;
        setLoroHandle(handle);
      })
      .catch((err) => {
        console.error("[ResultsTab] Loro openTaskDoc failed:", err);
        if (active) setLoroOpenFailed(true);
      });

    return () => {
      active = false;
      setLoroHandle((prev) => {
        if (prev) void prev.close();
        return null;
      });
    };
    // Keyed on task identity + owner only (one handle per task results surface).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.owner, currentUser]);

  // While the handle is still opening (flag on, not yet ready, not failed) we
  // hold the editor on the existing `loading` placeholder below by ORing this
  // into the loading gate, so CM6 only mounts once its final mode (Loro vs
  // legacy) is known. Mounting before the handle arrives would build the editor
  // in legacy mode and never switch (its mount effect runs once).
  const loroOpening =
    LORO_PILOT_ENABLED && loroHandle === null && !loroOpenFailed;

  // Auto-save status parity with the Notes pilot (experiment-collab follow-up).
  // Mirrors NoteDetailPopup's loroCommitPending: tracks whether a debounced
  // commit is queued or in flight so the Saving/Saved pill stays accurate. Only
  // meaningful when the pilot flag is on and the handle is open; false (settled)
  // otherwise. subscribeCommitPending fires immediately with the current value
  // so the pill initialises without a one-frame flash.
  const [loroCommitPending, setLoroCommitPending] = useState(false);
  useEffect(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) {
      setLoroCommitPending(false);
      return;
    }
    return loroHandle.subscribeCommitPending(setLoroCommitPending);
  }, [loroHandle]);

  // Auto-connect to the live session when a SHARED experiment opens. A shared
  // task's Results doc has its own collab_doc_id in its Loro meta (minted by
  // grant-on-share on the sharer's side, carried by the bundle on import).
  // Mirrors LabNotesTab's connectFromDocId effect, but the import-bootstrap
  // reads task.results_collab_doc_id (the Results doc's id), NOT
  // task.collab_doc_id (which belongs to Lab Notes).
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (collab.state.status !== "idle") return;

    let docId = getCollabDocId(loroHandle.doc);

    // Bootstrap: a freshly-imported task has results_collab_doc_id in its JSON
    // but not yet in the Results Loro sidecar. Seed the meta map with that exact
    // id so the sidecar derives the same relay room as the sharer's Results doc.
    if (!docId && task.results_collab_doc_id) {
      loroHandle.doc.getMap("meta").set("collab_doc_id", task.results_collab_doc_id);
      loroHandle.doc.commit({ message: "seed-results-collab-doc-id-from-import" });
      docId = task.results_collab_doc_id;
    }

    if (!docId) return; // unshared experiment, nothing to do

    collab.connectFromDocId(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, collab.state.status, task.results_collab_doc_id]);

  // ── Mint + grant the Results collab id when the experiment is shared ──────
  // Identical to LabNotesTab's mint-on-share effect, but operating on the
  // Results LoroDoc. grantCollabOnShare is entity-agnostic and mints into
  // whichever doc it is passed, so calling it with the Results handle mints +
  // grants the Results doc INDEPENDENTLY of the Lab Notes doc. Same docId-keyed
  // server grant route, no new server code.
  //
  // Re-share on member growth (see LabNotesTab for the full rationale): the
  // effect re-fires when shared_with grows so a NEW member added to an already-
  // collaborative experiment gets the durable Neon grant for the Results doc,
  // not only the live relay session. We diff against the last-granted membership
  // via a ref so only the newly-added members are granted, and a plain reopen
  // (doc id present, membership unchanged) still short-circuits.
  //
  // FLAG (data-shape): writes the minted id into the Results Loro meta map (its
  // own sidecar). The JSON bridge field for this id is results_collab_doc_id.
  const grantedSharedWithRef = useRef<SharedUser[] | null>(null);
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (!currentUser) return;
    if (collab.state.status !== "idle") return;
    const sharedWith = task.shared_with ?? [];
    if (sharedWith.length === 0) return; // not shared, nothing to mint

    const alreadyCollab = !!getCollabDocId(loroHandle.doc);
    // Seed the "already granted" baseline on first run for this handle (see
    // LabNotesTab): existing members of an already-collaborative Results doc are
    // treated as granted so a reopen does not re-grant; only growth re-fires.
    if (grantedSharedWithRef.current === null) {
      grantedSharedWithRef.current = alreadyCollab ? sharedWith : [];
    }

    const previousSharedWith = grantedSharedWithRef.current;
    const prevUsernames = new Set(previousSharedWith.map((s) => s.username));
    const grew = sharedWith.some((s) => !prevUsernames.has(s.username));
    if (alreadyCollab && !grew) return;

    grantedSharedWithRef.current = sharedWith;

    void grantCollabOnShare({
      doc: loroHandle.doc,
      ownerEmail: myDirectoryEmail ?? "",
      // Diff against the last-granted membership so only newly-added members are
      // registered on the server (owner granted only on the first share).
      previousSharedWith,
      nextSharedWith: sharedWith,
    }).then((docId) => {
      if (docId && collab.state.status === "idle") {
        collab.connectFromDocId(docId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, task.shared_with, currentUser]);

  // See LabNotesTab: imperative flush handle from the embedded editor so the
  // popup "Save results" button persists the freshest in-progress block.
  const editorSaveRef = useRef<(() => string) | null>(null);
  // See LabNotesTab: mirrors the editor's in-flight buffer-dirty flag so the
  // "Save results" button enables the instant typing starts (not only after
  // a block switch flushes to `content`).
  const [editorDirty, setEditorDirty] = useState(false);
  // See LabNotesTab — same SPA-nav draft-restore staging slot. Holds the
  // sessionStorage draft (if any) until the disk loader resolves, then the
  // loader promotes it on top of the disk baseline.
  const pendingDraftRef = useRef<string | null>(null);

  // See LabNotesTab for the per-user / legacy fallback rules. `outerBase`
  // holds the .md files + PDF panels; `attachBase` is the per-tab scoped
  // folder for THIS tab (or a legacy fallback to the shared outer base).
  const legacyOwner = ownerUsername || task.owner;
  const [outerBase, setOuterBase] = useState<string>(() => taskResultsBase(task));
  const [attachBase, setAttachBase] = useState<string>(() => taskResultsTabBase(task));
  const resultsPath = `${outerBase}/results.md`;
  const pdfsDir = `${outerBase}/ResultsPDFs`;
  const tabBase = useMemo(() => `${outerBase}/results`, [outerBase]);
  const inLegacyAttachMode = attachBase === outerBase;
  // Markdown embed hybrid P7-1a: the per-document embed-pins sidecar for the
  // Results doc. Separate file from the Lab Notes sidecar so a pin on Results never
  // collides with a pin on Notes. Only wired when editable.
  const embedPinContext = useMemo(
    () =>
      readOnly
        ? undefined
        : { sidecarPath: `${outerBase}/results.ros-embeds.json` },
    [outerBase, readOnly],
  );

  // See LabNotesTab — same lookup so a fresh results.md gets a real project
  // name in its stamp instead of "Unknown Project".
  const { data: stampProject } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  // SPA-nav-safe draft persistence — see LabNotesTab for the rationale. Key
  // is suffixed `:results` so the Notes tab + Results tab on the same task
  // don't share a sessionStorage slot.
  const resultsDraftKey = `researchos:draft:task-results:${currentUser ?? ""}:${task.owner}:${task.id}`;
  const { clearDraft: clearResultsDraft } = useDraftPersistence(
    resultsDraftKey,
    content,
    hasUnsavedChanges,
    {
      onRestore: (saved) => {
        if (typeof saved !== "string" || saved.length === 0) return;
        pendingDraftRef.current = saved;
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = currentUser
          ? await resolveTaskResultsBase({ id: task.id, owner: task.owner }, currentUser)
          : taskResultsBase({ id: task.id, owner: task.owner });
        if (cancelled) return;
        setOuterBase(resolved);
        const resolvedAttach = await resolveTabAttachmentBase(
          { id: task.id, owner: task.owner },
          "results",
          resolved
        );
        if (cancelled) return;
        setAttachBase(resolvedAttach);
        const resolvedResults = `${resolved}/results.md`;
        const file = await filesApi.readFile(resolvedResults);
        const raw = file.content;
        if (readOnly) {
          if (!cancelled) {
            setContent(raw);
            setOriginalContent(raw);
            setLoading(false);
          }
          return;
        }
        // Lazy-migrate any legacy `Attachments/` content into `Files/` on the
        // owner's first read. Cheap no-op if the folder doesn't exist.
        const attachMig = await migrateTaskAttachmentsToFiles(resolved, raw);
        const startContent = attachMig.contentRewritten ? attachMig.content : raw;
        const { content: migrated, didMigrate } = await migrateNoteImages(startContent, task.id, resolved, legacyOwner);
        // Lazy-normalize legacy stamp formats so the rendered preview stops
        // leaking the `[stamp-end]: # (hidden)` marker as visible text.
        const stampNormalizedContent = hasLegacyStampFormat(migrated)
          ? normalizeStampFormat(migrated)
          : migrated;
        const stampDidNormalize = stampNormalizedContent !== migrated;
        if (didMigrate || attachMig.contentRewritten || stampDidNormalize) {
          await filesApi.writeFile(resolvedResults, stampNormalizedContent, `Migrate image references for: ${task.name}`);
        }
        if (!cancelled) {
          setOriginalContent(stampNormalizedContent);
          // See LabNotesTab — promote a pending SPA-nav draft on top of
          // the disk baseline so the user's in-flight edits survive a
          // nav-link click within the app.
          const pending = pendingDraftRef.current;
          pendingDraftRef.current = null;
          if (pending && pending !== stampNormalizedContent) {
            setContent(pending);
          } else {
            setContent(stampNormalizedContent);
          }
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        const projectName = stampProject?.name ?? "Unknown Project";
        const newContent = createNewFileContent(task.name, projectName, 'results');
        setOriginalContent(newContent);
        const pending = pendingDraftRef.current;
        pendingDraftRef.current = null;
        setContent(pending && pending !== newContent ? pending : newContent);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.name, task.owner, task.project_id, currentUser, legacyOwner, readOnly, stampProject?.name]);

  // Warn before navigating away (F5 / tab close). SPA route changes are
  // handled by the draft-persistence hook above.
  useUnsavedChangesGuard(hasUnsavedChanges);

  // L3: lift dirty/saving up to the shell for the honest ambient indicator.
  // Same contract as LabNotesTab — presentation only, no new save behavior.
  useEffect(() => {
    onRegisterDirtyState?.({ dirty: hasUnsavedChanges || editorDirty, saving });
    return () => onRegisterDirtyState?.(null);
  }, [onRegisterDirtyState, hasUnsavedChanges, editorDirty, saving]);

  const ensureAttachmentsSplit = useCallback(
    async (
      latestContent: string
    ): Promise<{ resultsContent: string; migrated: boolean }> => {
      if (!inLegacyAttachMode) {
        return { resultsContent: latestContent, migrated: false };
      }
      let otherContent = "";
      try {
        const f = await filesApi.readFile(`${outerBase}/notes.md`);
        otherContent = f.content;
      } catch {
        otherContent = "";
      }
      const split = await splitTaskAttachments(
        { id: task.id, owner: task.owner },
        otherContent,
        latestContent
      );
      if (split.notesContentRewritten) {
        try {
          await filesApi.writeFile(
            `${outerBase}/notes.md`,
            split.notesContent,
            `Split attachments for: ${task.name}`
          );
        } catch {
          // best-effort
        }
      }
      if (split.resultsContentRewritten) {
        try {
          await filesApi.writeFile(
            `${outerBase}/results.md`,
            split.resultsContent,
            `Split attachments for: ${task.name}`
          );
        } catch {
          // best-effort
        }
      }
      setAttachBase(tabBase);
      return { resultsContent: split.resultsContent, migrated: true };
    },
    [inLegacyAttachMode, outerBase, tabBase, task.id, task.name, task.owner]
  );

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const split = await ensureAttachmentsSplit(content);
      if (split.migrated) {
        setContent(split.resultsContent);
        setOriginalContent(split.resultsContent);
      }

      const renamedFiles: File[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      const imagesDir = `${tabBase}/Images`;
      const existing = new Set(await fileService.listFiles(imagesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      // See the Lab Notes tab handler above — drop = attach to Images/ only;
      // placing the ref inline is the user's explicit drag from the strip.
      for (const file of uniqueFiles) {
        try {
          await attachImageToTask({
            ownerUsername: task.owner,
            taskId: task.id,
            basePath: tabBase,
            blob: file,
            suggestedFilename: file.name,
          });
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

      if (collisions.length > 0) {
        const resolutions = await resolveDuplicates(collisions);
        for (const info of collisions) {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") continue;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName;
          try {
            if (choice.action === "replace") {
              await fileService.deleteFile(`${imagesDir}/${info.existingName}`);
            }
            const renamed = new File([info.file], finalName, {
              type: info.file.type,
            });
            await attachImageToTask({
              ownerUsername: task.owner,
              taskId: task.id,
              basePath: tabBase,
              blob: renamed,
              suggestedFilename: finalName,
            });
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [content, ensureAttachmentsSplit, requestRename, resolveDuplicates, tabBase, task.id, task.owner]
  );

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const split = await ensureAttachmentsSplit(content);
      if (split.migrated) {
        setContent(split.resultsContent);
        setOriginalContent(split.resultsContent);
      }
      const filesDir = `${tabBase}/Files`;

      const renamedFiles: File[] = [];
      for (const file of files) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      const existing = new Set(await fileService.listFiles(filesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      const writeOne = async (file: File, finalName: string) => {
        const destPath = `${filesDir}/${finalName}`;
        await fileService.writeFileFromBlob(destPath, file);
        fileEvents.emitAttached({ basePath: tabBase, relativePath: `Files/${finalName}` });
      };

      for (const file of uniqueFiles) {
        try {
          await writeOne(file, file.name);
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

      if (collisions.length > 0) {
        const resolutions = await resolveDuplicates(collisions);
        for (const info of collisions) {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") continue;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName;
          try {
            await writeOne(info.file, finalName);
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [content, ensureAttachmentsSplit, requestRename, resolveDuplicates, tabBase]
  );

  // When `explicitValue` is supplied (the popup Save button flushes the
  // editor buffer first and passes the freshest doc), persist that instead of
  // the async-lagging `content` state. Falls back to `content` otherwise.
  const handleSave = useCallback(async (explicitValue?: string) => {
    const latest = typeof explicitValue === "string" ? explicitValue : content;
    setSaving(true);
    try {
      // save-checkpoint bot: read the CURRENT on-disk content BEFORE writing so
      // the version recorder can diff prev -> next (see LabNotesTab.handleSave).
      let prevContent = "";
      try {
        const before = await filesApi.readFile(resultsPath);
        prevContent = before.content ?? "";
      } catch {
        prevContent = "";
      }
      const split = await ensureAttachmentsSplit(latest);
      const toWrite = split.migrated ? split.resultsContent : latest;
      await filesApi.writeFile(resultsPath, toWrite, `Update results: ${task.name}`);
      setContent(toWrite);
      setOriginalContent(toWrite);
      // Saved to disk — drop the SPA-nav draft.
      clearResultsDraft();
      // save-checkpoint bot: record a permanent, revertible version of the
      // Results document. Skip a true no-op so re-saving an unchanged doc never
      // mints a phantom version. AFTER the write (best-effort side-channel).
      if (prevContent !== toWrite) {
        void recordTaskDocHistory({
          surface: "results",
          type: "update",
          id: task.id,
          owner: task.owner || currentUser || "",
          actor: currentUser ?? task.owner ?? "",
          prevContent,
          nextContent: toWrite,
        });
      }
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, ensureAttachmentsSplit, resultsPath, task.name, task.id, task.owner, currentUser, clearResultsDraft]);

  // Register a flush+save handle so the parent can persist this tab before an
  // auto-switch (a phone capture routed to the other tab). Mirrors LabNotesTab.
  useEffect(() => {
    if (readOnly || !onRegisterFlushSave) return;
    onRegisterFlushSave(async () => {
      const fresh = editorSaveRef.current?.();
      const latest = typeof fresh === "string" ? fresh : content;
      if (latest !== originalContent) {
        await handleSave(latest);
      }
    });
    return () => onRegisterFlushSave(null);
  }, [readOnly, onRegisterFlushSave, content, originalContent, handleSave]);

  // Phase 2: register an append-line handle. Mirrors LabNotesTab exactly but
  // operates on the Results doc and its loroHandle. Read-only tabs register nothing.
  useEffect(() => {
    if (readOnly || !onRegisterAppendLine) return;
    onRegisterAppendLine((line: string) => {
      if (LORO_PILOT_ENABLED && loroHandle) {
        appendTaskLine(loroHandle.doc, line);
        loroHandle.doc.commit({ message: "phone:append-calc-line" });
      } else {
        setContent((c) => {
          const base = c.replace(/\s+$/, "");
          return base ? base + "\n" + line : line;
        });
        const base = content.replace(/\s+$/, "");
        const next = base ? base + "\n" + line : line;
        void handleSave(next);
      }
    });
    return () => onRegisterAppendLine(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, onRegisterAppendLine, loroHandle, content, handleSave]);

  // save-checkpoint bot: version-history controller for the Results document.
  const docHistory = useTaskDocHistory({
    surface: "results",
    taskId: task.id,
    owner: task.owner || currentUser || "",
    actor: currentUser ?? task.owner ?? "",
    liveContent: originalContent,
    canRestore: !readOnly,
    writeRestored: async (restored) => {
      await filesApi.writeFile(resultsPath, restored, `Restore results: ${task.name}`);
      setContent(restored);
      setOriginalContent(restored);
      clearResultsDraft();
    },
  });

  // Right-side controls for the editor's unified toolbar: the version-history
  // button plus the Save button. The old "Markdown | Files" sub-tab switcher is
  // retired: files now live in the single bottom attachments strip
  // (file-unify bot).
  const editorToolbarTrailing = !readOnly ? (
    <>
      {/* experiment-collab follow-up: auto-save Saving/Saved pill, parity with
          the Notes pilot (see LabNotesTab / NoteDetailPopup). Only shown while
          the pilot flag is on and the Results Loro handle is open. Fullscreen-
          chrome slim: hidden at fullscreen (the header `task-ambient-save`
          already shows it — no duplicate). Docked keeps it. */}
      {!expanded && LORO_PILOT_ENABLED && !!loroHandle && (
        <span
          data-testid="task-results-autosave-status"
          aria-live="polite"
          aria-atomic="true"
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium ring-1 transition-colors ${
            loroCommitPending
              ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30"
              : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30"
          }`}
        >
          {loroCommitPending ? "Saving..." : "Saved"}
        </span>
      )}
      {/* save-checkpoint bot: version-history entry button for the Results
          document (see LabNotesTab). */}
      <TaskDocHistoryButton controller={docHistory} />
      {/* save-checkpoint bot: "Save checkpoint" + tooltip (see LabNotesTab).
          Fullscreen-chrome slim: at fullscreen relocates to the header `...`
          overflow (task-header-save-checkpoint); docked keeps it inline. */}
      {!expanded && (
        <Tooltip label="Saves a permanent version you can revert to anytime." placement="bottom">
          <button
            data-tour-target="task-popup-results-save"
            onClick={() => {
              // Flush the editor's in-flight block buffer first so the
              // last in-progress edit lands on disk, then persist.
              const latest = editorSaveRef.current?.() ?? content;
              void handleSave(latest);
            }}
            disabled={saving || (!hasUnsavedChanges && !editorDirty)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg transition-colors ${
              (hasUnsavedChanges || editorDirty) && !saving
                ? "text-white bg-brand-action hover:bg-brand-action/90"
                : "text-foreground-muted bg-surface-sunken cursor-not-allowed"
            }`}
          >
            {(hasUnsavedChanges || editorDirty) && !saving && (
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-300" />
            )}
            {saving ? "Saving..." : "Save checkpoint"}
          </button>
        </Tooltip>
      )}
    </>
  ) : undefined;

  return (
    <>
      <FileRenamePopup />
      <DuplicateDialog />
      <div className="flex flex-col h-full">
        {(
        <>
          {/* File size warning */}
          {uploadWarning && (
            <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30">
              <div className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 dark:text-amber-300 flex-shrink-0 mt-0.5" aria-hidden>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="flex-1">
                  <p className="text-body text-amber-800 dark:text-amber-200">{uploadWarning}</p>
                </div>
                <Tooltip label="Dismiss warning" placement="bottom">
                  <button
                    onClick={() => setUploadWarning(null)}
                    className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 p-0.5 -m-0.5 rounded transition-colors"
                    aria-label="Dismiss warning"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Editor — sized flex slot so the markdown scrolls inside the
              editor, not by pushing the whole tab. Matches the LabNotes
              tab and the fullscreen behavior. save-checkpoint bot: splits
              into the diff column + history sidebar when version history is
              open. */}
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-h-0 flex flex-col">
            {loading || loroOpening ? (
              <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-foreground-muted/15 rounded" />
                <div className="h-3 w-full bg-foreground-muted/15 rounded" />
                <div className="h-3 w-5/6 bg-foreground-muted/15 rounded" />
                <div className="h-3 w-4/5 bg-surface-sunken rounded" />
              </div>
            ) : docHistory.isOpen ? (
              <TaskDocDiffColumn controller={docHistory} />
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                // experiment-collab follow-up: view-only collaborators get a
                // live read of the Results doc but cannot write. See the Lab
                // Notes editor above for the full rationale (CM6 editable=false
                // -> no local ops -> nothing committed or synced back).
                disabled={readOnly}
                // Same seamless insertion as Lab Notes: the toolbar button +
                // the "/" slash trigger open the reference picker so a molecule,
                // sequence, method, or Data Hub document drops in as a chip.
                enableReferencePicker
                placeholder="Click to start writing results..."
                onImageDrop={handleImageUpload}
                onFileDrop={handleFileUpload}
                allowAnyFileType={true}
                imageBasePath={attachBase}
                // Results tab generally won't have a sidecar (the ELN
                // importer puts it under `notes/`), but plumbing the path
                // keeps behavior consistent if the user ever drops an image
                // here whose filename happens to match a Form-B entry. The
                // sidecar read short-circuits cleanly when absent.
                notesMarkdownPath={resultsPath}
                // Markdown embed hybrid P7-1a: per-document Results pins sidecar.
                embedPinContext={embedPinContext}
                showToolbar={true}
                // The popup owns its own version-controlled "Save results"
                // button (above), so hide the editor's internal one to avoid
                // two Save buttons. saveRef lets that button flush the live
                // buffer; onExplicitSave routes Cmd+S to disk; onDirtyChange
                // keeps that button enabled while mid-edit.
                hideSaveButton
                saveRef={editorSaveRef}
                onExplicitSave={(v) => { void handleSave(v); }}
                onDirtyChange={setEditorDirty}
                // Fold the "Save checkpoint" button + version history into
                // the editor's single unified toolbar instead of stacking
                // parent bars above it.
                toolbarTrailing={editorToolbarTrailing}
                // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §9,
                // U1): the editor's Focus button grows the POPUP (same DOM, CSS
                // size transition) instead of teleporting into its own
                // body-level overlay. The popup flushes this editor's buffer
                // before growing via the registered flush bridge.
                onRequestExpand={onRequestExpand}
                expanded={expanded}
                // file-unify bot: the single bottom attachments strip now
                // UNION-reads the retired Files panel's `ResultsPDFs/` folder
                // so files attached there still appear (view / delete). New
                // uploads write to Images/ + Files/ only.
                legacyAttachmentsDir={pdfsDir}
                // Experiment-collab chunk 2: when the pilot flag is on and the
                // Results handle is open, the CRDT owns the live text (the
                // editor seeds from + syncs to the Results doc's "content").
                // This is the Results doc, independent of the Lab Notes doc. The
                // task surface is a single text, so loroEntryIndex is 0 and there
                // is no loroBaseNote. collab cursors render only while a session
                // is live. Flag-off / open-failure leaves these undefined so the
                // legacy disk path is unchanged.
                loroHandle={
                  LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined
                }
                loroEntryIndex={LORO_PILOT_ENABLED ? 0 : undefined}
                collabEphemeral={collabActive ? collab.ephemeral : undefined}
                collabUser={collabActive ? collabUser : undefined}
              />
            )}
            </div>
            {docHistory.isOpen && (
              <TaskDocHistorySidebar
                controller={docHistory}
                surface="results"
                taskId={task.id}
                owner={task.owner || currentUser || ""}
                canRestore={!readOnly}
              />
            )}
          </div>
        </>
      )}
    </div>
    </>
  );
}

// ── Task Export Button Component ───────────────────────────────────────────────

function TaskExportButton({
  task,
  menuRow = false,
}: {
  task: Task;
  /** L3 declutter: render as a full-width overflow-menu row (icon + label)
   *  instead of the bare header icon-button. Same handler + dialog either way. */
  menuRow?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { currentUser } = useCurrentUser();

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setExporting(true);
      try {
        const result = await exportExperiments([task], format, currentUser);
        downloadResult(result);
        setDialogOpen(false);
      } catch (error) {
        console.error("Export failed:", error);
        alert(
          `Failed to export experiment: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      } finally {
        setExporting(false);
      }
    },
    [task, currentUser]
  );

  const exportGlyph = exporting ? (
    <svg
      className="animate-spin w-4 h-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  ) : (
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
      aria-hidden
    >
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );

  return (
    <>
      {menuRow ? (
        <button
          role="menuitem"
          aria-label="Export experiment"
          onClick={() => setDialogOpen(true)}
          disabled={exporting}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken disabled:opacity-50 transition-colors"
        >
          <span className="text-foreground-muted">{exportGlyph}</span>
          <span>{exporting ? "Exporting..." : "Export"}</span>
        </button>
      ) : (
        <Tooltip label="Export experiment" placement="bottom">
          <button
            aria-label="Export experiment"
            onClick={() => setDialogOpen(true)}
            disabled={exporting}
            className="text-foreground-muted hover:text-foreground-muted p-1 disabled:opacity-50"
          >
            {exportGlyph}
          </button>
        </Tooltip>
      )}

      {/* Format picker — hidden during the actual export so the
          ProgressEntertainer takes over the screen (Grant brief on
          the Centrifuge scene: pair big-save flows with a progress
          bar + entertaining animation). Single-task exports don't
          emit per-experiment progress events, so the bar runs in
          indeterminate mode. */}
      <ExportFormatDialog
        isOpen={dialogOpen && !exporting}
        taskCount={1}
        taskName={task.name}
        isExporting={exporting}
        onClose={() => setDialogOpen(false)}
        onExport={handleExport}
      />

      <ProgressEntertainer
        open={exporting}
        title="Preparing your export…"
        subtitle={`Exporting "${task.name}"`}
      />
    </>
  );
}

/**
 * Cross-boundary sharing (experiment track). The "Share outside this folder"
 * one-time send, mirrored from the note entry point in NoteDetailPopup. Opens
 * a dialog that builds the existing export bundle, seals it, and relays an
 * encrypted copy (not live editing) to one recipient on ResearchOS. Methods the
 * experiment references ride along inside the bundle. Identity-gated inside the
 * dialog via useSharingIdentity, so the button always renders for an experiment
 * and the dialog handles setup / restore / send.
 */
/**
 * Deposit-to-a-repository affordance (guided-deposit bot, 2026-05-28). Sits
 * beside the export button in the experiment popup header. Opens the guided
 * three-step deposit dialog: curate -> metadata -> hand off to a repository's
 * own web upload page. Phase 1 is the GUIDED path; no API calls, no DOI is
 * minted here.
 */
function TaskDepositButton({
  task,
  menuRow = false,
}: {
  task: Task;
  /** L3 declutter: render as a full-width overflow-menu row instead of the
   *  bare header icon-button. Same handler + dialog + testid either way. */
  menuRow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { currentUser } = useCurrentUser();

  // Repository / archive-with-upload-arrow glyph (inline SVG; no icon library,
  // no emoji).
  const depositGlyph = (
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
      aria-hidden
    >
      <path d="M21 8v13H3V8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <path d="M12 17V11" />
      <polyline points="9 14 12 11 15 14" />
    </svg>
  );

  return (
    <>
      {menuRow ? (
        <button
          role="menuitem"
          aria-label="Deposit to a repository"
          onClick={() => setOpen(true)}
          data-testid="task-deposit-button"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
        >
          <span className="text-foreground-muted">{depositGlyph}</span>
          <span>Deposit to a repository</span>
        </button>
      ) : (
        <Tooltip label="Deposit to a repository" placement="bottom">
          <button
            aria-label="Deposit to a repository"
            onClick={() => setOpen(true)}
            data-testid="task-deposit-button"
            className="text-foreground-muted hover:text-foreground-muted p-1"
          >
            {depositGlyph}
          </button>
        </Tooltip>
      )}

      <DepositDialog
        isOpen={open}
        task={task}
        currentUser={currentUser}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

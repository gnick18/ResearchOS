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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import PurchaseEditor from "./PurchaseEditor";
import DynamicAnimation from "./DynamicAnimation";
import MethodTabs from "./MethodTabs";
import TaskPicker from "./TaskPicker";
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import SharingChips from "@/components/sharing/SharingChips";
import { StampsRow } from "@/components/AttributionChip";
import CommentsThread from "./CommentsThread";
import Tooltip from "./Tooltip";
import { useAppStore } from "@/lib/store";
import { taskKey } from "@/lib/types";
import type { Task, Project, ShiftResult, SubTask } from "@/lib/types";
import type { GitHubTreeItem } from "@/lib/types";
import { createNewFileContent, normalizeStampFormat, hasLegacyStampFormat } from "@/lib/stamp-utils";
// TODO(manager): unstub once Sub-bot A lands frontend/src/lib/export/orchestrate.ts.
import { exportExperiments, downloadResult } from "@/lib/export/orchestrate";
import type { ExportFormat } from "@/lib/export/types";
import ExportFormatDialog from "@/components/ExportFormatDialog";
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
import { FileExtBadge } from "@/lib/utils/file-icons";
import { PaperclipIcon } from "@/lib/utils/icons";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { stripAttachmentReferences } from "@/lib/attachments/strip-references";
import { imageEvents } from "@/lib/attachments/image-events";
import { recordProjectActivity } from "@/lib/project-activity/event-log";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useLabHeadEditGate } from "@/hooks/useLabHeadEditGate";
import RequestEditButton from "./RequestEditButton";
import EditSessionBanner from "./EditSessionBanner";
import AuditTrailNotice from "./AuditTrailNotice";
import AssignTaskButton from "./lab-head/AssignTaskButton";
import FlagForReviewButton from "./lab-head/FlagForReviewButton";
import FlagBanner from "./lab-head/FlagBanner";
import {
  buildFieldDiffEntries,
  writeWithAudit,
} from "@/lib/lab/pi-audit";

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
}: TaskDetailPopupProps) {
  const queryClient = useQueryClient();
  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): wrap the
  // prop-passed `readOnly` flag with the edit-mode gate. When the active
  // user is a lab head and has unlocked a session for this record, the
  // effective readOnly flips false so write inputs (and the save handlers
  // that audit-log the diff) become available. Otherwise the gate is a
  // no-op pass-through of `propReadOnly`.
  const labHeadGate = useLabHeadEditGate({
    readOnly: propReadOnly,
    recordOwner: username ?? initialTask.owner ?? null,
  });
  const readOnly = labHeadGate.effectiveReadOnly;
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [animationPosition, setAnimationPosition] = useState<{ x: number; y: number } | null>(null);
  const [showSharePopup, setShowSharePopup] = useState(false);
  // R1 fix-pass: pending-enter-edit handshake between the header Edit
  // button and DetailsTab. The header click sets this flag (after
  // selectTab("details") if needed); DetailsTab consumes it on mount /
  // when it flips true and calls handleEnterEdit, then clears it. Lets
  // the tour script click Edit immediately on popup open even when the
  // popup defaults to Notes for experiments — the tab swap happens
  // first then the pending flag fires the edit-mode transition.
  const [pendingEnterEdit, setPendingEnterEdit] = useState(false);
  const { currentUser } = useCurrentUser();

  // Owner-aware view of tasksApi: when this popup is showing a task that was
  // shared to the current user with edit permission, every mutating call
  // routes through the owner's directory instead of the current user's.
  //
  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): when the popup
  // is in an unlocked PI edit session, mutations also route to the record
  // owner's folder AND each `update` writes per-field audit entries.
  const baseScopedTasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
  const labHeadOwner = labHeadGate.unlocked
    ? (username ?? task.owner ?? null)
    : null;
  const labHeadSessionId = labHeadGate.sessionId;
  const labHeadActor = labHeadGate.activeUser;
  const tasksApi = useMemo(() => {
    if (!labHeadOwner || !labHeadSessionId || !labHeadActor) {
      return baseScopedTasksApi;
    }
    // PI edit-session wrapper. Routes every mutation to the record-owner's
    // folder (the PI is editing IN their folder, not the PI's) and emits
    // per-field audit entries on update().
    const owner = labHeadOwner;
    const sessionId = labHeadSessionId;
    const actor = labHeadActor;
    return {
      ...baseScopedTasksApi,
      get: (id: number) => rawTasksApi.get(id, owner),
      update: async (
        id: number,
        data: Parameters<typeof rawTasksApi.update>[1],
      ) => {
        // Read the pre-edit record so we can build a diff. Owner-routed.
        const before = await rawTasksApi.get(id, owner);
        // Mira-Distracted P0 #2 fix (2026-05-23): route the data write +
        // audit append through `writeWithAudit` so they share the
        // per-user audit queue chain. Reduces the failure window where
        // a tab-unload between the two awaits leaves the record changed
        // with no audit entry. Track which phase succeeded so we can
        // preserve the prior behavior: data-write errors propagate
        // (caller treats the save as failed), audit-only errors are
        // swallowed with a warn (attribution loss is acceptable; the
        // edit itself succeeded).
        let updatedRef: Awaited<ReturnType<typeof rawTasksApi.update>> | null = null;
        try {
          return await writeWithAudit({
            targetUser: owner,
            dataWrite: async () => {
              const updated = await rawTasksApi.update(id, data, owner);
              updatedRef = updated;
              return updated;
            },
            buildEntries: (updated) => {
              if (!before || !updated) return [];
              const oldRecord = before as unknown as Record<string, unknown>;
              const newRecord = updated as unknown as Record<string, unknown>;
              const touchedFields = Object.keys(data).filter(
                (k) => k in oldRecord || k in newRecord,
              );
              return buildFieldDiffEntries({
                actor,
                session_id: sessionId,
                target_user: owner,
                record_type: "task",
                record_id: id,
                oldRecord,
                newRecord,
                fieldPaths: touchedFields,
              });
            },
          });
        } catch (err) {
          if (updatedRef !== null) {
            // Data write succeeded, audit append threw. Swallow + warn
            // (matches the pre-helper behavior) and return the post-write
            // record so the popup save UX still completes.
            console.warn(
              "[TaskDetailPopup] appendAuditEntries failed",
              err,
            );
            return updatedRef;
          }
          // Data write itself threw — propagate.
          throw err;
        }
      },
    };
  }, [
    baseScopedTasksApi,
    labHeadOwner,
    labHeadSessionId,
    labHeadActor,
  ]);

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
  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): when the PI
  // has unlocked edit mode on another member's record, the on-disk file
  // lives in the OWNER's directory and the fetch must owner-route to it.
  // Without this the popup would re-read from the PI's folder and clobber
  // the editable state with the wrong record.
  const ownerForTask = initialTask.is_shared_with_me
    ? initialTask.owner
    : labHeadGate.unlocked
      ? (username ?? initialTask.owner)
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
  //      element's own onKeyDown handler. HybridMarkdownEditor's
  //      handleEditKeyDown listens for Escape, blurs + commits the
  //      buffered edit, and stops propagation so we never see the key
  //      here. Without this branch the popup's old behavior swallowed
  //      Esc and closed the modal mid-cluster, breaking the tour's
  //      typing demos that dispatch a synthetic Escape via
  //      hybrid-editor-helpers.commitOpenEditAction between beats.
  //   2. Otherwise if the popup is fullscreen, shrink it instead of
  //      closing. The hybrid-editor-scope demo expanded the popup at
  //      the start of the cluster; Esc previously closed the popup
  //      entirely so fullscreen state didn't persist across steps.
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
      if (e.key !== "Escape") return;
      const active = typeof document !== "undefined"
        ? document.activeElement
        : null;
      if (isTextInputEl(active)) {
        // Branch 1: text input has focus, let it own the Escape.
        // The field's onKeyDown handler is responsible for blurring
        // and calling stopPropagation. If the field doesn't stop the
        // event we still don't close: dropping out of edit mode is
        // enough, and Grant's tour scripts rely on the popup surviving.
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
  }, [isExpanded, onClose]);

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

  // For simple tasks, render a minimal popup showing only the list and sublists
  if (isSimpleTask && !isExpanded) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
        // Marker for TourSpotlight (popup-occluding sweep manager,
        // 2026-05-27). Hides the v4 walkthrough ring while this popup
        // is mounted; see SnapshotTilePopup for the canonical example.
        data-tour-popup-occluding="task-detail-simple"
        onClick={onClose}
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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col overflow-hidden"
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
          {/* PI Phase 5 — simple-task branch banner. */}
          {labHeadGate.unlocked && labHeadGate.activeUser && (
            <EditSessionBanner
              contextLabel={`${username ?? task.owner ?? "lab member"}'s list: ${task.name}`}
              scopedToUsername={labHeadGate.activeUser}
            />
          )}
          {/* Minimal Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-center gap-2 flex-1 mr-2 min-w-0">
              {/* PI Phase 5 — Request edit button (simple-task header). */}
              {labHeadGate.canRequestEdit && !labHeadGate.unlocked && labHeadGate.activeUser && (
                <RequestEditButton
                  username={labHeadGate.activeUser}
                  targetLabel={`${username ?? task.owner ?? "member"}'s list: ${task.name}`}
                />
              )}
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
                        : "border-gray-300 hover:border-emerald-400 text-transparent hover:text-emerald-400"
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
                    : "border-2 border-gray-200 text-transparent"
                }`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </span>
              )}
              <h3 className={`text-base font-semibold truncate min-w-0 ${task.is_complete ? "text-gray-400 line-through" : "text-gray-900"}`}>
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
                    className={`p-1.5 rounded-lg transition-colors ${task.is_shared_with_me ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-red-600 hover:bg-red-50"}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Expand to full view" placement="bottom">
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
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
                  className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
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
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="task-detail"
      onClick={onClose}
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
        className={`bg-white rounded-2xl shadow-2xl w-full mx-4 flex flex-col transition-all duration-300 overflow-hidden ${
          isExpanded
            ? "inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
            : "max-w-5xl h-[90vh] max-h-[860px]"
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
        {/* PI Phase 5 (PI Phase 5 manager, 2026-05-23):
            unlocked-session timer banner. Renders only while the PI's
            session is unlocked AND it's THIS user's session (so a stale
            session on another popup doesn't bleed visual chrome here). */}
        {labHeadGate.unlocked && labHeadGate.activeUser && (
          <EditSessionBanner
            contextLabel={`${username ?? task.owner ?? "lab member"}'s task: ${task.name}`}
            scopedToUsername={labHeadGate.activeUser}
          />
        )}

        {/* Header */}
        {/* R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
            Removed the ringed-colored-dot type indicator. The dot, the
            colored type pill, and the underlying color all triggered
            on `task_type`; three signals saying the same thing read
            as visual noise. The pill stays (accessible label) and the
            top accent strip carries the color tone. Added flex-wrap
            so the action rail wraps below the title at narrow viewports
            instead of jamming together. */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 flex-wrap">
          <div className="flex items-start min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-semibold text-gray-900 leading-tight truncate max-w-[60ch]">
                  {task.name}
                </h3>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                    isExperiment
                      ? "bg-purple-50 text-purple-700"
                      : isPurchase
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {isExperiment ? "Experiment" : isPurchase ? "Purchase" : "Task"}
                </span>
                {/* Cross-owner "shared into project" pill. The X removes the
                    share — both the originating task owner AND the
                    destination project owner are allowed to unshare in v1
                    (this badge only renders for the task owner). */}
                {task.external_project && !task.is_shared_with_me && !readOnly && (
                  <Tooltip
                    label={`Click X to remove from ${task.external_project.owner}'s project`}
                    placement="bottom"
                  >
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
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
                        className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-wait"
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
              <div className="mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-1 text-xs text-gray-500">
                {project?.name && (
                  <>
                    <span className="font-medium text-gray-600">{project.name}</span>
                    <span className="text-gray-300">·</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1 text-gray-500">
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
                <span className="text-gray-300">·</span>
                <span>
                  {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
                </span>
                {task.is_complete && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
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
              {/* PI Phase 5 — record-level "Edited by PI" notice.
                  Shows any prior PI audit entries for this task; the inline
                  per-field notices below the field inputs are handled
                  separately (this one is the catch-all at the header). */}
              {propReadOnly && (username || task.owner) && (
                <AuditTrailNotice
                  targetUser={(username ?? task.owner) as string}
                  recordType="task"
                  recordId={task.id}
                />
              )}
            </div>
          </div>
          {/* R1 fix-pass: drop flex-shrink-0 + add flex-wrap so the rail
              wraps onto a second line at narrow viewports (≤~600px)
              instead of jamming against the title block. */}
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {/* PI Phase 5: Request edit button. Visible only when
                this is a PI viewing another member's record + no session
                is currently unlocked. Clicking opens the password modal. */}
            {labHeadGate.canRequestEdit && !labHeadGate.unlocked && labHeadGate.activeUser && (
              <RequestEditButton
                username={labHeadGate.activeUser}
                targetLabel={`${username ?? task.owner ?? "member"}'s task: ${task.name}`}
              />
            )}
            {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
                Assign + Flag-for-review buttons. Only render while the
                PI's edit session is unlocked AND this is a cross-owner
                view (the canRequestEdit gate covers the latter). */}
            {labHeadGate.canRequestEdit && labHeadGate.unlocked && labHeadGate.activeUser && labHeadGate.sessionId && (
              <>
                <AssignTaskButton
                  task={task}
                  actor={labHeadGate.activeUser}
                  sessionId={labHeadGate.sessionId}
                  onAssigned={() => {
                    void queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
                  }}
                />
                <FlagForReviewButton
                  recordType="task"
                  recordId={task.id}
                  recordName={task.name}
                  targetOwner={task.owner}
                  actor={labHeadGate.activeUser}
                  sessionId={labHeadGate.sessionId}
                  currentFlag={task.flagged ?? null}
                  onFlagged={() => {
                    void queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
                  }}
                />
              </>
            )}
            {/* Completion pill — single combined affordance that doubles as
                status + toggle. Replaces the old "Mark as complete →" hint
                + raw checkmark icon (chief offender on the "looks janky"
                complaint). */}
            {!readOnly ? (
              <Tooltip
                label={task.is_complete ? "Mark as incomplete" : "Mark as complete"}
                placement="bottom"
              >
                <button
                  onClick={async () => {
                    try {
                      await tasksApi.update(task.id, { is_complete: !task.is_complete });
                      await Promise.all([
                        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                      ]);
                    } catch {
                      alert("Failed to update task");
                    }
                  }}
                  className={`group/complete inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    task.is_complete
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200"
                      : "bg-white text-gray-700 hover:text-emerald-700 hover:bg-emerald-50 ring-1 ring-gray-200 hover:ring-emerald-200"
                  }`}
                >
                  {/* R1 fix-pass: when complete, swap the check icon for a
                      subtle reset arrow on hover so the toggle nature is
                      hinted at without shouting. */}
                  {task.is_complete ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="block group-hover/complete:hidden" aria-hidden>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="hidden group-hover/complete:block" aria-hidden>
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                    </>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {task.is_complete ? "Complete" : "Mark complete"}
                </button>
              </Tooltip>
            ) : task.is_complete ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Complete
              </span>
            ) : null}
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
                  `task-popup-edit-button` tour target. */}
              {!readOnly && (
                <Tooltip label="Edit properties" placement="bottom">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab !== "details") selectTab("details");
                      setPendingEnterEdit(true);
                    }}
                    data-tour-target="task-popup-edit-button"
                    className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors"
                    aria-label="Edit properties"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              {isExperiment && <TaskExportButton task={task} />}
              {!readOnly && !task.is_shared_with_me && (
                <Tooltip label="Share task" placement="bottom">
                  <button
                    onClick={() => setShowSharePopup(true)}
                    data-tour-target="task-popup-share-button"
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label={isExpanded ? "Exit fullscreen" : "Fullscreen"} placement="bottom">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  data-tour-target="task-popup-fullscreen"
                  className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
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
                        ? "text-gray-300 cursor-not-allowed"
                        : "text-gray-400 hover:text-red-600 hover:bg-red-50"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Close (Esc)" placement="bottom">
                <button
                  onClick={onClose}
                  data-tour-target="task-popup-close"
                  className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
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

        {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23): flag
            banner + assignee chip. The banner shows for everyone who can
            see the task (PI + owner), with a "Clear flag" affordance
            scoped to the owner. The assignee chip surfaces when an
            assignee is set AND differs from the owner. */}
        {task.flagged && (
          <div className="px-6 pt-3">
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
          </div>
        )}
        {task.assignee && task.assignee !== task.owner && (
          <div className="px-6 pt-2 flex items-center gap-2 text-xs">
            <span className="text-gray-500">Assigned to</span>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200"
              data-testid="task-assignee-chip"
            >
              {task.assignee}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">Owner: {task.owner}</span>
          </div>
        )}

        {/* R1b: sharing chips — read-only visibility hint row right
            below the header so viewers can see at a glance who else is
            on this task without opening the share dialog.
            R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
            Hide the chips row entirely when there's nothing to share
            (no co-collaborators, not a shared-with-me task). The empty
            state was "you (owner) private" which added a row of header
            chrome with zero signal. Tour mount still happens via
            SharingChips' internal data-tour-target when the row IS
            visible. */}
        {((task.shared_with?.length ?? 0) > 0 || task.is_shared_with_me) && (
          <div className="px-6 pt-2">
            <SharingChips
              sharedWith={task.shared_with || []}
              ownerUsername={task.owner}
              viewerUsername={currentUser ?? undefined}
              hideWhenEmpty
            />
          </div>
        )}

        {/* VCP R3 attribution stamps (VCP R3 attribution stamps,
            2026-05-26): popup stamps row. Tasks store no `created_at`
            today (per §3g — task is one of the FLAG'd entities missing
            it pre-R3); pass null so the row only shows "Last edited
            by X on D" until §3g lands the createdAt fan-out in R4. */}
        <div className="px-6 pt-2">
          <StampsRow
            createdBy={null}
            createdAt={null}
            lastEditedBy={task.last_edited_by}
            lastEditedAt={task.last_edited_at}
          />
        </div>

        {/* Tabs — clean underline pattern with a quiet hover state. The old
            tabs sat on a gray strip with the active tab back on white,
            which read as a chrome leak from the header. Now they sit on
            the same surface as the header for a smoother seam. */}
        <div
          className="flex items-stretch gap-1 px-6 border-b border-gray-100"
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
                className={`relative px-3.5 py-3 text-sm font-medium transition-colors -mb-px ${
                  isActive
                    ? "text-blue-600"
                    : "text-gray-500 hover:text-gray-800"
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

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
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
            />
          )}
          {activeTab === "notes" && <LabNotesTab task={task} readOnly={readOnly} ownerUsername={username} />}
          {activeTab === "method" && (
            <MethodTabs 
              task={task} 
              onTaskUpdate={(updatedTask) => setTask(updatedTask)} 
              readOnly={readOnly}
            />
          )}
          {activeTab === "results" && <ResultsTab task={task} readOnly={readOnly} ownerUsername={username} />}
          {activeTab === "purchases" && (
            <PurchaseEditor
              taskId={task.id}
              readOnly={readOnly || (task.is_shared_with_me === true && task.shared_permission === "view")}
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
        </div>

        {/* Lab comments (per-task, mirrors NoteCommentsThread). Mounted
            outside the tab-content scroll area so it stays visible regardless
            of which tab is active. Experiments only — purchase/list tasks
            don't have a lab-comment use case in v1 per Grant's clickable
            ("Add to experiments — same component, mount on
            TaskDetailPopup"). */}
        {isExperiment && (
          <CommentsThread
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
        )}

        {universalDropToast && (
          <div
            className="fixed z-50 max-w-sm rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 shadow-lg pointer-events-none flex items-center gap-2"
            style={{
              left: Math.max(8, Math.min(universalDropToast.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 400)),
              top: Math.max(8, Math.min(universalDropToast.y + 12, (typeof window !== "undefined" ? window.innerHeight : 768) - 100)),
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 flex-shrink-0" aria-hidden>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{universalDropToast.msg}</span>
          </div>
        )}
      </div>

      {/* Share Popup */}
      <ShareDialogAdapter
        isOpen={showSharePopup}
        onClose={() => setShowSharePopup(false)}
        recordType="task"
        recordId={task.id}
        recordName={task.name}
        ownerUsername={task.owner}
        currentSharedWith={task.shared_with || []}
        onShared={() => queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] })}
      />
      {/* Universal-drop duplicate-name resolver. Inner tabs (LabNotesTab,
          ResultsTab) own their OWN resolver instances since their upload
          handlers are gated on per-tab state. This one fires only for
          drops that land outside an editor card. */}
      <UniversalDuplicateDialog />
    </div>
  );
}

// ── Simple Task Checklist (for "list" task type) ──────────────────────────────

function SimpleTaskChecklist({
  task,
  onAnimationTrigger,
  readOnly = false,
}: {
  task: Task;
  onAnimationTrigger: (pos: { x: number; y: number }) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
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
    <div className="p-3">
      {/* Sub-tasks list */}
      <div className="space-y-1 mb-2.5">
        {subTasks.map((st, idx) => (
          <div
            key={st.id}
            className={`flex items-center gap-2.5 group py-1.5 px-2.5 rounded-md hover:bg-gray-50 transition-colors ${
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
                    ? "bg-blue-500 border-blue-500"
                    : "border-gray-300 hover:border-blue-400"
                } ${readOnly ? "cursor-default" : ""}`}
              >
                {st.is_complete && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </Tooltip>
            <span className={`flex-1 text-sm ${st.is_complete ? "line-through text-gray-400" : "text-gray-700"}`}>
              {st.text}
            </span>
            {!readOnly && (
              <Tooltip label="Delete item" placement="bottom">
                <button
                  onClick={() => handleDeleteSubTask(st.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
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
        <div className="flex gap-2">
          <input
            type="text"
            value={newSubTaskText}
            onChange={(e) => setNewSubTaskText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSubTask()}
            placeholder="Add item..."
            data-tour-target="workbench-list-add-item-input"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <Tooltip label="Add item" placement="bottom">
            <button
              onClick={handleAddSubTask}
              disabled={!newSubTaskText.trim() || saving}
              className="px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Project</dt>
          <dd className="text-sm text-gray-900 mt-1">
            {project?.name || (task.is_shared_with_me ? `Shared project (by ${task.owner})` : "—")}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Type</dt>
          <dd className="text-sm text-gray-900 mt-1 capitalize">{task.task_type}</dd>
        </div>
        {!hasDependencies && (
          <>
            <div>
              <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Start</dt>
              <dd className="text-sm text-gray-900 mt-1 font-mono">{task.start_date}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">End</dt>
              <dd className="text-sm text-gray-900 mt-1 font-mono">{task.end_date}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Duration</dt>
          <dd className="text-sm text-gray-900 mt-1">
            {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
          </dd>
        </div>
        {/* R1 fix-pass: Status pill now lives in the Properties card header
            row alongside the title — keeping it here as a labeled dl row
            would be a duplicate signal. */}
      </dl>
      {task.weekend_override && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700 flex-shrink-0 mt-0.5">
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
          <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Tags</dt>
          <div className="flex gap-1 flex-wrap">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {task.deviation_log && (
        <div>
          <dt className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Deviation log
          </dt>
          <div className="prose prose-sm prose-gray max-w-none bg-amber-50 border border-amber-100 rounded-lg p-3">
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
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
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

  // Resolve the selected dropdown value back to a (owner, id) pair.
  const selectedProjectInfo = useMemo(() => {
    const [owner, rawId] = selectedProjectKey.split(":");
    const id = Number(rawId);
    return { owner: owner ?? "", id: Number.isFinite(id) ? id : 0 };
  }, [selectedProjectKey]);

  // Whose-project-is-this-anyway sentinel. Drives the save flow's
  // "share into project" vs "regular project_id update" branch.
  const isSelectedProjectForeign = useMemo(() => {
    if (!currentUser) return false;
    // The task's own owner. For shared-with-me tasks (receiver editing),
    // that's the owner field; for own tasks it's the current user.
    const taskOwner = task.owner || currentUser;
    return selectedProjectInfo.owner && selectedProjectInfo.owner !== taskOwner;
  }, [currentUser, task.owner, selectedProjectInfo.owner]);

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

  // Find dependencies for this task
  const taskDependencies = dependencies.filter(d => d.child_id === task.id);
  const dependentTasks = dependencies.filter(d => d.parent_id === task.id);

  // Get parent task names
  const parentTasks = taskDependencies
    .map(dep => allTasks.find(t => t.id === dep.parent_id))
    .filter(Boolean) as Task[];

  // Get child task names
  const childTasks = dependentTasks
    .map(dep => allTasks.find(t => t.id === dep.child_id))
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
      const newStart = new Date(parentStart);
      newStart.setDate(newStart.getDate() - durationDays + 1);
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
        // Regular update - don't send start_date if task has parent dependencies
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId,
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
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId,
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
    // First, collect all tasks in the dependency graph
    const chainTasks = new Set<number>();
    const visited = new Set<number>();
    
    // Helper to find all tasks in the chain (both upstream and downstream)
    const collectChainTasks = (taskId: number) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      chainTasks.add(taskId);
      
      // Add parents (tasks this depends on)
      const parentDeps = dependencies.filter(d => d.child_id === taskId);
      for (const dep of parentDeps) {
        collectChainTasks(dep.parent_id);
      }
      
      // Add children (tasks that depend on this)
      const childDeps = dependencies.filter(d => d.parent_id === taskId);
      for (const dep of childDeps) {
        collectChainTasks(dep.child_id);
      }
    };
    
    // Collect all tasks in this chain
    collectChainTasks(task.id);
    
    // Get all tasks in the chain with their data
    const tasksInChain = allTasks.filter(t => chainTasks.has(t.id));
    
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
  }, [task.id, allTasks, dependencies]);

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
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-rose-900">
                Duplicate task name
              </h4>
              <p className="text-xs text-rose-800 mt-0.5">
                A task with this name already exists in this project:
              </p>
              <ul className="mt-2 space-y-1">
                {duplicateWarning.matching_tasks.map((t) => (
                  <li key={t.id} className="text-xs text-rose-800 flex items-center gap-2 bg-white border border-rose-100 rounded-lg px-2 py-1">
                    <strong className="text-rose-900">{t.name}</strong>
                    <span className="text-rose-500">
                      Started {t.start_date} · {t.is_complete ? "Completed" : "In Progress"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDuplicateWarning(null)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Change name
                </button>
                <button
                  onClick={handleProceedWithDuplicate}
                  className="px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-300 hover:bg-rose-100 rounded-lg transition-colors"
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
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-rose-900">
                Convert task type
              </h4>
              <p className="text-xs text-rose-800 mt-0.5">
                Converting from <strong className="capitalize">{task.task_type}</strong> will permanently delete type-specific data:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-rose-700">
                {getConversionWarnings(task.task_type).map((warning, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1 w-1 h-1 rounded-full bg-rose-400 flex-shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-rose-800 mt-3">
                <strong>Kept:</strong> name, dates, duration, project, completion status, and tags.
              </p>
              <div className="mt-3">
                <label className="block text-[11px] font-medium text-rose-700 uppercase tracking-wide mb-1">
                  Convert to
                </label>
                <select
                  value={convertToType}
                  onChange={(e) => setConvertToType(e.target.value as "experiment" | "purchase" | "list")}
                  className="w-full px-3 py-2 bg-white border border-rose-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
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
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConvertTaskType}
                  disabled={converting}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50"
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
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h4 className="text-base font-semibold text-gray-900">Sub-tasks</h4>
            {subTasks.length > 0 && (
              <span className="text-xs text-gray-500">
                {subTasks.filter(st => st.is_complete).length} of {subTasks.length} complete
              </span>
            )}
          </div>
          
          {/* Progress bar */}
          {subTasks.length > 0 && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                {/* R1 fix-pass: orange→yellow gradient leaked the legacy
                    sub-task palette into the new blue-centric chrome. Flat
                    blue matches the rest of the popup. */}
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
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
                className={`flex items-center gap-2 group py-1.5 px-2 rounded-lg hover:bg-white transition-colors ${
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
                        ? "bg-blue-600 border-blue-600"
                        : "border-gray-300 hover:border-blue-400"
                    }`}
                  >
                    {st.is_complete && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
                <span className={`flex-1 text-sm ${st.is_complete ? "line-through text-gray-400" : "text-gray-700"}`}>
                  {st.text}
                </span>
                <Tooltip label="Delete sub-task" placement="bottom">
                  <button
                    onClick={() => handleDeleteSubTask(st.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-opacity"
                    data-force-hover-controls-target
                  >
                    ✕
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
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleAddSubTask}
              disabled={!newSubTaskText.trim() || saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </section>
      )}

      {/* Shift Confirmation Modal */}
      {showShiftConfirm && shiftResult && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-amber-900">
                This change will affect {shiftResult.affected_tasks.length} task{shiftResult.affected_tasks.length !== 1 ? "s" : ""}
              </h4>
              <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
                {shiftResult.affected_tasks.map((t) => (
                  <div key={t.task_id} className="text-xs text-amber-800 flex items-center gap-2 bg-white border border-amber-100 rounded-lg px-2 py-1">
                    <strong className="text-amber-900">{t.name}</strong>
                    <span className="text-amber-600">{t.old_start} → {t.new_start}</span>
                  </div>
                ))}
              </div>
              {shiftResult.warnings.length > 0 && (
                <div className="mt-3 border-t border-amber-200 pt-3">
                  <p className="text-xs font-medium text-rose-700 mb-1">Warnings</p>
                  <ul className="text-xs text-rose-600 space-y-1">
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
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmShift}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
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
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h4 className="text-base font-semibold text-gray-900">Dependency chain</h4>
            <span className="text-xs text-gray-500">
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
                          <div className="w-8 h-0.5 bg-gray-300" />
                          <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-400">
                            <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                          </svg>
                          <div className="w-8 h-0.5 bg-gray-300" />
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
                            className={`relative px-4 py-2 rounded-lg text-sm transition-all ${
                              isCurrentTask
                                ? "bg-blue-50 text-blue-700 font-medium ring-1 ring-blue-200"
                                : "bg-white text-gray-700 border border-gray-200 hover:border-blue-400 hover:shadow-md cursor-pointer hover:bg-blue-50"
                            }`}
                            onClick={() => {
                              if (!isCurrentTask && onNavigateToTask) {
                                onNavigateToTask(chainTask);
                              }
                            }}
                            title={!isCurrentTask ? `Click to view: ${chainTask.name}` : undefined}
                          >
                            <span className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${isCurrentTask ? "bg-blue-500" : "bg-gray-400"}`} />
                              <span className="max-w-[200px] truncate">{chainTask.name}</span>
                              {isCurrentTask && (
                                <span className="text-xs opacity-75">(this task)</span>
                              )}
                              {!isCurrentTask && onNavigateToTask && (
                                <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                              <div className="w-8 h-0.5 bg-gray-300" />
                              <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-400">
                                <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                              </svg>
                              <div className="w-8 h-0.5 bg-gray-300" />
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
        </section>
      )}

      {/* Properties card — single section that toggles between read-only
          rows and inline editable inputs. Same shape in both modes so the
          read↔edit transition reads as a state change on the same fields,
          not a layout swap (the old "Edit / Exit edit mode" pattern flipped
          the whole layout out from under the user). */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* R1 fix-pass (experiments fix-pass R1 manager, 2026-05-23):
            Dropped the "Name, project, schedule, and other fields" subtitle
            — "Properties" already says that. Surface the completion-status
            pill in the same row so the read-only header carries actual
            signal instead of filler. Edit affordance lifted to the popup
            header rail (Edit pencil there now); Cancel/Save still live
            here because they're scoped to the in-card form state. */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h4 className="text-base font-semibold text-gray-900">Properties</h4>
            {!editing && (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
                  task.is_complete
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-blue-50 text-blue-700"
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
              <span className="text-xs text-gray-500">Editing — Save when done</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}
            {editing && (
              <>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  data-tour-target="task-popup-save-button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    hasUnsavedChanges && !saving
                      ? "text-white bg-blue-600 hover:bg-blue-700"
                      : "text-gray-400 bg-gray-100 cursor-not-allowed"
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
            <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1.5">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-tour-target="task-popup-name-input"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Project — own projects appear normally; cross-owner shared
              projects appear under "Share into…" and trigger a confirmation
              modal on save. */}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1.5">
              Project
            </label>
            <select
              value={selectedProjectKey}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedProjectKey(next);
                // Keep the legacy projectId state in sync for own-project
                // picks so handleSave's existing `tasksApi.update` call
                // gets the right id. Foreign picks branch off in handleSave.
                const [nextOwner, nextRawId] = next.split(":");
                const nextId = Number(nextRawId);
                if (nextOwner === (task.owner || currentUser || "")) {
                  setProjectId(Number.isFinite(nextId) ? nextId : 0);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <optgroup label="My projects">
                {projects
                  .filter((p) => !p.is_shared_with_me)
                  .map((p) => (
                    <option key={`${p.owner}:${p.id}`} value={`${p.owner}:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
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
              <p className="mt-1 text-xs text-amber-600">
                This task will be shared into {selectedProjectInfo.owner}&apos;s project.
                It stays in your library; {selectedProjectInfo.owner} will see it on their Gantt.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Hide start date field if task has parent dependencies */}
            {parentTasks.length === 0 && (
              <div>
                <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {dependentTasks.length > 0 && startDate !== task.start_date && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ Will shift {dependentTasks.length} dependent task(s)
                  </p>
                )}
              </div>
            )}
            <div className={parentTasks.length > 0 ? "col-span-2" : ""}>
              <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1.5">
                Duration (days)
              </label>
              <input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Remove from Dependency Chain Section - only show if task has dependencies */}
          {hasDependencies && (
            <div className="border-t border-gray-100 pt-4">
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
                  className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500"
                />
                <span className="text-sm text-red-600 font-medium">
                  Remove from dependency chain
                </span>
              </label>
              
              {showRemoveFromChain && (
                <div className="mt-3 pl-6 space-y-2">
                  <p className="text-xs text-gray-500">
                    This task will become standalone. Set its new start date:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={removeStartDate}
                      onChange={(e) => setRemoveStartDate(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveFromChain}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Removing..." : "Remove from Chain"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add Dependency Section - only for experiment tasks */}
          {canHaveDependencies && (
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-2">
                Add Dependency (optional)
              </label>
              <div className="space-y-2">
                {selectedNewParent ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-gray-900 truncate">
                        {selectedNewParent.name}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {selectedNewParent.start_date} → {selectedNewParent.end_date}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewParentTaskId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowParentPicker(true)}
                    disabled={availableParentTasks.length === 0}
                    className="w-full text-left px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <p className="text-xs text-amber-800">
                        <strong>New Start Date:</strong> {suggestedNewStartDate}
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        {newDepType === "FS" && `Will start after "${selectedNewParent?.name}" ends`}
                        {newDepType === "SS" && `Will start at same time as "${selectedNewParent?.name}"`}
                        {newDepType === "SF" && `Will finish when "${selectedNewParent?.name}" starts`}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddDependency}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
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
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={weekendOverride === true}
                    onChange={(e) => setWeekendOverride(e.target.checked ? true : null)}
                    className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="text-sm text-amber-800 font-medium">
                      I&apos;m okay with working on the weekend
                    </span>
                    <p className="text-xs text-amber-600 mt-0.5">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                task.is_shared_with_me
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-600 hover:text-rose-700 hover:bg-rose-50"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900">
                  Share into {pendingShareTarget.owner}&apos;s project?
                </h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  <strong>{pendingShareTarget.name}</strong> belongs to{" "}
                  <strong>{pendingShareTarget.owner}</strong>.
                </p>
              </div>
            </div>
            <ul className="text-sm text-gray-700 space-y-2 mb-4 bg-gray-50 rounded-lg p-3 border border-gray-100">
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  The task <strong>stays in your library</strong> — you remain its owner.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  {pendingShareTarget.owner} sees it on their Gantt next to their own tasks.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden>
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
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sharingIntoProject}
                onClick={handleConfirmShareIntoProject}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
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

type ContentSubTab = "markdown" | "pdfs";

function LabNotesTab({ task, readOnly = false, ownerUsername }: { task: Task; readOnly?: boolean; ownerUsername?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const { currentUser } = useCurrentUser();
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const split = await ensureAttachmentsSplit(content);
      const toWrite = split.migrated ? split.notesContent : content;
      await filesApi.writeFile(notesPath, toWrite, `Update lab notes for: ${task.name}`);
      setContent(toWrite);
      setOriginalContent(toWrite);
      // Saved content now lives on disk — drop the SPA-nav draft so the
      // next mount doesn't re-promote the now-redundant copy.
      clearNotesDraft();
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [content, ensureAttachmentsSplit, notesPath, task.name, clearNotesDraft]);

  return (
    <>
      <FileRenamePopup />
      <DuplicateDialog />
      <div className="flex flex-col h-full">
        {/* Sub-tabs for Markdown and PDFs — segmented control matches the
            recent purchases / settings polish bar (compact, contained). */}
        <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-100">
          <div className="inline-flex items-center p-0.5 bg-gray-100 rounded-lg">
            <button
              onClick={() => setActiveSubTab("markdown")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "markdown"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Markdown
            </button>
            <button
              onClick={() => setActiveSubTab("pdfs")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "pdfs"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              Files
            </button>
          </div>
        </div>

        {activeSubTab === "markdown" ? (
          <>
            {/* Toolbar - hidden in readOnly mode */}
            {!readOnly && (
              <div className="flex items-center gap-2 px-6 py-2.5 border-b border-gray-100">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  {uploading ? "Uploading..." : "Add file"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFileUpload(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
                <div className="flex-1" />
                {hasUnsavedChanges && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Unsaved changes
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    hasUnsavedChanges && !saving
                      ? "text-white bg-blue-600 hover:bg-blue-700"
                      : "text-gray-400 bg-gray-100 cursor-not-allowed"
                  }`}
                >
                  {saving ? "Saving..." : "Save notes"}
                </button>
              </div>
            )}

            {/* File size warning */}
            {uploadWarning && (
              <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
                <div className="flex items-start gap-2">
                  <span className="text-amber-500 text-sm">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm text-amber-800">{uploadWarning}</p>
                  </div>
                  <Tooltip label="Dismiss warning" placement="bottom">
                    <button
                      onClick={() => setUploadWarning(null)}
                      className="text-amber-400 hover:text-amber-600 text-sm"
                    >
                      ✕
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
              <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
                <div className="flex items-start gap-3">
                  <svg
                    aria-hidden
                    className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
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
                    <p className="text-sm font-medium text-amber-900">
                      {missingInline.length} inline image
                      {missingInline.length === 1 ? "" : "s"} from your
                      LabArchives import didn&apos;t come through
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">
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
                      className="shrink-0 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
                to scroll as a unit. */}
            <div className="flex-1 min-h-0 flex flex-col">
              {loading ? (
                <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-gray-200 rounded" />
                <div className="h-3 w-full bg-gray-200 rounded" />
                <div className="h-3 w-5/6 bg-gray-200 rounded" />
                <div className="h-3 w-4/5 bg-gray-100 rounded" />
              </div>
              ) : (
                <LiveMarkdownEditor
                  value={content}
                  onChange={setContent}
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
                  showToolbar={true}
                />
              )}
            </div>
          </>
        ) : (
          <PdfAttachmentsPanel
            pdfsDir={pdfsDir}
            label="Lab Notes"
            body={content}
            onBodyChange={setContent}
          />
        )}
      </div>

      {rehydrateModalOpen && missingInline && missingInline.length > 0 && currentUser && (
        <RehydrateMissingImagesModal
          notesBase={attachBase}
          notesMarkdownPath={notesPath}
          missingImages={missingInline}
          onApplied={() => {
            // Bump the reload key so the markdown re-reads from disk
            // (rehydrate.ts rewrote the body in place) and the sidecar
            // probe re-runs to shrink the banner count.
            setRehydrateReloadKey((k) => k + 1);
          }}
          onClose={() => setRehydrateModalOpen(false)}
        />
      )}
    </>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ task, readOnly = false, ownerUsername }: { task: Task; readOnly?: boolean; ownerUsername?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const { currentUser } = useCurrentUser();
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const split = await ensureAttachmentsSplit(content);
      const toWrite = split.migrated ? split.resultsContent : content;
      await filesApi.writeFile(resultsPath, toWrite, `Update results: ${task.name}`);
      setContent(toWrite);
      setOriginalContent(toWrite);
      // Saved to disk — drop the SPA-nav draft.
      clearResultsDraft();
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, ensureAttachmentsSplit, resultsPath, task.name, clearResultsDraft]);

  return (
    <>
      <FileRenamePopup />
      <DuplicateDialog />
      <div className="flex flex-col h-full">
        {/* Sub-tabs for Markdown and PDFs — segmented control matches the
            recent purchases / settings polish bar (compact, contained). */}
        <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-100">
          <div className="inline-flex items-center p-0.5 bg-gray-100 rounded-lg">
            <button
              onClick={() => setActiveSubTab("markdown")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "markdown"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Markdown
            </button>
            <button
              onClick={() => setActiveSubTab("pdfs")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "pdfs"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              Files
            </button>
          </div>
        </div>

        {activeSubTab === "markdown" ? (
        <>
          {/* Toolbar - hidden in readOnly mode */}
          {!readOnly && (
            <div className="flex items-center gap-2 px-6 py-2.5 border-b border-gray-100">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                {uploading ? "Uploading..." : "Add file"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFileUpload(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <div className="flex-1" />
              {hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Unsaved changes
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  hasUnsavedChanges && !saving
                    ? "text-white bg-blue-600 hover:bg-blue-700"
                    : "text-gray-400 bg-gray-100 cursor-not-allowed"
                }`}
              >
                {saving ? "Saving..." : "Save results"}
              </button>
            </div>
          )}

          {/* File size warning */}
          {uploadWarning && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-sm">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm text-amber-800">{uploadWarning}</p>
                </div>
                <Tooltip label="Dismiss warning" placement="bottom">
                  <button
                    onClick={() => setUploadWarning(null)}
                    className="text-amber-400 hover:text-amber-600 text-sm"
                  >
                    ✕
                  </button>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Editor — sized flex slot so the markdown scrolls inside the
              editor, not by pushing the whole tab. Matches the LabNotes
              tab and the fullscreen behavior. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {loading ? (
              <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-gray-200 rounded" />
                <div className="h-3 w-full bg-gray-200 rounded" />
                <div className="h-3 w-5/6 bg-gray-200 rounded" />
                <div className="h-3 w-4/5 bg-gray-100 rounded" />
              </div>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
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
                showToolbar={true}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel
          pdfsDir={pdfsDir}
          label="Results"
          body={content}
          onBodyChange={setContent}
        />
      )}
    </div>
    </>
  );
}

// ── PDF Attachments Panel ─────────────────────────────────────────────────────

// Helper to determine if a file is renderable in browser
const isRenderableFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'md', 'txt'].includes(ext);
};

// Helper to determine if a file is markdown
const isMarkdownFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ext === 'md';
};

// getFileIcon replaced by shared FileExtBadge component (see lib/utils/file-icons.tsx)

// Helper to get MIME type
const getMimeType = (filename: string): string => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

interface PdfAttachment {
  name: string;
  path: string;
  url: string | null;
  loading: boolean;
  isRenderable: boolean;
}

function PdfAttachmentsPanel({
  pdfsDir,
  label,
  body,
  onBodyChange,
}: {
  pdfsDir: string;
  label: string;
  // Editor body + onChange so a delete from the Files sub-tab can strip
  // any inline references the user added by hand. Optional because
  // callers without a body (none today) can still mount the panel.
  body?: string;
  onBodyChange?: (next: string) => void;
}) {
  const [files, setFiles] = useState<PdfAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeFile, setActiveFile] = useState<PdfAttachment | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const dirFiles = await filesApi.listDirectory(pdfsDir);

      const attachments: PdfAttachment[] = dirFiles.map((f: GitHubTreeItem) => ({
        name: f.name,
        path: f.path,
        url: null,
        loading: false,
        isRenderable: isRenderableFile(f.name),
      }));

      setFiles(attachments);
    } catch {
      // Directory doesn't exist yet
      setFiles([]);
    }
    setLoading(false);
  }, [pdfsDir]);

  // Load files from directory. loadFiles is async and calls setState
  // internally; the lint rule trips on the transitive setState but this is
  // a standard "fetch on mount/dep change" pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFiles();
  }, [loadFiles]);

  // Handle file upload
  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${pdfsDir}/${fileName}`;
          
          await filesApi.uploadImage(
            filePath,
            base64,
            `Upload file for ${label}: ${file.name}`
          );
          
          // Refresh the list
          await loadFiles();
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
    setUploading(false);
  }, [pdfsDir, label, loadFiles]);

  // Load and display a file
  const handleViewFile = useCallback(async (file: PdfAttachment) => {
    if (!file.isRenderable) {
      // For non-renderable files, offer download
      try {
        const fileData = await filesApi.readFile(file.path);
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        alert("Failed to download file");
      }
      return;
    }
    
    setActiveFile(file);
    setFileUrl(null);
    setMarkdownContent(null);
    
    try {
      const fileData = await filesApi.readFile(file.path);
      
      // Check if it's a markdown file - render with ReactMarkdown
      if (isMarkdownFile(file.name)) {
        // Decode base64 to text
        const binaryString = atob(fileData.content);
        const textContent = decodeURIComponent(escape(binaryString));
        setMarkdownContent(textContent);
      } else {
        // For PDFs and images, create blob URL for iframe
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        setFileUrl(url);
      }
    } catch {
      alert("Failed to load file");
      setActiveFile(null);
    }
  }, []);

  // Delete a file
  const handleDeleteFile = useCallback(async (file: PdfAttachment) => {
    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      const ok = await fileService.deleteFile(file.path);
      if (!ok) {
        alert("Failed to delete file");
        return;
      }
      if (body !== undefined && onBodyChange) {
        const next = stripAttachmentReferences(body, file.name, "Files");
        if (next !== body) onBodyChange(next);
      }
      fileEvents.emitDeleted({ basePath: pdfsDir, filename: file.name });
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      if (activeFile?.path === file.path) {
        setActiveFile(null);
        setFileUrl(null);
        setMarkdownContent(null);
      }
    } catch {
      alert("Failed to delete file");
    }
  }, [activeFile, body, onBodyChange, pdfsDir]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  if (activeFile) {
    const isMarkdown = isMarkdownFile(activeFile.name);
    
    return (
      <div className="flex flex-col h-full">
        {/* File Viewer Header */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
          <button
            onClick={() => {
              setActiveFile(null);
              setFileUrl(null);
              setMarkdownContent(null);
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            ← Back to Files
          </button>
          <span className="text-sm text-gray-600 truncate">{activeFile.name}</span>
        </div>
        
        {/* File Viewer */}
        <div className="flex-1 overflow-hidden">
          {isMarkdown ? (
            markdownContent ? (
              <div className="h-full overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
                  {markdownContent}
                </ReactMarkdown>
              </div>
            ) : (
              // R1 fix-pass: replaced plain "Loading..." text with the
              // skeleton-block pattern used elsewhere (matches lab-notes
              // editor loading state) so all loading surfaces speak the
              // same visual language.
              <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-gray-200 rounded" />
                <div className="h-3 w-full bg-gray-200 rounded" />
                <div className="h-3 w-5/6 bg-gray-200 rounded" />
                <div className="h-3 w-4/5 bg-gray-100 rounded" />
              </div>
            )
          ) : (
            fileUrl ? (
              <iframe
                src={fileUrl}
                className="w-full h-full"
                title={activeFile.name}
              />
            ) : (
              // R1 fix-pass: same skeleton swap for the non-markdown file
              // preview. PDF/image previews use the iframe shell so a few
              // skeleton bars stand in for the rendered content.
              <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-gray-200 rounded" />
                <div className="h-3 w-full bg-gray-200 rounded" />
                <div className="h-3 w-5/6 bg-gray-200 rounded" />
                <div className="h-3 w-4/5 bg-gray-100 rounded" />
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-gray-100">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {uploading ? "Uploading..." : "Add file"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <span className="text-xs text-gray-500">
          PDFs and images view inline, other files download
        </span>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-4 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-10 rounded bg-gray-200 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 bg-gray-200 rounded" />
                    <div className="h-2 w-1/2 bg-gray-100 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-16 max-w-sm mx-auto">
            <div className="w-12 h-12 rounded-full bg-gray-100 mx-auto mb-3 flex items-center justify-center">
              <PaperclipIcon className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">No files yet</p>
            <p className="text-xs text-gray-500 mb-4">
              Drop files here or click <span className="font-medium text-gray-700">Add file</span> to upload PDFs, images, or any document.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add your first file
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {files.map((file) => (
              <div
                key={file.path}
                className="group relative bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => handleViewFile(file)}
              >
                <div className="flex items-start gap-3">
                  <FileExtBadge filename={file.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {file.isRenderable ? "Click to view" : "Click to download"}
                    </p>
                  </div>
                </div>
                <Tooltip label="Delete file" placement="bottom">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                    aria-label={`Delete ${file.name}`}
                    data-force-hover-controls-target
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task Export Button Component ───────────────────────────────────────────────

function TaskExportButton({ task }: { task: Task }) {
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

  return (
    <>
      <Tooltip label="Export experiment" placement="bottom">
        <button
          aria-label="Export experiment"
          onClick={() => setDialogOpen(true)}
          disabled={exporting}
          className="text-gray-400 hover:text-gray-600 p-1 disabled:opacity-50"
        >
          {exporting ? (
            <svg
              className="animate-spin w-4 h-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
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
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        </button>
      </Tooltip>

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

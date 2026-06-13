"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { useQueryClient } from "@tanstack/react-query";
import { filesApi } from "@/lib/local-api";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import {
  diffMarkdownLines,
  type DiffSegment,
} from "@/lib/methods/markdown-line-diff";
import {
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CHIP_TEXT,
} from "@/lib/methods/diff-display";
import Tooltip from "@/components/Tooltip";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import VariationNotesPanel from "./VariationNotesPanel";

interface MarkdownMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: route the body override into the compound's
   *  `compound_snapshots[child_id]` slot. Snapshot shape is
   *  `{ body_override: string }`. */
  nestedSnapshot?: NestedSnapshotAdapter<{ body_override: string }>;
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

// Tailwind utility bundles for the diff-line highlights. Kept inline rather
// than exported from diff-display.ts because diff-display's row/cell classes
// target table-shaped editors (PCR/LC); the body-diff is a free-flowing
// markdown overlay and wants its own visual treatment ("amber background
// with colored text + decoration" per the spec).
const DIFF_REMOVED_CLASSES =
  "bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200 text-red-700 dark:text-red-300 line-through whitespace-pre-wrap font-mono text-meta px-2 py-1 rounded";
const DIFF_ADDED_CLASSES =
  "bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200 text-green-700 dark:text-green-300 underline decoration-green-600 whitespace-pre-wrap font-mono text-meta px-2 py-1 rounded";

/**
 * Render a diff between the source markdown body and the per-task override.
 *
 * `same` runs are passed through ReactMarkdown so multi-line markdown
 * constructs (lists, paragraphs, code fences, tables) keep working in the
 * unchanged majority of the body. `add` / `remove` runs render as plain
 * monospaced blocks — losing inline markdown formatting in the changed
 * regions is the v1 trade-off (the alternative, full markdown rendering
 * inside hunks, is fragile when a hunk splits a fenced block or list).
 */
function DiffView({ segments }: { segments: DiffSegment[] }) {
  return (
    <div className="space-y-3">
      {segments.map((segment, idx) => {
        if (segment.kind === "same") {
          return (
            <div key={idx} className="prose prose-sm prose-gray max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
                {segment.lines.join("\n")}
              </ReactMarkdown>
            </div>
          );
        }
        const classes =
          segment.kind === "add" ? DIFF_ADDED_CLASSES : DIFF_REMOVED_CLASSES;
        return (
          <div key={idx} className={classes}>
            {segment.lines.join("\n")}
          </div>
        );
      })}
    </div>
  );
}

export default function MarkdownMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: MarkdownMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const [sourceBody, setSourceBody] = useState("");
  const [loading, setLoading] = useState(true);

  // Persisted override mirror. In compound-child mode the override comes
  // from the nested-snapshot adapter; otherwise it's the attachment's
  // standalone `body_override` field.
  const nestedRead = nestedSnapshot?.read;
  const savedOverride: string | null = nestedRead
    ? (nestedRead()?.body_override ?? null)
    : (attachment?.body_override ?? null);

  const [isEditing, setIsEditing] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Load source method body from disk. Mirrors the original behavior:
  // for editable (non-readOnly) users we still opportunistically run the
  // legacy-image migration and write the result back to the source file.
  // The migration is a source-of-truth normalization on the method file
  // itself, NOT on the per-task override — so it intentionally stays here.
  useEffect(() => {
    if (!method.source_path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const sourcePath = method.source_path;
    (async () => {
      try {
        const file = await filesApi.readFile(sourcePath);
        const raw = file.content;
        if (readOnly) {
          if (!cancelled) {
            setSourceBody(raw);
            setLoading(false);
          }
          return;
        }
        const dir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
        const slug = dir.split("/").pop() || dir;
        const legacyOwner = method.owner || method.created_by || undefined;
        const { content: migrated, didMigrate } = await migrateNoteImages(
          raw,
          slug,
          dir,
          legacyOwner,
        );
        if (didMigrate) {
          await filesApi.writeFile(
            sourcePath,
            migrated,
            `Migrate image references for: ${method.name}`,
          );
        }
        if (!cancelled) {
          setSourceBody(migrated);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSourceBody("*Method file not found.*");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [method.source_path, method.owner, method.created_by, method.name, readOnly]);

  // When the editor opens, seed it with the current displayed body — i.e.
  // the override if it exists, otherwise the source. Re-seeds whenever the
  // saved override or source body changes externally (e.g. owner refetch
  // of a shared task) BUT only while the editor isn't open, so we never
  // clobber in-flight typed edits.
  const displayedBody = savedOverride ?? sourceBody;
  useEffect(() => {
    if (isEditing) return;
    setEditorContent(displayedBody);
  }, [displayedBody, isEditing]);

  // The "unsaved changes" pill compares the editor against whatever counts
  // as the saved state for this attachment: the persisted override if one
  // exists, else the source body. Without an override on the task yet, a
  // first edit will still be flagged dirty against the source — which is
  // the intent (the user is about to create the override).
  const baselineForDirtyCheck = savedOverride ?? sourceBody;
  const hasUnsavedChanges = isEditing && editorContent !== baselineForDirtyCheck;

  const diffSegments = useMemo(() => {
    if (savedOverride === null) return [];
    return diffMarkdownLines(sourceBody, savedOverride);
  }, [sourceBody, savedOverride]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.write({ body_override: editorContent });
        setIsEditing(false);
      } else {
        const updated = await tasksApi.updateMethodMarkdownOverride(
          task.id,
          methodId,
          editorContent,
        );
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updated) onTaskUpdate?.(updated);
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Failed to save markdown override:", err);
      alert("Failed to save method body changes");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, editorContent, tasksApi, queryClient, onTaskUpdate, nestedSnapshot]);

  const handleReset = useCallback(async () => {
    if (
      !confirm(
        "Reset to the source method's body? Your per-task documented variation will be lost.",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
        setIsEditing(false);
      } else {
        const updated = await tasksApi.resetMarkdownOverride(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updated) onTaskUpdate?.(updated);
        // Drop the editor open if it was. The next view-mode render will
        // re-seed editorContent from the now-cleared override (= source).
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Failed to reset markdown override:", err);
      alert("Failed to reset method body");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, tasksApi, queryClient, onTaskUpdate, nestedSnapshot]);

  const handleCancelEdit = useCallback(() => {
    setEditorContent(baselineForDirtyCheck);
    setIsEditing(false);
  }, [baselineForDirtyCheck]);

  if (loading) {
    return <div className="p-6 text-body text-foreground-muted animate-pulse">Loading method...</div>;
  }

  const hasOverride = savedOverride !== null;

  return (
    <div className="flex flex-col h-full">
      {!hideVariationNotes && (
        <VariationNotesPanel
          task={task}
          methodId={methodId}
          variationNotes={attachment?.variation_notes || null}
          onSaved={(updatedTask) => {
            if (updatedTask) onTaskUpdate?.(updatedTask);
            queryClient.refetchQueries({ queryKey: ["tasks"] });
            queryClient.refetchQueries({ queryKey: ["allTasks"] });
          }}
          readOnly={readOnly}
          piActor={piActor}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Toolbar: chip + edit/reset/save controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasOverride && (
              <Tooltip
                label="This method's body has been modified for this task; the source method is unchanged."
                placement="bottom"
              >
                <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
              </Tooltip>
            )}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-meta text-amber-600 dark:text-amber-300">Unsaved changes</span>
              )}
              {isEditing ? (
                <>
                  <Tooltip label="Discard editor changes and return to the saved body">
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </Tooltip>
                  <Tooltip label="Save this body as a per-task override (the source method stays unchanged)">
                    <button
                      onClick={handleSave}
                      disabled={saving || !hasUnsavedChanges}
                      className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </Tooltip>
                </>
              ) : (
                <>
                  {hasOverride && (
                    <Tooltip label="Clear the per-task override and show the source method body">
                      <button
                        onClick={handleReset}
                        disabled={saving}
                        className="px-3 py-1.5 text-meta bg-surface-sunken text-foreground-muted rounded-lg hover:bg-foreground-muted/15 disabled:opacity-50"
                      >
                        Reset to source method
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="Edit this method's body for this task only (the source method stays unchanged)">
                    <button
                      onClick={() => setIsEditing(true)}
                      disabled={saving}
                      className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
                    >
                      Edit body
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          )}
        </div>

        {/* Body region: editor textarea OR diff view OR plain markdown. */}
        {isEditing ? (
          <textarea
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[24rem] p-3 font-mono text-body border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Edit the method body for this task. The source method stays unchanged."
          />
        ) : hasOverride ? (
          <DiffView segments={diffSegments} />
        ) : (
          <div className="prose prose-sm prose-gray max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
              {sourceBody}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

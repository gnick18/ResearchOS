"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import type { Task } from "@/lib/types";
import { useDropWarning } from "@/lib/use-drop-warning";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import Tooltip from "@/components/Tooltip";

interface VariationEntry {
  heading: string;
  body: string;
}

/**
 * Split a variation-notes markdown blob into individual entries, each headed
 * by a `### Variation ...` line. Handles both legacy ("Variation (timestamp)")
 * and current ("Variation - timestamp") header formats. Any text before the
 * first header is returned as a leading entry with an empty heading so it
 * isn't silently dropped.
 */
function parseVariationEntries(markdown: string): VariationEntry[] {
  if (!markdown.trim()) return [];
  const headerRegex = /^###\s+Variation\b[^\n]*$/gm;
  const matches: Array<{ text: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(markdown)) !== null) {
    matches.push({ text: m[0], start: m.index });
  }
  if (matches.length === 0) {
    return [{ heading: "", body: markdown.trim() }];
  }
  const entries: VariationEntry[] = [];
  // Anything before the first header — preserve as a heading-less entry.
  const prologue = markdown.substring(0, matches[0].start).trim();
  if (prologue) entries.push({ heading: "", body: prologue });
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : markdown.length;
    const heading = matches[i].text;
    const body = markdown.substring(start + heading.length, end).replace(/^\n+/, "").replace(/\s+$/, "");
    entries.push({ heading, body });
  }
  return entries;
}

/**
 * Remove the `entryIndex`-th `### Variation` entry from the markdown.
 * Indices match `parseVariationEntries` output (a leading heading-less entry,
 * if present, counts as index 0 and is not deletable via this helper — the
 * caller should hide the trash button for that case).
 */
function removeVariationEntry(markdown: string, entryIndex: number): string {
  const headerRegex = /^###\s+Variation\b[^\n]*$/gm;
  const matches: Array<{ start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(markdown)) !== null) {
    matches.push({ start: m.index });
  }
  // Account for a leading heading-less prologue offsetting indices by 1.
  const prologue = matches.length > 0 ? markdown.substring(0, matches[0].start).trim() : "";
  const headerArrayIndex = prologue ? entryIndex - 1 : entryIndex;
  if (headerArrayIndex < 0 || headerArrayIndex >= matches.length) return markdown;
  const start = matches[headerArrayIndex].start;
  const end =
    headerArrayIndex + 1 < matches.length
      ? matches[headerArrayIndex + 1].start
      : markdown.length;
  return (markdown.substring(0, start) + markdown.substring(end)).trim();
}

interface VariationNotesPanelProps {
  task: Task;
  methodId: number;
  variationNotes: string | null;
  // Called after a successful save/delete with the freshly persisted task
  // (or null if the API somehow returned no record). Parent threads this
  // into `onTaskUpdate` so the popup's local `task` state — and therefore
  // the `variationNotes` prop we read on the next render — reflects the
  // write. The earlier implementation relied on `queryClient.refetchQueries`
  // with key `["task", task.id]`, which doesn't match the popup's actual
  // key `["task", taskKey(task)]` (a composite owner-scoped string), so the
  // refetch was a no-op and the saved note never reappeared.
  onSaved: (updatedTask: Task | null) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

// Debounce window for autosave-on-input. 700ms strikes a balance between
// "feels instant after you stop typing" and "doesn't fire mid-word." Mirrors
// the running-log auto-save cadence in NoteDetailPopup.
const AUTOSAVE_DEBOUNCE_MS = 700;
// How long the "Saved" affordance lingers after a successful write before
// the indicator fades back to idle. Long enough to register, short enough
// not to feel sticky.
const SAVED_INDICATOR_LINGER_MS = 1500;

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Tiny status pill for the autosave loop. Three visible states:
 * - `saving`  → spinner + "Saving..."
 * - `saved`   → check + "Saved" (briefly, then auto-fades to idle)
 * - `error`   → red "Save failed — retry will happen on next edit"
 * Idle with no pending changes renders nothing. Idle with pending changes
 * (hasUnsavedChanges=true) renders a muted "Unsaved changes" so the user
 * isn't left wondering whether their typing is being captured.
 */
function SaveStatusIndicator({
  status,
  hasUnsavedChanges,
}: {
  status: SaveStatus;
  hasUnsavedChanges: boolean;
}) {
  if (status === "saving") {
    return (
      <span className="text-meta text-foreground-muted flex items-center gap-1">
        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Saving...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="text-meta text-emerald-600 dark:text-emerald-300 flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-meta text-red-600 dark:text-red-300 flex items-center gap-1" title="Will retry on the next edit">
        Save failed
      </span>
    );
  }
  if (hasUnsavedChanges) {
    return <span className="text-meta text-amber-600 dark:text-amber-300 flex items-center">Unsaved changes</span>;
  }
  return null;
}

export default function VariationNotesPanel({ task, methodId, variationNotes, onSaved, readOnly = false, piActor }: VariationNotesPanelProps) {
  // Match MethodTabs: thread owner through saveVariationNote when this is a
  // shared-with-edit task — otherwise writes land in the wrong namespace.
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(variationNotes || "");
  // Baseline = the last value we know is durably on disk. Cancel reverts to
  // this; the autosave loop compares against this to skip no-op writes.
  // (Previously called `originalContent` and only updated on explicit Save.)
  const [lastSavedContent, setLastSavedContent] = useState(variationNotes || "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Variation notes are stored inline in the Task JSON, not in a Files/
  // folder — so dropping a file here has nowhere to go. Flash a toast.
  const { show: showDropWarning, toast: dropWarningToast } = useDropWarning(
    "File attachments aren't supported on variation notes. Attach files via the method's main page or a task's Lab Notes / Results tab."
  );

  // Track unsaved changes (drives the "Unsaved..." → "Saving..." → "Saved"
  // status indicator; the Save button is gone now).
  const hasUnsavedChanges = content !== lastSavedContent;

  // Autosave timer + "saved" lingering timer. Both kept in refs so renders
  // never cancel a pending save.
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const savedLingerTimerRef = useRef<NodeJS.Timeout | null>(null);
  // The latest content the user has typed, mirrored as a ref so the unmount
  // flush below can read it without depending on state closure.
  const contentRef = useRef(content);
  // Last value we actually wrote to disk. Used to skip duplicate writes when
  // the debounce fires but nothing changed since the last save.
  const lastWrittenRef = useRef(variationNotes || "");
  // Track which `variationNotes` value seeded `content`. Stops the external-
  // sync `useEffect` below from clobbering in-flight typed edits whenever
  // the parent re-renders (e.g. after onSaved updates the parent task).
  const seededFromRef = useRef(variationNotes || "");
  // Latest `tasksApi`/`methodId`/`task.id`/`onSaved` mirrored to refs so the
  // unmount-flush effect can run a final save without re-binding (and
  // therefore re-running) every time one of those changes.
  const tasksApiRef = useRef(tasksApi);
  const methodIdRef = useRef(methodId);
  const taskIdRef = useRef(task.id);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { tasksApiRef.current = tasksApi; }, [tasksApi]);
  useEffect(() => { methodIdRef.current = methodId; }, [methodId]);
  useEffect(() => { taskIdRef.current = task.id; }, [task.id]);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => { contentRef.current = content; }, [content]);

  // Count the number of variation entries (### headers)
  const noteCount = useMemo(() => {
    if (!variationNotes) return 0;
    const matches = variationNotes.match(/^###\s+Variation/gm);
    return matches ? matches.length : 0;
  }, [variationNotes]);

  // Reset content when notes change externally (e.g. server-side update,
  // owner refetch). Guarded: only re-seed when the incoming `variationNotes`
  // is actually different from what we last seeded with, otherwise typing
  // would race against parent re-renders triggered by our own autosave.
  useEffect(() => {
    const next = variationNotes || "";
    if (next === seededFromRef.current) return;
    seededFromRef.current = next;
    lastWrittenRef.current = next;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reseed of editor buffer when the parent passes a genuinely new variationNotes value (e.g. after an external save, or task switch); skips the no-op case so in-flight typing isn't clobbered
    setContent(next);
    setLastSavedContent(next);
  }, [variationNotes]);

  // Core save fn — single source of truth for both the debounced autosave
  // and the per-entry delete handler. Skips no-op writes (same content as
  // the last successful save).
  const saveNow = useCallback(
    async (next: string) => {
      if (next === lastWrittenRef.current) return null;
      setSaveStatus("saving");
      try {
        const updated = await tasksApiRef.current.saveVariationNote(
          taskIdRef.current,
          methodIdRef.current,
          next,
        );
        lastWrittenRef.current = next;
        // Mirror the seed-ref so the external-sync useEffect doesn't fire
        // when the parent re-renders with the value we just wrote.
        seededFromRef.current = next;
        setLastSavedContent(next);
        onSavedRef.current(updated);
        setSaveStatus("saved");
        if (savedLingerTimerRef.current) clearTimeout(savedLingerTimerRef.current);
        savedLingerTimerRef.current = setTimeout(() => {
          setSaveStatus("idle");
        }, SAVED_INDICATOR_LINGER_MS);
        return updated;
      } catch (err) {
        console.error("Failed to save variation notes:", err);
        setSaveStatus("error");
        return null;
      }
    },
    [],
  );

  // Schedule a debounced autosave whenever `content` diverges from the last
  // written baseline. Runs only while the editor is open (Edit mode) and the
  // task isn't read-only — otherwise typed edits in the read view (which
  // shouldn't happen, but defensively) are inert.
  useEffect(() => {
    if (readOnly || !isEditing) return;
    if (content === lastWrittenRef.current) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      saveNow(content);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [content, isEditing, readOnly, saveNow]);

  // Flush pending edits on unmount. This is the critical safety net for the
  // "type → hit Escape → popup closes → panel unmounts" path that used to
  // discard work. We bypass `saveNow`'s state setters (component is going
  // away) and fire the API call directly.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (savedLingerTimerRef.current) {
        clearTimeout(savedLingerTimerRef.current);
        savedLingerTimerRef.current = null;
      }
      const pending = contentRef.current;
      if (pending !== lastWrittenRef.current) {
        // Best-effort fire-and-forget. We can't await on unmount, and the
        // panel is gone so there's no UI to surface an error on. Errors
        // will land in the console.
        tasksApiRef.current
          .saveVariationNote(taskIdRef.current, methodIdRef.current, pending)
          .then((updated) => {
            onSavedRef.current(updated);
          })
          .catch((err) => {
            console.error("Failed to flush variation notes on unmount:", err);
          });
      }
    };
  }, []);

  // Generate a new timestamped entry
  const generateTimestamp = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    return `${dateStr} ${timeStr}`;
  };

  // Add a new note entry
  const handleAddNote = useCallback(() => {
    const timestamp = generateTimestamp();
    const newEntry = `### Variation - ${timestamp}\n\n`;
    setContent(prev => newEntry + prev);
    setIsEditing(true);
  }, []);

  // Cancel editing — explicit revert to last-saved baseline. Cancels any
  // pending debounced autosave so the just-reverted content isn't
  // re-overwritten on the next tick.
  const handleCancel = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setContent(lastSavedContent);
    setIsEditing(false);
    setSaveStatus("idle");
  }, [lastSavedContent]);

  // Delete a single variation entry (in-place; no Edit All needed).
  // Bypasses the debounce — destructive actions should be immediate.
  const handleDeleteEntry = useCallback(
    async (entryIndex: number) => {
      if (!variationNotes) return;
      if (!window.confirm("Delete this variation note? This can't be undone.")) return;
      const updatedMarkdown = removeVariationEntry(variationNotes, entryIndex);
      await saveNow(updatedMarkdown);
      // Sync the in-memory editor buffer to the post-delete content so the
      // next edit cycle starts from the right baseline.
      setContent(updatedMarkdown);
    },
    [variationNotes, saveNow],
  );

  // `saving` flag for disabling Cancel / delete buttons mid-write.
  const saving = saveStatus === "saving";

  // Split rendered notes into individual entries so each gets its own delete button.
  const entries = useMemo(() => parseVariationEntries(variationNotes || ""), [variationNotes]);

  return (
    <div className="border-b border-border" data-tour-target="experiment-variation-notes">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-sunken hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-foreground">Variation Notes</span>
          {noteCount > 0 && (
            <span className="text-meta px-1.5 py-0.5 bg-surface-raised text-foreground-muted rounded">
              {noteCount} {noteCount === 1 ? "entry" : "entries"}
            </span>
          )}
          {!variationNotes && (
            <span className="text-meta text-foreground-muted italic">Click to add notes</span>
          )}
        </div>
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
          className={`text-foreground-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="bg-surface-sunken p-4">
          {isEditing ? (
            <div className="space-y-3">
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Write your variation notes in markdown..."
                showToolbar={true}
                allowAnyFileType={true}
                onFileDrop={() => showDropWarning()}
              />
              <div className="flex justify-end items-center gap-2">
                {/* Autosave status indicator. Replaces the explicit Save
                    button — input is debounced-persisted (700ms) and the
                    label is the only visible save affordance. Hidden when
                    fully idle so the panel stays calm at rest. */}
                <SaveStatusIndicator status={saveStatus} hasUnsavedChanges={hasUnsavedChanges} />
                <Tooltip label="Revert to last saved value">
                  <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </Tooltip>
                <Tooltip label="Close the editor (your edits are saved automatically)">
                  <button
                    onClick={() => setIsEditing(false)}
                    disabled={saving}
                    className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
                  >
                    Done
                  </button>
                </Tooltip>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {variationNotes && entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((entry, idx) => {
                    // Heading-less leading prologue (legacy data) — no delete button.
                    const canDelete = !readOnly && entry.heading !== "";
                    return (
                      <div
                        key={idx}
                        className="group relative bg-surface-raised rounded-lg p-4 pr-9 border border-border"
                      >
                        {canDelete && (
                          <Tooltip label="Delete this variation" placement="left">
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(idx)}
                              disabled={saving}
                              className="absolute top-2 right-2 p-1 text-foreground-muted hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                              aria-label="Delete this variation"
                              data-force-hover-controls-target
                            >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                            </button>
                          </Tooltip>
                        )}
                        <div className="prose prose-sm prose-gray max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
                            {entry.heading ? `${entry.heading}\n\n${entry.body}` : entry.body}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 rounded-lg border border-border bg-surface-raised text-foreground-muted">
                  <p className="text-body">No variation notes yet.</p>
                  <p className="text-meta mt-1">Document any changes you make to the method during this experiment.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {!readOnly && (
                  <button
                    onClick={handleAddNote}
                    className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg"
                  >
                    + Add Note
                  </button>
                )}
                {variationNotes && !readOnly && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg"
                  >
                    Edit All
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {dropWarningToast}
    </div>
  );
}

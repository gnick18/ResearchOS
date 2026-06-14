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
import { Icon } from "@/components/icons";

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

/**
 * Strip the leading `### Variation - ...` marker (and any markdown noise) from
 * an entry so the card can show a compact, human one-line title. Falls back to
 * "Variation" for heading-less legacy prologue entries.
 */
function entryTitle(entry: VariationEntry): string {
  if (!entry.heading) return "Variation";
  return entry.heading.replace(/^###\s+/, "").trim() || "Variation";
}

/**
 * Collapse an entry body to a single readable line for the card preview:
 * drop markdown headers/bullets/emphasis markers and whitespace runs.
 */
function entryPreview(entry: VariationEntry): string {
  const raw = entry.body || "";
  const flat = raw
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat;
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

/**
 * Floating full-text summary popup for a hovered card. Modeled on the
 * MethodExperimentsSidebar variation-notes popup: `fixed z-50 w-80
 * bg-surface-raised rounded-lg shadow-xl border border-border p-4
 * pointer-events-none`, anchored to the LEFT of the card (the column lives on
 * the right edge of the pane, so the bubble opens inward). Renders the FULL
 * note body as markdown so formatting is preserved on hover.
 */
function VariationHoverSummary({
  entry,
  position,
}: {
  entry: VariationEntry;
  position: { x: number; y: number };
}) {
  return (
    <div
      className="fixed z-50 w-80 bg-surface-raised rounded-lg shadow-xl border border-border p-4 pointer-events-none"
      style={{
        // Open to the LEFT of the card (column is on the right edge): 320px
        // bubble + 12px gap from the card's left edge.
        left: `calc(${position.x}px - 332px)`,
        top: `${position.y}px`,
        maxHeight: "320px",
        overflowY: "auto",
      }}
    >
      <h4 className="text-meta font-semibold text-foreground mb-2 flex items-center gap-1">
        {/* Reused note glyph from the MethodExperimentsSidebar popup. */}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Variations
      </h4>
      <div className="text-meta text-foreground-muted whitespace-pre-wrap prose prose-xs max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
          {entry.heading ? `${entry.heading}\n\n${entry.body}` : entry.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default function VariationNotesPanel({ task, methodId, variationNotes, onSaved, readOnly = false, piActor }: VariationNotesPanelProps) {
  // Match MethodTabs: thread owner through saveVariationNote when this is a
  // shared-with-edit task — otherwise writes land in the wrong namespace.
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);
  // Narrow-width collapse: the column folds to a thin "Variations (N)" strip
  // the user expands by hover or click. Default expanded on wide layouts; the
  // container CSS (see MethodTabs) drives the actual responsive hide, this is
  // the manual toggle for the strip affordance.
  const [isColumnCollapsed, setIsColumnCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(variationNotes || "");
  // Card whose full note is currently shown in the hover summary popup, plus
  // the on-screen anchor for it.
  const [hoveredEntryIndex, setHoveredEntryIndex] = useState<number | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
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

  // Split rendered notes into individual entries so each gets its own card.
  const entries = useMemo(() => parseVariationEntries(variationNotes || ""), [variationNotes]);

  const hoveredEntry =
    hoveredEntryIndex !== null && entries[hoveredEntryIndex]
      ? entries[hoveredEntryIndex]
      : null;

  // ---- Narrow-width collapsed strip ------------------------------------
  // A thin vertical bar showing "Variations (N)" that the user expands by
  // clicking. Used at narrow content widths (also reachable via the in-column
  // collapse chevron). Keeps the read-only gating: clicking only toggles the
  // column open, no editing affordances are exposed here.
  if (isColumnCollapsed) {
    return (
      <div
        className="flex w-9 flex-shrink-0 flex-col items-center border-l border-border bg-surface-secondary"
        data-tour-target="experiment-variation-notes"
      >
        <Tooltip label="Show variation notes" placement="left">
          <button
            type="button"
            onClick={() => setIsColumnCollapsed(false)}
            className="flex flex-1 flex-col items-center gap-2 px-1.5 py-3 text-foreground-muted hover:text-foreground"
            aria-label={`Show variation notes${noteCount > 0 ? ` (${noteCount})` : ""}`}
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
            <span
              className="text-meta font-medium tracking-wide"
              style={{ writingMode: "vertical-rl" }}
            >
              Variations{noteCount > 0 ? ` (${noteCount})` : ""}
            </span>
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className="flex w-[248px] flex-shrink-0 flex-col border-l border-border bg-surface-secondary"
      data-tour-target="experiment-variation-notes"
    >
      {/* Column header: "Variations" label + Add + a collapse chevron. */}
      <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-body font-medium text-foreground">Variations</span>
          {noteCount > 0 && (
            <span className="text-meta rounded bg-surface-raised px-1.5 py-0.5 text-foreground-muted">
              {noteCount}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {!readOnly && !isEditing && (
            <Tooltip label="Add a variation note" placement="bottom">
              <button
                type="button"
                onClick={handleAddNote}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-meta text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                aria-label="Add a variation note"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add
              </button>
            </Tooltip>
          )}
          <Tooltip label="Collapse variations" placement="left">
            <button
              type="button"
              onClick={() => setIsColumnCollapsed(true)}
              className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label="Collapse variations"
            >
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Body: editor (when editing) or the scrollable list of entry cards. */}
      <div className="flex-1 overflow-y-auto p-2">
        {isEditing ? (
          <div className="space-y-2">
            <LiveMarkdownEditor
              value={content}
              onChange={setContent}
              placeholder="Write your variation notes in markdown..."
              showToolbar={true}
              allowAnyFileType={true}
              onFileDrop={() => showDropWarning()}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Autosave status indicator. Input is debounced-persisted
                  (700ms) — the label is the only visible save affordance. */}
              <SaveStatusIndicator status={saveStatus} hasUnsavedChanges={hasUnsavedChanges} />
              <Tooltip label="Revert to last saved value">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-lg px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken disabled:opacity-50"
                >
                  Cancel
                </button>
              </Tooltip>
              <Tooltip label="Close the editor (your edits are saved automatically)">
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                  className="rounded-lg bg-brand-action px-3 py-1.5 text-meta text-white hover:bg-brand-action/90 disabled:opacity-50"
                >
                  Done
                </button>
              </Tooltip>
            </div>
          </div>
        ) : variationNotes && entries.length > 0 ? (
          <div className="space-y-1.5">
            {entries.map((entry, idx) => {
              // Heading-less leading prologue (legacy data) — no delete button.
              const canDelete = !readOnly && entry.heading !== "";
              const preview = entryPreview(entry);
              return (
                <div
                  key={idx}
                  className="group relative rounded-md border border-border bg-surface p-2.5 pr-7 transition-colors hover:border-foreground-muted/40 hover:shadow-sm"
                  onMouseEnter={(e) => {
                    setHoveredEntryIndex(idx);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPopupPosition({ x: rect.left, y: rect.top });
                  }}
                  onMouseLeave={() => setHoveredEntryIndex(null)}
                >
                  {/* Date / title line */}
                  <div className="truncate text-meta font-medium text-foreground">
                    {entryTitle(entry)}
                  </div>
                  {/* One-line preview of the note body */}
                  {preview ? (
                    <div className="mt-0.5 truncate text-meta text-foreground-muted">
                      {preview}
                    </div>
                  ) : (
                    <div className="mt-0.5 truncate text-meta italic text-foreground-muted">
                      No details yet
                    </div>
                  )}

                  {canDelete && (
                    <Tooltip label="Delete this variation" placement="left">
                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(idx)}
                        disabled={saving}
                        className="absolute right-1.5 top-1.5 rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        aria-label="Delete this variation"
                        data-force-hover-controls-target
                      >
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              );
            })}
            {variationNotes && !readOnly && (
              <button
                onClick={() => setIsEditing(true)}
                className="w-full rounded-md px-3 py-1.5 text-meta text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                Edit all
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-foreground-muted">
            <p className="text-meta">No variation notes yet.</p>
            <p className="mt-1 text-meta">
              Document any changes you make to the method during this experiment.
            </p>
            {!readOnly && (
              <button
                onClick={handleAddNote}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-brand-action px-3 py-1.5 text-meta text-white transition-colors hover:bg-brand-action/90"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add note
              </button>
            )}
          </div>
        )}
      </div>

      {/* Hover summary popup — full note text next to the hovered card. */}
      {!isEditing && hoveredEntry && (
        <VariationHoverSummary entry={hoveredEntry} position={popupPosition} />
      )}

      {dropWarningToast}
    </div>
  );
}

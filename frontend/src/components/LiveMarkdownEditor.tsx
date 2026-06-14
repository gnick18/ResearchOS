"use client";

import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { usePreloadOnIdle } from "@/lib/perf/use-preload-on-idle";
import { extractUserContent } from "@/lib/stamp-utils";
import RenderedMarkdown, { type ImageClickPayload } from "./RenderedMarkdown";
import { FIGURE_DIRECTIVE } from "@/lib/embeds/figure-numbering";
import { attachmentsApi } from "@/lib/local-api";
import InlineMarkdownEditor from "./InlineMarkdownEditor";

// ReferencePicker is lazy (loads the heavy list APIs + MoleculeThumbnail RDKit
// only when opened). next/dynamic gives a no-SSR wrapper so the initial bundle
// is unaffected. `dynamic` is already imported above from "next/dynamic".
const ReferencePicker = dynamic(
  () => import("./references/ReferencePicker"),
  { ssr: false },
);
import type { EditorLoroHandle } from "@/lib/loro/editor-handle";
import type { Note } from "@/lib/types";
import MarkdownShortcutsSidebar from "./MarkdownShortcutsSidebar";
import { blobUrlResolver, encodeAttachmentRefPath } from "@/lib/utils/blob-url-resolver";
import { fileService } from "@/lib/file-system/file-service";
import ImageResizePopover from "./ImageResizePopover";
import { filenameFromMarkdownSrc } from "@/lib/attachments/annotations";
import { rewriteImageBySrcAlt } from "@/lib/image-resize-utils";

// Konva-based annotation editor: loaded client-only (SSR-unsafe) and only when
// the user opens it from the resize popover's Annotate action.
const ImageAnnotatorModal = dynamic(() => import("./ImageAnnotatorModal"), {
  ssr: false,
});
import ImageStrip from "./ImageStrip";
import Tooltip from "./Tooltip";
import { Icon } from "./icons";
import FileStrip, { FILE_STRIP_DRAG_MIME } from "./FileStrip";
import ImageTrashDropZone from "./ImageTrashDropZone";
import FileTrashDropZone from "./FileTrashDropZone";
import FileViewerModal, { classifyFileLink, type FileViewerKind } from "./FileViewerModal";
import {
  lookupMissingInlineImage,
  pickUniqueImageFilename,
  readImportSidecar,
  removeMissingInlineImageFromSidecar,
} from "@/lib/import/eln/sidecar-lookup";
import {
  matchDroppedFilesToMissing,
  type DroppedFile,
} from "@/lib/import/imageDropMatcher";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import {
  type EditorWidthPreset,
  EDITOR_WIDTH_PRESETS,
  EDITOR_WIDTH_PRESET_LABELS,
  EDITOR_WIDTH_PRESET_DESCRIPTIONS,
  editorWidthMeasureClass,
  coerceEditorWidthPreset,
  readStoredEditorWidthPreset,
  writeStoredEditorWidthPreset,
} from "@/lib/markdown/editor-width-preset";
import { useOptionalCurrentUser } from "@/lib/file-system/file-system-context";
import { patchUserSettings, readUserSettings } from "@/lib/settings/user-settings";

// Type for editor mode. "inline" is the CodeMirror 6 Typora-style surface
// (now the sole editor). "preview" is the read-only ReactMarkdown render.
// "hybrid" has been removed from the runtime; this union no longer includes it.
export type EditorMode = "preview" | "inline";

/**
 * Pre-process markdown to preserve blank line spacing.
 * Converts consecutive blank lines into explicit spacing divs.
 */
function preserveBlankLines(markdown: string): string {
  // Split by code blocks first to avoid modifying content inside them
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const parts = markdown.split(codeBlockRegex);
  
  return parts.map((part, index) => {
    // If this is a code block, return it unchanged
    if (index % 2 === 1) {
      return part;
    }
    
    // Process blank lines in non-code-block content
    // Replace 2+ consecutive blank lines with spacing divs
    // A "blank line" is a line that is empty or contains only whitespace
    return part.replace(/\n{3,}/g, (match) => {
      // match is 3+ newlines, which means 2+ blank lines
      // Each additional newline beyond 2 represents one more blank line
      const blankLineCount = match.length - 2; // -2 because the first 2 newlines are normal paragraph separation
      // Create spacing divs for each additional blank line
      // Use <br> tags which will pass through rehype-raw
      return '\n\n' + '<br/>'.repeat(blankLineCount);
    });
  }).join('');
}

// Interface for a broken inline reference. Covers both ![alt](Images/…) image
// refs and [text](Files/…) file-link refs. `kind` decides whether we offer
// the "search for a replacement" flow (images only) or jump straight to the
// "remove from note" affordance (files — there's no equivalent file-search
// API and the typical recovery is just to delete the dangling link).
interface BrokenRefInfo {
  originalSrc: string;
  /** Alt text for an image, link text for a file. */
  alt: string;
  kind: "image" | "file";
  element: Element | null;
}

// Interface for image search result
interface ImageSearchResult {
  path: string;
  filename: string;
  match_type: string;
}

interface LiveMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onImageDrop?: (files: File[]) => void;
  /** Callback for uploading any file type (images and non-images) */
  onFileDrop?: (files: File[]) => void;
  /** Base path in the data repo for resolving relative image URLs (e.g. "results/task-5") */
  imageBasePath?: string;
  /** Optional disk path to the markdown file backing `value`. When set AND the
   *  task has an `_import_source.json` sidecar with outstanding
   *  `missingInlineImages`, native image drops will be filename-matched
   *  against the sidecar and routed through the LabArchives Form-B
   *  rehydration path (write to `Images/<final>`, rewrite the
   *  `Images/missing-<filename>` ref, shrink the sidecar) instead of landing
   *  as a fresh attachment. Unmatched drops fall through to the existing
   *  `onImageDrop`. Currently plumbed by `TaskDetailPopup`'s Lab Notes tab —
   *  Results tab passes its own `results.md` path so a drop on Results with
   *  a stray Form-B placeholder there also rehydrates (rare but correct). */
  notesMarkdownPath?: string;
  /** Whether to show the toolbar with Preview and Add Image buttons */
  showToolbar?: boolean;
  /** Callback when Add Image button is clicked (if not provided, uses internal file input) */
  onAddImage?: () => void;
  /** Callback when Browse Images button is clicked (opens image gallery popup) */
  onBrowseImages?: () => void;
  /** Whether the editor is in read-only mode */
  disabled?: boolean;
  /** Whether to show the keyboard shortcuts helper panel */
  showShortcutsHelper?: boolean;
  /** Whether to suppress the bottom Images / Files attachment manager strip
   *  entirely (the tab bar, the ImageStrip / FileStrip, and the trash drop
   *  zones). Surfaces that are pure editor space with no file attachments (the
   *  BeakerBot Canvas draft panel) set this true. Defaults to false so notes,
   *  methods, results, and task surfaces keep the attachment strip unchanged. */
  hideAttachments?: boolean;
  /** Whether to allow any file type uploads (not just images) */
  allowAnyFileType?: boolean;
  /** Editor mode. Defaults to 'inline' (the CodeMirror 6 surface, the sole
   *  editor) and toggles to 'preview' (read-only rendered) from the toolbar. */
  mode?: EditorMode;
  /** Callback when mode changes */
  onModeChange?: (mode: EditorMode) => void;
  /** When true AND the editor mounts with empty content, the hybrid empty
   *  state mounts a textarea immediately instead of the "Click to start
   *  writing..." placeholder. Used by the new-method Create modal where the
   *  modal IS the editing surface — a click-to-start placeholder reads as
   *  "no editor" (the persona-09 Create-modal bug). Defaults to false so
   *  existing surfaces (notes, results, task body) keep their
   *  placeholder-first empty state. */
  autoStartEditing?: boolean;
  /** Context label for Browse tooltip and strip empty-state copy.
   *  Defaults to "experiment" for backward compatibility. */
  recordType?: "experiment" | "note" | "method" | "list" | "purchase";
  /** Hide the editor's own internal Save button. Used by surfaces that own
   *  their own disk-save action (the experiment popup). Defaults to false. */
  hideSaveButton?: boolean;
  /** Receives an imperative function that flushes the edit buffer, fires
   *  onChange, and returns the latest full-document string synchronously. */
  saveRef?: React.MutableRefObject<(() => string) | null>;
  /** Fired on an explicit save with the value committed to the parent,
   *  so the parent can persist it to disk. */
  onExplicitSave?: (value: string) => void;
  /** Fired when the editor's in-flight buffer-dirty flag flips, so a parent
   *  that hides the internal Save button can enable its own Save button the
   *  moment the user starts typing. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Writing Focus Mode (FOCUS_WRITING_MODE_DESIGN.md §6). Controlled-or-
   *  internal pair mirroring `mode` / `onModeChange`. When `onFocusModeChange`
   *  is provided the wrapper treats `focusMode` as a controlled value (the
   *  tour drives it this way); otherwise it owns the boolean internally and
   *  the toolbar button / shortcut toggle it. Defaults to off. */
  focusMode?: boolean;
  /** Callback when focus mode changes (enables the controlled pattern). */
  onFocusModeChange?: (focusMode: boolean) => void;
  /** Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §3B / §9, U1+U2).
   *  When a host popup provides this, the editor's Focus button (and the
   *  Cmd/Ctrl+Shift+F shortcut) call `onRequestExpand()` to ask the HOST to
   *  grow itself to fullscreen (same DOM, CSS size transition) instead of the
   *  editor teleporting its own subtree into a body-level portal overlay. The
   *  editor stays mounted inline at the larger size; its overlay/portal/buffer/
   *  focus-trap machinery stays dormant (kept as the fallback for the six
   *  non-popup mounts that do NOT pass this prop). When ABSENT, behavior is
   *  byte-identical to today (internal focusMode + overlay). The host is
   *  expected to flush/commit the editor buffer before growing (see saveRef /
   *  the host's flush bridge). */
  onRequestExpand?: () => void;
  /** Pressed/label state for the Focus button when the host owns expand via
   *  `onRequestExpand`. Reflects whether the host popup is currently expanded
   *  so the button can read as a toggle (expand <-> collapse). Ignored when
   *  `onRequestExpand` is absent. */
  expanded?: boolean;
  /** Optional parent-supplied content rendered on the RIGHT side of the
   *  single unified toolbar (after a flex spacer). Surfaces that own their
   *  own Save action or sub-tab switcher (the experiment popup's Lab Notes /
   *  Results tabs) inject those controls here so they share this one ~50px
   *  toolbar instead of stacking their own bars above the editor. Rendered
   *  only when `showToolbar` is true and focus mode is off. */
  toolbarTrailing?: React.ReactNode;
  /** Legacy attachments directory passed through to the bottom strips so the
   *  unified Files surface UNION-reads files attached through the retired
   *  "Files" panel (the task popup's `NotesPDFs/` / `ResultsPDFs/` folders).
   *  New uploads never write here; this is read-only legacy. Only the task
   *  popup sets it; other mount sites leave it undefined. */
  legacyAttachmentsDir?: string;

  // ---------------------------------------------------------------------------
  // Loro CRDT pilot pass-through props (forwarded to InlineMarkdownEditor only)
  // When absent, behavior is entirely unchanged.
  // ---------------------------------------------------------------------------
  /** Loro handle (note or task surface); when set, InlineMarkdownEditor runs in
   *  Loro mode. Either model is accepted via the shared EditorLoroHandle shape. */
  loroHandle?: EditorLoroHandle;
  /** Active entry index within the Loro doc. Defaults to 0. A task surface
   *  ignores it. */
  loroEntryIndex?: number;
  /** The live Note object for debounced-commit stamping (note path only). */
  loroBaseNote?: Note;
  /**
   * The shared EphemeralStore for the live collab session.
   * Forwarded to InlineMarkdownEditor; when absent the editor is sync-only.
   */
  collabEphemeral?: import("loro-crdt").EphemeralStore<import("loro-codemirror").EphemeralState>;
  /** Cursor identity for this peer (name + colorClassName). */
  collabUser?: import("loro-codemirror").UserState;

  // ---------------------------------------------------------------------------
  // Reference picker (Chemistry Phase 3). Opt-in: only surfaces that pass
  // enableReferencePicker={true} show the "Insert reference" toolbar button
  // and the slash-command trigger. Existing call sites are byte-identical when
  // this prop is absent (defaults to false).
  // ---------------------------------------------------------------------------
  /** When true, adds an "Insert reference" button to the toolbar and wires the
   *  "/" slash trigger to open the ReferencePicker modal. Defaults to false so
   *  existing call sites are unaffected. */
  enableReferencePicker?: boolean;

  /** Markdown embed hybrid P7-1a: the doc-level pin context (sidecar path + bake
   *  deps), forwarded to InlineMarkdownEditor. When set, a pinned block embed
   *  renders its frozen snapshot and offers a Pin / Unpin control. Absent on every
   *  surface that does not own a per-document embed sidecar, so those are
   *  byte-for-byte unchanged. */
  embedPinContext?: import("@/components/embeds/ObjectEmbed").EmbedPinContext;
  /** P7-2 transclusion normalize. Forwarded to InlineMarkdownEditor. When set,
   *  we publish an async normalizer that the host awaits before persisting, so
   *  any ![[Note#Heading]] in the doc is rewritten to the portable embed link
   *  before the save lands in Loro or on disk. Absent = no normalization (zero
   *  change to every non-note surface that does not pass this). */
  normalizeRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

/**
 * Live Markdown editor with toolbar: Preview toggle and Add Image/File button.
 * Click the "Add Image" or "Add File" button in the toolbar to attach files.
 */
export default function LiveMarkdownEditor({
  value,
  onChange,
  placeholder,
  onImageDrop,
  onFileDrop,
  imageBasePath,
  notesMarkdownPath,
  showToolbar = true,
  onAddImage,
  onBrowseImages,
  disabled = false,
  showShortcutsHelper = true,
  hideAttachments = false,
  allowAnyFileType = false,
  mode = "inline",
  onModeChange,
  autoStartEditing = false,
  recordType = "experiment",
  hideSaveButton = false,
  saveRef,
  onExplicitSave,
  onDirtyChange,
  focusMode = false,
  onFocusModeChange,
  onRequestExpand,
  expanded = false,
  toolbarTrailing,
  legacyAttachmentsDir,
  loroHandle,
  loroEntryIndex,
  loroBaseNote,
  collabEphemeral,
  collabUser,
  enableReferencePicker = false,
  embedPinContext,
  normalizeRef,
}: LiveMarkdownEditorProps) {
  // The markdown editor lets you annotate dropped/embedded images, so warm the
  // lazy annotator chunk on idle. ImageStrip isn't always mounted alongside this
  // editor, so it can't rely on ImageStrip's warm; this covers the notes/methods
  // surfaces directly. (The webpack chunk cache is shared, so warming it once
  // here also benefits ImageStrip / ImageMetadataPopup.)
  usePreloadOnIdle(() => import("./ImageAnnotatorModal"));

  // Internal mode state (used if onModeChange is not provided)
  const [internalMode, setInternalMode] = useState<EditorMode>(mode);

  // Writing Focus Mode (FOCUS_WRITING_MODE_DESIGN.md §6). Controlled-or-
  // internal pattern mirroring `mode` / `onModeChange` above. When the host
  // (or the tour) supplies `onFocusModeChange`, `focusMode` is the source of
  // truth; otherwise we own it internally and the toolbar button / shortcut
  // toggle it.
  const [internalFocusMode, setInternalFocusMode] = useState<boolean>(focusMode);
  const focusModeActive = onFocusModeChange ? focusMode : internalFocusMode;
  const setFocusMode = useCallback(
    (next: boolean) => {
      if (onFocusModeChange) {
        onFocusModeChange(next);
      } else {
        setInternalFocusMode(next);
      }
    },
    [onFocusModeChange],
  );

  // Reference picker (Chemistry Phase 3). State lives here in LiveMarkdownEditor
  // so the toolbar button and the InlineMarkdownEditor slash callback both toggle
  // the same modal. Only active when enableReferencePicker is true.
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);

  // Buffer-safety bridge (FOCUS_WRITING_MODE_DESIGN.md §7). Wired for
  // belt-and-suspenders safety across the focus-mode portal flip. Element
  // identity is preserved across the portal flip (the SAME editor subtree
  // renders in both branches), so no remount happens. The flush-to-pending
  // function may be null when the inline editor is mounted (it owns its own
  // CM6 history stack), which is fine.
  const commitBufferRef = useRef<(() => void) | null>(null);
  // Imperative insert published by the inline (CodeMirror 6) child. The inline
  // Style Guide rail (MarkdownShortcutsSidebar) calls this to splice a markdown
  // snippet in at the editor's current selection. Null until the inline editor
  // mounts; only the inline branch wires it.
  const insertRef = useRef<((syntax: string) => void) | null>(null);
  // Captured focused element on enter, restored on exit (a11y §10).
  const focusReturnElRef = useRef<HTMLElement | null>(null);
  // Overlay root for the focus trap + guarded-Escape scoping.
  const focusOverlayRef = useRef<HTMLDivElement>(null);
  // Parked status published by the child editor (no block mid-edit AND no
  // block selected). The guarded-Escape listener consults this so it never
  // exits focus mode while a block is being edited or merely selected
  // (FOCUS_WRITING_MODE_DESIGN.md §0 decision 1). Defaults true so a fresh
  // editor with nothing selected is parked.
  const editorParkedRef = useRef(true);
  // Mirror focusMode into a ref so it can be read inside listeners with
  // stable deps (avoids re-binding the document keydown on every render).
  const focusModeActiveRef = useRef(false);

  // Buffer-safe portal container (FOCUS_WRITING_MODE_DESIGN.md §7).
  //
  // React UNMOUNTS + remounts a portal's children when the portal CONTAINER
  // node changes between renders (verified in react-dom 19's reconciler:
  // updatePortal bails to createFiberFromPortal on a containerInfo mismatch).
  // A remount would wipe the editor's CM6 state and silently drop in-flight
  // typing, exactly the failure the design doc calls the top correctness risk.
  //
  // So we create ONE stable container div and ALWAYS portal the editor subtree
  // into it (the container reference never changes, so React never remounts).
  // We then move that single node IMPERATIVELY in the DOM: into the in-place
  // mount slot when not in focus mode, and into document.body (full-viewport
  // overlay) when in focus mode. Moving a node with `appendChild` does not
  // change the node's identity, so the portal's containerInfo stays equal and
  // the component state survives.
  const portalContainerRef = useRef<HTMLDivElement | null>(null);
  if (portalContainerRef.current === null && typeof document !== "undefined") {
    portalContainerRef.current = document.createElement("div");
  }
  // The in-place mount slot: a `display: contents` node so it is transparent
  // to the host's flex layout. The portal container lives inside it when not
  // in focus mode. Captured via a callback ref so the move effect can react.
  const [inPlaceMount, setInPlaceMount] = useState<HTMLDivElement | null>(null);
  const inPlaceMountCallbackRef = useCallback((node: HTMLDivElement | null) => {
    setInPlaceMount(node);
  }, []);

  // Toggle handler shared by the toolbar button, the exit button, the
  // Cmd/Ctrl+Shift+F shortcut, and the guarded Escape. Flush the in-flight
  // buffer to pending BEFORE flipping the portal target (see commitBufferRef
  // above), then flip.
  const toggleFocusMode = useCallback(
    (next: boolean) => {
      commitBufferRef.current?.();
      if (next) {
        // Capture where focus was so we can restore it on exit (the toolbar
        // enter button, typically). Done before the overlay mounts.
        if (typeof document !== "undefined") {
          focusReturnElRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }
      }
      setFocusMode(next);
    },
    [setFocusMode],
  );

  // Unified editor surface seam (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, U1+U2).
  // When the host popup provides `onRequestExpand`, the Focus button and the
  // Cmd/Ctrl+Shift+F shortcut ask the HOST to grow itself (same DOM, CSS size
  // transition) instead of toggling the editor's own portal overlay. The host
  // owns the buffer flush before growing. When `onRequestExpand` is absent this
  // falls through to the legacy internal focus-mode toggle, so the six
  // non-popup mounts are byte-identical to today.
  const onRequestExpandRef = useRef(onRequestExpand);
  useEffect(() => {
    onRequestExpandRef.current = onRequestExpand;
  }, [onRequestExpand]);
  const requestExpandToggle = useCallback(() => {
    const requestExpand = onRequestExpandRef.current;
    if (requestExpand) {
      // Flush the in-flight buffer before the host transition so no typing is
      // lost across the grow/shrink. Belt-and-suspenders alongside the host's
      // own flush bridge.
      commitBufferRef.current?.();
      requestExpand();
      return;
    }
    toggleFocusMode(!focusModeActiveRef.current);
  }, [toggleFocusMode]);

  // The child fires this (Cmd/Ctrl+Shift+F) to request a toggle. It reads the
  // live focusMode value from the ref so the closure stays stable. Routes
  // through requestExpandToggle so the shortcut grows the host popup when a
  // host owns expand, and toggles the legacy overlay otherwise.
  const handleChildToggleFocusMode = useCallback(() => {
    requestExpandToggle();
  }, [requestExpandToggle]);

  // Writing-surface WIDTH preset (MARKDOWN_EDITOR_TYPORA_DESIGN.md Phase 1).
  // Grant's pain point: the surface (esp. Focus Mode) was a constant box. The
  // surface now uses a FLUID ch-based measure (default ~72ch centered) that
  // the user can widen, narrow, or remove (Full-bleed) via the Focus Mode
  // top-bar control. Seeded synchronously from localStorage for an immediate
  // first-paint width; the durable per-account record lives in settings.json
  // (`editorWidthPreset`) and an effect reconciles the two below.
  const [widthPreset, setWidthPreset] = useState<EditorWidthPreset>(() =>
    readStoredEditorWidthPreset(),
  );
  // Best-effort per-user settings mirror. Null when there is no
  // FileSystemProvider above (isolated test renders) or nobody is connected;
  // in that case localStorage is the only persistence, which is fine.
  const currentUser = useOptionalCurrentUser();
  // Reconcile from durable settings on connect / user-switch: settings.json
  // is the cross-device source of truth, so if it disagrees with the local
  // mirror we adopt it (and refresh the local mirror). Guarded so a fresh
  // account with no saved preset keeps the local default rather than being
  // forced back to "comfortable".
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await readUserSettings(currentUser);
        if (cancelled || settings.editorWidthPreset === undefined) return;
        const fromDisk = coerceEditorWidthPreset(settings.editorWidthPreset);
        setWidthPreset(fromDisk);
        writeStoredEditorWidthPreset(fromDisk);
      } catch {
        // Disk read failed (not connected / transient): keep the local
        // mirror. No throw, width is cosmetic.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);
  // Apply + persist a new preset: update state, mirror to localStorage
  // synchronously, and best-effort write the durable settings record.
  const applyWidthPreset = useCallback(
    (next: EditorWidthPreset) => {
      setWidthPreset(next);
      writeStoredEditorWidthPreset(next);
      if (currentUser) {
        void patchUserSettings(currentUser, { editorWidthPreset: next }).catch(
          () => {
            // Not connected / write failed: the localStorage mirror still
            // holds for this browser. Width is cosmetic; never surface this.
          },
        );
      }
    },
    [currentUser],
  );
  const measureClass = editorWidthMeasureClass(widthPreset);

  // Use controlled mode (from prop) or internal mode
  const currentMode = onModeChange ? mode : internalMode;
  
  // Helper to change mode
  const setMode = useCallback((newMode: EditorMode) => {
    if (onModeChange) {
      onModeChange(newMode);
    } else {
      setInternalMode(newMode);
    }
  }, [onModeChange]);
  
  // For backward compatibility, derive previewMode from currentMode
  const previewMode = currentMode === "preview";
  // Provenance stamp stays in the saved .md + every export, but it is not user
  // prose, so the Preview render strips the stamp scaffold (HTML-comment block +
  // its date/time/experiment/project body + the `___` separator + any legacy
  // last-access / "Reopened on" lines). The inline CM6 editor hides the same
  // block via a decoration; this is the Preview counterpart so the two read modes
  // agree. extractUserContent keeps the H1 title and all user content untouched.
  const previewValue = previewMode ? extractUserContent(value) : value;
  // Broken-reference detection state — shared queue between image and file
  // refs so the popup surfaces them one at a time. `currentBrokenImage.kind`
  // decides whether to run the image-search flow or jump straight to the
  // "Remove reference from note" affordance.
  const [brokenImageQueue, setBrokenImageQueue] = useState<BrokenRefInfo[]>([]);
  const [currentBrokenImage, setCurrentBrokenImage] = useState<BrokenRefInfo | null>(null);
  const [showBrokenImagePopup, setShowBrokenImagePopup] = useState(false);
  const [imageSearchResults, setImageSearchResults] = useState<ImageSearchResult[]>([]);
  const [isSearchingImage, setIsSearchingImage] = useState(false);
  // LabArchives Form-B placeholder recovery. When the broken-image popup opens
  // we async-check whether the missing ref matches an entry in the task's
  // `_import_source.json` sidecar. If so, the popup surfaces "Find on
  // LabArchives" + "Replace from disk" buttons in addition to the existing
  // "Remove reference from note" affordance. `null` = either the lookup
  // hasn't finished yet OR the ref isn't a LabArchives placeholder (in which
  // case the legacy popup shape is what renders).
  const [labArchivesMatch, setLabArchivesMatch] = useState<MissingInlineImage | null>(null);
  const [isReplacingFromDisk, setIsReplacingFromDisk] = useState(false);
  const replaceFromDiskInputRef = useRef<HTMLInputElement>(null);
  // Transient confirmation toast for filename-matched auto-rehydration on
  // native image drop. Mirrors the emerald drop-toast pattern in
  // `TaskDetailPopup`'s universal-drop handler. Auto-clears after ~3.5s so
  // the user notices but isn't blocked. Tracks the matched filenames so the
  // copy can include up to two names + " and N more" without re-querying
  // state from inside the drop handler.
  const [missingImageRehydrateToast, setMissingImageRehydrateToast] =
    useState<{ filenames: string[] } | null>(null);
  useEffect(() => {
    if (!missingImageRehydrateToast) return;
    const id = window.setTimeout(() => setMissingImageRehydrateToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [missingImageRehydrateToast]);
  // Active file-link click prompt. The modal shows a View/Download choice for
  // text-like + PDF files; binary types skip the prompt and download
  // immediately from the click handler. `resolvedPath` is pre-resolved so the
  // modal doesn't need to know about basePath conventions.
  const [fileViewerRequest, setFileViewerRequest] = useState<{
    filename: string;
    resolvedPath: string;
    kind: FileViewerKind;
  } | null>(null);
  const [showAttachmentStrip, setShowAttachmentStrip] = useState(true);
  const [activeAttachmentTab, setActiveAttachmentTab] = useState<"images" | "files">("images");
  // L1 quiet toolbar: the secondary insert actions (Add File / Browse / Insert
  // ref / Number figures) collapse behind a single "＋" overflow menu so the
  // docked toolbar reads as a calm contextual strip. This tracks whether that
  // menu is open. Closing on outside-click / Escape is wired below.
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const insertMenuRef = useRef<HTMLDivElement>(null);
  // Native-file drag affordance: light up the editor (or the surrounding popup)
  // while the user is dragging a file from Finder over it. Counter handles
  // child-element bubbling — dragenter/leave fire on every nested element the
  // cursor crosses, so we only clear the highlight when the counter returns to 0.
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);

  // Close the quiet toolbar's "＋" insert overflow menu on an outside click or
  // Escape, so it behaves like a normal popover and never traps focus.
  useEffect(() => {
    if (!insertMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!insertMenuRef.current?.contains(e.target as Node)) {
        setInsertMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInsertMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [insertMenuOpen]);
  // Forward-reference to the LabArchives Form-B drop interceptor (defined
  // further down once its callback deps — value/onChange/etc — are in
  // scope). The capture-phase native drop listener below reads through this
  // ref so we don't need to re-bind the listener on every value change AND
  // don't trip the "used before declaration" hoisting error.
  const interceptMissingImageDropRef = useRef<
    ((files: File[]) => Promise<File[]>) | null
  >(null);

  // Capture-phase native drop listener. Chrome's default behavior for
  // native file drops on rendered <img> elements (the markdown preview
  // image) intercepts the drop before React's synthetic events fire on
  // any inner element — so neither the img's nor the block's nor the
  // editor's React onDrop ever sees the drop, and the event escapes to
  // the window-level GlobalDropGuard. Listening in capture phase on the
  // editor content wrapper catches the event BEFORE it reaches the img,
  // so we can route the file ourselves with preventDefault +
  // stopPropagation. Dragover stays without stopPropagation so the ring
  // affordance still triggers on the wrapper.
  useEffect(() => {
    const el = editorContentRef.current;
    if (!el) return;
    const handleNativeDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const handleNativeDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      const others = files.filter((f) => !f.type.startsWith("image/"));
      // Route images first through the LabArchives Form-B sidecar matcher:
      // matches get rehydrated in-place (markdown ref rewritten, sidecar
      // shrunk), non-matches fall through to the generic-attachment
      // onImageDrop. Drops on editors without notesMarkdownPath wired
      // (NoteDetailPopup, methods) short-circuit and behave exactly as
      // before. Indirected through a ref so the listener doesn't re-bind
      // every render.
      const intercept = interceptMissingImageDropRef.current;
      const unmatchedImages =
        images.length > 0 && intercept ? await intercept(images) : images;
      if (unmatchedImages.length > 0) {
        if (onImageDrop) {
          onImageDrop(unmatchedImages);
        } else if (allowAnyFileType && onFileDrop) {
          onFileDrop(unmatchedImages);
        }
      }
      if (others.length > 0 && allowAnyFileType && onFileDrop) {
        onFileDrop(others);
      }
    };
    el.addEventListener("dragover", handleNativeDragOver, true);
    el.addEventListener("drop", handleNativeDrop, true);
    return () => {
      el.removeEventListener("dragover", handleNativeDragOver, true);
      el.removeEventListener("drop", handleNativeDrop, true);
    };
  }, [onFileDrop, onImageDrop, allowAnyFileType]);

  // Scroll the rendered preview/hybrid editor to the image with the given
  // filename. Triggered by the "Jump to occurrence" button inside the
  // image-strip metadata popup; the strip only enables that button when the
  // image is actually in the document.
  const handleJumpToImage = useCallback(
    (filename: string) => {
      const scroll = () => {
        const root = editorContentRef.current;
        if (!root) return;
        const imgs = Array.from(root.querySelectorAll("img"));
        const target = imgs.find((img) => {
          const src = img.getAttribute("src") ?? "";
          // Blob URLs don't contain the filename; match against alt or the
          // resolved data-orig-src attribute if rendered, falling back to a
          // suffix check on src for non-blob (e.g. external) cases.
          const alt = img.getAttribute("alt") ?? "";
          const dataSrc = img.getAttribute("data-orig-src") ?? "";
          return (
            dataSrc.endsWith(`/${filename}`) ||
            dataSrc.endsWith(filename) ||
            src.endsWith(`/${filename}`) ||
            src.endsWith(filename) ||
            alt === filename
          );
        }) as HTMLImageElement | undefined;
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ring-4", "ring-blue-400", "ring-offset-2", "transition-shadow");
        window.setTimeout(() => {
          target.classList.remove("ring-4", "ring-blue-400", "ring-offset-2");
        }, 1400);
      };

      requestAnimationFrame(scroll);
    },
    []
  );
  const processedBrokenSrcsRef = useRef<Set<string>>(new Set());
  // Separate set for file refs so a `Files/foo.pdf` scan never collides with
  // a same-named image src in the image-only processed set above.
  const processedBrokenFileSrcsRef = useRef<Set<string>>(new Set());
  // Latest onChange identity, kept in a ref so effects that call onChange can
  // read it without listing onChange in their dep arrays. Listing onChange in
  // an effect that itself calls onChange is a self-feeding loop. A new onChange
  // identity re-runs the effect, the effect calls onChange, the parent re-
  // renders and hands back a fresh onChange, and around it goes. The broken-
  // image scan reads through this ref instead so a changed onChange identity
  // alone can never re-fire it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Click-to-resize popover state (preview-mode click on rendered image)
  const [imageResize, setImageResize] = useState<{
    imageSrc: string;
    imageAlt: string;
    x: number;
    y: number;
    currentWidth: number | null;
  } | null>(null);

  // Active annotation-editor target (filename within imageBasePath/Images),
  // opened from the resize popover's Annotate action.
  const [annotatingFilename, setAnnotatingFilename] = useState<string | null>(null);

  // RenderedMarkdown now owns its own blob-URL resolver for the Preview render
  // path (it resolves image srcs independently). The revokeAll cleanup keeps
  // the singleton tidy when the editor unmounts; the resolver may still hold
  // URLs from InlineMarkdownEditor's own resolution passes.
  useEffect(() => () => blobUrlResolver.revokeAll(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const brokenImagePopupRef = useRef<HTMLDivElement>(null);

  const handleAddImageClick = useCallback(() => {
    if (onAddImage) {
      onAddImage();
    } else {
      fileInputRef.current?.click();
    }
  }, [onAddImage]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const files = Array.from(e.target.files);
        // Same split logic as the native-drop path: route images to
        // onImageDrop (Images/ + markdown snippet) and non-images to
        // onFileDrop (Files/). Without splitting, an image picked via
        // the toolbar's Add File button lands in the wrong folder when
        // the caller has both callbacks wired.
        const imageFiles = files.filter((f) => f.type.startsWith("image/"));
        const otherFiles = files.filter((f) => !f.type.startsWith("image/"));
        if (imageFiles.length > 0) {
          if (onImageDrop) {
            onImageDrop(imageFiles);
          } else if (allowAnyFileType && onFileDrop) {
            onFileDrop(imageFiles);
          }
        }
        if (otherFiles.length > 0 && allowAnyFileType && onFileDrop) {
          onFileDrop(otherFiles);
        }
      }
      e.target.value = "";
    },
    [onImageDrop, onFileDrop, allowAnyFileType]
  );

  /**
   * Apply a resize selection from the click-to-resize popover (preview mode).
   * Rewrites the corresponding image in the full markdown source by index.
   */
  const handleImageResizeSelect = useCallback(
    (width: number | null) => {
      if (!imageResize) return;
      const newValue = rewriteImageBySrcAlt(
        value,
        imageResize.imageSrc,
        imageResize.imageAlt,
        width,
      );
      setImageResize(null);
      if (newValue !== value) {
        onChange(newValue);
      }
    },
    [imageResize, value, onChange],
  );

  /**
   * Process the next broken ref in the queue. For images we run a filename
   * search across the user's data folder so the popup can offer concrete
   * replacement candidates. For files we skip the search (there's no
   * equivalent file-search API and the typical recovery is just to delete
   * the dangling link) and surface the popup with the "Remove reference
   * from note" button immediately.
   */
  useEffect(() => {
    // If we're currently showing a popup or searching, don't process
    if (showBrokenImagePopup || isSearchingImage) {
      return;
    }

    // If there are items in the queue and no current ref being processed
    if (brokenImageQueue.length > 0 && !currentBrokenImage) {
      const nextRef = brokenImageQueue[0];

      // Extract filename from the src
      let filename = "";

      if (nextRef.originalSrc.includes("/")) {
        filename = nextRef.originalSrc.split("/").pop() || "";
      } else {
        filename = nextRef.originalSrc;
      }

      // Remove any query parameters
      filename = filename.split("?")[0];

      // Remove timestamp prefixes
      const timestampMatch = filename.match(/^\d+-(.+)$/);
      if (timestampMatch) {
        filename = timestampMatch[1];
      }

      if (!filename || !filename.includes(".")) {
        // Not a valid filename, skip and remove from queue
        setBrokenImageQueue(prev => prev.slice(1));
        return;
      }

      // Set current ref and open popup
      setCurrentBrokenImage(nextRef);
      setShowBrokenImagePopup(true);
      setImageSearchResults([]);

      // Remove from queue
      setBrokenImageQueue(prev => prev.slice(1));

      // Files: skip the filename-search step and let the popup render its
      // "no matches → Remove reference from note" branch immediately.
      if (nextRef.kind === "file") {
        return;
      }

      // Images: search for a likely replacement.
      setIsSearchingImage(true);
      attachmentsApi.searchImageByFilename(filename)
        .then(result => {
          setImageSearchResults(result.matches);
        })
        .catch(error => {
          console.error("Error searching for image:", error);
          setImageSearchResults([]);
        })
        .finally(() => {
          setIsSearchingImage(false);
        });
    }
  }, [brokenImageQueue, currentBrokenImage, showBrokenImagePopup, isSearchingImage]);

  /**
   * Detect whether the currently-surfaced broken image is a LabArchives
   * Form-B placeholder by looking up the ref in the per-task
   * `_import_source.json` sidecar. Runs once per popup-open. The result
   * gates the two new buttons ("Find on LabArchives" + "Replace from
   * disk"); a `null` result means we render the legacy popup shape
   * unchanged.
   *
   * Files (`kind === "file"`) skip this lookup — the sidecar tracks
   * inline-image refs only.
   */
  useEffect(() => {
    if (!currentBrokenImage || currentBrokenImage.kind !== "image") {
      setLabArchivesMatch(null);
      return;
    }
    let cancelled = false;
    lookupMissingInlineImage(imageBasePath, currentBrokenImage.originalSrc)
      .then((result) => {
        if (cancelled) return;
        setLabArchivesMatch(result ? result.entry : null);
      })
      .catch(() => {
        if (cancelled) return;
        setLabArchivesMatch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentBrokenImage, imageBasePath]);

  /**
   * Clear processed srcs when value changes (new document)
   * Note: We don't clear on every value change because that would reset
   * the queue while the user is fixing images. Instead, we clear when
   * the component unmounts or when explicitly needed.
   */
  
  /**
   * Extract image sources from markdown content
   * Returns array of { src, alt } objects
   */
  const extractImageSources = useCallback((content: string): { src: string; alt: string }[] => {
    const images: { src: string; alt: string }[] = [];
    const seenSrcs = new Set<string>();
    
    // Find markdown images: ![alt](src)
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = mdImageRegex.exec(content)) !== null) {
      if (!seenSrcs.has(match[2])) {
        seenSrcs.add(match[2]);
        images.push({ alt: match[1], src: match[2] });
      }
    }
    
    // Find HTML img tags: <img src="..." alt="..." /> or <img alt="..." src="..." />
    const htmlImgRegex = /<img[^>]*>/gi;
    while ((match = htmlImgRegex.exec(content)) !== null) {
      const imgTag = match[0];
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
      
      if (srcMatch && !seenSrcs.has(srcMatch[1])) {
        seenSrcs.add(srcMatch[1]);
        images.push({ src: srcMatch[1], alt: altMatch ? altMatch[1] : "" });
      }
    }
    
    return images;
  }, []);

  /**
   * Check if an image exists by trying to load it
   * Returns a promise that resolves to true if the image loads, false otherwise
   */
  const checkImageExists = useCallback(async (src: string): Promise<boolean> => {
    if (!blobUrlResolver.isLocalPath(src)) return true;
    const resolvedPath = blobUrlResolver.resolvePath(src, imageBasePath);
    return await fileService.fileExists(resolvedPath);
  }, [imageBasePath]);

  /**
   * Scan for broken images in edit mode
   * Uses a ref to track the current scan to avoid race conditions
   */
  useEffect(() => {
    // Only scan in edit mode and when there's content
    if (previewMode || !value.trim() || disabled) {
      return;
    }
    
    // Extract all image sources from the markdown content
    const images = extractImageSources(value);
    
    if (images.length === 0) {
      return;
    }
    
    // Check each image. For broken refs whose basename already exists at the
    // canonical destination (`${imageBasePath}/Images/{basename}`), silently
    // rewrite the markdown — these are usually middle-state migration
    // artifacts and don't warrant a popup. Only refs that can't be auto-
    // recovered get queued for the broken-image picker.
    const checkImages = async () => {
      let nextValue = value;
      let mutated = false;
      for (const { src, alt } of images) {
        if (processedBrokenSrcsRef.current.has(src)) {
          continue;
        }

        const exists = await checkImageExists(src);
        if (exists) continue;

        const baseName = (src.split("/").pop() ?? "").split("?")[0];
        if (baseName && imageBasePath && await fileService.fileExists(`${imageBasePath}/Images/${baseName}`)) {
          // Found canonical copy — rewrite both markdown and HTML img refs in
          // place without disturbing surrounding text.
          processedBrokenSrcsRef.current.add(src);
          const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const mdRegex = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedSrc}(\\))`, 'g');
          const htmlRegex = new RegExp(`(<img[^>]+src=["'])${escapedSrc}(["'])`, 'gi');
          const replaced = nextValue
            .replace(mdRegex, `$1Images/${baseName}$2`)
            .replace(htmlRegex, `$1Images/${baseName}$2`);
          if (replaced !== nextValue) {
            nextValue = replaced;
            mutated = true;
          }
          continue;
        }

        processedBrokenSrcsRef.current.add(src);
        setBrokenImageQueue(prev => {
          if (prev.some(img => img.originalSrc === src)) {
            return prev;
          }
          return [...prev, { originalSrc: src, alt, kind: "image", element: null }];
        });
      }
      // Read onChange through the ref so a changed onChange identity can't be
      // what re-runs this effect. The mutated guard keeps it idempotent, we
      // only fire when the scan actually rewrote a recovered ref.
      if (mutated) onChangeRef.current(nextValue);
    };

    checkImages();
  }, [previewMode, value, disabled, extractImageSources, checkImageExists, imageBasePath]);

  /**
   * Extract `[text](Files/…)` and `<a href="Files/…">text</a>` references
   * from the markdown body. Mirrors `extractImageSources` but for non-image
   * file links: the negative lookbehind in the markdown regex excludes the
   * `!` form so an image with the same href isn't pulled into the file pass.
   */
  const extractFileSources = useCallback(
    (content: string): { src: string; alt: string }[] => {
      const files: { src: string; alt: string }[] = [];
      const seenSrcs = new Set<string>();

      // Markdown form: `[text](Files/...)` — `(?<!!)` keeps image syntax out.
      const mdFileRegex = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = mdFileRegex.exec(content)) !== null) {
        const src = match[2];
        if (!src.startsWith("Files/") && !src.startsWith("./Files/")) continue;
        if (seenSrcs.has(src)) continue;
        seenSrcs.add(src);
        files.push({ alt: match[1], src });
      }

      // HTML form: `<a href="Files/...">text</a>`.
      const htmlAnchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = htmlAnchorRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src.startsWith("Files/") && !src.startsWith("./Files/")) continue;
        if (seenSrcs.has(src)) continue;
        seenSrcs.add(src);
        // Strip nested markup from the link text — best-effort, just for the
        // popup display, never written back to the body.
        const text = match[2].replace(/<[^>]+>/g, "").trim();
        files.push({ alt: text, src });
      }

      return files;
    },
    [],
  );

  /**
   * Check if a file ref points to a path that exists on disk. Falls through
   * to `true` (treat as not-broken) for non-local paths (http/https/data/etc.)
   * so the popup doesn't fire on real external links.
   */
  const checkFileExists = useCallback(
    async (src: string): Promise<boolean> => {
      if (!blobUrlResolver.isLocalPath(src)) return true;
      const resolvedPath = blobUrlResolver.resolvePath(src, imageBasePath);
      return await fileService.fileExists(resolvedPath);
    },
    [imageBasePath],
  );

  /**
   * Click handler shared by both editor modes' rendered `<a>` overrides for
   * `Files/…` links. Decodes the URL (CommonMark stores spaces as `%20`),
   * resolves to an on-disk path, and either downloads or shows the
   * View/Download prompt depending on file extension.
   */
  const handleFileLinkClick = useCallback(
    async (rawHref: string) => {
      let cleanHref = rawHref;
      try {
        cleanHref = decodeURI(rawHref);
      } catch {
        // Leave the raw href alone if it isn't valid percent-encoding.
      }
      if (cleanHref.startsWith("./")) cleanHref = cleanHref.slice(2);
      const prefix = cleanHref.startsWith("Files/") ? "Files/" : null;
      if (!prefix) return false;
      const filename = cleanHref.slice(prefix.length).split("/").pop() ?? cleanHref;
      const resolvedPath = blobUrlResolver.resolvePath(cleanHref, imageBasePath);
      const decision = classifyFileLink(filename);
      if (decision.type === "download") {
        try {
          const blob = await fileService.readFileAsBlob(resolvedPath);
          if (!blob) return true;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          // Best-effort: silently fail (the broken-file popup will fire on
          // the next pre-scan if the file truly doesn't exist).
        }
        return true;
      }
      setFileViewerRequest({ filename, resolvedPath, kind: decision.kind });
      return true;
    },
    [imageBasePath],
  );

  /**
   * Scan for broken `[text](Files/…)` refs. Runs in every mode (edit, hybrid,
   * preview) because the rendered `<a>` has no `onError` equivalent for
   * 404 hrefs — without the pre-scan there's nothing to trigger the popup
   * from the render side. Disabled (read-only) editors stay quiet so a
   * shared note opened by another user doesn't pop a remove-button modal
   * the viewer can't act on usefully.
   */
  useEffect(() => {
    if (!value.trim() || disabled) return;

    const files = extractFileSources(value);
    if (files.length === 0) return;

    const checkFiles = async () => {
      for (const { src, alt } of files) {
        if (processedBrokenFileSrcsRef.current.has(src)) continue;
        const exists = await checkFileExists(src);
        if (exists) continue;
        processedBrokenFileSrcsRef.current.add(src);
        setBrokenImageQueue(prev => {
          if (prev.some(ref => ref.originalSrc === src)) return prev;
          return [...prev, { originalSrc: src, alt, kind: "file", element: null }];
        });
      }
    };

    checkFiles();
  }, [value, disabled, extractFileSources, checkFileExists]);

  /**
   * Apply the corrected image path to the markdown content.
   *
   * Copies the user-picked file into `${imageBasePath}/Images/{basename}` (so
   * legacy / backup-folder originals get pulled into the canonical location)
   * and rewrites the markdown to use the canonical `Images/{file}` form that
   * blobUrlResolver and the migration helper both understand.
   *
   * If `imageBasePath` isn't set, falls back to the legacy "../../Images/..."
   * rewrite so we don't lose the user's intent — but every caller in this
   * codebase passes imageBasePath, so the fallback shouldn't be hit.
   */
  const applyImageCorrection = useCallback(
    async (correctPath: string) => {
      if (!currentBrokenImage) return;

      const { originalSrc, alt } = currentBrokenImage;

      let newPath: string;
      if (imageBasePath) {
        try {
          const baseName = correctPath.split("/").pop() ?? correctPath;
          const dot = baseName.lastIndexOf(".");
          const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
          const ext = dot > 0 ? baseName.slice(dot) : "";
          let finalName = baseName;
          let n = 1;
          while (await fileService.fileExists(`${imageBasePath}/Images/${finalName}`)) {
            finalName = `${stem}-${n}${ext}`;
            n += 1;
          }
          const blob = await fileService.readFileAsBlob(correctPath);
          if (!blob) throw new Error(`source not found: ${correctPath}`);
          await fileService.writeFileFromBlob(`${imageBasePath}/Images/${finalName}`, blob);
          newPath = encodeAttachmentRefPath("Images", finalName);
        } catch {
          alert(`Failed to copy ${correctPath} into the notes folder. The markdown reference was left unchanged.`);
          setShowBrokenImagePopup(false);
          setCurrentBrokenImage(null);
          setImageSearchResults([]);
          return;
        }
      } else if (correctPath.includes("/Images/")) {
        const imagesIndex = correctPath.indexOf("/Images/");
        newPath = "../.." + correctPath.substring(imagesIndex);
      } else {
        newPath = correctPath;
      }
      
      // Replace in the markdown content
      // Look for both markdown and HTML image syntax
      let newValue = value;
      let replaced = false;
      
      // Try to find and replace markdown image syntax: ![alt](src)
      // Use separate regex for test and replace to avoid lastIndex issues
      const escapedAlt = alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedSrc = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      const mdImageRegex = new RegExp(`!\\[${escapedAlt}\\]\\(${escapedSrc}\\)`, 'g');
      const mdImageTestRegex = new RegExp(`!\\[${escapedAlt}\\]\\(${escapedSrc}\\)`);
      
      if (mdImageTestRegex.test(newValue)) {
        newValue = newValue.replace(mdImageRegex, `![${alt}](${newPath})`);
        replaced = true;
      }
      
      if (!replaced) {
        // Try to find and replace by src only (in case alt is different)
        const srcOnlyRegex = new RegExp(`!\\[^\\]]*\\]\\(${escapedSrc}\\)`, 'g');
        const srcOnlyTestRegex = new RegExp(`!\\[^\\]]*\\]\\(${escapedSrc}\\)`);
        
        if (srcOnlyTestRegex.test(newValue)) {
          newValue = newValue.replace(srcOnlyRegex, (match) => {
            return match.replace(originalSrc, newPath);
          });
          replaced = true;
        }
      }
      
      if (!replaced) {
        // Try HTML img tag
        const htmlImgRegex = new RegExp(`<img([^>]*)src=["']${escapedSrc}["']`, 'gi');
        const htmlImgTestRegex = new RegExp(`<img([^>]*)src=["']${escapedSrc}["']`, 'i');
        
        if (htmlImgTestRegex.test(newValue)) {
          newValue = newValue.replace(htmlImgRegex, `<img$1src="${newPath}"`);
          replaced = true;
        }
      }
      
      if (replaced) {
        onChange(newValue);
      }

      setShowBrokenImagePopup(false);
      setCurrentBrokenImage(null);
      setImageSearchResults([]);
    },
    [currentBrokenImage, value, onChange, imageBasePath]
  );

  // Strip the broken reference from the markdown entirely. Same regex
  // shapes as applyImageCorrection's match logic — the difference is we
  // replace with an empty string instead of a corrected path.
  //
  // Branches on `kind` so file-link refs ([text](Files/foo.pdf) + HTML <a>)
  // are stripped without the leading `!` that image syntax requires. The
  // negative lookbehind on the markdown form keeps a sibling image with the
  // same path from being matched by the file pass.
  const removeBrokenReference = useCallback(() => {
    if (!currentBrokenImage) return;
    const { originalSrc, alt, kind } = currentBrokenImage;
    const escapedAlt = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSrc = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let newValue = value;
    if (kind === "file") {
      // Strip exact `[alt](src)` first (non-image; `!` lookbehind guards
      // against matching the image-syntax form when src is shared).
      const exactMd = new RegExp(`(?<!!)\\[${escapedAlt}\\]\\(${escapedSrc}\\)\\s*`, "g");
      newValue = newValue.replace(exactMd, "");
      // Fall back to any-text match for the same href.
      const anyTextMd = new RegExp(`(?<!!)\\[[^\\]]*\\]\\(${escapedSrc}\\)\\s*`, "g");
      newValue = newValue.replace(anyTextMd, "");
      // HTML <a> tag with this href — strip the open tag, link text, and close.
      const htmlAnchor = new RegExp(
        `<a[^>]*href=["']${escapedSrc}["'][^>]*>[\\s\\S]*?<\\/a>\\s*`,
        "gi",
      );
      newValue = newValue.replace(htmlAnchor, "");
    } else {
      // Strip exact `![alt](src)` first so we don't accidentally over-match
      // when alt is empty and a sibling image has the same src.
      const exactMd = new RegExp(`!\\[${escapedAlt}\\]\\(${escapedSrc}\\)\\s*`, "g");
      newValue = newValue.replace(exactMd, "");
      // Fall back to any-alt match for the same src.
      const anyAltMd = new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}\\)\\s*`, "g");
      newValue = newValue.replace(anyAltMd, "");
      // HTML <img> tag with this src.
      const htmlImg = new RegExp(`<img[^>]*src=["']${escapedSrc}["'][^>]*>\\s*`, "gi");
      newValue = newValue.replace(htmlImg, "");
    }

    if (newValue !== value) {
      onChange(newValue);
    }
    setShowBrokenImagePopup(false);
    setCurrentBrokenImage(null);
    setImageSearchResults([]);
  }, [currentBrokenImage, value, onChange]);

  /**
   * LabArchives placeholder recovery — "Find on LabArchives" button.
   * Opens the original online URL in a new tab. The user is presumed
   * logged into LabArchives there; once the image renders they can
   * right-click → Save and feed it back into "Replace from disk".
   *
   * The `originalUrl` stored in the sidecar is typically a relative
   * path like `/attachments/inline_image/...` (that's how LabArchives's
   * offline HTML stores them). Without a host prefix, `window.open`
   * resolves the URL against the CURRENT origin (= localhost:3000),
   * landing the user on a dead page. Prefix with the LabArchives
   * notebook host so the open actually reaches LabArchives.
   *
   * Regional default is the US host `mynotebook.labarchives.com`. UK/AU/EU
   * institutions use different hosts (e.g. `aumynotebook.labarchives.com`);
   * surfacing a region picker is a deferred follow-up.
   *
   * `noopener,noreferrer` keeps the opened tab from accessing this
   * window via `window.opener`.
   */
  const findOnLabArchives = useCallback(() => {
    if (!labArchivesMatch) return;
    const url = labArchivesMatch.originalUrl;
    const isAbsolute = /^https?:\/\//i.test(url);
    const absoluteUrl = isAbsolute
      ? url
      : `https://mynotebook.labarchives.com${url.startsWith("/") ? "" : "/"}${url}`;
    window.open(absoluteUrl, "_blank", "noopener,noreferrer");
  }, [labArchivesMatch]);

  /**
   * LabArchives placeholder recovery — "Replace from disk" file picker.
   * Triggers the hidden `<input type="file">`. The actual write happens
   * in `handleReplaceFromDiskFile` once the user picks a file.
   */
  const triggerReplaceFromDisk = useCallback(() => {
    if (!labArchivesMatch || isReplacingFromDisk) return;
    replaceFromDiskInputRef.current?.click();
  }, [labArchivesMatch, isReplacingFromDisk]);

  /**
   * Handle the user picking a local file to replace a LabArchives Form-B
   * placeholder. Pipeline:
   *
   *   1. Pick a collision-free filename under `${imageBasePath}/Images/`,
   *      matching the ` (N)` suffix style used by the ELN apply pipeline
   *      (see `pickUniqueImageFilename` in `sidecar-lookup.ts`).
   *   2. Write the bytes to disk.
   *   3. Rewrite the markdown ref in `value` from `Images/missing-<orig>`
   *      to `Images/<finalName>` and flush via `onChange`. Save logic is
   *      owned by the editor's parent component, which autosaves on
   *      `onChange` like every other markdown edit.
   *   4. Remove the entry from `_import_source.json`'s
   *      `missingInlineImages` so re-opening the note doesn't re-surface
   *      this image in the broken-image popup.
   *   5. Close the popup. The next `<img>` render attempts the new path,
   *      blobUrlResolver hits the cache, and the image displays inline.
   */
  const handleReplaceFromDiskFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0] ?? null;
      // Clear the input's value so re-picking the same file later still fires
      // onChange. Done before any early-return so the user can retry.
      input.value = "";
      if (!file) return;
      if (!currentBrokenImage || !labArchivesMatch || !imageBasePath) return;
      setIsReplacingFromDisk(true);
      try {
        const desiredName = file.name || labArchivesMatch.filename;
        const imagesDir = `${imageBasePath}/Images`;
        const finalName = await pickUniqueImageFilename(imagesDir, desiredName);
        await fileService.writeFileFromBlob(`${imagesDir}/${finalName}`, file);

        const newPath = encodeAttachmentRefPath("Images", finalName);
        const { originalSrc, alt } = currentBrokenImage;
        const escapedAlt = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedSrc = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let newValue = value;
        let replaced = false;

        const mdExact = new RegExp(`!\\[${escapedAlt}\\]\\(${escapedSrc}\\)`, "g");
        if (mdExact.test(newValue)) {
          newValue = newValue.replace(
            new RegExp(`!\\[${escapedAlt}\\]\\(${escapedSrc}\\)`, "g"),
            `![${alt}](${newPath})`,
          );
          replaced = true;
        }
        if (!replaced) {
          const mdAnyAlt = new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}\\)`, "g");
          if (mdAnyAlt.test(newValue)) {
            newValue = newValue.replace(
              new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}\\)`, "g"),
              (match) => match.replace(originalSrc, newPath),
            );
            replaced = true;
          }
        }
        if (!replaced) {
          const htmlImg = new RegExp(
            `<img([^>]*)src=["']${escapedSrc}["']`,
            "gi",
          );
          if (htmlImg.test(newValue)) {
            newValue = newValue.replace(
              new RegExp(`<img([^>]*)src=["']${escapedSrc}["']`, "gi"),
              `<img$1src="${newPath}"`,
            );
            replaced = true;
          }
        }

        if (replaced) {
          onChange(newValue);
        }

        // Prune the entry from the sidecar so we don't re-surface this
        // image on the next open. Best-effort — if the sidecar can't be
        // written we still want to close the popup (the on-disk image +
        // rewritten markdown are the source of truth for the popup not
        // re-firing on re-render anyway).
        try {
          await removeMissingInlineImageFromSidecar(
            imageBasePath,
            labArchivesMatch.filename,
          );
        } catch (err) {
          console.warn(
            "[LiveMarkdownEditor] Failed to update _import_source.json sidecar after replacing missing image:",
            err,
          );
        }

        setShowBrokenImagePopup(false);
        setCurrentBrokenImage(null);
        setImageSearchResults([]);
        setLabArchivesMatch(null);
      } catch (err) {
        console.error("[LiveMarkdownEditor] Replace from disk failed:", err);
        alert(
          "Couldn't write the picked file into the notes folder. The markdown reference was left unchanged.",
        );
      } finally {
        setIsReplacingFromDisk(false);
      }
    },
    [
      currentBrokenImage,
      labArchivesMatch,
      imageBasePath,
      value,
      onChange,
    ],
  );

  /**
   * Intercept native image drops that filename-match an outstanding Form-B
   * `MissingInlineImage` entry in the task's `_import_source.json` sidecar,
   * and route them through the same recovery pipeline as the broken-image
   * popup's "Replace from disk" file picker.
   *
   * Why this exists: the per-image popup's file-picker already converged with
   * the rehydrate helper for matched files. But dragging the saved image
   * onto the note (the natural follow-up to "Find on LabArchives → Save
   * As") did NOT match — drag-and-drop fell through to `onImageDrop`, which
   * writes the file as a fresh attachment with a generic name, leaving the
   * `Images/missing-<filename>` placeholder still broken. This bridges the
   * two paths.
   *
   * Returns the *unmatched* subset of `files` so the caller can pass them
   * to the existing `onImageDrop` (generic-attachment) path. The mixed-drop
   * case (3 sidecar matches + 2 unrelated images) ends up with the matched
   * 3 rehydrated and the unmatched 2 going through the normal flow.
   *
   * Pre-conditions: `notesMarkdownPath` and `imageBasePath` are both set
   * AND the sidecar exists with non-empty `missingInlineImages`. Otherwise
   * we short-circuit and return the input unchanged.
   *
   * We deliberately call the SAME primitives as `handleReplaceFromDiskFile`
   * (`pickUniqueImageFilename` + in-memory `value` rewrite +
   * `removeMissingInlineImageFromSidecar`) rather than the disk-only
   * `rehydrateMissingImages` helper from `lib/import/eln/rehydrate.ts`,
   * because this surface owns the `value` state and autosave is what
   * eventually flushes it to disk — calling the helper would read from
   * (possibly stale) disk and rewrite it, racing with the editor's
   * autosave on the next `onChange`. The helper's matching + sidecar-shrink
   * primitives are reused via the `sidecar-lookup.ts` + `imageDropMatcher.ts`
   * exports the helper itself layers on top of.
   */
  const interceptMissingImageDrop = useCallback(
    async (files: File[]): Promise<File[]> => {
      if (files.length === 0) return files;
      if (!imageBasePath || !notesMarkdownPath) return files;

      const sidecar = await readImportSidecar(imageBasePath);
      if (!sidecar || sidecar.missingInlineImages.length === 0) return files;

      const dropped: DroppedFile[] = files.map((f) => ({
        file: f,
        displayPath: f.name,
      }));
      const matchResult = matchDroppedFilesToMissing(
        dropped,
        sidecar.missingInlineImages,
      );
      if (matchResult.matched.length === 0) return files;

      // Build the (File, MissingInlineImage) pair list. The matcher's
      // `byUrl` map carries the matched File as the `blob` field on each
      // `FetchedInlineImage` (File extends Blob), so we just read it back
      // out. The matcher already enforced first-match-wins, so there's no
      // double-pairing risk.
      const matchedFileSet = new Set<File>();
      const pairs: Array<{ file: File; entry: MissingInlineImage }> = [];
      for (const entry of matchResult.matched) {
        const fetched = matchResult.byUrl.get(entry.originalUrl);
        if (!fetched || fetched.kind !== "ok") continue;
        // The matcher stores the original File on `blob` (File extends
        // Blob), which is what we need to write to disk + count toward the
        // matched set. The cast is safe because `dropped` always holds raw
        // File objects (no ZIP-synthesized Files here — the drop surface
        // is the editor body, not the wizard's ZIP-accepting panel).
        const file = fetched.blob as File;
        matchedFileSet.add(file);
        pairs.push({ file, entry });
      }
      const unmatchedOut = files.filter((f) => !matchedFileSet.has(f));

      if (pairs.length === 0) return files;

      const imagesDir = `${imageBasePath}/Images`;
      // Apply rewrites to the current `value` in a single pass so multiple
      // matched drops in the same batch don't fight each other through
      // sequential `onChange` calls.
      let nextValue = value;
      const matchedFilenames: string[] = [];
      const takenInBatch = new Set<string>();
      for (const { file, entry } of pairs) {
        try {
          const desiredName = file.name || entry.filename;
          // pickUniqueImageFilename only checks disk — augment with an
          // in-batch set so two simultaneous matches with the same desired
          // name don't both resolve to the same on-disk filename.
          let finalName = await pickUniqueImageFilename(imagesDir, desiredName);
          while (takenInBatch.has(finalName.toLowerCase())) {
            const dot = finalName.lastIndexOf(".");
            const stem = dot <= 0 ? finalName : finalName.slice(0, dot);
            const ext = dot <= 0 ? "" : finalName.slice(dot);
            finalName = `${stem} (${takenInBatch.size + 1})${ext}`;
          }
          takenInBatch.add(finalName.toLowerCase());
          await fileService.writeFileFromBlob(
            `${imagesDir}/${finalName}`,
            file,
          );

          const oldRef = `Images/missing-${entry.filename}`;
          const newRef = `Images/${finalName}`;
          // Rewrite every shape of ref that can appear in the markdown body
          // — markdown image syntax (any alt) AND HTML <img src=> — by
          // matching on the raw substring. Same idea as the helper in
          // `rehydrate.ts`'s `applyMarkdownRewrites`, but applied to the
          // in-memory `value` so autosave preserves it.
          const escapedOld = oldRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          nextValue = nextValue.replace(new RegExp(escapedOld, "g"), newRef);

          // Shrink the sidecar (best-effort — a write failure leaves the
          // entry behind and the banner re-fires next session, which is
          // recoverable).
          try {
            await removeMissingInlineImageFromSidecar(
              imageBasePath,
              entry.filename,
            );
          } catch (err) {
            console.warn(
              "[LiveMarkdownEditor] Failed to shrink _import_source.json after drop-matched rehydration:",
              err,
            );
          }
          matchedFilenames.push(entry.filename);
        } catch (err) {
          console.error(
            "[LiveMarkdownEditor] Drop-matched rehydration failed for",
            entry.filename,
            err,
          );
          // Bytes failed to write — fall back to the generic-attachment path
          // for THIS file so the user still sees it land somewhere.
          unmatchedOut.push(file);
        }
      }

      if (matchedFilenames.length > 0) {
        if (nextValue !== value) {
          onChange(nextValue);
        }
        setMissingImageRehydrateToast({ filenames: matchedFilenames });
      }
      return unmatchedOut;
    },
    [imageBasePath, notesMarkdownPath, value, onChange],
  );

  // Keep the capture-phase listener's forward reference in sync with the
  // latest `interceptMissingImageDrop` closure. This is the bridge that
  // lets the listener (registered once in the early useEffect) call the
  // current callback without re-binding native listeners on every value
  // change.
  useEffect(() => {
    interceptMissingImageDropRef.current = interceptMissingImageDrop;
  }, [interceptMissingImageDrop]);

  /**
   * Dismiss the broken image popup and optionally clear the queue
   */
  const dismissBrokenImagePopup = useCallback((clearQueue: boolean = false) => {
    setShowBrokenImagePopup(false);
    setCurrentBrokenImage(null);
    setImageSearchResults([]);
    setLabArchivesMatch(null);
    if (clearQueue) {
      setBrokenImageQueue([]);
    }
  }, []);

  /**
   * Skip the current broken image and move to the next one in the queue
   */
  const skipCurrentBrokenImage = useCallback(() => {
    setShowBrokenImagePopup(false);
    setCurrentBrokenImage(null);
    setImageSearchResults([]);
    setLabArchivesMatch(null);
    // The queue processing useEffect will pick up the next item
  }, []);

  // Whether this editor instance should advertise itself as a file drop target.
  // Surfaces that opted into native file uploads (`allowAnyFileType` + `onFileDrop`)
  // route files into `${basePath}/Files/`; surfaces without that wiring still
  // benefit from showing the ring + receiving the existing drop-warning toast,
  // so the affordance fires whenever either prop is set. Without this gate a
  // read-only preview-only editor would falsely promise to accept drops.
  const acceptsFileDragAffordance = allowAnyFileType || Boolean(onFileDrop);

  const handleWrapperDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!acceptsFileDragAffordance) return;
    const types = Array.from(e.dataTransfer.types);
    // ImageStrip / FileStrip drags originate inside the editor and have their
    // own affordances — don't double up. Only react to native Finder drags.
    if (
      types.includes("application/x-research-os-image") ||
      types.includes(FILE_STRIP_DRAG_MIME)
    ) {
      return;
    }
    if (!types.includes("Files")) return;
    dragCounterRef.current += 1;
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleWrapperDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!acceptsFileDragAffordance) return;
    const types = Array.from(e.dataTransfer.types);
    if (
      types.includes("application/x-research-os-image") ||
      types.includes(FILE_STRIP_DRAG_MIME)
    ) {
      return;
    }
    if (!types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  };

  const handleWrapperDrop = () => {
    dragCounterRef.current = 0;
    if (isDraggingFile) setIsDraggingFile(false);
  };

  // Apply the ring to whichever ancestor opts in via `data-drag-ring-target`
  // (typically the popup card that contains the editor) so it isn't clipped
  // by the editor's overflow parents. If no ancestor opts in, the editor's
  // own wrapper takes the ring as a fallback.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const target =
      wrapperRef.current.closest("[data-drag-ring-target]") as HTMLElement | null
      ?? wrapperRef.current;
    if (isDraggingFile) {
      target.classList.add("live-md-drag-ring-active");
    } else {
      target.classList.remove("live-md-drag-ring-active");
    }
    return () => {
      target.classList.remove("live-md-drag-ring-active");
    };
  }, [isDraggingFile]);

  // ---- Writing Focus Mode (FOCUS_WRITING_MODE_DESIGN.md §5, §6, §10) ----

  // Keep the latest focusMode value on a ref so the child's Cmd+Shift+F
  // toggle (handleChildToggleFocusMode) reads the live value without
  // re-binding the editor's document-level keydown listener.
  useEffect(() => {
    focusModeActiveRef.current = focusModeActive;
  }, [focusModeActive]);

  // Focus mode keeps ALL the editor's own tools (the Shortcuts / Style Guide
  // rail and the Images / Files attachment strip) so no editing functionality
  // is lost (Grant 2026-05-29). Focus mode strips the surrounding host popup
  // chrome (tabs, header, icon rail), which the full-viewport overlay simply
  // covers, NOT the editor's own affordances. So the attachment strip stays
  // visible (its `true` default) on enter, and the rail is not force-collapsed
  // (see forceHelperCollapsed below). The "Attachments" toggle in the focus
  // top bar can still collapse the strip on demand for a calmer surface.

  // Restore focus to where it was before entering (a11y §10). Runs on the
  // exit transition; the captured element is the toolbar enter button.
  useEffect(() => {
    if (!focusModeActive && focusReturnElRef.current) {
      const el = focusReturnElRef.current;
      focusReturnElRef.current = null;
      try {
        el.focus();
      } catch {
        // Some elements throw on focus in test environments; ignore.
      }
    }
  }, [focusModeActive]);

  // Guarded Escape exit (FOCUS_WRITING_MODE_DESIGN.md §0 decision 1, §5).
  // Document-level listener that exits focus mode ONLY when parked. The
  // inline editor's CM6 keymap may call stopPropagation for its own Escape
  // handling. When this listener DOES receive one it re-checks the guards
  // before acting, and early-returns on a tour-synthetic Escape so the
  // in-cluster Escapes the walkthrough fires never bounce the user out of
  // focus mode mid-demo.
  useEffect(() => {
    if (!focusModeActive) return;
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Modifier-combo Escape is not our toggle; let it pass through.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // Only act when PARKED: no block mid-edit, no block selected, and no
      // tour cursor lock active. The child editor signals "mid-edit" by
      // keeping a textarea focused (its own handler stopPropagation's that
      // case before we see it); the belt-and-suspenders checks below cover
      // the rest.
      // PARKED guard (decision 1): the child publishes whether no block is
      // mid-edit AND no block is selected. If it is not parked, decline.
      if (!editorParkedRef.current) return;
      // Belt-and-suspenders: also decline if a textarea inside the overlay is
      // focused (mid-edit). The child's own block-commit Escape owns that
      // case and stopPropagation's it, so we usually never see it, but this
      // keeps us safe if the parked ref ever lags a frame.
      const active = document.activeElement as HTMLElement | null;
      const isEditingTextarea =
        active instanceof HTMLTextAreaElement &&
        Boolean(focusOverlayRef.current?.contains(active));
      if (isEditingTextarea) return;
      const tourCursorLocked = Boolean(
        (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
          .__beakerBotCursorScriptRunning,
      );
      if (tourCursorLocked) return;
      // We are parked: claim the Escape so the host popup's own
      // Escape-to-close / shrink never also fires, then exit focus mode.
      e.preventDefault();
      e.stopPropagation();
      toggleFocusMode(false);
    };
    // Capture phase so we win over the host popup's window-level Escape
    // (which would otherwise close / shrink the popup underneath).
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [focusModeActive, toggleFocusMode]);

  // Cmd/Ctrl+Shift+F focus-mode toggle. The inline (CodeMirror 6) editor does
  // not install a document-level keydown, so the wrapper owns the shortcut
  // here. Fires when this editor owns focus OR when nothing editable anywhere
  // owns focus (so a freshly opened editor with focus on the host chrome still
  // toggles), and yields when a DIFFERENT editor's field is focused.
  const inlineBranchActive = currentMode === "inline";
  useEffect(() => {
    if (!inlineBranchActive) return;
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd || e.altKey || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "f") return;
      const active = document.activeElement as HTMLElement | null;
      const ownsFocus = Boolean(
        wrapperRef.current && active && wrapperRef.current.contains(active),
      );
      const editableFocused =
        !!active &&
        (active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT" ||
          active.isContentEditable);
      if (!ownsFocus && editableFocused) return;
      e.preventDefault();
      e.stopPropagation();
      requestExpandToggle();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [inlineBranchActive, requestExpandToggle]);

  // Minimal focus trap (a11y §10): keep Tab / Shift+Tab cycling within the
  // overlay. On enter, move focus to the overlay root so keyboard users
  // land inside the dialog.
  useEffect(() => {
    if (!focusModeActive) return;
    const root = focusOverlayRef.current;
    if (!root) return;
    // Land focus inside the overlay on enter.
    try {
      root.focus();
    } catch {
      // ignore in test environments
    }
    const onTrapKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === root);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === root) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onTrapKeyDown);
    return () => root.removeEventListener("keydown", onTrapKeyDown);
  }, [focusModeActive]);

  // Move the stable portal container in the DOM (never replace it) so the
  // editor's React state survives the focus toggle. When focus mode is on the
  // container lives in document.body (its `fixed inset-0` child becomes the
  // viewport overlay); otherwise it lives inside the in-place mount slot in
  // the host's normal flow. The container is `display: contents` so it is
  // transparent to layout in both homes. useLayoutEffect so the node is
  // attached before paint (no first-frame flash of an editor-less slot).
  useLayoutEffect(() => {
    const container = portalContainerRef.current;
    if (!container) return;
    container.style.display = "contents";
    const desiredParent = focusModeActive ? document.body : inPlaceMount;
    if (desiredParent && container.parentNode !== desiredParent) {
      desiredParent.appendChild(container);
    }
  }, [focusModeActive, inPlaceMount]);

  // Detach the stable container from the DOM on unmount so it doesn't leak as
  // an orphan in document.body if we unmount mid-focus-mode.
  useEffect(() => {
    return () => {
      const container = portalContainerRef.current;
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  }, []);

  // The editor subtree, rendered ONCE. In focus mode it is relocated into a
  // body-level portal via createPortal below; React preserves component
  // state (the CM6 editor's state + undo refs) when only the portal
  // container changes and element identity is kept, so no remount happens
  // and no typing is lost (FOCUS_WRITING_MODE_DESIGN.md §7).
  // In focus mode the outer wrapper centers the body in a FLUID, ch-based
  // readable measure (Phase 1) instead of the old constant `max-w-5xl` box.
  // The measure follows the user's width preset (Narrow / Comfortable / Wide /
  // Full-bleed); Full-bleed drops the cap so the surface uses the available
  // width. `h-full` is kept so the column still fills the overlay height and
  // scrolls inside itself.
  const editorTree = (
    <div
      ref={wrapperRef}
      className={
        focusModeActive
          ? `flex flex-col h-full ${measureClass}`
          : "flex flex-col h-full"
      }
      onDragEnter={handleWrapperDragEnter}
      onDragLeave={handleWrapperDragLeave}
      // Capture phase: the inner drop handler calls stopPropagation on valid
      // payloads, which would prevent a bubble-phase onDrop here from firing.
      // Capture runs top-down before that stop, so we always reset on drop.
      onDropCapture={handleWrapperDrop}
    >
      {/* Toolbar: the FULL in-place toolbar. Hidden while focus mode is on
          (the focus overlay renders its own compact top bar instead, see
          §6: hide Add File / Browse / Strip, keep a compact Hybrid / Preview
          toggle + Attachments toggle + Save + Exit). */}
      {showToolbar && !focusModeActive && (
        // L1 quiet contextual toolbar. The heavy permanent toolbar collapses
        // into a calm, low-contrast strip: Edit / Preview + Focus stay visible;
        // the secondary insert actions (Add File / Browse / Insert ref / Number
        // figures) fold into a single "＋" overflow menu; the Attachments
        // (strip) toggle and Focus enter button are quiet icon buttons. EVERY
        // original action + behavior is preserved — only the presentation is
        // quieted (Phase A). No hard border / sunken fill so it reads as part
        // of the writing room.
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          {/* Two-way mode toggle: Edit | Preview. The inline CodeMirror 6
              surface is now the sole editor ("Edit"); Hybrid was retired from
              the UI (its code stays as a dormant fallback). The Edit pill maps
              to the "inline" EditorMode. */}
          <div className="flex items-center bg-surface-sunken/70 rounded-lg p-0.5">
            <Tooltip
              label="Write in a single live editing surface"
              placement="bottom"
            >
              <button
                type="button"
                data-testid="editor-mode-inline"
                onClick={() => setMode("inline")}
                disabled={disabled}
                className={`px-2.5 py-1 text-meta rounded-md transition-colors ${
                  currentMode !== "preview"
                    ? "bg-surface-raised text-foreground font-medium shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                } disabled:opacity-50`}
              >
                Edit
              </button>
            </Tooltip>
            <Tooltip label="Read-only rendered preview" placement="bottom">
              <button
                type="button"
                onClick={() => setMode("preview")}
                disabled={disabled}
                className={`px-2.5 py-1 text-meta rounded-md transition-colors ${
                  currentMode === "preview"
                    ? "bg-surface-raised text-foreground font-medium shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                } disabled:opacity-50`}
              >
                Preview
              </button>
            </Tooltip>
          </div>

          {/* Quiet divider between the primary toggle and the contextual icons. */}
          <div
            aria-hidden="true"
            className="w-px h-4 bg-border mx-0.5"
          />

          {/* ＋ Insert overflow menu. Collapses the four secondary insert
              actions (Add File / Add Image, Browse, Insert ref, Number figures)
              behind a single quiet "＋" so the strip stays calm. Each row keeps
              its EXACT original handler + behavior; only the presentation moved
              from inline buttons into this menu. Outside-click / Escape close it
              (wired via the insertMenuOpen effect above). */}
          <div className="relative" ref={insertMenuRef}>
            <Tooltip label="Insert" placement="bottom">
              <button
                type="button"
                aria-label="Insert"
                aria-haspopup="menu"
                aria-expanded={insertMenuOpen}
                onClick={() => setInsertMenuOpen((v) => !v)}
                disabled={disabled}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                  insertMenuOpen
                    ? "bg-brand-action/12 text-brand-action"
                    : "text-foreground-muted hover:bg-foreground-muted/15 hover:text-foreground"
                }`}
              >
                <Icon name="plus" className="w-4 h-4" />
              </button>
            </Tooltip>
            {insertMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1 z-30 min-w-[11rem] py-1 rounded-lg border border-border bg-surface-overlay shadow-lg"
              >
                {/* Add File / Add Image */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setInsertMenuOpen(false);
                    handleAddImageClick();
                  }}
                  disabled={disabled}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-meta text-foreground hover:bg-foreground-muted/10 transition-colors disabled:opacity-50"
                >
                  <Icon name="plus" className="w-4 h-4 text-foreground-muted" />
                  {allowAnyFileType ? "Add File" : "Add Image"}
                </button>

                {/* Browse Images */}
                {onBrowseImages && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setInsertMenuOpen(false);
                      onBrowseImages();
                    }}
                    disabled={disabled}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-meta text-foreground hover:bg-foreground-muted/10 transition-colors disabled:opacity-50"
                  >
                    <Icon name="search" className="w-4 h-4 text-foreground-muted" />
                    Browse
                  </button>
                )}

                {/* Insert reference (molecule / sequence / method). */}
                {enableReferencePicker && !disabled && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Insert reference"
                    onClick={() => {
                      setInsertMenuOpen(false);
                      setReferencePickerOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-meta text-foreground hover:bg-foreground-muted/10 transition-colors"
                  >
                    <Icon name="reference" className="w-4 h-4 text-foreground-muted" />
                    Insert ref
                  </button>
                )}

                {/* Number figures directive toggle (per-document). Keeps the
                    exact insert/remove logic; the active state shows a check. */}
                {enableReferencePicker && !disabled && (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={FIGURE_DIRECTIVE.test(value)}
                    aria-label="Number figures"
                    onClick={() => {
                      const on = FIGURE_DIRECTIVE.test(value);
                      const next = on
                        ? value.replace(/^[^\n]*<!--\s*ros:number-figures\s*-->[^\n]*\n?/m, "")
                        : `<!-- ros:number-figures -->\n${value}`;
                      onChange(next);
                      setInsertMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-meta text-foreground hover:bg-foreground-muted/10 transition-colors"
                  >
                    <Icon
                      name={FIGURE_DIRECTIVE.test(value) ? "check" : "list"}
                      className={`w-4 h-4 ${FIGURE_DIRECTIVE.test(value) ? "text-brand-action" : "text-foreground-muted"}`}
                    />
                    Number figures
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Attachment Strip toggle (kept quiet). Shows / hides the
              scrollable strip of every image OR non-image file attached to this
              experiment along the bottom. Same showAttachmentStrip handler.
              Rendered as a quiet text control (matching the focus-mode bar's
              "Attachments" label) so the strip needs no new registry glyph. */}
          <Tooltip
            label={
              showAttachmentStrip
                ? "Hide the attachments strip"
                : "Show every image and file attached to this experiment along the bottom - drag a tile into the body to insert it"
            }
            placement="bottom"
          >
            <button
              type="button"
              aria-label="Toggle attachments strip"
              aria-pressed={showAttachmentStrip}
              onClick={() => setShowAttachmentStrip((v) => !v)}
              className={`px-2.5 py-1 text-meta rounded-lg transition-colors ${
                showAttachmentStrip
                  ? "bg-brand-action/12 text-brand-action font-medium"
                  : "text-foreground-muted hover:bg-foreground-muted/15 hover:text-foreground"
              }`}
            >
              Attachments
            </button>
          </Tooltip>

          {/* Writing Focus Mode enter button (FOCUS_WRITING_MODE_DESIGN.md
              §6). Inline SVG "expand" glyph (no emoji), project Tooltip (never
              native title=), data-tour-target for the walkthrough's enter beat.
              Stays visible on the quiet strip.

              Unified surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, U1+U2): when
              the host popup owns expand via onRequestExpand, this button grows
              the HOST popup (and reads as a collapse toggle when already
              expanded) instead of opening the editor's own portal overlay. */}
          <Tooltip
            label={
              onRequestExpand
                ? expanded
                  ? "Exit fullscreen (Cmd+Shift+F)"
                  : "Expand to fullscreen (Cmd+Shift+F)"
                : "Focus mode (Cmd+Shift+F)"
            }
            placement="bottom"
          >
            <button
              type="button"
              data-tour-target="hybrid-editor-focus-toggle"
              data-testid="hybrid-editor-focus-toggle"
              onClick={() => requestExpandToggle()}
              disabled={disabled}
              aria-pressed={onRequestExpand ? expanded : undefined}
              aria-label={
                onRequestExpand
                  ? expanded
                    ? "Exit fullscreen editing"
                    : "Expand to fullscreen editing"
                  : "Enter writing focus mode"
              }
              className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                onRequestExpand && expanded
                  ? "bg-foreground-muted/15 text-foreground"
                  : "text-foreground-muted hover:bg-foreground-muted/15 hover:text-foreground"
              }`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                {onRequestExpand && expanded ? (
                  // Collapse glyph (inward arrows) when the host is expanded.
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 9V4m0 5H4m5 0L4 4m11 5h5m-5 0V4m0 5l5-5M9 15v5m0-5H4m5 0l-5 5m11-5h5m-5 0v5m0-5l5 5"
                  />
                ) : (
                  // Expand glyph (outward arrows).
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                  />
                )}
              </svg>
            </button>
          </Tooltip>

          <input
            ref={fileInputRef}
            type="file"
            accept={allowAnyFileType ? undefined : "image/*"}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Trailing slot — parent-owned controls (sub-tab switcher + Save)
              share this single toolbar instead of stacking their own bars.
              The flex spacer pushes them to the right edge. */}
          {toolbarTrailing && (
            <>
              <div className="flex-1" />
              {toolbarTrailing}
            </>
          )}
        </div>
      )}

      {/* Main content area with helper panel and editor */}
      <div
        ref={editorContentRef}
        className={
          // L1 calm editor atom: the DOCKED (non-focus) content zone becomes a
          // warm "writing room" (calm paper + writing-room type via the scoped
          // `.ros-editor-room` rules in globals.css). Focus mode relocates this
          // same subtree to a body portal WITHOUT this class, so the focus
          // overlay keeps its own treatment untouched (Phase A guardrail).
          `flex flex-1 min-h-0${focusModeActive ? "" : " ros-editor-room"}`
        }
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          if (
            types.includes("application/x-research-os-image") ||
            types.includes(FILE_STRIP_DRAG_MIME) ||
            types.includes("Files")
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={async (e) => {
          // Three possible payloads:
          //   1. ImageStrip drag — inserts `![](Images/...)`.
          //   2. FileStrip drag — inserts `[name](Files/...)`.
          //   3. Native OS file drop (Finder, etc.) — uploads via the
          //      caller-supplied onFileDrop / onImageDrop. Without this
          //      branch the browser would handle it (Chrome opens the
          //      PDF), so we always preventDefault even if no callback
          //      is wired to keep the editor inert.
          const imageRaw = e.dataTransfer.getData("application/x-research-os-image");
          const fileRaw = e.dataTransfer.getData(FILE_STRIP_DRAG_MIME);
          const nativeFiles =
            !imageRaw && !fileRaw && e.dataTransfer.files.length > 0
              ? Array.from(e.dataTransfer.files)
              : null;
          if (!imageRaw && !fileRaw && !nativeFiles) return;
          e.preventDefault();
          e.stopPropagation();
          if (nativeFiles) {
            // Split by image vs non-image so images go to onImageDrop (which
            // writes to Images/ + inserts a markdown image snippet) and other
            // files go to onFileDrop (which writes to Files/). Without this
            // split, images dropped on a tab that has both callbacks wired
            // (Lab Notes / Results) fall into onFileDrop and land in Files/
            // — orphaned: no markdown link, no ImageStrip entry, the user
            // sees "nothing happened."
            const imageFiles = nativeFiles.filter((f) => f.type.startsWith("image/"));
            const otherFiles = nativeFiles.filter((f) => !f.type.startsWith("image/"));
            // Route image drops through the LabArchives Form-B sidecar matcher
            // first; matched files rehydrate in-place (markdown rewrite +
            // sidecar shrink) and only the unmatched remainder reaches the
            // generic onImageDrop. Mirrors the capture-phase listener path
            // for drops over the editor body (vs over a rendered <img>).
            const unmatchedImageFiles =
              imageFiles.length > 0
                ? await interceptMissingImageDrop(imageFiles)
                : imageFiles;
            if (unmatchedImageFiles.length > 0) {
              if (onImageDrop) {
                onImageDrop(unmatchedImageFiles);
              } else if (allowAnyFileType && onFileDrop) {
                // No image-specific handler: caller wants all files, so route
                // images through the file path as a fallback.
                onFileDrop(unmatchedImageFiles);
              }
            }
            if (otherFiles.length > 0 && allowAnyFileType && onFileDrop) {
              onFileDrop(otherFiles);
            }
            return;
          }

          let snippet: string | null = null;
          if (imageRaw) {
            let parsed: { filename: string; caption?: string; basePath?: string } | null = null;
            try {
              parsed = JSON.parse(imageRaw) as { filename: string; caption?: string; basePath?: string };
            } catch {
              return;
            }
            if (!parsed?.filename) return;
            // Cross-tab drag: if the source strip's basePath differs from
            // this editor's, copy the file into the editor's tab folder so
            // the inserted ref resolves locally (the canonical tab-scoped
            // layout has strict isolation — no `../` traversal). Falls
            // through gracefully if either basePath is missing or the
            // source file isn't readable.
            if (
              imageBasePath &&
              parsed.basePath &&
              parsed.basePath !== imageBasePath
            ) {
              try {
                const srcPath = `${parsed.basePath}/Images/${parsed.filename}`;
                const blob = await fileService.readFileAsBlob(srcPath);
                if (blob) {
                  let destName = parsed.filename;
                  const { stem, ext } = (() => {
                    const dot = destName.lastIndexOf(".");
                    return dot <= 0
                      ? { stem: destName, ext: "" }
                      : { stem: destName.slice(0, dot), ext: destName.slice(dot) };
                  })();
                  let n = 1;
                  while (await fileService.fileExists(`${imageBasePath}/Images/${destName}`)) {
                    destName = `${stem}-${n}${ext}`;
                    n += 1;
                  }
                  await fileService.writeFileFromBlob(`${imageBasePath}/Images/${destName}`, blob);
                  snippet = `![${parsed.caption ?? ""}](${encodeAttachmentRefPath("Images", destName)})`;
                }
              } catch {
                // fall through to default snippet below
              }
            }
            if (!snippet) {
              // Percent-encode so a spaced filename renders inline; CommonMark
              // truncates an un-encoded destination at the first space.
              snippet = `![${parsed.caption ?? ""}](${encodeAttachmentRefPath("Images", parsed.filename)})`;
            }
          } else if (fileRaw) {
            let parsed: { filename: string; basePath?: string } | null = null;
            try {
              parsed = JSON.parse(fileRaw) as { filename: string; basePath?: string };
            } catch {
              return;
            }
            if (!parsed?.filename) return;
            if (
              imageBasePath &&
              parsed.basePath &&
              parsed.basePath !== imageBasePath
            ) {
              try {
                const srcPath = `${parsed.basePath}/Files/${parsed.filename}`;
                const blob = await fileService.readFileAsBlob(srcPath);
                if (blob) {
                  let destName = parsed.filename;
                  const { stem, ext } = (() => {
                    const dot = destName.lastIndexOf(".");
                    return dot <= 0
                      ? { stem: destName, ext: "" }
                      : { stem: destName.slice(0, dot), ext: destName.slice(dot) };
                  })();
                  let n = 1;
                  while (await fileService.fileExists(`${imageBasePath}/Files/${destName}`)) {
                    destName = `${stem}-${n}${ext}`;
                    n += 1;
                  }
                  await fileService.writeFileFromBlob(`${imageBasePath}/Files/${destName}`, blob);
                  // URL-encode the filename so spaces (and other reserved chars)
                  // produce a CommonMark-valid link destination. The display
                  // label stays raw for readability.
                  snippet = `[${destName}](Files/${encodeURIComponent(destName)})`;
                }
              } catch {
                // fall through to default snippet below
              }
            }
            if (!snippet) {
              snippet = `[${parsed.filename}](Files/${encodeURIComponent(parsed.filename)})`;
            }
          }
          if (!snippet) return;

          const trailing = value.endsWith("\n") ? "" : "\n";
          onChange(`${value}${trailing}${snippet}\n`);
          if (currentMode === "preview") setMode("inline");
        }}
      >
        {/* Editor / Preview — `min-h-0` lets the flex slot shrink below
            its content's natural size so we scroll INSIDE this column
            instead of bursting out of a small popup. */}
        <div className="flex-1 min-h-0 cursor-text overflow-hidden flex flex-col">
          {currentMode === "preview" ? (
            // Read-render: center the prose in the same FLUID ch-based measure
            // (Phase 1) instead of edge-to-edge `max-w-none`, so long lines
            // don't sprawl on a wide host. `w-full` keeps it 100% fluid below
            // the cap; Full-bleed drops the cap. The `px-6` gives the measure
            // breathing room from the scroll edge.
            <div className="p-4 h-full overflow-y-auto">
              {previewValue.trim() ? (
                <div
                  className={`ros-editor-preview-card light-scope prose prose-sm prose-gray ${measureClass} px-6 py-4 rounded-md border border-border bg-surface-raised`}
                  style={{ lineHeight: "1.7" }}
                >
                  {/* Preview render path: RenderedMarkdown handles object
                      embeds, external embeds, transclusion chips, and images
                      consistently with every other read-only surface. The two
                      optional callbacks wire the image click-to-resize popover
                      and the Files/ link viewer so Preview stays feature-
                      complete with the old plain-ReactMarkdown path. */}
                  <RenderedMarkdown
                    content={preserveBlankLines(previewValue)}
                    basePath={imageBasePath}
                    enableSyntaxHighlight
                    embedPinSidecar={embedPinContext?.sidecarPath}
                    onImageClick={disabled ? undefined : (payload: ImageClickPayload) => {
                      setImageResize({
                        imageSrc: payload.originalSrc,
                        imageAlt: payload.alt,
                        x: payload.x,
                        y: payload.y,
                        currentWidth: payload.currentWidth,
                      });
                    }}
                    onFileLinkClick={(href) => { void handleFileLinkClick(href); }}
                  />
                </div>
              ) : (
                <p className="text-body text-foreground-muted italic">
                  {placeholder || "Nothing to preview."}
                </p>
              )}
            </div>
          ) : (
            // Inline (CodeMirror 6 Typora-style) surface — the sole editing
            // branch. Mounts inside the SAME editorContentRef subtree as the
            // wrapper, so the wrapper-level blob-URL image resolver, broken-ref
            // scan, Form-B rehydration, and native drag-drop machinery keep
            // firing. It owns its OWN CM6 history() undo stack and never
            // autosaves; the manual-save contract (saveRef / onExplicitSave /
            // onDirtyChange) is wired from the parent popup. The fluid ch-based
            // measure centers the writing column.
            //
            // The Shortcuts / Style Guide rail is a fixed-width column on the
            // LEFT (it owns its own collapse state) and the editor fills the
            // rest as flex-1. In focus mode the rail collapses to the thin
            // expandable strip (not hidden, per Grant 2026-06-03) so the cheat
            // sheet stays one click away without disturbing the calm surface;
            // the shortcuts keep working via the CM6 keymap.
            <div className="flex h-full min-h-0">
              {showShortcutsHelper && (
                <MarkdownShortcutsSidebar
                  onInsertSyntax={(s) => insertRef.current?.(s)}
                  focusActive={focusModeActive}
                />
              )}
              <div
                className="relative flex-1 flex flex-col min-h-0 h-full"
                data-tour-target="inline-editor-surface"
              >
                <InlineMarkdownEditor
                  value={value}
                  onChange={onChange}
                  placeholder={placeholder}
                  disabled={disabled}
                  saveRef={saveRef}
                  insertRef={insertRef}
                  onExplicitSave={onExplicitSave}
                  onDirtyChange={onDirtyChange}
                  measureClass={measureClass}
                  imageBasePath={imageBasePath}
                  loroHandle={loroHandle}
                  loroEntryIndex={loroEntryIndex}
                  loroBaseNote={loroBaseNote}
                  collabEphemeral={collabEphemeral}
                  collabUser={collabUser}
                  embedPinContext={embedPinContext}
                  normalizeRef={normalizeRef}
                  onRequestReference={enableReferencePicker ? () => setReferencePickerOpen(true) : undefined}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attachment Strip — every image or non-image file attached to this
          experiment, as scrollable thumbnails / tiles. A small Images |
          Files tab bar switches between the two strips. Drag one into the
          markdown to insert at the drop point, or (images only) drop on the
          trash zone (rendered while an image drag is in progress) to delete
          from disk and strip references. */}
      {!hideAttachments && showAttachmentStrip && (
        <div className="sticky bottom-0 z-10">
          <div className="flex items-center gap-1 px-3 pt-2 bg-surface-sunken border-t border-border">
            <button
              type="button"
              onClick={() => setActiveAttachmentTab("images")}
              className={`px-2.5 py-1 text-meta rounded-t transition-colors ${
                activeAttachmentTab === "images"
                  ? "bg-surface-raised text-foreground font-medium border border-border border-b-transparent"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
            >
              Images
            </button>
            <button
              type="button"
              onClick={() => setActiveAttachmentTab("files")}
              className={`px-2.5 py-1 text-meta rounded-t transition-colors ${
                activeAttachmentTab === "files"
                  ? "bg-surface-raised text-foreground font-medium border border-border border-b-transparent"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
            >
              Files
            </button>
          </div>
          {activeAttachmentTab === "images" ? (
            <ImageStrip
              content={value}
              basePath={imageBasePath}
              legacyPdfsDir={legacyAttachmentsDir}
              onJumpToImage={handleJumpToImage}
              recordType={recordType}
              onBodyChange={disabled ? undefined : onChange}
            />
          ) : (
            <FileStrip
              content={value}
              basePath={imageBasePath}
              legacyPdfsDir={legacyAttachmentsDir}
              recordType={recordType}
              onBodyChange={disabled ? undefined : onChange}
            />
          )}
        </div>
      )}
      {!hideAttachments && (
        <>
          <ImageTrashDropZone value={value} onChange={onChange} basePath={imageBasePath} />
          <FileTrashDropZone value={value} onChange={onChange} basePath={imageBasePath} />
        </>
      )}

      {/* Image Resize Popover (preview mode click-to-resize) */}
      {imageResize && (
        <ImageResizePopover
          x={imageResize.x}
          y={imageResize.y}
          currentWidth={imageResize.currentWidth}
          onSelect={handleImageResizeSelect}
          onClose={() => setImageResize(null)}
          onAnnotate={
            imageBasePath && filenameFromMarkdownSrc(imageResize.imageSrc)
              ? () => {
                  const fn = filenameFromMarkdownSrc(imageResize.imageSrc);
                  if (fn) setAnnotatingFilename(fn);
                  setImageResize(null);
                }
              : undefined
          }
        />
      )}

      {/* Photo annotation editor (opened from the resize popover). */}
      {annotatingFilename && imageBasePath && (
        <ImageAnnotatorModal
          basePath={imageBasePath}
          filename={annotatingFilename}
          onClose={() => setAnnotatingFilename(null)}
        />
      )}

      {/* File link click prompt — View / Download for text-like + PDF, with
          inline text viewer for the View action. Binary types skip this and
          download immediately from `handleFileLinkClick`. */}
      {fileViewerRequest && (
        <FileViewerModal
          filename={fileViewerRequest.filename}
          resolvedPath={fileViewerRequest.resolvedPath}
          kind={fileViewerRequest.kind}
          onClose={() => setFileViewerRequest(null)}
        />
      )}

      {/* Broken Image / File Fix Popup */}
      {showBrokenImagePopup && currentBrokenImage && (
        <div
          ref={brokenImagePopupRef}
          className="fixed bottom-4 right-4 bg-surface-raised border border-red-200 dark:border-red-500/30 rounded-lg shadow-xl z-50 w-80 max-h-96 overflow-hidden"
        >
          <div className="p-3 border-b border-red-100 dark:border-red-500/25 bg-red-50 dark:bg-red-500/10">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-red-500 dark:text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-meta font-medium text-red-800 dark:text-red-200">
                {currentBrokenImage.kind === "file" ? "File Not Found" : "Image Not Found"}
              </p>
              {brokenImageQueue.length > 0 && (
                <span className="ml-auto text-meta text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/20 px-1.5 py-0.5 rounded">
                  +{brokenImageQueue.length} more
                </span>
              )}
            </div>
            <p className="text-meta text-red-600 dark:text-red-300 mt-1 truncate" title={currentBrokenImage.originalSrc}>
              {currentBrokenImage.originalSrc}
            </p>
          </div>

          <div className="p-3">
            {currentBrokenImage.kind === "file" ? (
              // File refs: skip the search step entirely. There's no
              // searchFileByFilename API, and the typical recovery for a
              // dangling [name](Files/foo.pdf) is to remove the link.
              <div className="py-4 text-center">
                <p className="text-meta text-foreground-muted">This file isn&apos;t in the notes folder.</p>
                <p className="text-meta text-foreground-muted mt-1">
                  It may have been deleted or moved.
                </p>
                <button
                  type="button"
                  onClick={removeBrokenReference}
                  className="mt-3 px-3 py-1.5 text-meta bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Remove reference from note
                </button>
              </div>
            ) : isSearchingImage ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-meta text-foreground-muted">Searching for image...</span>
              </div>
            ) : imageSearchResults.length > 0 ? (
              <>
                <p className="text-meta text-foreground-muted mb-2">
                  Found {imageSearchResults.length} matching image{imageSearchResults.length > 1 ? 's' : ''}. Click to fix:
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {imageSearchResults.map((result, index) => (
                    <Tooltip key={index} label={result.path} placement="bottom">
                      <button
                        type="button"
                        onClick={() => applyImageCorrection(result.path)}
                        className="w-full px-2 py-2 text-left text-meta bg-surface-sunken hover:bg-blue-50 dark:hover:bg-brand-action/10 hover:text-blue-700 dark:hover:text-blue-300 rounded border border-border hover:border-blue-300 dark:border-blue-500/30 transition-colors"
                      >
                        <div className="font-medium truncate">{result.filename}</div>
                        <div className="text-foreground-muted truncate text-meta mt-0.5">
                          {result.match_type === 'exact' ? '✓ Exact match' : '○ Similar name'}
                        </div>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </>
            ) : labArchivesMatch ? (
              // LabArchives Form-B placeholder recovery path. The image was
              // intentionally left as a `missing-<filename>` ref by the
              // importer because LabArchives keeps it online-only. Surface
              // two recovery affordances:
              //   • "Find on LabArchives" — open the original URL in a new
              //     tab (user is presumed logged in there, can right-click
              //     → Save).
              //   • "Replace from disk" — pick a local file, write it into
              //     Images/, rewrite the markdown ref, prune the sidecar.
              // The legacy "Remove reference from note" affordance stays
              // available as a fallback for users who decide the image is
              // unrecoverable.
              <div className="py-2">
                <p className="text-meta text-foreground-muted">
                  This image was imported from LabArchives but kept online-only. Open it in LabArchives to find the original, then drop the saved copy back in here.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={findOnLabArchives}
                    className="w-full px-3 py-2 text-meta bg-brand-action hover:bg-brand-action/90 text-white rounded transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Find on LabArchives
                  </button>
                  <button
                    type="button"
                    onClick={triggerReplaceFromDisk}
                    disabled={isReplacingFromDisk}
                    className="w-full px-3 py-2 text-meta bg-green-600 hover:bg-green-700 disabled:bg-foreground-muted/20 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-1.5"
                  >
                    {isReplacingFromDisk ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-border"></div>
                        Saving…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Replace from disk
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={removeBrokenReference}
                    disabled={isReplacingFromDisk}
                    className="w-full px-3 py-1.5 text-meta text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 disabled:text-foreground-muted transition-colors"
                  >
                    Remove reference from note
                  </button>
                </div>
                <input
                  ref={replaceFromDiskInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleReplaceFromDiskFile}
                />
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-meta text-foreground-muted">No matching images found.</p>
                <p className="text-meta text-foreground-muted mt-1">
                  The image may have been deleted or moved.
                </p>
                <button
                  type="button"
                  onClick={removeBrokenReference}
                  className="mt-3 px-3 py-1.5 text-meta bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Remove reference from note
                </button>
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-border bg-surface-sunken flex justify-between items-center">
            {brokenImageQueue.length > 0 ? (
              <button
                type="button"
                onClick={skipCurrentBrokenImage}
                className="px-3 py-1 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
              >
                Skip ({brokenImageQueue.length} remaining)
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex items-center gap-3">
              {imageSearchResults.length > 0 && (
                <Tooltip label="Strip this reference from the markdown body" placement="bottom">
                  <button
                    type="button"
                    onClick={removeBrokenReference}
                    className="text-meta text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 transition-colors"
                  >
                    Remove reference
                  </button>
                </Tooltip>
              )}
              <button
                type="button"
                onClick={() => dismissBrokenImagePopup(true)}
                className="px-3 py-1 text-meta text-foreground-muted hover:text-foreground transition-colors"
              >
                Dismiss all
              </button>
            </div>
          </div>
        </div>
      )}
      {missingImageRehydrateToast && (
        // Confirmation toast for drop-matched LabArchives Form-B
        // rehydration. Pinned to the editor's bottom-right corner (relative
        // to the wrapperRef's positioning context) so it overlays the
        // editor body without colliding with the popup's own toasts.
        // Same emerald styling as `TaskDetailPopup`'s universal-drop toast
        // so the success affordance feels familiar.
        <div
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-body text-emerald-900 dark:text-emerald-200 shadow-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {formatRehydrateToastMessage(missingImageRehydrateToast.filenames)}
        </div>
      )}
    </div>
  );

  // ---- Buffer-safe render switch (FOCUS_WRITING_MODE_DESIGN.md §7) ----
  //
  // The single most important correctness constraint: toggling focus mode
  // must NOT remount the editor, or its CM6 state + undo refs are wiped and
  // in-flight typing is lost silently.
  //
  // We ALWAYS render `editorTree` through a portal at a FIXED position in the
  // React element tree: it is always the single child of the column div,
  // which is always the second slot of the outer `frame` div. Only two things
  // change between the normal and focus renders:
  //   1. the portal CONTAINER DOM node (the in-place mount node vs
  //      document.body), and
  //   2. the chrome classNames + whether the focus top bar slot is filled.
  // React preserves component state when only the portal container changes
  // and element identity is kept, so the editor never unmounts.
  //
  // The in-place mount node is rendered by THIS component (the
  // `inPlaceMountRef` div with `display: contents` so it is transparent to
  // the host's flex layout). On the very first render its DOM node does not
  // exist yet, so we portal into document.body for that one frame and a
  // layout effect re-renders once the node attaches; in practice focus mode
  // always starts off, so the in-place node is present before the user can
  // toggle.
  const frame = (
    <div
      ref={focusModeActive ? focusOverlayRef : undefined}
      role={focusModeActive ? "dialog" : undefined}
      aria-modal={focusModeActive ? true : undefined}
      aria-label={focusModeActive ? "Writing focus mode" : undefined}
      tabIndex={focusModeActive ? -1 : undefined}
      className={
        focusModeActive
          // z-[410] sits ABOVE the LivingPopup band (z-[400]) so Focus Mode
          // covers the task/note popup it launches from. It used to be z-50,
          // fine when popups were also ~z-50, but the LivingPopup migration
          // raised popups to z-[400] and stranded Focus Mode beneath them.
          // Stays BELOW the v4 tour overlays (input lock z-[420], spotlight
          // z-[440], speech z-[450]) so the tour still paints over Focus Mode
          // exactly as before.
          ? "fixed inset-0 z-[410] flex flex-col bg-surface-raised outline-none"
          : "contents"
      }
    >
      {/* Focus top-bar slot (index 0). Stays a falsy slot when not in focus
          mode so the column div below keeps its index-1 position and the
          editor subtree inside it is never re-keyed / remounted. */}
      {focusModeActive && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-raised/80 backdrop-blur-sm">
          {/* Compact Edit / Preview toggle (kept on the calm surface). The
              Edit pill maps to the inline CodeMirror 6 surface (sole editor);
              Hybrid was retired from the UI. */}
          <div className="flex items-center bg-surface-sunken rounded-md p-0.5">
            <button
              type="button"
              data-testid="editor-mode-inline-focus"
              onClick={() => setMode("inline")}
              disabled={disabled}
              className={`px-2.5 py-1 text-meta rounded transition-colors ${
                currentMode !== "preview"
                  ? "bg-surface-raised text-foreground font-medium shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              } disabled:opacity-50`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              disabled={disabled}
              className={`px-2.5 py-1 text-meta rounded transition-colors ${
                currentMode === "preview"
                  ? "bg-surface-raised text-foreground font-medium shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              } disabled:opacity-50`}
            >
              Preview
            </button>
          </div>

          {/* Single collapsed Attachments toggle: re-shows the existing
              Images / Files tray (reuses showAttachmentStrip). */}
          <button
            type="button"
            onClick={() => setShowAttachmentStrip((v) => !v)}
            className={`px-2.5 py-1 text-meta rounded transition-colors ${
              showAttachmentStrip
                ? "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
                : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
            }`}
          >
            Attachments
          </button>

          <div className="flex-1" />

          {/* Writing-surface WIDTH control (MARKDOWN_EDITOR_TYPORA_DESIGN.md
              Phase 1). A small segmented affordance: Narrow / Comfortable /
              Wide / Full-bleed. Each segment carries an inline-SVG measure
              glyph (no emoji) inside a project Tooltip (never native title=).
              The active preset is highlighted; clicking one applies + persists
              it (localStorage mirror + per-user settings). Lives only on the
              Focus Mode top bar, which is the dedicated writing surface. */}
          <div
            role="group"
            aria-label="Writing width"
            data-testid="hybrid-editor-width-control"
            className="flex items-center bg-surface-sunken rounded-md p-0.5"
          >
            {EDITOR_WIDTH_PRESETS.map((preset) => {
              const active = widthPreset === preset;
              return (
                <Tooltip
                  key={preset}
                  label={EDITOR_WIDTH_PRESET_DESCRIPTIONS[preset]}
                  placement="bottom"
                >
                  <button
                    type="button"
                    data-testid={`hybrid-editor-width-${preset}`}
                    aria-pressed={active}
                    aria-label={`Set writing width to ${EDITOR_WIDTH_PRESET_LABELS[preset]}`}
                    onClick={() => applyWidthPreset(preset)}
                    className={`p-1.5 rounded transition-colors ${
                      active
                        ? "bg-surface-raised text-foreground shadow-sm"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <WidthPresetGlyph preset={preset} />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* Focus-mode Save (FOCUS_WRITING_MODE_DESIGN.md §0 decision 3, §7).
              The host disk-Save button sits outside the editor and is covered
              by this overlay, so focus mode renders its own, but only when a
              saveRef is wired (the four primary surfaces + the method create /
              compound mounts). When the host provides onExplicitSave too we
              flush via saveRef and call onExplicitSave (the exact wiring the
              popup's own Save uses, e.g. TaskDetailPopup.tsx:4042-4045);
              otherwise the saveRef flush IS the editor's internal manual save
              (it commits the buffer + fires onChange). Surfaces with no
              saveRef (VariationNotesPanel) keep the editor's own visible Save
              button inside the overlay as the fallback, so we don't render a
              second one here. Cmd+S keeps working unchanged in every case. */}
          {saveRef && (
            <Tooltip label="Save (Cmd+S)" placement="bottom">
              <button
                type="button"
                data-testid="hybrid-editor-focus-save"
                onClick={() => {
                  const flushed = saveRef.current?.();
                  if (flushed !== undefined && onExplicitSave) {
                    onExplicitSave(flushed);
                  }
                }}
                disabled={disabled}
                aria-label="Save"
                className="px-3 py-1.5 text-meta font-medium rounded-md shadow-sm bg-brand-action text-white hover:bg-brand-action/90 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </Tooltip>
          )}

          {/* Exit control (FOCUS_WRITING_MODE_DESIGN.md §5). Inline SVG
              "collapse" glyph, project Tooltip, data-tour-target for the
              walkthrough's exit beat. */}
          <Tooltip label="Exit focus mode (Esc)" placement="bottom">
            <button
              type="button"
              data-tour-target="hybrid-editor-focus-exit"
              data-testid="hybrid-editor-focus-exit"
              onClick={() => toggleFocusMode(false)}
              aria-label="Exit writing focus mode"
              className="p-1.5 text-foreground-muted rounded hover:bg-foreground-muted/15 hover:text-foreground transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 9V4m0 5H4m5 0L4 4m11 5h5m-5 0V4m0 5l5-5M9 15v5m0-5H4m5 0l-5 5m11-5h5m-5 0v5m0-5l5 5"
                />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}

      {/* Column slot (index 1). `editorTree` is ALWAYS its single child, at a
          stable React-tree position across the normal <-> focus toggle, so
          the manual-save buffer survives the portal-container flip. */}
      <div
        className={
          focusModeActive
            ? "flex-1 min-h-0 overflow-hidden flex justify-center px-4"
            : "contents"
        }
      >
        {editorTree}
      </div>
    </div>
  );

  return (
    <>
      {/* In-place mount slot. `display: contents` keeps it transparent to the
          host's flex layout so the normal render looks identical to before.
          The stable portal container (moved imperatively by the effect above)
          lives inside this node when not in focus mode. */}
      <div ref={inPlaceMountCallbackRef} className="contents" />
      {/* ALWAYS portal into the SAME stable container so React never remounts
          the editor subtree (no buffer loss). The container's DOM home is
          what moves, not the container itself. */}
      {portalContainerRef.current
        ? createPortal(frame, portalContainerRef.current)
        : null}

      {/* Reference picker modal (Chemistry Phase 3). Rendered outside the
          portal so it is never clipped by the editor's overflow parents.
          Only mounts when enableReferencePicker is true AND the picker is
          open, so the default (picker off) adds exactly zero nodes to the
          DOM. When a reference is picked, insert it at the CM6 caret via
          the existing insertRef. */}
      {enableReferencePicker && referencePickerOpen && (
        <ReferencePicker
          onPick={(markdown) => {
            insertRef.current?.(markdown);
          }}
          onClose={() => setReferencePickerOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Inline-SVG glyph for one width preset (MARKDOWN_EDITOR_TYPORA_DESIGN.md
 * Phase 1). Each preset draws a text-measure metaphor: a pair of side rails
 * with "text" lines between them whose width grows narrow -> comfortable ->
 * wide, and Full-bleed shows the rails pushed to the edges (no measure cap).
 * No emoji, no native title= (the wrapping Tooltip owns the label).
 */
function WidthPresetGlyph({ preset }: { preset: EditorWidthPreset }) {
  // x-extent of the "text" lines for each preset (the rails stay at 4..20).
  // Full-bleed lines run rail-to-rail to signal "use the available width".
  const span: Record<EditorWidthPreset, { x1: number; x2: number }> = {
    narrow: { x1: 9, x2: 15 },
    comfortable: { x1: 7, x2: 17 },
    wide: { x1: 5, x2: 19 },
    full: { x1: 4, x2: 20 },
  };
  const { x1, x2 } = span[preset];
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {/* Side rails (the viewport edges). */}
      <path
        strokeLinecap="round"
        strokeWidth={2}
        d="M4 5v14M20 5v14"
      />
      {/* Three "text" lines whose width encodes the measure. */}
      <path
        strokeLinecap="round"
        strokeWidth={2}
        d={`M${x1} 9h${x2 - x1}M${x1} 12h${x2 - x1}M${x1} 15h${x2 - x1}`}
      />
    </svg>
  );
}

/**
 * Compose the confirmation copy for the drop-matched rehydration toast.
 * Truncates at 2 names + " and N more" so a 5-image batch reads
 * "Replaced 5 missing images: foo.png, bar.png and 3 more" — informative
 * without paint-bleeding the toast width.
 */
function formatRehydrateToastMessage(filenames: string[]): string {
  if (filenames.length === 0) return "";
  const noun = filenames.length === 1 ? "image" : "images";
  const shown = filenames.slice(0, 2).join(", ");
  const rest = filenames.length - 2;
  const tail = rest > 0 ? ` and ${rest} more` : "";
  return `Replaced ${filenames.length} missing ${noun}: ${shown}${tail}`;
}

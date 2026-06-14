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
import type { ReferencePickerTab } from "./references/ReferencePicker";
import type { IconName } from "./icons/registry";
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
import {
  readStoredTypewriterScroll,
  writeStoredTypewriterScroll,
  readStoredFocusDimming,
  writeStoredFocusDimming,
} from "@/lib/markdown/editor-focus-prefs";
import { useOptionalCurrentUser } from "@/lib/file-system/file-system-context";
import { patchUserSettings, readUserSettings } from "@/lib/settings/user-settings";
import { listSectionHeadings } from "@/lib/embeds/markdown-section";
import { useOptionalBeakerSearch } from "./beaker-search/BeakerSearchProvider";

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
  /** Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §3B / §9).
   *  When a host popup provides this, the editor's Focus button (and the
   *  Cmd/Ctrl+Shift+F shortcut) call `onRequestExpand()` to ask the HOST to
   *  grow itself to fullscreen (same DOM, CSS size transition) and shrink back.
   *  The editor renders inline at every size; there is no separate fullscreen
   *  overlay. The host is expected to flush/commit the editor buffer before
   *  growing (see saveRef / the host's flush bridge); the editor also flushes
   *  its in-flight buffer (`commitBufferRef`) before calling `onRequestExpand`
   *  as a belt-and-suspenders guard. When this prop is ABSENT (the non-popup
   *  mounts: methods page, the method create / compound / variation panels, the
   *  BeakerBot Canvas) the editor shows NO Focus button, since those surfaces
   *  have no host that can expand, so the affordance would be a dead end. */
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

  // Reference picker (Chemistry Phase 3). State lives here in LiveMarkdownEditor
  // so the toolbar button and the InlineMarkdownEditor slash callback both toggle
  // the same modal. Only active when enableReferencePicker is true.
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  // L1 Phase B: the slim insert rail's typed entries (Sequence / Molecule /
  // Data Hub table / Plot) open the SAME picker pre-targeted to a tab. Null =
  // open on the picker's own default tab (the generic "Insert ref" entry / the
  // "/" trigger). Reset to null on close so the next plain open is unbiased.
  const [referencePickerTab, setReferencePickerTab] =
    useState<ReferencePickerTab | null>(null);
  // Open the reference picker, optionally pre-targeted to a tab. Shared by the
  // ＋ overflow menu, the slim insert rail, and the "/" trigger (which passes
  // no tab). Closes the overflow menu so the two never stack.
  const openReferencePicker = useCallback(
    (tab?: ReferencePickerTab) => {
      setReferencePickerTab(tab ?? null);
      setReferencePickerOpen(true);
      setInsertMenuOpen(false);
    },
    [],
  );

  // In-flight buffer flush. The inline (CM6) editor publishes a flush-to-pending
  // function here; the manual-save / expand paths call it to commit any unsaved
  // keystrokes before the host grows or shrinks the popup, so no typing is lost
  // across the size transition. May be null while the inline editor's own CM6
  // history stack owns the buffer, which is fine.
  const commitBufferRef = useRef<(() => void) | null>(null);
  // Imperative insert published by the inline (CodeMirror 6) child. The inline
  // Style Guide rail (MarkdownShortcutsSidebar) calls this to splice a markdown
  // snippet in at the editor's current selection. Null until the inline editor
  // mounts; only the inline branch wires it.
  const insertRef = useRef<((syntax: string) => void) | null>(null);

  // Self-effacing chrome (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5). When the
  // host popup is EXPANDED (fullscreen), the editor's quiet contextual toolbar
  // dozes ~2.5s after the user goes quiet (i.e. into writing) and wakes the
  // instant they move the pointer or press a key, so the writing surface stays
  // calm without trapping the controls. Applies ONLY at fullscreen; the small
  // docked editor keeps its toolbar always visible. The host popup's PINNED tab
  // bar is owned by the popup, not this component, so it never dozes (Grant's
  // pinned-tabs decision). Defaults awake so the toolbar is visible the moment
  // the surface expands.
  const [chromeDozing, setChromeDozing] = useState(false);

  // Unified editor surface seam (UNIFIED_EDITOR_SURFACE_DESIGN.md §9).
  // The Focus button and the Cmd/Ctrl+Shift+F shortcut ask the HOST popup to
  // grow / shrink itself (same DOM, CSS size transition) via `onRequestExpand`.
  // The editor renders inline at every size, so there is no separate fullscreen
  // overlay to toggle. When `onRequestExpand` is absent (the non-popup mounts)
  // there is no host to expand: the Focus button is not rendered and this is a
  // no-op. A ref keeps the keydown closure stable without re-binding the
  // listener on every render.
  const onRequestExpandRef = useRef(onRequestExpand);
  useEffect(() => {
    onRequestExpandRef.current = onRequestExpand;
  }, [onRequestExpand]);
  const requestExpandToggle = useCallback(() => {
    const requestExpand = onRequestExpandRef.current;
    if (!requestExpand) return;
    // Flush the in-flight buffer before the host transition so no typing is
    // lost across the grow / shrink. Belt-and-suspenders alongside the host's
    // own flush bridge.
    commitBufferRef.current?.();
    requestExpand();
  }, []);

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

  // Focus behaviors (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5 toggles). Two
  // per-user, default-OFF writing-comfort behaviors that engage ONLY at the
  // fullscreen scale. Seeded synchronously from localStorage for an immediate
  // first-paint decision (mirroring widthPreset); the durable per-account record
  // lives in settings.json (`editorTypewriterScroll` / `editorFocusDimming`),
  // reconciled below. Resolved (pref AND expanded) before passing to the editor.
  const [typewriterPref, setTypewriterPref] = useState<boolean>(() =>
    readStoredTypewriterScroll(),
  );
  const [dimmingPref, setDimmingPref] = useState<boolean>(() =>
    readStoredFocusDimming(),
  );
  // Reconcile both prefs from durable settings on connect / user-switch, same
  // shape as the width-preset reconcile. Absent on disk = keep the local mirror
  // (a fresh account stays at the default-off rather than being forced).
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await readUserSettings(currentUser);
        if (cancelled) return;
        if (settings.editorTypewriterScroll !== undefined) {
          const v = settings.editorTypewriterScroll === true;
          setTypewriterPref(v);
          writeStoredTypewriterScroll(v);
        }
        if (settings.editorFocusDimming !== undefined) {
          const v = settings.editorFocusDimming === true;
          setDimmingPref(v);
          writeStoredFocusDimming(v);
        }
      } catch {
        // Disk read failed (not connected / transient): keep the local mirror.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);
  // Apply + persist a focus-behavior toggle: update state, mirror to localStorage
  // synchronously, and best-effort write the durable settings record.
  const applyTypewriterPref = useCallback(
    (next: boolean) => {
      setTypewriterPref(next);
      writeStoredTypewriterScroll(next);
      if (currentUser) {
        void patchUserSettings(currentUser, {
          editorTypewriterScroll: next,
        }).catch(() => {
          // Not connected / write failed: the localStorage mirror still holds.
        });
      }
    },
    [currentUser],
  );
  const applyDimmingPref = useCallback(
    (next: boolean) => {
      setDimmingPref(next);
      writeStoredFocusDimming(next);
      if (currentUser) {
        void patchUserSettings(currentUser, {
          editorFocusDimming: next,
        }).catch(() => {
          // Not connected / write failed: the localStorage mirror still holds.
        });
      }
    },
    [currentUser],
  );
  // Resolved flags handed to InlineMarkdownEditor: the behavior runs only when
  // (its pref is on) AND (the host popup is expanded / fullscreen). This is the
  // double-gate — the docked editor (expanded=false) and BeakerBotCanvas (never
  // expanded) always resolve to false, so they are unaffected by these prefs.
  const typewriterActive = typewriterPref && expanded;
  const dimmingActive = dimmingPref && expanded;

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
  const [activeAttachmentTab, setActiveAttachmentTab] = useState<"images" | "files">("images");
  // ── Right Context rail (focus-mode gutter rails, design 2026-06-13) ──
  // The right gutter holds a quiet Context rail with four icon tabs, each
  // popping a flyout anchored to the rail (never over the text column):
  //   outline   — the doc's headings, click to jump
  //   embeds    — the live embeds placed in the doc, click to jump
  //   files     — Attachments (the NEW home of the former bottom Images/Files
  //               strip: same ImageStrip / FileStrip + tab bar, relocated)
  //   bot       — summon BeakerBot (only when the provider is present)
  // `contextFlyout` is which flyout is open (null = closed). The Attachments
  // flyout replaces the retired bottom strip; the toolbar "Attachments" toggle
  // and the rail's Attachments tab both open contextFlyout="files".
  const [contextFlyout, setContextFlyout] = useState<
    "outline" | "embeds" | "files" | "bot" | null
  >(null);
  const contextFlyoutRef = useRef<HTMLDivElement>(null);
  // Non-throwing BeakerSearch access: this editor mounts on surfaces WITHOUT
  // the app shell (BeakerBot Canvas, method create / compound / variation
  // panels), so we read the context optionally and only offer the BeakerBot
  // tab when a provider is genuinely above us.
  const beakerSearch = useOptionalBeakerSearch();
  // L1 quiet toolbar: the secondary insert actions (Add File / Browse / Insert
  // ref / Number figures) collapse behind a single "＋" overflow menu so the
  // docked toolbar reads as a calm contextual strip. This tracks whether that
  // menu is open. Closing on outside-click / Escape is wired below.
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const insertMenuRef = useRef<HTMLDivElement>(null);
  // U5 focus-behaviors popover: a small quiet menu (next to the width control,
  // fullscreen only) holding the Typewriter scroll + Focus dimming toggles. Open
  // state + outside-click/Escape close mirror the ＋ insert menu below.
  const [focusMenuOpen, setFocusMenuOpen] = useState(false);
  const focusMenuRef = useRef<HTMLDivElement>(null);
  // The focus menu is portaled to document.body (see render) to escape the
  // editor's stacking context; this ref is the portaled panel and the position
  // is the fixed anchor computed from the trigger.
  const focusMenuPanelRef = useRef<HTMLDivElement>(null);
  const [focusMenuPos, setFocusMenuPos] = useState<{ top: number; right: number } | null>(null);
  // Native-file drag affordance: light up the editor (or the surrounding popup)
  // while the user is dragging a file from Finder over it. Counter handles
  // child-element bubbling — dragenter/leave fire on every nested element the
  // cursor crosses, so we only clear the highlight when the counter returns to 0.
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);

  // ── Slim insert rail: measured never-overlap rule (L1 Phase B, design §3A) ──
  // The rail floats in the editor's RIGHT gutter and must NEVER overlap the
  // document text. We measure the REAL empty gutter every resize:
  //   gutter = (containerWidth - writingColumnWidth) / 2
  // and only render the rail when that gutter is >= RAIL_MIN_GUTTER_PX. The
  // writing column width is read off a visually-hidden probe that carries the
  // SAME `measureClass` (w-full max-w-[Nch] mx-auto), so its measured width is
  // exactly the column's: min(containerWidth, Nch). At the Full-bleed preset the
  // probe fills the container, gutter -> ~0, and the rail hides entirely (per
  // design). When the gutter is too narrow (small laptop / split-screen /
  // docked popup) the rail also hides and its tools stay reachable in the ＋
  // overflow menu. `colRef` is the relatively-positioned host the rail is
  // absolutely placed within.
  const railColRef = useRef<HTMLDivElement>(null);
  const railProbeRef = useRef<HTMLDivElement>(null);
  // The right Context rail element, so the flyout's outside-click guard can
  // tell a click on a rail tab (which owns its own toggle) from a true outside
  // click.
  const contextRailRef = useRef<HTMLDivElement>(null);
  const [railGutterPx, setRailGutterPx] = useState(0);
  const measureRailGutter = useCallback(() => {
    const host = railColRef.current;
    const probe = railProbeRef.current;
    if (!host || !probe) return;
    const containerWidth = host.clientWidth;
    const columnWidth = probe.clientWidth;
    // Half the leftover horizontal space is one gutter. Clamp at 0 so a probe
    // wider than its host (shouldn't happen) never reads negative.
    const gutter = Math.max(0, (containerWidth - columnWidth) / 2);
    setRailGutterPx((prev) => (Math.abs(prev - gutter) > 0.5 ? gutter : prev));
  }, []);

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

  // Close the U5 focus-behaviors popover on an outside click or Escape (same
  // shape as the ＋ insert menu above), so it never traps focus.
  useEffect(() => {
    if (!focusMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      // The panel is portaled out of this subtree, so check it explicitly too.
      if (
        !focusMenuRef.current?.contains(e.target as Node) &&
        !focusMenuPanelRef.current?.contains(e.target as Node)
      ) {
        setFocusMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focusMenuOpen]);

  // Anchor the portaled focus menu under its trigger with fixed coords, and keep
  // it attached while open as the surface scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!focusMenuOpen) return;
    const update = () => {
      const r = focusMenuRef.current?.getBoundingClientRect();
      if (r) setFocusMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [focusMenuOpen]);

  // Close the right Context-rail flyout on an outside click or Escape, so it
  // behaves like a normal popover and never traps focus. The check ignores
  // clicks on the rail itself (the rail buttons own their own toggle) and on
  // the flyout body; everything else dismisses.
  useEffect(() => {
    if (!contextFlyout) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (contextFlyoutRef.current?.contains(target)) return;
      if (contextRailRef.current?.contains(target)) return;
      setContextFlyout(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextFlyout(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextFlyout]);

  // Keep the never-overlap gutter measurement live. A single ResizeObserver on
  // the rail host re-measures whenever the editor column resizes (popup resize,
  // split-screen, rail collapse, width-preset change). measureClass is in the
  // dep list so changing the writing width (which changes the column cap, and
  // therefore the gutter) re-measures immediately rather than waiting on a
  // resize. Cheap: it reads two clientWidths and skips state churn under 0.5px.
  useLayoutEffect(() => {
    const host = railColRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    measureRailGutter();
    const ro = new ResizeObserver(() => measureRailGutter());
    ro.observe(host);
    return () => ro.disconnect();
  }, [measureRailGutter, measureClass, currentMode]);

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
  // Scroll the rendered editor body to the first element whose visible text
  // begins with `text` (best-effort, mirrors handleJumpToImage's DOM scan).
  // Used by the Outline / Embeds flyouts to jump to a heading or a placed embed
  // without coupling to CodeMirror internals. A brief ring flash marks the
  // target. No-op when nothing matches (e.g. the line is scrolled out of the
  // virtualized CM viewport); never throws.
  const handleJumpToText = useCallback((text: string) => {
    const needle = text.trim().toLowerCase();
    if (!needle) return;
    const scroll = () => {
      const root = editorContentRef.current;
      if (!root) return;
      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>(
          "h1,h2,h3,h4,h5,h6,a,p,li,div,span",
        ),
      );
      const target = candidates.find((el) =>
        (el.textContent ?? "").trim().toLowerCase().startsWith(needle),
      );
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add(
        "ring-2",
        "ring-brand-action",
        "ring-offset-2",
        "rounded",
        "transition-shadow",
      );
      window.setTimeout(() => {
        target.classList.remove(
          "ring-2",
          "ring-brand-action",
          "ring-offset-2",
        );
      }, 1400);
    };
    requestAnimationFrame(scroll);
  }, []);
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

  // ---- Fullscreen expand shortcut (UNIFIED_EDITOR_SURFACE_DESIGN.md §9) ----

  // Cmd/Ctrl+Shift+F expand toggle. The inline (CodeMirror 6) editor does not
  // install a document-level keydown, so the wrapper owns the shortcut here. It
  // routes through requestExpandToggle, which asks the host popup to grow /
  // shrink (and is a no-op on the non-popup mounts that pass no onRequestExpand).
  // Fires when this editor owns focus OR when nothing editable anywhere owns
  // focus (so a freshly opened editor with focus on the host chrome still
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

  // Self-effacing chrome doze (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5). Only
  // armed when the host popup is EXPANDED. Pointer-move or keypress anywhere in
  // the editor subtree wakes the chrome and (re)starts a ~2.5s idle timer; when
  // it fires the toolbar dozes. Listeners are scoped to the editor wrapper so
  // activity elsewhere on the page (incl. the pinned tab bar, which lives
  // outside this subtree) never affects it. When not expanded the chrome is
  // always awake, so the small docked toolbar stays put.
  useEffect(() => {
    if (!expanded) {
      setChromeDozing(false);
      return;
    }
    const root = wrapperRef.current;
    if (!root || typeof window === "undefined") return;
    let timer: number | undefined;
    const arm = () => {
      setChromeDozing(false);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setChromeDozing(true), 2500);
    };
    // Start awake with the timer armed so the toolbar dozes if the user goes
    // straight to writing without any further activity.
    arm();
    root.addEventListener("pointermove", arm);
    root.addEventListener("keydown", arm);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      root.removeEventListener("pointermove", arm);
      root.removeEventListener("keydown", arm);
    };
  }, [expanded]);

  // ── Slim insert rail config (L1 Phase B) ──────────────────────────────────
  // Minimum REAL empty gutter (px) before the rail may render. Below this the
  // rail would crowd or overlap the text, so it hides and folds into the ＋
  // overflow menu instead. ~76px matches the design's measured threshold and
  // comfortably clears the ~44px rail (8px chrome + 32px hit area + insets).
  const RAIL_MIN_GUTTER_PX = 76;
  // Each entry drops a live embed at the caret through the EXISTING pipeline:
  // typed object inserts open the ReferencePicker pre-targeted to a tab (which
  // calls insertRef on pick), and Image routes through the same Add Image flow
  // as the toolbar. No new embed syntax is introduced. Reference / table / plot
  // / sequence / molecule need the picker; Image always works. The whole rail
  // is gated on enableReferencePicker (the insert-pipeline capability) so it
  // only appears on surfaces that opted in, and never on the constrained mounts
  // (BeakerBot Canvas, the method create / compound / variation panels).
  const railInsertItems: {
    key: string;
    label: string;
    icon: IconName;
    onClick: () => void;
  }[] = [
    { key: "reference", label: "Reference", icon: "reference", onClick: () => openReferencePicker() },
    { key: "table", label: "Data Hub table", icon: "table", onClick: () => openReferencePicker("datahub") },
    { key: "plot", label: "Plot or figure", icon: "chart", onClick: () => openReferencePicker("datahub") },
    { key: "sequence", label: "Sequence", icon: "sequence", onClick: () => openReferencePicker("sequences") },
    { key: "molecule", label: "Molecule", icon: "moleculeCircular", onClick: () => openReferencePicker("molecules") },
    { key: "image", label: "Image or file", icon: "attach", onClick: () => { setInsertMenuOpen(false); handleAddImageClick(); } },
  ];
  // The never-overlap gate: opted-in surface, edit mode (insert-at-caret has no
  // meaning in Preview / read-only), and a measured gutter wide enough to clear
  // the text. Full-bleed collapses the gutter to ~0 so railVisible is false and
  // the rail hides entirely, exactly as the design specifies.
  const railVisible =
    enableReferencePicker &&
    !disabled &&
    currentMode !== "preview" &&
    railGutterPx >= RAIL_MIN_GUTTER_PX;

  // ── Right Context rail config (gutter rails L/R, 2026-06-13) ──────────────
  // The right gutter holds a quiet Context rail mirroring the design mockup:
  // Outline / Embeds / Attachments / BeakerBot, each an icon tab that pops a
  // flyout anchored to the rail. It obeys the SAME measured never-overlap rule
  // as the insert rail (a wide-enough gutter, edit mode, not full-bleed), so it
  // never sits on the text and never appears on the constrained non-popup
  // mounts. When the gutter is too narrow the tools fold into a single "≡"
  // chrome control and the flyout re-anchors below the toolbar instead of over
  // the gutter (never on the words).
  const contextRailVisible =
    enableReferencePicker &&
    !disabled &&
    currentMode !== "preview" &&
    railGutterPx >= RAIL_MIN_GUTTER_PX;
  // The doc outline: every ATX heading, in order, reused from the shared
  // section parser so it matches transclusion section matching exactly.
  const docOutline = listSectionHeadings(value);
  // Placed embeds: markdown links that point at a ResearchOS object view (a
  // `#ros=` fragment, or an internal object route). This is a read-only listing
  // for the Embeds flyout's jump targets; it never rewrites the body. The label
  // is the link text; the kind is inferred from the href for the leading glyph.
  const docEmbeds: { label: string; href: string; icon: IconName }[] = [];
  {
    const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(value)) !== null) {
      const label = m[1].trim();
      const href = m[2].trim();
      const isEmbed =
        href.includes("#ros=") ||
        /^\/(sequences|molecules|notes|methods|experiments|datahub|data-hub|trees|phylo)\b/.test(
          href,
        );
      if (!isEmbed) continue;
      const key = `${label}::${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let icon: IconName = "reference";
      if (/sequences/.test(href)) icon = "sequence";
      else if (/molecules/.test(href)) icon = "moleculeCircular";
      else if (/(datahub|data-hub)/.test(href)) icon = "table";
      else if (/(trees|phylo)/.test(href)) icon = "labTree";
      else if (/notes|methods|experiments/.test(href)) icon = "reference";
      docEmbeds.push({ label, href, icon });
    }
  }

  // The editor subtree, rendered inline at EVERY size (no portal, no overlay).
  // The host popup grows / shrinks itself around this same DOM, so the editor
  // never remounts and no in-flight typing is lost across the size transition
  // (UNIFIED_EDITOR_SURFACE_DESIGN.md §9).
  // When the host popup is EXPANDED (fullscreen) the outer wrapper centers the
  // body in a FLUID, ch-based readable measure (Phase 1) so the writing-room
  // type reads well across the wide surface. The measure follows the user's
  // width preset (Narrow / Comfortable / Wide / Full-bleed); Full-bleed drops
  // the cap so the surface uses the available width. `h-full` is kept so the
  // column fills the available height and scrolls inside itself.
  const editorTree = (
    <div
      ref={wrapperRef}
      // Full-width always: the warm-paper room + toolbar span the whole surface
      // and the writing column is centered by the INNER measure (InlineMarkdownEditor
      // + the Preview card both carry measureClass). Capping this outer wrapper with
      // the measure (the old `expanded` branch) shrank the paper to a narrow centered
      // card AND collapsed the gutters the insert/context rails need — so focus mode
      // read as a small card floating in white instead of an edge-to-edge room.
      className="flex flex-col h-full"
      onDragEnter={handleWrapperDragEnter}
      onDragLeave={handleWrapperDragLeave}
      // Capture phase: the inner drop handler calls stopPropagation on valid
      // payloads, which would prevent a bubble-phase onDrop here from firing.
      // Capture runs top-down before that stop, so we always reset on drop.
      onDropCapture={handleWrapperDrop}
    >
      {/* Toolbar: the quiet contextual strip. Always rendered when showToolbar
          is set; at fullscreen it self-effaces (dozes ~2.5s into writing, wakes
          on pointer-move / keypress) via `chromeDozing` below, but the markup is
          unchanged across docked and fullscreen. */}
      {showToolbar && (
        // L1 quiet contextual toolbar. The heavy permanent toolbar collapses
        // into a calm, low-contrast strip: Edit / Preview + Focus stay visible;
        // the secondary insert actions (Add File / Browse / Insert ref / Number
        // figures) fold into a single "＋" overflow menu; the Attachments
        // (strip) toggle and Focus enter button are quiet icon buttons. EVERY
        // original action + behavior is preserved — only the presentation is
        // quieted (Phase A). No hard border / sunken fill so it reads as part
        // of the writing room.
        <div
          // Self-effacing chrome (U5): at fullscreen the toolbar fades out and
          // goes non-interactive while dozing, and wakes (opacity-100) the
          // instant the user moves the pointer or presses a key. `chromeDozing`
          // is only ever true when expanded, so the docked toolbar is unaffected.
          className={`${
            expanded
              ? "relative z-40 self-center mt-2 mb-1 inline-flex rounded-full border border-border bg-surface-overlay/85 shadow-md backdrop-blur px-2.5"
              : "flex px-3"
          } items-center gap-1.5 py-1.5 transition-opacity duration-500 ${
            chromeDozing ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
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

                {/* Typed insert entries (L1 Phase B). These mirror the slim
                    insert rail one-for-one so the SAME tools stay reachable
                    when the rail is hidden (narrow gutter / split-screen /
                    full-bleed) — the "fold into the floating chrome" half of
                    the never-overlap rule. Each opens the ReferencePicker
                    pre-targeted to a tab; Image routes through the Add Image
                    flow above, so it is not repeated here. */}
                {enableReferencePicker && !disabled && (
                  <>
                    <div className="my-1 h-px bg-border" aria-hidden="true" />
                    {railInsertItems
                      .filter((item) => item.key !== "image")
                      .map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          role="menuitem"
                          aria-label={item.label}
                          onClick={item.onClick}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-meta text-foreground hover:bg-foreground-muted/10 transition-colors"
                        >
                          <Icon name={item.icon} className="w-4 h-4 text-foreground-muted" />
                          {item.label}
                        </button>
                      ))}
                  </>
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

          {/* Attachments toggle (kept quiet). Opens the Attachments flyout in
              the right Context rail, which is the NEW home of the former bottom
              Images / Files strip: same ImageStrip / FileStrip + tab bar, just
              relocated off the bottom edge and into the gutter. Carries the
              paperclip glyph (Grant-approved) beside the quiet label. Hidden
              when the surface suppresses attachments (hideAttachments). */}
          {!hideAttachments && (
            <Tooltip
              label={
                contextFlyout === "files"
                  ? "Hide attachments"
                  : "Every image and file attached to this experiment - drag a tile into the body to insert it"
              }
              placement="bottom"
            >
              <button
                type="button"
                aria-label="Toggle attachments"
                aria-pressed={contextFlyout === "files"}
                onClick={() =>
                  setContextFlyout((v) => (v === "files" ? null : "files"))
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 text-meta rounded-lg transition-colors ${
                  contextFlyout === "files"
                    ? "bg-brand-action/12 text-brand-action font-medium"
                    : "text-foreground-muted hover:bg-foreground-muted/15 hover:text-foreground"
                }`}
              >
                <Icon name="attach" className="w-3.5 h-3.5" />
                {/* Fullscreen-only: icon-only (drop the "Attachments" label) to
                    match the Writing-Room pill's ▢ glyph. The Tooltip label,
                    handler, and aria all stay, so the toggle is unchanged for
                    a11y; docked keeps the text. */}
                {!expanded && "Attachments"}
              </button>
            </Tooltip>
          )}

          {/* Focus (expand) affordance lives in the HOST popup header now, not
              here (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, "one focus control").
              The editor no longer renders its own Focus button — focus is driven
              by the header's expand/collapse control (click) plus the
              Cmd/Ctrl+Shift+F shortcut (keyboard), which still routes through
              `onRequestExpand`. The `expanded` prop continues to drive in-editor
              focus state (typewriter / dimming gating, width control, chrome
              doze). */}

          {/* "/" discoverability hint (L1 Phase B, design §3A). Quiet,
              low-contrast text so it teaches without shouting. Shown only when
              the slash-insert pipeline is actually wired (enableReferencePicker)
              and not in read-only / preview, so it never advertises an action
              the surface can't perform. Hidden on very narrow strips so it
              never crowds the trailing controls. The styling mirrors BeakerBot's
              composer slash affordance (a `/` token + muted copy) so users
              learn one "/" mental model. */}
          {enableReferencePicker && !disabled && currentMode !== "preview" && !expanded && (
            <span
              data-testid="editor-slash-hint"
              className="hidden md:inline-flex items-center gap-1 pl-1 text-meta text-foreground-muted/70 select-none"
            >
              <span className="rounded border border-border px-1 font-semibold text-foreground-muted">
                /
              </span>
              to insert
            </span>
          )}

          {/* Writing-surface WIDTH control moved OUT of the pill and INTO the
              "Writing focus" popover below (fullscreen-chrome slim) so the
              fullscreen pill stays minimal (Edit/Preview · ＋ · 📎 · ⊙focus).
              The 4 segmented measure glyphs + applyWidthPreset + per-preset
              testids now live as a "Writing width" section inside the focus
              menu; width stays reachable via the ⊙ control at fullscreen.
              Docked never rendered this (it was already gated on `expanded`). */}

          {/* Focus behaviors (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5 toggles).
              A small quiet popover, shown ONLY when the host popup is EXPANDED
              (fullscreen) — these comfort behaviors only matter at the dedicated
              writing scale, and they are double-gated (pref AND expanded) before
              reaching the editor. Each toggle persists immediately (localStorage
              mirror + durable settings) and takes effect live via the editor's
              reconfigure compartment. Both default off (the design's amber
              decision). The popover ALSO hosts the writing-width presets (moved
              here from the pill). */}
          {expanded && (
            <div ref={focusMenuRef} className="relative">
              <Tooltip label="Writing focus" placement="bottom">
                <button
                  type="button"
                  data-testid="hybrid-editor-focus-menu"
                  aria-haspopup="menu"
                  aria-expanded={focusMenuOpen}
                  aria-label="Writing focus options"
                  onClick={() => setFocusMenuOpen((v) => !v)}
                  className={`p-1.5 rounded-md transition-colors ${
                    focusMenuOpen || typewriterPref || dimmingPref
                      ? "bg-surface-raised text-foreground shadow-sm"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  <Icon name="focus" className="h-4 w-4" />
                </button>
              </Tooltip>
              {focusMenuOpen && focusMenuPos && createPortal(
                <div
                  ref={focusMenuPanelRef}
                  role="menu"
                  data-testid="hybrid-editor-focus-popover"
                  // Portaled to document.body and fixed under the trigger: the
                  // menu must escape the editor's stacking context. The fullscreen
                  // pill's backdrop-blur and the document body sit in contexts that
                  // otherwise paint over an in-tree menu (doc text bled through,
                  // confirmed via elementFromPoint). As a top-level layer with an
                  // opaque --surface-overlay fill it always renders solid above the
                  // popup.
                  style={{
                    position: "fixed",
                    top: focusMenuPos.top,
                    right: focusMenuPos.right,
                    zIndex: 500,
                    backgroundColor: "var(--surface-overlay)",
                  }}
                  className="min-w-[15rem] p-1.5 rounded-lg border border-border bg-surface-overlay shadow-lg"
                >
                  <FocusToggleRow
                    icon="align"
                    label="Typewriter scroll"
                    description="Hold the active line near the middle of the screen."
                    checked={typewriterPref}
                    testId="hybrid-editor-typewriter-toggle"
                    onChange={applyTypewriterPref}
                  />
                  <FocusToggleRow
                    icon="focus"
                    label="Dim other lines"
                    description="Fade everything except the line you're writing, while focused."
                    checked={dimmingPref}
                    testId="hybrid-editor-dimming-toggle"
                    onChange={applyDimmingPref}
                  />

                  {/* Writing-width presets (relocated from the pill —
                      fullscreen-chrome slim). Same segmented measure glyphs,
                      applyWidthPreset handler, and per-preset testids
                      (hybrid-editor-width-*) so the moved control is still
                      covered by the existing tests; the group testid
                      hybrid-editor-width-control is preserved too. */}
                  <div className="my-1 h-px bg-border" aria-hidden="true" />
                  <div className="px-2 pt-0.5 pb-1.5">
                    <div className="mb-1 text-xs font-medium text-foreground-muted">
                      Writing width
                    </div>
                    <div
                      role="group"
                      aria-label="Writing width"
                      data-testid="hybrid-editor-width-control"
                      className="flex items-center bg-surface-sunken/70 rounded-lg p-0.5"
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
                              className={`p-1.5 rounded-md transition-colors ${
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
                  </div>
                </div>,
                document.body,
              )}
            </div>
          )}

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
          // L1 calm editor atom: the content zone is a warm "writing room"
          // (calm paper + writing-room type via the scoped `.ros-editor-room`
          // rules in globals.css). The same surface renders at every size, so
          // the room treatment now also applies when the host popup is expanded
          // to fullscreen (UNIFIED_EDITOR_SURFACE_DESIGN.md §9, U5).
          "flex flex-1 min-h-0 ros-editor-room"
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
              {/* Markdown shortcuts / Style Guide rail. At fullscreen it is now
                  FULLY hidden (not even the thin collapsed strip) — the Insert
                  rail owns that gutter in the Writing Room, and the markdown
                  shortcuts still work via the CM6 keymap. Docked is unchanged
                  (rail renders as before). Fullscreen-chrome slim. */}
              {showShortcutsHelper && !expanded && (
                <MarkdownShortcutsSidebar
                  onInsertSyntax={(s) => insertRef.current?.(s)}
                  focusActive={expanded}
                />
              )}
              <div
                ref={railColRef}
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
                  onRequestReference={enableReferencePicker ? () => openReferencePicker() : undefined}
                  // U5 focus behaviors: already double-gated (pref AND expanded)
                  // so the docked editor / Canvas always pass false.
                  typewriterScroll={typewriterActive}
                  focusDimming={dimmingActive}
                />

                {/* Never-overlap probe (L1 Phase B). A zero-height, invisible
                    twin of the writing column: same `measureClass` (w-full
                    max-w-[Nch] mx-auto), so its measured width IS the column's.
                    measureRailGutter reads it to compute the real gutter. It is
                    aria-hidden + pointer-events-none so it never affects layout
                    height, scroll, or assistive tech. The p-4 padding mirrors
                    the editor's own scroll-pane padding so the gutter math
                    matches what the user sees. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0 overflow-hidden pointer-events-none px-4"
                >
                  <div ref={railProbeRef} className={measureClass} />
                </div>

                {/* Slim Insert rail — LEFT gutter (gutter rails L/R, design
                    2026-06-13). Floats in the editor's LEFT gutter and drops a
                    live embed at the caret via the existing ReferencePicker /
                    insertRef pipeline (no new embed syntax). HARD never-overlap
                    rule: renders ONLY when the measured empty gutter is wide
                    enough to clear the text; when too narrow (split-screen /
                    docked popup) OR full-bleed it hides and its tools stay
                    reachable in the ＋ overflow menu. Dozes with the chrome at
                    fullscreen (chromeDozing). Edit-mode + non-disabled only. */}
                {railVisible && (
                  <div
                    data-testid="editor-insert-rail"
                    className={`absolute left-3 top-1/2 -translate-y-1/2 z-[4] flex flex-col gap-1 rounded-2xl border border-border bg-surface-overlay/85 px-1.5 py-2 shadow-lg backdrop-blur transition-opacity duration-500 ${
                      chromeDozing ? "opacity-0 pointer-events-none" : "opacity-100"
                    }`}
                  >
                    <span className="px-1 pb-0.5 text-center text-[8px] font-extrabold uppercase tracking-[0.08em] text-foreground-muted">
                      Insert
                    </span>
                    {railInsertItems.map((item) => (
                      <Tooltip key={item.key} label={item.label} placement="right">
                        <button
                          type="button"
                          aria-label={item.label}
                          onClick={item.onClick}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-brand-action/12 hover:text-brand-action"
                        >
                          <Icon name={item.icon} className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                )}

                {/* Context rail — RIGHT gutter (gutter rails L/R, design
                    2026-06-13). Four quiet icon tabs, each popping a flyout
                    anchored to the rail (never over the text column): Outline,
                    placed Embeds, Attachments (the new home of the retired
                    bottom strip), and BeakerBot. Same measured never-overlap
                    gate as the Insert rail; dozes with the chrome. The BeakerBot
                    tab only renders when a BeakerSearch provider is present
                    above us (it stays inert on the constrained mounts). */}
                {contextRailVisible && (
                  <div
                    ref={contextRailRef}
                    data-testid="editor-context-rail"
                    className={`absolute right-3 top-1/2 -translate-y-1/2 z-[4] flex flex-col gap-1 rounded-2xl border border-border bg-surface-overlay/85 px-1.5 py-2 shadow-lg backdrop-blur transition-opacity duration-500 ${
                      chromeDozing ? "opacity-0 pointer-events-none" : "opacity-100"
                    }`}
                  >
                    <span className="px-1 pb-0.5 text-center text-[8px] font-extrabold uppercase tracking-[0.08em] text-foreground-muted">
                      Doc
                    </span>
                    {(
                      [
                        { key: "outline", label: "Outline", icon: "list" },
                        { key: "embeds", label: "Embeds", icon: "layer" },
                        ...(!hideAttachments
                          ? [{ key: "files", label: "Attachments", icon: "attach" }]
                          : []),
                        ...(beakerSearch
                          ? [{ key: "bot", label: "BeakerBot", icon: "ask" }]
                          : []),
                      ] as { key: typeof contextFlyout; label: string; icon: IconName }[]
                    ).map((tab) => (
                      <Tooltip key={tab.key} label={tab.label} placement="left">
                        <button
                          type="button"
                          data-testid={`editor-context-tab-${tab.key}`}
                          aria-label={tab.label}
                          aria-pressed={contextFlyout === tab.key}
                          onClick={() => {
                            if (tab.key === "bot") {
                              // BeakerBot summons the app's existing surface
                              // (no inline panel built into the editor); close
                              // any open flyout so the two never stack.
                              setContextFlyout(null);
                              beakerSearch?.openBeakerBot();
                              return;
                            }
                            setContextFlyout((v) => (v === tab.key ? null : tab.key));
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                            contextFlyout === tab.key
                              ? "bg-brand-action/16 text-brand-action"
                              : "text-foreground-muted hover:bg-brand-action/12 hover:text-brand-action"
                          }`}
                        >
                          <Icon name={tab.icon} className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                )}

                {/* Context-rail flyout. Anchored to the RIGHT rail, opening into
                    the gutter / outside the text column so it never sits on the
                    writing. Dismisses on Esc + outside-click (wired above);
                    does not trap focus. Only rendered alongside a visible
                    Context rail, so it inherits the same never-overlap gate. */}
                {contextRailVisible && contextFlyout && contextFlyout !== "bot" && (
                  <div
                    ref={contextFlyoutRef}
                    data-testid="editor-context-flyout"
                    role="dialog"
                    aria-label={
                      contextFlyout === "outline"
                        ? "Outline"
                        : contextFlyout === "embeds"
                          ? "Embeds in this note"
                          : "Attachments"
                    }
                    className={`absolute right-16 top-1/2 -translate-y-1/2 z-[5] flex max-h-[78%] w-64 flex-col overflow-hidden rounded-2xl border border-border bg-surface-overlay/95 shadow-xl backdrop-blur transition-opacity duration-500 ${
                      chromeDozing ? "opacity-0 pointer-events-none" : "opacity-100"
                    }`}
                  >
                    {contextFlyout === "outline" && (
                      <div className="overflow-auto p-2">
                        <h4 className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.05em] text-foreground-muted">
                          Outline
                        </h4>
                        {docOutline.length === 0 && docEmbeds.length === 0 ? (
                          <p className="px-2 py-1.5 text-meta text-foreground-muted">
                            No headings yet. Add a # heading to build an outline.
                          </p>
                        ) : (
                          <>
                            {docOutline.map((h, i) => (
                              <button
                                key={`h-${i}-${h.text}`}
                                type="button"
                                onClick={() => handleJumpToText(h.text)}
                                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-brand-action/12"
                                style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}
                              >
                                {h.text}
                              </button>
                            ))}
                            {docEmbeds.length > 0 && (
                              <>
                                <div className="my-1 h-px bg-border" aria-hidden="true" />
                                {docEmbeds.map((e, i) => (
                                  <button
                                    key={`oe-${i}-${e.href}`}
                                    type="button"
                                    onClick={() => handleJumpToText(e.label)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-meta text-foreground-muted transition-colors hover:bg-brand-action/12"
                                  >
                                    <Icon name={e.icon} className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{e.label}</span>
                                  </button>
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {contextFlyout === "embeds" && (
                      <div className="overflow-auto p-2">
                        <h4 className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.05em] text-foreground-muted">
                          Embeds in this note
                        </h4>
                        {docEmbeds.length === 0 ? (
                          <p className="px-2 py-1.5 text-meta text-foreground-muted">
                            None yet. Add one from the left Insert rail.
                          </p>
                        ) : (
                          docEmbeds.map((e, i) => (
                            <button
                              key={`e-${i}-${e.href}`}
                              type="button"
                              onClick={() => handleJumpToText(e.label)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-meta text-foreground transition-colors hover:bg-brand-action/12"
                            >
                              <Icon name={e.icon} className="h-4 w-4 shrink-0 text-brand-action" />
                              <span className="truncate">{e.label}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {contextFlyout === "files" && !hideAttachments && (
                      // Attachments flyout = the new home of the retired bottom
                      // strip. The SAME Images / Files tab bar + ImageStrip /
                      // FileStrip + add affordance + drag-to-insert, just lifted
                      // off the bottom edge into the gutter. Nothing lost.
                      <div className="flex min-h-0 flex-col">
                        <div className="flex items-center gap-1 border-b border-border px-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setActiveAttachmentTab("images")}
                            className={`rounded-t px-2.5 py-1 text-meta transition-colors ${
                              activeAttachmentTab === "images"
                                ? "border border-b-transparent border-border bg-surface-raised font-medium text-foreground"
                                : "text-foreground-muted hover:text-foreground"
                            }`}
                          >
                            Images
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveAttachmentTab("files")}
                            className={`rounded-t px-2.5 py-1 text-meta transition-colors ${
                              activeAttachmentTab === "files"
                                ? "border border-b-transparent border-border bg-surface-raised font-medium text-foreground"
                                : "text-foreground-muted hover:text-foreground"
                            }`}
                          >
                            Files
                          </button>
                          <button
                            type="button"
                            aria-label="Add attachment"
                            onClick={() => handleAddImageClick()}
                            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-brand-action/12 hover:text-brand-action"
                          >
                            <Icon name="plus" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-h-0 overflow-auto">
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attachments fallback panel (never-overlap fold). The Attachments flyout
          normally lives in the right Context rail, but the rail only shows when
          the gutter is wide enough and we are in edit mode. When the rail is
          hidden (narrow window / split-screen / Full-bleed / Preview) but the
          user still asks for Attachments via the toolbar toggle, we surface the
          SAME Images / Files strip docked at the bottom edge instead. It sits
          BELOW the writing column (a sticky strip), so it never overlaps the
          text either way. Same ImageStrip / FileStrip + tab bar + add affordance
          + drag-to-insert: nothing is lost, only relocated. */}
      {!hideAttachments && contextFlyout === "files" && !contextRailVisible && (
        <div className="sticky bottom-0 z-10" data-testid="editor-attachments-fallback">
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
            <button
              type="button"
              aria-label="Hide attachments"
              onClick={() => setContextFlyout(null)}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-foreground-muted/15 hover:text-foreground"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
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

  // ---- Render (UNIFIED_EDITOR_SURFACE_DESIGN.md §9) ----
  //
  // The editor renders INLINE at every size. The host popup grows / shrinks
  // itself (modal-grows-in-place) around this same DOM, so the editor never
  // teleports into an overlay and never remounts; its CM6 state + undo refs and
  // any in-flight buffer survive the size transition. The retired model used a
  // body-level portal to move the editor in/out of a fullscreen overlay; that
  // machinery is gone (no portal, no focus trap, no buffer-flip).
  return (
    <>
      {editorTree}

      {/* Reference picker modal (Chemistry Phase 3). Only mounts when
          enableReferencePicker is true AND the picker is open, so the default
          (picker off) adds exactly zero nodes to the DOM. When a reference is
          picked, insert it at the CM6 caret via the existing insertRef. */}
      {enableReferencePicker && referencePickerOpen && (
        <ReferencePicker
          initialTab={referencePickerTab ?? undefined}
          onPick={(markdown) => {
            insertRef.current?.(markdown);
          }}
          onClose={() => {
            setReferencePickerOpen(false);
            setReferencePickerTab(null);
          }}
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
 * One row in the U5 focus-behaviors popover: an icon + label + one-line
 * description, with a small click-to-toggle pill on the right. A plain button
 * (role=menuitemcheckbox) rather than a heavy switch, to keep the popover quiet;
 * the brand-action fill signals the on state. The whole row is clickable.
 */
function FocusToggleRow({
  icon,
  label,
  description,
  checked,
  testId,
  onChange,
}: {
  icon: IconName;
  label: string;
  description: string;
  checked: boolean;
  testId: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken/70"
    >
      <Icon
        name={icon}
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          checked ? "text-brand-action" : "text-foreground-muted"
        }`}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-foreground-muted">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          checked ? "justify-end bg-brand-action" : "justify-start bg-surface-sunken"
        }`}
      >
        <span className="h-3 w-3 rounded-full bg-surface-overlay shadow-sm" />
      </span>
    </button>
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

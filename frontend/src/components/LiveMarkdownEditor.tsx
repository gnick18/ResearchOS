"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { attachmentsApi } from "@/lib/local-api";
import HybridMarkdownEditor from "./HybridMarkdownEditor";
import { blobUrlResolver, encodeAttachmentRefPath } from "@/lib/utils/blob-url-resolver";
import { fileService } from "@/lib/file-system/file-service";
import ImageResizePopover from "./ImageResizePopover";
import { rewriteImageBySrcAlt, parseWidthPercent } from "@/lib/image-resize-utils";
import ImageStrip from "./ImageStrip";
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

// Transparent 1×1 GIF used as the `src` placeholder while the real blob URL
// is being resolved asynchronously, so the browser never tries to fetch the
// raw local path (which would 404 against the Next.js dev server).
const IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Strip CommonMark title and surrounding angle brackets from a raw URL
// captured between (...). Mirrors the helper in HybridMarkdownEditor — keeps
// filenames with spaces routable through the blob-URL cache. The previous
// `[^)\s]+` regex truncated at the first whitespace, so the cache key never
// matched what react-markdown later passed to the <img> renderer.
function canonicalizeRefSrc(raw: string): string {
  let src = raw.trim();
  const titleMatch = src.match(/^(.+?)\s+["'].*["']\s*$/);
  if (titleMatch) src = titleMatch[1].trim();
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
  return src;
}

// Type for editor mode
export type EditorMode = "hybrid" | "preview";

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
  /** Whether to allow any file type uploads (not just images) */
  allowAnyFileType?: boolean;
  /** Editor mode: 'hybrid' (click-to-edit) or 'preview' (read-only rendered) */
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
  /** Pass-through to HybridMarkdownEditor: hide the editor's own internal
   *  Save button. Used by surfaces that own their own disk-save action (the
   *  experiment popup). Defaults to false (button shown). */
  hideSaveButton?: boolean;
  /** Pass-through to HybridMarkdownEditor: receives an imperative function
   *  that flushes the edit buffer, fires onChange, and returns the latest
   *  full-document string synchronously. */
  saveRef?: React.MutableRefObject<(() => string) | null>;
  /** Pass-through to HybridMarkdownEditor: fired on an explicit save with the
   *  value committed to the parent, so the parent can persist it to disk. */
  onExplicitSave?: (value: string) => void;
  /** Pass-through to HybridMarkdownEditor: fired when the editor's in-flight
   *  buffer-dirty flag flips, so a parent that hides the internal Save button
   *  can enable its own Save button the moment the user starts typing. */
  onDirtyChange?: (dirty: boolean) => void;
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
  allowAnyFileType = false,
  mode = "hybrid",
  onModeChange,
  autoStartEditing = false,
  recordType = "experiment",
  hideSaveButton = false,
  saveRef,
  onExplicitSave,
  onDirtyChange,
}: LiveMarkdownEditorProps) {
  // Internal mode state (used if onModeChange is not provided)
  const [internalMode, setInternalMode] = useState<EditorMode>(mode);
  
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
  const [resolvedBlobUrls, setResolvedBlobUrls] = useState<Map<string, string>>(new Map());
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
  // Native-file drag affordance: light up the editor (or the surrounding popup)
  // while the user is dragging a file from Finder over it. Counter handles
  // child-element bubbling — dragenter/leave fire on every nested element the
  // cursor crosses, so we only clear the highlight when the counter returns to 0.
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
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
  // Click-to-resize popover state (preview-mode click on rendered image)
  const [imageResize, setImageResize] = useState<{
    imageSrc: string;
    imageAlt: string;
    x: number;
    y: number;
    currentWidth: number | null;
  } | null>(null);

  // Resolve relative image references to blob URLs whenever the markdown or
  // the active mode changes. The mode dependency is a safety net: if a child
  // component ever wipes the singleton blobUrlResolver cache while we're
  // still mounted (e.g. an aggressive sibling cleanup), switching modes will
  // re-populate freshly from disk so the new render doesn't show dead URLs.
  useEffect(() => {
    // Capture lazily up to the closing paren so filenames with spaces survive,
    // then canonicalize so the cache key matches whatever react-markdown
    // hands the <img> override below. The old `[^)\s]+` form truncated
    // `Images/Emile ID card-1.jpg` down to `Images/Emile` and the cache
    // lookup always missed.
    const imageRegex = /!\[[^\]]*\]\(([^)\n]+?)\)/g;
    const htmlRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
    const srcs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imageRegex.exec(value)) !== null) srcs.add(canonicalizeRefSrc(m[1]));
    while ((m = htmlRegex.exec(value)) !== null) srcs.add(m[1]);

    let cancelled = false;
    (async () => {
      const newPairs: Array<[string, string]> = [];
      for (const src of srcs) {
        if (!blobUrlResolver.isLocalPath(src)) continue;
        const resolvedPath = blobUrlResolver.resolvePath(src, imageBasePath);
        const cached = blobUrlResolver.getCachedUrl(resolvedPath);
        if (cached) {
          newPairs.push([src, cached]);
          continue;
        }
        const url = await blobUrlResolver.getBlobUrl(resolvedPath);
        if (url) newPairs.push([src, url]);
      }
      if (cancelled || newPairs.length === 0) return;
      setResolvedBlobUrls((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [src, url] of newPairs) {
          if (next.get(src) !== url) {
            next.set(src, url);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [value, imageBasePath, currentMode]);

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
   * Handle broken image detection - when an image fails to load
   * Adds to a queue and processes one at a time
   */
  const handleImageError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>, originalSrc: string, alt: string) => {
      // Check if we've already processed this src
      if (processedBrokenSrcsRef.current.has(originalSrc)) {
        return;
      }
      
      // Mark this src as processed
      processedBrokenSrcsRef.current.add(originalSrc);
      
      // Add to the queue
      setBrokenImageQueue(prev => {
        // Check if already in queue
        if (prev.some(img => img.originalSrc === originalSrc)) {
          return prev;
        }
        return [...prev, { originalSrc, alt, kind: "image", element: null }];
      });
    },
    []
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
      if (mutated) onChange(nextValue);
    };

    checkImages();
  }, [previewMode, value, disabled, extractImageSources, checkImageExists, imageBasePath, onChange]);

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

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col h-full"
      onDragEnter={handleWrapperDragEnter}
      onDragLeave={handleWrapperDragLeave}
      // Capture phase: the inner drop handler calls stopPropagation on valid
      // payloads, which would prevent a bubble-phase onDrop here from firing.
      // Capture runs top-down before that stop, so we always reset on drop.
      onDropCapture={handleWrapperDrop}
    >
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
          {/* Two-way mode toggle: Hybrid | Preview. Edit mode (raw textarea)
              was removed after hybrid v2 proved iron-clad in real use. */}
          <div className="flex items-center bg-gray-100 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setMode("hybrid")}
              disabled={disabled}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                currentMode === "hybrid"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              } disabled:opacity-50`}
              title="Click on any block to edit it, everything else stays rendered"
            >
              Hybrid
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              disabled={disabled}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                currentMode === "preview"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              } disabled:opacity-50`}
              title="Read-only rendered preview"
            >
              Preview
            </button>
          </div>
          <button
            type="button"
            onClick={handleAddImageClick}
            disabled={disabled}
            className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
            title={allowAnyFileType ? "Click to upload any file from your computer" : "Click to upload an image file from your computer"}
          >
            {allowAnyFileType ? "Add File" : "Add Image"}
          </button>
          
          {/* Browse Images Button */}
          {onBrowseImages && (
            <button
              type="button"
              onClick={onBrowseImages}
              disabled={disabled}
              className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
              title={`Browse images already attached to this ${recordType}`}
            >
              Browse
            </button>
          )}

          {/* Attachment Strip Toggle — shows a scrollable strip of every
              image OR non-image file attached to this experiment along the
              bottom. A small Images / Files tab bar above the strip switches
              between the two. Drag a thumbnail into the body to insert a
              reference at the drop point. */}
          <button
            type="button"
            onClick={() => setShowAttachmentStrip((v) => !v)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              showAttachmentStrip
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            title={
              showAttachmentStrip
                ? "Hide the attachments strip"
                : "Show every image and file attached to this experiment along the bottom — drag a tile into the body to insert it"
            }
          >
            Strip
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept={allowAnyFileType ? undefined : "image/*"}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Main content area with helper panel and editor */}
      <div
        ref={editorContentRef}
        className="flex flex-1 min-h-0"
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
          if (currentMode === "preview") setMode("hybrid");
        }}
      >
        {/* Editor / Preview — `min-h-0` lets the flex slot shrink below
            its content's natural size so we scroll INSIDE this column
            instead of bursting out of a small popup. */}
        <div className="flex-1 min-h-0 cursor-text overflow-hidden flex flex-col">
          {currentMode === "preview" ? (
            <div className="p-4 h-full overflow-y-auto">
              {value.trim() ? (
                <div className="prose prose-sm prose-gray max-w-none" style={{ lineHeight: "1.7" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkUnderline]}
                    rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
                    components={{
                      a: ({ href, children, ...aProps }) => {
                        const rawHref = typeof href === "string" ? href : "";
                        let decoded = rawHref;
                        try {
                          decoded = decodeURI(rawHref);
                        } catch {
                          // not valid percent-encoding — fall through
                        }
                        const isFileLink =
                          decoded.startsWith("Files/") || decoded.startsWith("./Files/");
                        if (!isFileLink) {
                          // External / non-file refs render as a normal link.
                          return <a href={rawHref} {...aProps}>{children}</a>;
                        }
                        return (
                          <a
                            href={rawHref}
                            onClick={(e) => {
                              e.preventDefault();
                              void handleFileLinkClick(rawHref);
                            }}
                            className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                            {...aProps}
                          >
                            {children}
                          </a>
                        );
                      },
                      img: ({ src, alt, width, ...props }) => {
                        const currentWidthPct = parseWidthPercent(width as string | number | undefined);
                        const originalSrc = String(src || "");
                        const originalAlt = String(alt || "");
                        // Canonicalize before the cache lookup so URLs with
                        // CommonMark titles or angle brackets line up with
                        // the entries the pre-resolve effect wrote.
                        const cacheKey = canonicalizeRefSrc(originalSrc);
                        const cachedBlob = resolvedBlobUrls.get(cacheKey);
                        // While we're waiting for the async blob URL for a
                        // local path, render a transparent placeholder so the
                        // browser doesn't request — and 404 on — the raw path.
                        const needsResolution =
                          blobUrlResolver.isLocalPath(originalSrc) && !cachedBlob;
                        const resolvedSrc = needsResolution
                          ? IMAGE_PLACEHOLDER
                          : (cachedBlob ?? originalSrc);
                        return (
                          <img
                            src={resolvedSrc}
                            alt={originalAlt}
                            width={width}
                            className="max-w-full rounded-lg cursor-pointer"
                            // See HybridMarkdownEditor's matching <img> handler
                            // for why these three props are mandatory: without
                            // them Chrome intercepts native file drops with its
                            // "replace image" default before React's outer
                            // handlers run, breaking attachments when the
                            // cursor is over a rendered image.
                            draggable={false}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => e.preventDefault()}
                            onError={(e) => handleImageError(e, originalSrc, originalAlt)}
                            onClick={(e) => {
                              if (disabled) return;
                              e.stopPropagation();
                              setImageResize({
                                imageSrc: originalSrc,
                                imageAlt: originalAlt,
                                x: e.clientX + 6,
                                y: e.clientY + 6,
                                currentWidth: currentWidthPct,
                              });
                            }}
                            title="Click to resize"
                            {...props}
                          />
                        );
                      },
                    }}
                  >
                    {preserveBlankLines(value)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-gray-300 italic">
                  {placeholder || "Nothing to preview."}
                </p>
              )}
            </div>
          ) : (
            <HybridMarkdownEditor
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              disabled={disabled}
              imageBasePath={imageBasePath}
              showShortcutsHelper={showShortcutsHelper}
              useBlobUrls
              onFileDrop={onFileDrop}
              onImageDrop={onImageDrop}
              allowAnyFileType={allowAnyFileType}
              autoStartEditing={autoStartEditing}
              hideSaveButton={hideSaveButton}
              saveRef={saveRef}
              onExplicitSave={onExplicitSave}
              onDirtyChange={onDirtyChange}
            />
          )}
        </div>
      </div>

      {/* Attachment Strip — every image or non-image file attached to this
          experiment, as scrollable thumbnails / tiles. A small Images |
          Files tab bar switches between the two strips. Drag one into the
          markdown to insert at the drop point, or (images only) drop on the
          trash zone (rendered while an image drag is in progress) to delete
          from disk and strip references. */}
      {showAttachmentStrip && (
        <div className="sticky bottom-0 z-10">
          <div className="flex items-center gap-1 px-3 pt-2 bg-gray-50 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setActiveAttachmentTab("images")}
              className={`px-2.5 py-1 text-xs rounded-t transition-colors ${
                activeAttachmentTab === "images"
                  ? "bg-white text-gray-800 font-medium border border-gray-200 border-b-transparent"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              Images
            </button>
            <button
              type="button"
              onClick={() => setActiveAttachmentTab("files")}
              className={`px-2.5 py-1 text-xs rounded-t transition-colors ${
                activeAttachmentTab === "files"
                  ? "bg-white text-gray-800 font-medium border border-gray-200 border-b-transparent"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              Files
            </button>
          </div>
          {activeAttachmentTab === "images" ? (
            <ImageStrip
              content={value}
              basePath={imageBasePath}
              onJumpToImage={handleJumpToImage}
              recordType={recordType}
            />
          ) : (
            <FileStrip content={value} basePath={imageBasePath} recordType={recordType} />
          )}
        </div>
      )}
      <ImageTrashDropZone value={value} onChange={onChange} basePath={imageBasePath} />
      <FileTrashDropZone value={value} onChange={onChange} basePath={imageBasePath} />

      {/* Image Resize Popover (preview mode click-to-resize) */}
      {imageResize && (
        <ImageResizePopover
          x={imageResize.x}
          y={imageResize.y}
          currentWidth={imageResize.currentWidth}
          onSelect={handleImageResizeSelect}
          onClose={() => setImageResize(null)}
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
          className="fixed bottom-4 right-4 bg-white border border-red-200 rounded-lg shadow-xl z-50 w-80 max-h-96 overflow-hidden"
        >
          <div className="p-3 border-b border-red-100 bg-red-50">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs font-medium text-red-800">
                {currentBrokenImage.kind === "file" ? "File Not Found" : "Image Not Found"}
              </p>
              {brokenImageQueue.length > 0 && (
                <span className="ml-auto text-xs text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                  +{brokenImageQueue.length} more
                </span>
              )}
            </div>
            <p className="text-xs text-red-600 mt-1 truncate" title={currentBrokenImage.originalSrc}>
              {currentBrokenImage.originalSrc}
            </p>
          </div>

          <div className="p-3">
            {currentBrokenImage.kind === "file" ? (
              // File refs: skip the search step entirely. There's no
              // searchFileByFilename API, and the typical recovery for a
              // dangling [name](Files/foo.pdf) is to remove the link.
              <div className="py-4 text-center">
                <p className="text-xs text-gray-500">This file isn&apos;t in the notes folder.</p>
                <p className="text-xs text-gray-400 mt-1">
                  It may have been deleted or moved.
                </p>
                <button
                  type="button"
                  onClick={removeBrokenReference}
                  className="mt-3 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Remove reference from note
                </button>
              </div>
            ) : isSearchingImage ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-xs text-gray-500">Searching for image...</span>
              </div>
            ) : imageSearchResults.length > 0 ? (
              <>
                <p className="text-xs text-gray-600 mb-2">
                  Found {imageSearchResults.length} matching image{imageSearchResults.length > 1 ? 's' : ''}. Click to fix:
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {imageSearchResults.map((result, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => applyImageCorrection(result.path)}
                      className="w-full px-2 py-2 text-left text-xs bg-gray-50 hover:bg-blue-50 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-300 transition-colors"
                      title={result.path}
                    >
                      <div className="font-medium truncate">{result.filename}</div>
                      <div className="text-gray-400 truncate text-[10px] mt-0.5">
                        {result.match_type === 'exact' ? '✓ Exact match' : '○ Similar name'}
                      </div>
                    </button>
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
                <p className="text-xs text-gray-600">
                  This image was imported from LabArchives but kept online-only. Open it in LabArchives to find the original, then drop the saved copy back in here.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={findOnLabArchives}
                    className="w-full px-3 py-2 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center justify-center gap-1.5"
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
                    className="w-full px-3 py-2 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-1.5"
                  >
                    {isReplacingFromDisk ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
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
                    className="w-full px-3 py-1.5 text-xs text-red-600 hover:text-red-800 disabled:text-gray-400 transition-colors"
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
                <p className="text-xs text-gray-500">No matching images found.</p>
                <p className="text-xs text-gray-400 mt-1">
                  The image may have been deleted or moved.
                </p>
                <button
                  type="button"
                  onClick={removeBrokenReference}
                  className="mt-3 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Remove reference from note
                </button>
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
            {brokenImageQueue.length > 0 ? (
              <button
                type="button"
                onClick={skipCurrentBrokenImage}
                className="px-3 py-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                Skip ({brokenImageQueue.length} remaining)
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex items-center gap-3">
              {imageSearchResults.length > 0 && (
                <button
                  type="button"
                  onClick={removeBrokenReference}
                  className="text-xs text-red-600 hover:text-red-800 transition-colors"
                  title="Strip this reference from the markdown body"
                >
                  Remove reference
                </button>
              )}
              <button
                type="button"
                onClick={() => dismissBrokenImagePopup(true)}
                className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800 transition-colors"
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
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {formatRehydrateToastMessage(missingImageRehydrateToast.filenames)}
        </div>
      )}
    </div>
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

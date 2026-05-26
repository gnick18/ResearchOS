"use client";

import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "@/lib/markdown-block-parser";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { fileService } from "@/lib/file-system/file-service";
import { rewriteImageBySrcAlt, parseWidthPercent } from "@/lib/image-resize-utils";
import { ValueHistory, type PushKind } from "@/lib/undo/value-history";
import ImageResizePopover from "./ImageResizePopover";
import FileViewerModal, { classifyFileLink, type FileViewerKind } from "./FileViewerModal";
import Tooltip from "./Tooltip";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

// Transparent 1×1 GIF used as the `src` placeholder while the real blob URL
// is being resolved asynchronously, so the browser never tries to fetch the
// raw local path (which would 404 against the Next.js dev server).
const IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Strip a CommonMark title and surrounding angle brackets from a raw URL
// captured between (...). Filenames with spaces (e.g. "Emile ID card-1.jpg")
// must round-trip the regex / cache lookup unchanged — the earlier `[^)\s]+`
// capture truncated at the first space so the cache key never matched what
// react-markdown handed back to the img renderer.
function canonicalizeRefSrc(raw: string): string {
  let src = raw.trim();
  const titleMatch = src.match(/^(.+?)\s+["'].*["']\s*$/);
  if (titleMatch) src = titleMatch[1].trim();
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
  return src;
}

// Type for the helper panel tab
type HelperTab = "shortcuts" | "styleguide";

// Markdown style guide content
const MARKDOWN_STYLE_GUIDE = [
  { syntax: "# Heading 1", description: "Main title" },
  { syntax: "## Heading 2", description: "Section header" },
  { syntax: "### Heading 3", description: "Subsection" },
  { syntax: "**bold text**", description: "Bold" },
  { syntax: "*italic text*", description: "Italic" },
  { syntax: "~~strikethrough~~", description: "Strikethrough" },
  { syntax: "[link text](url)", description: "Hyperlink" },
  { syntax: "![alt text](image.png)", description: "Image" },
  { syntax: "`inline code`", description: "Inline code" },
  { syntax: "```\ncode block\n```", description: "Code block" },
  { syntax: "> quote text", description: "Blockquote" },
  { syntax: "- list item", description: "Bullet list" },
  { syntax: "1. list item", description: "Numbered list" },
  { syntax: "- [ ] task", description: "Task list" },
  { syntax: "---", description: "Horizontal rule" },
  { syntax: "| Table | Header |", description: "Table" },
];

// Common programming languages for code blocks
const COMMON_LANGUAGES = [
  { code: "javascript", label: "JavaScript", aliases: ["js"] },
  { code: "typescript", label: "TypeScript", aliases: ["ts"] },
  { code: "python", label: "Python", aliases: ["py"] },
  { code: "bash", label: "Bash/Shell", aliases: ["sh", "shell"] },
  { code: "json", label: "JSON", aliases: [] },
  { code: "html", label: "HTML", aliases: [] },
  { code: "css", label: "CSS", aliases: [] },
  { code: "sql", label: "SQL", aliases: [] },
  { code: "java", label: "Java", aliases: [] },
  { code: "c", label: "C", aliases: [] },
  { code: "cpp", label: "C++", aliases: ["c++"] },
  { code: "csharp", label: "C#", aliases: ["c#", "cs"] },
  { code: "go", label: "Go", aliases: ["golang"] },
  { code: "rust", label: "Rust", aliases: ["rs"] },
  { code: "ruby", label: "Ruby", aliases: ["rb"] },
  { code: "php", label: "PHP", aliases: [] },
  { code: "swift", label: "Swift", aliases: [] },
  { code: "kotlin", label: "Kotlin", aliases: [] },
  { code: "yaml", label: "YAML", aliases: ["yml"] },
  { code: "markdown", label: "Markdown", aliases: ["md"] },
  { code: "dockerfile", label: "Dockerfile", aliases: [] },
  { code: "plaintext", label: "Plain Text", aliases: ["text", ""] },
];

// Detect Mac at module level so shortcut labels render correctly on all platforms.
const IS_MAC =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/**
 * Produce a human-readable shortcut label.
 * Mac:       "⌘B", "⌘⇧X", "⌘⌃C", "⌃Q"
 * Win/Linux: "Ctrl+B", "Ctrl+Shift+X", "Ctrl+Alt+C", "Ctrl+Q"
 */
function formatShortcutLabel(
  key: string,
  opts: {
    cmd?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    requireCmdAndCtrl?: boolean;
    requireCtrlOnly?: boolean;
  },
  isMac: boolean
): string {
  const k = key.toUpperCase();
  if (isMac) {
    const parts: string[] = [];
    if (opts.requireCmdAndCtrl) return `⌘⌃${k}`;
    if (opts.requireCtrlOnly) return `⌃${k}`;
    if (opts.cmd) parts.push("⌘");
    if (opts.shift) parts.push("⇧");
    if (opts.alt) parts.push("⌥");
    return parts.join("") + k;
  } else {
    const parts: string[] = [];
    if (opts.requireCmdAndCtrl) return `Ctrl+Alt+${k}`;
    if (opts.requireCtrlOnly) return `Ctrl+${k}`;
    if (opts.cmd) parts.push("Ctrl");
    if (opts.shift) parts.push("Shift");
    if (opts.alt) parts.push("Alt");
    return parts.join("+") + (parts.length > 0 ? "+" : "") + k;
  }
}

// Keyboard shortcuts configuration
interface ShortcutConfig {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  requireCmdAndCtrl?: boolean; // For shortcuts that need both Cmd and Ctrl (e.g., Cmd+Ctrl+C)
  requireCtrlOnly?: boolean; // For shortcuts that need only Ctrl (not Cmd) - e.g., Ctrl+Q
  /** Platform-aware display label; computed from IS_MAC at module init. */
  label: string;
  prefix: string;
  suffix: string;
  cursorOffset: number; // How many chars back to place cursor after prefix when no selection
  description: string;
  isBlockFormat?: boolean; // For code blocks and headings that work differently
}

const KEYBOARD_SHORTCUTS: ShortcutConfig[] = [
  {
    key: "b",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("b", { cmd: true }, IS_MAC),
    prefix: "**",
    suffix: "**",
    cursorOffset: 2,
    description: "Bold",
  },
  {
    key: "i",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("i", { cmd: true }, IS_MAC),
    prefix: "*",
    suffix: "*",
    cursorOffset: 1,
    description: "Italic",
  },
  {
    key: "u",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("u", { cmd: true }, IS_MAC),
    prefix: "<u>",
    suffix: "</u>",
    cursorOffset: 3,
    description: "Underline",
  },
  {
    key: "k",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("k", { cmd: true }, IS_MAC),
    prefix: "[",
    suffix: "](url)",
    cursorOffset: 1,
    description: "Link",
  },
  {
    key: "x",
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    label: formatShortcutLabel("x", { cmd: true, shift: true }, IS_MAC),
    prefix: "~~",
    suffix: "~~",
    cursorOffset: 2,
    description: "Strikethrough",
  },
  {
    key: "c",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    requireCmdAndCtrl: true,
    label: formatShortcutLabel("c", { requireCmdAndCtrl: true }, IS_MAC),
    prefix: "```\n",
    suffix: "\n```",
    cursorOffset: 4,
    description: "Code Block",
    isBlockFormat: true,
  },
  {
    key: "1",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("1", { cmd: true }, IS_MAC),
    prefix: "# ",
    suffix: "",
    cursorOffset: 2,
    description: "Heading 1",
    isBlockFormat: true,
  },
  {
    key: "2",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("2", { cmd: true }, IS_MAC),
    prefix: "## ",
    suffix: "",
    cursorOffset: 3,
    description: "Heading 2",
    isBlockFormat: true,
  },
  {
    key: "3",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("3", { cmd: true }, IS_MAC),
    prefix: "### ",
    suffix: "",
    cursorOffset: 4,
    description: "Heading 3",
    isBlockFormat: true,
  },
  {
    key: "4",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("4", { cmd: true }, IS_MAC),
    prefix: "#### ",
    suffix: "",
    cursorOffset: 5,
    description: "Heading 4",
    isBlockFormat: true,
  },
  {
    key: "5",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("5", { cmd: true }, IS_MAC),
    prefix: "##### ",
    suffix: "",
    cursorOffset: 6,
    description: "Heading 5",
    isBlockFormat: true,
  },
  {
    key: "6",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    label: formatShortcutLabel("6", { cmd: true }, IS_MAC),
    prefix: "###### ",
    suffix: "",
    cursorOffset: 7,
    description: "Heading 6",
    isBlockFormat: true,
  },
  {
    key: "q",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    requireCtrlOnly: true,
    label: formatShortcutLabel("q", { requireCtrlOnly: true }, IS_MAC),
    prefix: "> ",
    suffix: "",
    cursorOffset: 2,
    description: "Quote",
    isBlockFormat: true,
  },
];

interface HybridMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  imageBasePath?: string;
  disabled?: boolean;
  showShortcutsHelper?: boolean;
  useBlobUrls?: boolean;
  /** Caller-supplied handlers used when a native OS file is dropped directly
   *  on a rendered <img> element. Chrome intercepts that drop with its
   *  built-in "replace image" default, breaking the normal bubble path to
   *  the outer editor wrapper. The img component below routes the drop
   *  here directly to bypass that. */
  onFileDrop?: (files: File[]) => void;
  onImageDrop?: (files: File[]) => void;
  allowAnyFileType?: boolean;
  /** When true AND the editor mounts with an empty value, the empty-state
   *  textarea mounts immediately (instead of the "Click to start writing..."
   *  placeholder) so the user has a real input element to type into. Used by
   *  the new-method Create modal where the modal IS the editing surface — a
   *  click-to-start placeholder there reads as "no editor" because users
   *  expect a textbox the moment the markdown tile is selected. Defaults to
   *  false so existing surfaces (notes, results, etc.) keep their
   *  placeholder-first behavior. */
  autoStartEditing?: boolean;
}

/**
 * Adjust the heading level of the current line(s).
 * @param content - The current block content
 * @param cursorPos - The current cursor position within the block
 * @param onChange - Callback to update the block content
 * @param increase - If true, increase heading level (## -> #). If false, decrease (## -> ###).
 * @returns The new cursor position offset
 */
function adjustHeadingLevelInBlock(
  content: string,
  cursorPos: number,
  increase: boolean
): { newContent: string; cursorOffset: number } {
  // Find the start of the current line
  let lineStart = cursorPos;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }
  
  // Find the end of the current line
  let lineEnd = cursorPos;
  while (lineEnd < content.length && content[lineEnd] !== '\n') {
    lineEnd++;
  }
  
  const line = content.substring(lineStart, lineEnd);
  
  // Match heading pattern: start of line, optional spaces, then 1-6 #'s followed by space
  const headingMatch = line.match(/^(\s*)(#{1,6})(\s.*)?$/);
  
  let newLine: string;
  let cursorOffset = 0;
  
  if (headingMatch) {
    const leadingSpaces = headingMatch[1];
    const currentHashes = headingMatch[2];
    const restOfLine = headingMatch[3] || '';
    const currentLevel = currentHashes.length;
    
    if (increase) {
      // Increase heading level (decrease #'s): ## -> #
      if (currentLevel > 1) {
        newLine = leadingSpaces + '#'.repeat(currentLevel - 1) + restOfLine;
        cursorOffset = -1;
      } else {
        // Already at level 1, remove heading entirely
        newLine = leadingSpaces + restOfLine.replace(/^\s/, '');
        cursorOffset = -2;
      }
    } else {
      // Decrease heading level (increase #'s): ## -> ###
      if (currentLevel < 6) {
        newLine = leadingSpaces + '#'.repeat(currentLevel + 1) + restOfLine;
        cursorOffset = 1;
      } else {
        // Already at level 6, can't go lower
        return { newContent: content, cursorOffset: 0 };
      }
    }
  } else {
    // Not a heading - add one
    if (increase) {
      // Add level 1 heading
      newLine = '# ' + line;
      cursorOffset = 2;
    } else {
      // Add level 2 heading
      newLine = '## ' + line;
      cursorOffset = 3;
    }
  }
  
  const newContent = content.substring(0, lineStart) + newLine + content.substring(lineEnd);
  return { newContent, cursorOffset };
}

/**
 * Apply markdown formatting around selected text or insert formatting markers at cursor.
 * If the selected text is already wrapped with the formatting, it will be removed (toggle behavior).
 */
function applyMarkdownFormatInBlock(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  config: ShortcutConfig
): { newContent: string; newCursorStart: number; newCursorEnd: number } {
  const selectedText = content.substring(selectionStart, selectionEnd);

  let newContent: string;
  let newCursorStart: number;
  let newCursorEnd: number;

  if (selectedText) {
    // Check if the selected text is already wrapped with this formatting
    const isAlreadyWrapped = 
      selectedText.startsWith(config.prefix) && selectedText.endsWith(config.suffix);
    
    if (isAlreadyWrapped) {
      // Remove the formatting (toggle off)
      const innerText = selectedText.slice(config.prefix.length, -config.suffix.length);
      newContent = content.substring(0, selectionStart) + innerText + content.substring(selectionEnd);
      newCursorStart = selectionStart;
      newCursorEnd = selectionStart + innerText.length;
    } else {
      // Wrap existing selection with formatting
      newContent = content.substring(0, selectionStart) + config.prefix + selectedText + config.suffix + content.substring(selectionEnd);
      newCursorStart = selectionStart + config.prefix.length;
      newCursorEnd = selectionStart + config.prefix.length + selectedText.length;
    }
  } else {
    // No selection - insert markers and place cursor between them
    const insertion = config.prefix + config.suffix;
    newContent = content.substring(0, selectionStart) + insertion + content.substring(selectionStart);
    newCursorStart = selectionStart + config.cursorOffset;
    newCursorEnd = newCursorStart;
  }

  return { newContent, newCursorStart, newCursorEnd };
}

/**
 * Save button chrome. Pinned to the upper-right of the editor
 * surface. Primary-blue when there are uncommitted edits; disabled
 * (and faded) when there's nothing to save. The button label is
 * static "Save" — the keyboard hint surfaces on hover via the
 * Tooltip component (no native `title=`; that attribute is
 * functionally invisible in this codebase).
 *
 * Rendered in both the empty-state and main-content branches.
 * Hidden when the editor is in read-only/disabled mode since the
 * Save semantic only applies to interactive editing.
 */
function SaveChrome({
  dirty,
  disabled,
  onSave,
}: {
  dirty: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  if (disabled) return null;
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcutHint = isMac ? "Cmd+S" : "Ctrl+S";
  return (
    <div className="absolute top-2 right-3 z-20">
      <Tooltip
        label={
          dirty
            ? `Save changes (${shortcutHint})`
            : `Save changes (${shortcutHint}) — no unsaved edits`
        }
        placement="bottom"
      >
        <button
          type="button"
          data-testid="hybrid-editor-save"
          onClick={(e) => {
            // Stop propagation so the click doesn't bubble into the
            // editor container's click-to-start-editing handler.
            e.stopPropagation();
            onSave();
          }}
          // onMouseDown also stops propagation so the global keydown
          // listener doesn't pre-empt focus mid-click.
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          disabled={!dirty}
          aria-label="Save"
          className={
            dirty
              ? "px-3 py-1.5 text-xs font-medium rounded-md shadow-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              : "px-3 py-1.5 text-xs font-medium rounded-md shadow-sm bg-gray-100 text-gray-400 cursor-not-allowed transition-colors"
          }
        >
          Save
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Unsaved-changes confirm modal. Renders when the parent attempts
 * an external swap of the `value` prop while the editor holds
 * uncommitted local edits. Three resolutions:
 *   - Save: commits the pending document via the provided
 *     onSave (which fires onChange) then proceeds with the swap.
 *   - Discard: drops the pending document, accepts the new value.
 *   - Cancel: stays on the current pending document; the parent's
 *     external swap is held back until the user resolves it later
 *     (e.g. saves manually, then the swap can re-fire).
 *
 * Visual: full-screen overlay with a centered card. No emojis,
 * no em-dashes. Buttons are color-coded — Save (primary blue),
 * Discard (red), Cancel (neutral).
 */
function UnsavedChangesModal({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hybrid-editor-unsaved-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-5">
        <h2
          id="hybrid-editor-unsaved-title"
          className="text-base font-semibold text-gray-900 mb-2"
        >
          Unsaved changes
        </h2>
        <p className="text-sm text-gray-600 mb-5">
          Save before leaving? Your edits have not been committed yet.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            data-testid="hybrid-editor-unsaved-save"
            onClick={onSave}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hybrid Markdown Editor
 *
 * Renders the entire document as preview by default.
 * When a user clicks on a block, that block switches to edit mode
 * while everything else remains in preview mode.
 *
 * Multi-line blocks (code blocks, blockquotes, lists) are edited as a whole.
 */
export default function HybridMarkdownEditor({
  value,
  onChange,
  placeholder,
  imageBasePath,
  disabled = false,
  showShortcutsHelper = true,
  useBlobUrls = true,
  onFileDrop,
  onImageDrop,
  allowAnyFileType = false,
  autoStartEditing = false,
}: HybridMarkdownEditorProps) {
  // Track which block is currently being edited by its start offset
  // Using startOffset is more stable than block ID because it doesn't
  // change when the block content changes during editing.
  //
  // autoStartEditing seeds offset=0 on first mount when value is empty so
  // the empty-state textarea renders immediately. The empty-state branch
  // below renders a virtual textarea at offset 0 when value is "" + we're
  // in edit mode, since parseMarkdownBlocks("") returns [] and renderBlock
  // would otherwise have nothing to attach to.
  const [editingBlockOffset, setEditingBlockOffset] = useState<number | null>(
    autoStartEditing && !value.trim() && !disabled ? 0 : null,
  );
  // Single-click selects a block (without entering edit mode), double-click
  // enters edit. Selection enables keyboard delete + future drag/reorder
  // without competing with the textarea's own cursor placement.
  const [selectedBlockOffset, setSelectedBlockOffset] = useState<number | null>(null);
  // Track the current content of the editing block (for live editing)
  const [editingBlockContent, setEditingBlockContent] = useState<string>("");
  // Track cursor position when entering edit mode
  const [editCursorPosition, setEditCursorPosition] = useState<number | null>(null);
  // Flag to track if we're in the middle of an edit
  const isEditingRef = useRef<boolean>(false);
  // Track the original block length when entering edit mode
  // This allows us to replace the correct portion of the document even when
  // the block structure changes (e.g., adding/removing newlines splits/merges blocks)
  const editingBlockOriginalLengthRef = useRef<number>(0);
  // Original block content captured at session start. Read by the
  // live dirty-flag check in handleEditChange so we can mark dirty
  // only when the buffer actually diverges from what the user
  // started with (not just on length parity). Kept in lockstep with
  // editingBlockOriginalLengthRef.
  const editingBlockOriginalContentRef = useRef<string>("");

  // Buffered-edit snapshot. Captured when a block enters edit mode; held
  // until blur (or explicit exit) at which point the buffer is composed
  // back into the document via a single pushAndCommit call.
  //
  // While this state is non-null, the editor renders surrounding blocks
  // against this snapshot rather than the live `value` prop, so typing
  // into the active textarea does NOT re-parse / re-render the rest of
  // the document on every keystroke. That fixes two bugs:
  //   1. Typing `#` in a paragraph flips the parser's idea of the block
  //      type heading, which used to shift offsets and remount the active
  //      textarea, dropping focus mid-keystroke.
  //   2. Preview blocks under the active textarea would re-render their
  //      ReactMarkdown subtree once per keystroke.
  // See commitBufferedEdit / handleEditBlur for the commit path.
  //
  // Pattern: useState backs the render-time read (`effectiveValue` /
  // `blocks` memo). The parallel `editSessionSnapshotRef` mirrors it
  // for synchronous reads in callbacks that run before React flushes
  // a state update (e.g. handleBlockSelect commits the buffer mid-
  // click). Both must be written together via beginEditSession /
  // commitBufferedEdit so the render path and the imperative path
  // never disagree.
  //
  // Seed: when autoStartEditing seeds editingBlockOffset=0 on the
  // initial mount, also seed the snapshot to the initial value so
  // commit composes against an actual document. Otherwise the snapshot
  // is null and remains so until the first beginEditSession call.
  const initialSnapshot =
    autoStartEditing && !value.trim() && !disabled ? value : null;
  const [editSessionSnapshot, setEditSessionSnapshot] = useState<string | null>(
    initialSnapshot,
  );
  const editSessionSnapshotRef = useRef<string | null>(initialSnapshot);
  
  // Helper panel state
  const [helperCollapsed, setHelperCollapsed] = useState(false);
  const [helperTab, setHelperTab] = useState<HelperTab>("shortcuts");
  
  // Language selector state
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [languageSelectorPosition, setLanguageSelectorPosition] = useState({ top: 0, left: 0 });
  const [codeBlockInsertPosition, setCodeBlockInsertPosition] = useState<number | null>(null);
  const [languageSearch, setLanguageSearch] = useState("");

  // Image resize popover state (click-to-resize on rendered images)
  const [imageResize, setImageResize] = useState<{
    blockOffset: number;
    imageSrc: string;
    imageAlt: string;
    x: number;
    y: number;
    currentWidth: number | null;
  } | null>(null);

  // Active file-link click prompt — same shape and component as in
  // LiveMarkdownEditor's preview mode so a Files/ link clicked in either
  // editor surfaces the same View/Download flow.
  const [fileViewerRequest, setFileViewerRequest] = useState<{
    filename: string;
    resolvedPath: string;
    kind: FileViewerKind;
  } | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const languageSelectorRef = useRef<HTMLDivElement>(null);

  // App-level undo/redo stack. The per-block textarea unmounts and remounts
  // on `editingBlockOffset` change, which wipes any native undo entirely. We
  // own past/future of full-document value snapshots so Cmd+Z keeps working
  // across block boundaries. v1 scope: typing + paste into the active
  // textarea, keyboard formatting shortcuts (Cmd+B etc.), and the
  // wrap-with-newlines block-emergence path. Drag-drop images, language
  // selector inserts, image resize, file deletes, etc. are out of scope and
  // appear as one-shot jumps when undone. See lib/undo/value-history.ts.
  const historyRef = useRef<ValueHistory | null>(null);
  if (historyRef.current === null) {
    // Default boundaryChars (in value-history.ts) include space and newline,
    // which are the constituent chars of the chip-1 soft-break sequence
    // ("  \n"). That means a soft-break insertion ends the current typing
    // run, so undo from "hello  \nworld" goes to "hello  \n" then to "" in
    // two word-level steps rather than collapsing the soft-break and the
    // following word into one. See the corresponding test in
    // value-history.test.ts. Removing space or newline from the default set
    // would silently break this; the test guards against that.
    historyRef.current = new ValueHistory();
  }
  const valueRef = useRef<string>(value);

  // Manual-save model (2026-05-26):
  //
  // Under the manual-save model the editor no longer flushes typed
  // edits to the parent's `onChange` automatically. Typing populates
  // an active block's local buffer (existing buffered-edit layer);
  // committing the buffer (block-switch, Esc, explicit Save, or any
  // bespoke structural transformation like Shift+Enter, language
  // insert, image resize, paste, drop, delete-block) writes to a
  // LOCAL pending-document layer instead of firing `onChange`. The
  // pending document is only flushed to the parent on explicit Save
  // (button click or Cmd+S).
  //
  // `pendingDocument` is non-null when the editor holds uncommitted
  // edits. `editBufferDirty` mirrors that for ergonomic checks +
  // for the nav-away guard.
  //
  // External `value` prop changes from the parent (e.g., the parent
  // resets the document) clear the pending document so the editor
  // re-syncs with the source of truth. Combined with the in-editor
  // unsaved-changes modal (which fires when the parent attempts an
  // external swap while dirty), this gives the user a fighting
  // chance to keep their work.
  const [pendingDocument, setPendingDocument] = useState<string | null>(null);
  const pendingDocumentRef = useRef<string | null>(null);
  const [editBufferDirty, setEditBufferDirty] = useState<boolean>(false);
  const editBufferDirtyRef = useRef<boolean>(false);

  const markDirty = useCallback(() => {
    if (!editBufferDirtyRef.current) {
      editBufferDirtyRef.current = true;
      setEditBufferDirty(true);
    }
  }, []);

  const clearDirty = useCallback(() => {
    if (editBufferDirtyRef.current) {
      editBufferDirtyRef.current = false;
      setEditBufferDirty(false);
    }
    if (pendingDocumentRef.current !== null) {
      pendingDocumentRef.current = null;
      setPendingDocument(null);
    }
  }, []);

  // Track the latest value the parent last accepted (i.e. the most
  // recent value passed in through props OR the most recent value
  // we ourselves emitted via `onChange`). Used to detect EXTERNAL
  // parent-driven changes vs. our own commit. An external change
  // while dirty triggers the unsaved-changes modal.
  const lastAcceptedValueRef = useRef<string>(value);

  // Modal state for the soft-route / parent-swap unsaved-changes
  // confirm. `pendingExternalValue` holds the value the parent is
  // trying to swap to; we hold it back until the user resolves the
  // modal (Save commits the pending document FIRST, then switches;
  // Discard drops the pending document and accepts the parent's new
  // value; Cancel stays on the current pending document).
  const [pendingExternalValue, setPendingExternalValue] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (valueRef.current === value) return;
    // External value change semantics:
    //   - If value matches the last value the parent accepted from us,
    //     this is a no-op re-render of an already-known prop and we
    //     must NOT overwrite our local pending edits. Skip.
    //   - If we have uncommitted local edits AND the parent is trying
    //     to swap to something different, hold the new value back and
    //     open the unsaved-changes modal.
    //   - Otherwise, silently accept the parent's new value as the
    //     fresh working document.
    if (value === lastAcceptedValueRef.current) return;
    if (editBufferDirtyRef.current) {
      setPendingExternalValue(value);
      return;
    }
    historyRef.current?.flushBoundary();
    valueRef.current = value;
    lastAcceptedValueRef.current = value;
  }, [value]);

  // Push a new value into the local working document + history. Does
  // NOT call `onChange`. The parent does not see this value until the
  // user explicitly Saves. Same name + signature as the pre-manual-
  // save helper so existing call sites (Shift+Enter, paste, drop,
  // language insert, image resize, paragraph merge, delete-block, the
  // outer Add-paragraph button) keep working unchanged.
  const pushAndCommit = useCallback(
    (newValue: string, kind: PushKind = "type") => {
      historyRef.current?.push(valueRef.current, newValue, kind);
      valueRef.current = newValue;
      pendingDocumentRef.current = newValue;
      setPendingDocument(newValue);
      markDirty();
    },
    [markDirty]
  );

  // Flush the current pending document (and any in-flight edit
  // buffer) to the parent via a single `onChange` call. Called by
  // the Save button, Cmd+S, and the modal's "Save" choice.
  const manualSaveRef = useRef<() => void>(() => {});
  // Forward-declared here so that `commitBufferedEdit` (defined
  // below) and `manualSave` (defined further below) can both refer
  // to a stable callable. The real implementation is wired further
  // down once `commitBufferedEdit` is available.

  /**
   * Begin a buffered edit session. Captures the current document value
   * into the snapshot (both state and ref — see the
   * editSessionSnapshotRef declaration for why) and flushes the undo-
   * history boundary so the pre-edit value is a clean checkpoint. Safe
   * to call when already in a session; later calls leave the existing
   * snapshot in place (so switching block-to-block mid-session doesn't
   * reset the freeze).
   */
  const beginEditSession = useCallback(() => {
    if (editSessionSnapshotRef.current === null) {
      editSessionSnapshotRef.current = valueRef.current;
      setEditSessionSnapshot(valueRef.current);
    }
    historyRef.current?.flushBoundary();
  }, []);

  /**
   * Buffer-mode keystroke target — read directly by handleEditChange and
   * by intra-edit helpers (Tab, soft-break Enter, formatting shortcuts,
   * language selector, heading-adjust). Holds the live buffer content
   * (which is also what's in setEditingBlockContent state — we keep a
   * ref so synchronous helpers see the latest write before the next
   * render).
   *
   * Seeded to match the autoStartEditing initial state so the very
   * first keystroke commits cleanly even before any explicit
   * beginEditSession / handleBlockEdit call.
   */
  const editingBlockContentRef = useRef<string>("");
  const editingBlockOffsetRef = useRef<number | null>(
    autoStartEditing && !value.trim() && !disabled ? 0 : null,
  );

  // Track whether the edit session began on a blank-line block. If so,
  // a non-blank commit needs surrounding newlines so the parser keeps
  // proper paragraph boundaries (otherwise adjacent paragraphs swallow
  // the new text into a single block). See the original
  // BLANK-LINE FIRST-TYPING GUARD comment in handleEditChange (pre
  // buffered-edit) for the original rationale.
  const editSessionStartedBlankRef = useRef<boolean>(false);

  /**
   * Compose the current edit-session buffer back into the snapshot at
   * the active block's offset and push the result as a single undo
   * step. Clears the snapshot afterwards. Returns the committed value
   * (or null if no session was active or the buffer matched the
   * original block content).
   *
   * The single point of integration with pushAndCommit during a
   * buffered edit: callers that have already mutated the document
   * themselves (Shift+Enter hard split, Backspace paragraph merge)
   * should clear the snapshot manually and skip this helper.
   */
  const commitBufferedEdit = useCallback((): string | null => {
    const snapshot = editSessionSnapshotRef.current;
    const offset = editingBlockOffsetRef.current;
    let buffer = editingBlockContentRef.current;
    if (snapshot === null || offset === null) {
      editSessionStartedBlankRef.current = false;
      return null;
    }
    const originalLength = editingBlockOriginalLengthRef.current;

    // Blank-line block emergence guard. Wrap with \n so the parser
    // doesn't merge the new content into the adjacent paragraphs.
    if (editSessionStartedBlankRef.current && buffer.trim().length > 0) {
      buffer = "\n" + buffer + "\n";
    }

    const newFullContent =
      snapshot.substring(0, offset) +
      buffer +
      snapshot.substring(offset + originalLength);
    editSessionSnapshotRef.current = null;
    setEditSessionSnapshot(null);
    editSessionStartedBlankRef.current = false;
    if (newFullContent === valueRef.current) {
      return null;
    }
    // Commit as a single "paste"-kind step so the whole edit session
    // collapses into one undo entry regardless of how many characters
    // were typed.
    pushAndCommit(newFullContent, "paste");
    return newFullContent;
  }, [pushAndCommit]);

  // Undo / redo operate against the LOCAL working document only.
  // Under the manual-save model they do NOT call onChange — the
  // user can undo as far as they like and the parent only sees the
  // final result on explicit Save. The reverted value is staged
  // into the pending-document layer like any other local commit.
  const performUndo = useCallback((): boolean => {
    const prev = historyRef.current?.undo(valueRef.current) ?? null;
    if (prev === null) return false;
    valueRef.current = prev;
    pendingDocumentRef.current = prev;
    setPendingDocument(prev);
    // If undo returns the editor to the last-saved value, dirty
    // would technically be false again — but we keep dirty=true
    // because subsequent redo restores the dirty state and the
    // user may still want a save event. Cheap and safe.
    markDirty();
    return true;
  }, [markDirty]);

  const performRedo = useCallback((): boolean => {
    const next = historyRef.current?.redo(valueRef.current) ?? null;
    if (next === null) return false;
    valueRef.current = next;
    pendingDocumentRef.current = next;
    setPendingDocument(next);
    markDirty();
    return true;
  }, [markDirty]);

  /**
   * Explicit Save handler. Composes any in-flight edit-session buffer
   * back into the pending document (via commitBufferedEdit), then
   * flushes the pending document to the parent via a single
   * onChange call. After Save the editor is clean (no pending, dirty
   * cleared); the active edit session is also terminated so the user
   * has a clear "done editing" signal. Wired to the Save button +
   * Cmd/Ctrl+S.
   *
   * No-op when there's nothing to save (no buffered session AND no
   * pending document). Returns true if a save happened, false
   * otherwise — used by the unsaved-changes modal's "Save" path to
   * decide whether to swallow the synthetic resolve.
   */
  const manualSave = useCallback((): boolean => {
    // Flush in-flight buffered edit into pending first. This keeps the
    // ordering invariant: commitBufferedEdit writes to pendingDocumentRef
    // via pushAndCommit, so by the time we read pendingDocumentRef we
    // have the freshest typed value baked in.
    if (editSessionSnapshotRef.current !== null) {
      commitBufferedEdit();
    }
    const toSave = pendingDocumentRef.current;
    if (toSave === null) {
      // Nothing pending. Just exit edit mode cleanly if a session was open.
      if (editingBlockOffsetRef.current !== null) {
        editingBlockOffsetRef.current = null;
        editingBlockContentRef.current = "";
        isEditingRef.current = false;
        setEditingBlockOffset(null);
        setEditingBlockContent("");
        setEditCursorPosition(null);
        setShowLanguageSelector(false);
        historyRef.current?.flushBoundary();
      }
      return false;
    }
    lastAcceptedValueRef.current = toSave;
    clearDirty();
    onChange(toSave);
    // Exit edit mode after Save so the user has a visible "saved"
    // signal (textarea collapses to preview, blocks re-render against
    // the committed value).
    editingBlockOffsetRef.current = null;
    editingBlockContentRef.current = "";
    isEditingRef.current = false;
    setEditingBlockOffset(null);
    setEditingBlockContent("");
    setEditCursorPosition(null);
    setShowLanguageSelector(false);
    historyRef.current?.flushBoundary();
    return true;
  }, [commitBufferedEdit, clearDirty, onChange]);

  // Keep the forward-declared ref pointer in sync so callbacks
  // captured before manualSave existed (Cmd+S binding in
  // handleEditKeyDown) read the latest definition.
  useEffect(() => {
    manualSaveRef.current = manualSave;
  }, [manualSave]);

  // Wire the existing useUnsavedChangesGuard hook so the browser's
  // native "Leave site?" dialog fires on full-tab unload (close,
  // refresh, hard-nav) when the editor holds uncommitted edits.
  // Soft-route changes (parent swaps the `value` prop) are covered
  // by the in-editor modal below.
  useUnsavedChangesGuard(editBufferDirty);

  /**
   * Modal handlers for the unsaved-changes confirm. Three paths:
   *
   *   Save: commit the pending document via the normal manualSave
   *   (fires onChange to the parent), THEN accept the parent's
   *   incoming external value. There's a race here in the
   *   controlled-component shape — the parent will see our
   *   onChange and likely re-render with that committed value
   *   before the user's intended target swap propagates. In
   *   practice that's fine because the parent's external swap
   *   intention is already known (pendingExternalValue holds it).
   *   We accept that value as the new baseline after the save.
   *
   *   Discard: drop the pending document entirely, accept the
   *   parent's new value as the new baseline. valueRef + history
   *   reset to the new baseline.
   *
   *   Cancel: leave the pending document alone, clear the modal.
   *   The parent's external swap stays held back; future Save
   *   actions will produce the user's edits as onChange and the
   *   parent will re-render normally.
   */
  const handleUnsavedSave = useCallback(() => {
    manualSave();
    const target = pendingExternalValue;
    if (target !== null) {
      historyRef.current?.flushBoundary();
      valueRef.current = target;
      lastAcceptedValueRef.current = target;
      setPendingExternalValue(null);
    }
  }, [manualSave, pendingExternalValue]);

  const handleUnsavedDiscard = useCallback(() => {
    const target = pendingExternalValue;
    pendingDocumentRef.current = null;
    setPendingDocument(null);
    editSessionSnapshotRef.current = null;
    setEditSessionSnapshot(null);
    editSessionStartedBlankRef.current = false;
    editingBlockOffsetRef.current = null;
    editingBlockContentRef.current = "";
    isEditingRef.current = false;
    setEditingBlockOffset(null);
    setEditingBlockContent("");
    setEditCursorPosition(null);
    setShowLanguageSelector(false);
    editBufferDirtyRef.current = false;
    setEditBufferDirty(false);
    historyRef.current?.flushBoundary();
    if (target !== null) {
      valueRef.current = target;
      lastAcceptedValueRef.current = target;
      setPendingExternalValue(null);
    }
  }, [pendingExternalValue]);

  const handleUnsavedCancel = useCallback(() => {
    setPendingExternalValue(null);
  }, []);

  // Switching which block is being edited (or leaving edit mode entirely) is
  // a logical boundary even when the buffer text hasn't changed yet.
  useEffect(() => {
    historyRef.current?.flushBoundary();
    editingBlockOffsetRef.current = editingBlockOffset;
  }, [editingBlockOffset]);

  // Mirror editingBlockContent state into a ref so the synchronous
  // commitBufferedEdit / onBlur path can read the latest typed text
  // without waiting for an effect to flush. Same pattern as valueRef.
  useEffect(() => {
    editingBlockContentRef.current = editingBlockContent;
  }, [editingBlockContent]);

  // Resolved blob URLs for images (path -> blob URL)
  const [resolvedBlobUrls, setResolvedBlobUrls] = useState<Map<string, string>>(new Map());
  
  /**
   * Auto-grow textarea to fit content
   */
  const autoGrowTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to fit all content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  // Parse the markdown content into blocks.
  //
  // While a block is being edited (snapshot is captured), the surrounding
  // blocks are parsed against the FROZEN snapshot, not the live `value`
  // prop. This is the read side of the buffered-edit model: keystrokes
  // into the active textarea write only to local buffer state, so the
  // live `value` doesn't change mid-edit anyway. Keeping `blocks` keyed
  // off the snapshot during the edit session prevents any stray external
  // value change from re-keying preview blocks underneath the textarea.
  // The frozen snapshot wins during an active edit session (so
  // surrounding blocks don't re-render mid-typing). Otherwise we
  // prefer the LOCAL pending document over the parent's `value`
  // prop — under the manual-save model the pending document is
  // the editor's source of truth for everything that has not yet
  // been Saved.
  const effectiveValue =
    editSessionSnapshot !== null
      ? editSessionSnapshot
      : pendingDocument !== null
        ? pendingDocument
        : value;
  const blocks = useMemo(
    () => parseMarkdownBlocks(effectiveValue),
    [effectiveValue],
  );

  // Find the block that's currently being edited by its start offset
  const editingBlock = useMemo(() => {
    if (editingBlockOffset === null) return null;
    // Find block by start offset - this is stable across re-renders
    // because the offset doesn't change when content within the block changes
    return blocks.find((b) => b.startOffset === editingBlockOffset) || null;
  }, [blocks, editingBlockOffset]);
  
  // When editing block is found, sync the editing content if needed
  useEffect(() => {
    if (editingBlock && isEditingRef.current) {
      // Only update if the block content differs from what we're editing
      // This handles cases where the block was found by offset after content change
      if (editingBlock.content !== editingBlockContent) {
        // The block was re-parsed, update our editing content to match
        // But only if we're not actively typing (which would cause cursor jump)
        // This is a safety net for edge cases
      }
    }
  }, [editingBlock, editingBlockContent]);

  /**
   * Close language selector when clicking outside
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageSelectorRef.current && !languageSelectorRef.current.contains(event.target as Node)) {
        setShowLanguageSelector(false);
        setLanguageSearch("");
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  /**
   * Keyboard actions on the currently-selected (but not-yet-editing) block:
   *   - Delete / Backspace → remove the block
   *   - Enter             → enter edit mode
   *   - Escape            → clear selection
   *
   * Ignored when focus is in an input/textarea/contentEditable so we don't
   * fight an inline editor.
   */
  useEffect(() => {
    if (selectedBlockOffset === null) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // deleteBlockByOffset reads the latest closure via the effect deps.
        const target = selectedBlockOffset;
        const block = blocks.find((b) => b.startOffset === target);
        if (!block) return;
        let start = block.startOffset;
        let end = block.startOffset + block.content.length;
        // Read from valueRef so we splice against the LIVE working
        // document (which may include unsaved pending edits), not
        // the parent's prop snapshot.
        const base = valueRef.current;
        while (end < base.length && base[end] === "\n") end++;
        if (end >= base.length) {
          while (start > 0 && base[start - 1] === "\n") start--;
        }
        pushAndCommit(base.slice(0, start) + base.slice(end), "paste");
        setSelectedBlockOffset(null);
      } else if (e.key === "Escape") {
        setSelectedBlockOffset(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const block = blocks.find((b) => b.startOffset === selectedBlockOffset);
        if (block) {
          setSelectedBlockOffset(null);
          beginEditSession();
          editSessionStartedBlankRef.current = block.type === "blankLine";
          isEditingRef.current = true;
          setEditingBlockOffset(block.startOffset);
          editingBlockOffsetRef.current = block.startOffset;
          setEditingBlockContent(block.content);
          editingBlockContentRef.current = block.content;
          editingBlockOriginalLengthRef.current = block.content.length;
          editingBlockOriginalContentRef.current = block.content;
          setEditCursorPosition(0);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedBlockOffset, blocks, value, onChange, beginEditSession]);

  // Clear selection if the underlying block was removed by an outside edit
  // (e.g. content rewrite). Synchronizing to external state is exactly what
  // useEffect is for; silence the compiler lint.
  useEffect(() => {
    if (selectedBlockOffset === null) return;
    const stillExists = blocks.some((b) => b.startOffset === selectedBlockOffset);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to external state
    if (!stillExists) setSelectedBlockOffset(null);
  }, [blocks, selectedBlockOffset]);

  /**
   * Resolve blob URLs for images in the markdown content. Keyed by the
   * original src token (e.g. `Images/foo.png`) so renderers can do a direct lookup.
   */
  useEffect(() => {
    if (!useBlobUrls) return;

    let cancelled = false;
    (async () => {
      // Lazy capture up to the closing paren so filenames with spaces survive
      // (the old `[^)\s]+` form truncated at the first whitespace). Post-
      // process via canonicalizeRefSrc to drop the CommonMark title and any
      // surrounding angle brackets so the cache key matches whatever
      // react-markdown actually hands the <img> renderer below.
      const imageRegex = /!\[[^\]]*\]\(([^)\n]+?)\)/g;
      const htmlRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
      const srcs = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = imageRegex.exec(value)) !== null) srcs.add(canonicalizeRefSrc(m[1]));
      while ((m = htmlRegex.exec(value)) !== null) srcs.add(m[1]);

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
  }, [value, useBlobUrls, imageBasePath]);

  // Blob URL cleanup intentionally not done here: blobUrlResolver is a
  // process-wide singleton shared with the parent LiveMarkdownEditor. When
  // this child unmounts during a mode toggle (hybrid → preview) the parent
  // is still mounted and still has state pointing at those URLs — revoking
  // them globally would dead-link the preview render. The parent
  // LiveMarkdownEditor handles cleanup on its own unmount, which is the
  // right scope.

  /**
   * Click handler for `[name](Files/…)` links rendered inside hybrid blocks.
   * Mirrors the LiveMarkdownEditor preview-mode handler so both surfaces
   * route through the same FileViewerModal flow.
   */
  const handleFileLinkClick = useCallback(
    async (rawHref: string) => {
      let cleanHref = rawHref;
      try {
        cleanHref = decodeURI(rawHref);
      } catch {
        // not valid percent-encoding — leave as-is
      }
      if (cleanHref.startsWith("./")) cleanHref = cleanHref.slice(2);
      if (!cleanHref.startsWith("Files/")) return;
      const filename =
        cleanHref.slice("Files/".length).split("/").pop() ?? cleanHref;
      const resolvedPath = blobUrlResolver.resolvePath(cleanHref, imageBasePath);
      const decision = classifyFileLink(filename);
      if (decision.type === "download") {
        try {
          const blob = await fileService.readFileAsBlob(resolvedPath);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          // best-effort; broken-link popup will fire on next pre-scan
        }
        return;
      }
      setFileViewerRequest({ filename, resolvedPath, kind: decision.kind });
    },
    [imageBasePath],
  );

  /**
   * Filter languages based on search
   */
  const filteredLanguages = useMemo(() => {
    if (!languageSearch) return COMMON_LANGUAGES;
    const search = languageSearch.toLowerCase();
    return COMMON_LANGUAGES.filter(
      (lang) =>
        lang.label.toLowerCase().includes(search) ||
        lang.code.toLowerCase().includes(search) ||
        lang.aliases.some((alias) => alias.toLowerCase().includes(search))
    );
  }, [languageSearch]);

  /**
   * Handle language selection for code block
   */
  const handleLanguageSelect = useCallback(
    (languageCode: string) => {
      if (codeBlockInsertPosition === null) return;

      // Insert the language code after ```. Under buffered-edit this
      // writes only to local buffer — no per-keystroke commit. The
      // change ships to the parent at the next blur along with whatever
      // else the user types in this session.
      const newContent =
        editingBlockContent.substring(0, codeBlockInsertPosition) +
        languageCode +
        editingBlockContent.substring(codeBlockInsertPosition);

      editingBlockContentRef.current = newContent;
      setEditingBlockContent(newContent);

      // Move cursor to after the language code
      const newCursorPos = codeBlockInsertPosition + languageCode.length;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);

      setShowLanguageSelector(false);
      setLanguageSearch("");
      setCodeBlockInsertPosition(null);
    },
    [codeBlockInsertPosition, editingBlockContent]
  );

  /**
   * Handle clicking on a block to enter edit mode
   */
  const handleBlockSelect = useCallback(
    (block: MarkdownBlock) => {
      if (disabled) return;
      // If another block is currently being edited, commit-and-exit before
      // moving the selection halo. Previously the textarea's onBlur did this
      // implicitly, but we removed it to keep paste-induced transient blurs
      // from tearing down edit mode mid-paste.
      if (editingBlockOffset !== null && editingBlockOffset !== block.startOffset) {
        // Flush buffered edit FIRST so the document reflects what the
        // user just typed, then drop the editing state. The commit
        // clears editSessionSnapshotRef internally.
        commitBufferedEdit();
        isEditingRef.current = false;
        setEditingBlockOffset(null);
        setEditingBlockContent("");
        setEditCursorPosition(null);
        setShowLanguageSelector(false);
      }
      setSelectedBlockOffset(block.startOffset);
    },
    [disabled, editingBlockOffset, commitBufferedEdit]
  );

  const handleBlockEdit = useCallback(
    (block: MarkdownBlock, event?: React.MouseEvent) => {
      if (disabled) return;

      // Entering edit takes over from selection — clear it so we don't show
      // both a selection halo and an editing textarea.
      setSelectedBlockOffset(null);

      // Freeze the document into a snapshot for the duration of this
      // edit session. handleEditChange will then write only to local
      // buffer state and surrounding preview blocks parse against the
      // snapshot, not the live value. Buffered commit happens at blur.
      beginEditSession();
      editSessionStartedBlankRef.current = block.type === "blankLine";

      isEditingRef.current = true;
      setEditingBlockOffset(block.startOffset);
      editingBlockOffsetRef.current = block.startOffset;
      setEditingBlockContent(block.content);
      editingBlockContentRef.current = block.content;
      editingBlockOriginalLengthRef.current = block.content.length;
      editingBlockOriginalContentRef.current = block.content;

      if (event) {
        // Place the textarea caret at the line the user clicked on.
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        const clickY = event.clientY - rect.top;
        const lineHeight = 24;
        const estimatedLine = Math.floor(clickY / lineHeight);
        const lines = block.content.split("\n");
        let offset = 0;
        for (let i = 0; i < Math.min(estimatedLine, lines.length - 1); i++) {
          offset += lines[i].length + 1;
        }
        setEditCursorPosition(Math.min(offset, block.content.length));
      } else {
        setEditCursorPosition(0);
      }
    },
    [disabled, beginEditSession]
  );

  /** Remove a block and its trailing paragraph separator from the document. */
  const deleteBlockByOffset = useCallback(
    (offset: number) => {
      const block = blocks.find((b) => b.startOffset === offset);
      if (!block) return;
      let start = block.startOffset;
      let end = block.startOffset + block.content.length;
      // Eat the paragraph-separating newlines so we don't leave a phantom
      // blank line behind. If the block is at the end, eat leading newlines
      // instead so the previous block doesn't gain a trailing blank line.
      // Splice against the LIVE working document (valueRef) so pending
      // unsaved edits are preserved across delete-block.
      const base = valueRef.current;
      while (end < base.length && base[end] === "\n") end++;
      if (end >= base.length) {
        while (start > 0 && base[start - 1] === "\n") start--;
      }
      pushAndCommit(base.slice(0, start) + base.slice(end), "paste");
      setSelectedBlockOffset(null);
    },
    [blocks, pushAndCommit]
  );

  /**
   * Handle changes to the editing block content.
   *
   * BUFFERED-EDIT MODEL: keystrokes update LOCAL buffer state only.
   * The parent's onChange is NOT called per keystroke. Surrounding
   * preview blocks parse against the frozen edit-session snapshot
   * (see effectiveValue / blocks above) so they don't re-render
   * underneath the active textarea, and the textarea node itself
   * doesn't get re-keyed when the buffer's first character flips it
   * from paragraph to heading (typing `#`). The buffer is composed
   * into a new document value and committed via a single
   * pushAndCommit call on blur — see commitBufferedEdit and
   * handleEditBlur.
   *
   * Side effects that ARE still synchronous here:
   *   - Detect ``` at start-of-line to open the language selector
   *     popup. The popup writes into the buffer, not the document.
   *   - editingBlockContentRef stays in sync with buffer state so
   *     the synchronous commit path reads the freshest text.
   */
  const handleEditChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart || 0;

      // Check if user just typed ``` at the start of a line
      const textBeforeCursor = newContent.substring(0, cursorPos);
      const lines = textBeforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];

      // Check if current line is exactly ``` (code block start)
      if (currentLine === '```' && editingBlockOffset !== null) {
        const insertPos = cursorPos; // Position right after ```

        // Get textarea position for popup
        if (textarea) {
          const textareaRect = textarea.getBoundingClientRect();
          const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
          const lineIndex = lines.length - 1;
          const charWidth = 8; // Approximate monospace char width
          const topOffset = lineIndex * lineHeight;
          const leftOffset = currentLine.length * charWidth;

          setLanguageSelectorPosition({
            top: textareaRect.top + topOffset - textarea.scrollTop + lineHeight,
            left: textareaRect.left + leftOffset,
          });
          setCodeBlockInsertPosition(insertPos);
          setShowLanguageSelector(true);
          setLanguageSearch("");
        }
      }

      // Buffer-only write. Mirror to the ref synchronously so any
      // commit triggered before React flushes the state update
      // (e.g. the user clicks straight to a different block) sees
      // the latest typed character.
      editingBlockContentRef.current = newContent;
      setEditingBlockContent(newContent);
      // Live dirty-flag update. Mark dirty if the buffer now
      // differs from the active block's ORIGINAL content (the
      // value the block had when this edit session began). This
      // lights up the Save button + nav-away guard the moment the
      // user actually changes something, not just on click-into-
      // edit. The comparison length is the original-length ref
      // (set in handleBlockEdit). pendingDocumentRef already
      // independently marks dirty for committed-to-pending edits.
      if (
        newContent !== editingBlockOriginalContentRef.current ||
        pendingDocumentRef.current !== null
      ) {
        markDirty();
      }
    },
    [editingBlockOffset, markDirty]
  );

  /**
   * Exit the active edit-mode session.
   *
   * MANUAL-SAVE MODEL: native textarea blur (click outside, OS focus
   * loss, browser extension probe) no longer triggers this — the
   * buffer stays alive, edit mode persists, and the user can click
   * back to keep typing. This function is now reserved for explicit
   * "leave edit mode" signals:
   *   - Escape key (graceful exit; buffer composes to pending)
   *   - Block switch via handleBlockSelect (commits to pending,
   *     opens a new buffer on the clicked block)
   *   - Bespoke structural transformations that exit edit mode
   *     after splicing the document themselves (Shift+Enter hard
   *     split, Backspace paragraph merge, Split-here button)
   *
   * Internally still calls commitBufferedEdit so any typed content
   * is preserved into the pending document. Under the manual-save
   * model commitBufferedEdit routes through pushAndCommit, which
   * writes to the local pending layer (it does NOT call onChange).
   * onChange is reached only via manualSave (explicit Save button
   * or Cmd+S).
   */
  const handleEditBlur = useCallback(() => {
    commitBufferedEdit();
    editingBlockOffsetRef.current = null;
    editingBlockContentRef.current = "";
    isEditingRef.current = false;
    setEditingBlockOffset(null);
    setEditingBlockContent("");
    setEditCursorPosition(null);
    setShowLanguageSelector(false);
    // Leaving edit mode is a logical boundary for the undo stack.
    historyRef.current?.flushBoundary();
  }, [commitBufferedEdit]);

  /**
   * Helper that intra-edit shortcuts (Tab indent, Cmd+B, Cmd+Ctrl+heading,
   * heading-level adjust, etc.) call to write a new block-buffer value
   * after their own cursor math.
   *
   * Under the buffered-edit model this writes ONLY to the local buffer
   * (and its mirror ref), NOT to the parent document. The whole edit
   * session collapses into a single pushAndCommit at blur time. If the
   * caller is not in an edit session (snapshot is null), we fall back
   * to a direct pushAndCommit — that path is for emergency edits from
   * the helper panel into a not-yet-active block.
   */
  const updateDocumentContent = useCallback(
    (newContent: string) => {
      if (editSessionSnapshotRef.current !== null && editingBlockOffsetRef.current !== null) {
        editingBlockContentRef.current = newContent;
        setEditingBlockContent(newContent);
        return;
      }
      // Fallback: no buffered session active. Commit immediately.
      if (editingBlockOffset !== null) {
        const originalLength = editingBlockOriginalLengthRef.current;
        const newFullContent =
          valueRef.current.substring(0, editingBlockOffset) +
          newContent +
          valueRef.current.substring(editingBlockOffset + originalLength);

        editingBlockOriginalLengthRef.current = newContent.length;
        pushAndCommit(newFullContent, "paste");
      } else {
        pushAndCommit(newContent, "paste");
      }
    },
    [editingBlockOffset, pushAndCommit]
  );

  /**
   * Handle keyboard events in edit mode
   */
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Undo / redo. Short-circuit before any other shortcut. The hybrid
      // editor's per-block textarea remounts on block change, which wipes
      // native undo entirely, so the app-level stack is the only working
      // surface here. preventDefault + stopPropagation: the parent dialog
      // may also listen for Cmd+Z.
      const isMacUndo =
        typeof navigator !== "undefined" &&
        navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdUndo = isMacUndo ? e.metaKey : e.ctrlKey;
      const undoKey = !e.altKey && cmdUndo && e.key.toLowerCase() === "z";
      const redoKeyMac =
        !e.altKey && cmdUndo && e.shiftKey && e.key.toLowerCase() === "z";
      const redoKeyWin =
        !isMacUndo &&
        !e.altKey &&
        e.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "y";
      if (undoKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        performUndo();
        return;
      }
      if (redoKeyMac || redoKeyWin) {
        e.preventDefault();
        e.stopPropagation();
        performRedo();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleEditBlur();
        return;
      }

      // Handle Tab key for indentation
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;
        
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        if (e.shiftKey) {
          // Unindent: remove tab or spaces at start of line
          const content = editingBlockContent;
          let lineStart = start;
          while (lineStart > 0 && content[lineStart - 1] !== "\n") {
            lineStart--;
          }
          
          const lineStartContent = content.substring(lineStart, start);
          if (lineStartContent.startsWith("\t")) {
            const newContent = content.substring(0, lineStart) + content.substring(lineStart + 1);
            setEditingBlockContent(newContent);
            updateDocumentContent(newContent);
            setTimeout(() => {
              textarea.setSelectionRange(start - 1, end - 1);
            }, 0);
          } else if (lineStartContent.startsWith("  ")) {
            const newContent = content.substring(0, lineStart) + content.substring(lineStart + 2);
            setEditingBlockContent(newContent);
            updateDocumentContent(newContent);
            setTimeout(() => {
              textarea.setSelectionRange(start - 2, end - 2);
            }, 0);
          }
        } else {
          // Indent: insert tab or spaces
          const newContent = editingBlockContent.substring(0, start) + "  " + editingBlockContent.substring(end);
          setEditingBlockContent(newContent);
          updateDocumentContent(newContent);
          setTimeout(() => {
            textarea.setSelectionRange(start + 2, end + 2);
          }, 0);
        }
        return;
      }

      // Plain Enter inserts a CommonMark soft break (two trailing spaces +
      // newline). Buffer-only under buffered-edit; the document only sees
      // the soft break at blur. The parser keeps soft breaks inside the
      // current paragraph block, so editingBlockOffset stays put and the
      // textarea does not remount even when we DO re-render against the
      // post-commit value. Guards skip non-shift modifier combos (so
      // Cmd+Enter / Ctrl+Enter remain available to parents) and IME
      // composition (so the textarea's native Enter commits the composition).
      if (
        e.key === "Enter" &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !(e.nativeEvent as KeyboardEvent).isComposing
      ) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea || editingBlockOffset === null) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const softBreak = "  \n";
        const newContent =
          editingBlockContent.substring(0, start) +
          softBreak +
          editingBlockContent.substring(end);
        editingBlockContentRef.current = newContent;
        setEditingBlockContent(newContent);
        const newCursor = start + softBreak.length;
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(newCursor, newCursor);
        }, 0);
        return;
      }

      // Backspace at the very start of a paragraph block merges it into the
      // previous paragraph via a soft-break boundary. Notion / Google Docs
      // style. A confirmation prompt is required because the merge changes
      // block structure and is hard to undo silently. Limited to
      // paragraph-paragraph merges: joining a heading or list via soft-break
      // would produce structurally weird markdown.
      if (
        e.key === "Backspace" &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !(e.nativeEvent as KeyboardEvent).isComposing
      ) {
        const textarea = textareaRef.current;
        if (!textarea || editingBlockOffset === null) return;
        if (textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) {
          // Not at the very start with empty selection; let default run.
          return;
        }
        const currentIdx = blocks.findIndex(
          (b) => b.startOffset === editingBlockOffset
        );
        if (currentIdx <= 0) return;
        // parseMarkdownBlocks emits a `blankLine` block for every blank-line
        // separator between paragraphs (any two adjacent paragraphs in
        // CommonMark are split by at least one blank line), so the
        // immediately-previous index is almost always a blankLine, never the
        // previous paragraph. Walk backwards over blankLines to find the real
        // merge target. The splice range below still uses prevBlock.startOffset
        // to currentBlock.startOffset + currentBlock.content.length, which
        // correctly subsumes the intervening blankLine span.
        let prevIdx = currentIdx - 1;
        while (prevIdx >= 0 && blocks[prevIdx].type === "blankLine") {
          prevIdx -= 1;
        }
        if (prevIdx < 0) return;
        const prevBlock = blocks[prevIdx];
        const currentBlock = blocks[currentIdx];
        if (prevBlock.type !== "paragraph" || currentBlock.type !== "paragraph") {
          return;
        }
        e.preventDefault();
        const ok = window.confirm(
          "Merge with previous paragraph? This combines the two paragraphs into one."
        );
        if (!ok) return;
        const softBreak = "  \n";
        // currentBlock.content reflects the snapshot (since blocks are
        // parsed against effectiveValue). The user may have typed into
        // the buffer; use the live buffer for the merged tail so their
        // edits aren't lost when we collapse out of buffered mode.
        const liveCurrentContent = editingBlockContentRef.current;
        const merged =
          prevBlock.content + softBreak + liveCurrentContent;
        // Use snapshot for the splice base (it's what blocks are keyed off
        // of); if no snapshot somehow, fall back to live value.
        const base = editSessionSnapshotRef.current ?? valueRef.current;
        const newFullContent =
          base.substring(0, prevBlock.startOffset) +
          merged +
          base.substring(currentBlock.startOffset + currentBlock.content.length);
        // Bypass commitBufferedEdit: we have a bespoke transformation.
        editSessionSnapshotRef.current = null;
        setEditSessionSnapshot(null);
        editSessionStartedBlankRef.current = false;
        pushAndCommit(newFullContent, "paste");
        handleEditBlur();
        return;
      }

      // Shift+Enter performs a hard paragraph split. Inserts a blank line at
      // the cursor and exits edit mode so the next re-parse cleanly produces
      // two paragraph blocks. Exiting beats transitioning into the new lower
      // block: the textarea would have to remount on a new offset anyway,
      // which is the rekey path that was the root cause of several prior
      // focus / cursor bugs in this editor.
      if (
        e.key === "Enter" &&
        e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.nativeEvent as KeyboardEvent).isComposing
      ) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea || editingBlockOffset === null) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const hardSplit = "\n\n";
        const newContent =
          editingBlockContent.substring(0, start) +
          hardSplit +
          editingBlockContent.substring(end);
        const originalLength = editingBlockOriginalLengthRef.current;
        // Splice against the snapshot (not the live value). The snapshot
        // is what blocks are derived from in buffered mode; using live
        // value would race against any external prop change during the
        // session.
        const base = editSessionSnapshotRef.current ?? valueRef.current;
        const newFullContent =
          base.substring(0, editingBlockOffset) +
          newContent +
          base.substring(editingBlockOffset + originalLength);
        // Bespoke transformation — bypass commitBufferedEdit.
        editSessionSnapshotRef.current = null;
        setEditSessionSnapshot(null);
        editSessionStartedBlankRef.current = false;
        pushAndCommit(newFullContent, "paste");
        handleEditBlur();
        return;
      }

      // Check if this key combination matches any shortcut
      const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // Handle heading level shortcuts: Cmd+Ctrl+'+' (increase) and Cmd+Ctrl+'-' (decrease)
      const cmdAndCtrlPressed = isMac 
        ? (e.metaKey && e.ctrlKey) 
        : (e.ctrlKey && e.altKey);
      
      if (cmdAndCtrlPressed && (e.key === '+' || e.key === '=' || e.key === '-')) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea && !disabled) {
          const cursorPos = textarea.selectionStart;
          const { newContent, cursorOffset } = adjustHeadingLevelInBlock(
            editingBlockContent,
            cursorPos,
            e.key === '+' || e.key === '='
          );
          
          setEditingBlockContent(newContent);
          updateDocumentContent(newContent);
          
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(cursorPos + cursorOffset, cursorPos + cursorOffset);
          }, 0);
        }
        return;
      }

      for (const shortcut of KEYBOARD_SHORTCUTS) {
        const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const shiftMatches = e.shiftKey === shortcut.shiftKey;
        const altMatches = e.altKey === shortcut.altKey;

        // Handle shortcuts that require both Cmd and Ctrl (e.g., Cmd+Ctrl+C for code block)
        if (shortcut.requireCmdAndCtrl) {
          const cmdAndCtrlMatches = isMac 
            ? (e.metaKey && e.ctrlKey) 
            : (e.ctrlKey && e.altKey);
          
          if (keyMatches && cmdAndCtrlMatches && shiftMatches) {
            e.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && !disabled) {
              // Special handling for code block - show language selector
              if (shortcut.description === "Code Block") {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selectedText = editingBlockContent.substring(start, end);
                
                let newContent: string;
                let insertPos: number;
                
                if (selectedText) {
                  // Wrap existing selection with code block
                  newContent = editingBlockContent.substring(0, start) + "```" + selectedText + "\n```" + editingBlockContent.substring(end);
                  insertPos = start + 3;
                } else {
                  // No selection - insert code block markers
                  newContent = editingBlockContent.substring(0, start) + "```\n\n```" + editingBlockContent.substring(start);
                  insertPos = start + 3;
                }
                
                setEditingBlockContent(newContent);
                updateDocumentContent(newContent);
                
                // Get textarea position for popup
                const textareaRect = textarea.getBoundingClientRect();
                const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
                
                // Calculate line number at cursor position
                const textBeforeInsert = editingBlockContent.substring(0, start);
                const lines = textBeforeInsert.split('\n');
                const lineIndex = lines.length;
                
                setLanguageSelectorPosition({
                  top: textareaRect.top + (lineIndex * lineHeight) - textarea.scrollTop + lineHeight,
                  left: textareaRect.left + 24, // After the ```
                });
                setCodeBlockInsertPosition(insertPos);
                setShowLanguageSelector(true);
                setLanguageSearch("");
                
                // Set cursor position after the opening ```
                setTimeout(() => {
                  textarea.focus();
                  textarea.setSelectionRange(insertPos, insertPos);
                }, 0);
              } else {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const { newContent, newCursorStart, newCursorEnd } = applyMarkdownFormatInBlock(
                  editingBlockContent,
                  start,
                  end,
                  shortcut
                );
                
                setEditingBlockContent(newContent);
                updateDocumentContent(newContent);
                
                setTimeout(() => {
                  textarea.focus();
                  textarea.setSelectionRange(newCursorStart, newCursorEnd);
                }, 0);
              }
            }
            return;
          }
        } else if (shortcut.requireCtrlOnly) {
          // Handle shortcuts that require only Ctrl (not Cmd) - e.g., Ctrl+Q for quote
          const ctrlOnlyMatches = isMac 
            ? (e.ctrlKey && !e.metaKey) 
            : e.ctrlKey;
          
          if (keyMatches && ctrlOnlyMatches && shiftMatches && altMatches) {
            e.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && !disabled) {
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const { newContent, newCursorStart, newCursorEnd } = applyMarkdownFormatInBlock(
                editingBlockContent,
                start,
                end,
                shortcut
              );
              
              setEditingBlockContent(newContent);
              updateDocumentContent(newContent);
              
              setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(newCursorStart, newCursorEnd);
              }, 0);
            }
            return;
          }
        } else {
          // Standard shortcuts
          const cmdMatches = cmdKey === shortcut.ctrlKey;

          if (keyMatches && cmdMatches && shiftMatches && altMatches) {
            // UI affordance fix (break-bot Bug 2, 2026-05-24): the editor
            // owns Cmd+B / Cmd+I / Cmd+K / Cmd+1..6 etc. when focused.
            // stopPropagation keeps any future global keydown listener
            // (command palette, /search jump, etc.) from also acting on
            // the same keystroke. preventDefault alone only stops the
            // browser default; bubble-phase listeners still see the event.
            // Cmd+K is the headliner: it's the universal "insert link"
            // shortcut in Notion / Obsidian / VS Code, so it must reach
            // the editor before anything else.
            e.preventDefault();
            e.stopPropagation();
            const textarea = textareaRef.current;
            if (textarea && !disabled) {
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const { newContent, newCursorStart, newCursorEnd } = applyMarkdownFormatInBlock(
                editingBlockContent,
                start,
                end,
                shortcut
              );

              setEditingBlockContent(newContent);
              updateDocumentContent(newContent);

              setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(newCursorStart, newCursorEnd);
              }, 0);
            }
            return;
          }
        }
      }
    },
    [editingBlockContent, editingBlockOffset, updateDocumentContent, handleEditBlur, disabled, performUndo, performRedo, pushAndCommit, blocks]
  );

  // When autoStartEditing seeds editingBlockOffset on the initial mount we
  // must NOT yank focus into the textarea — the caller (e.g. CreateMethodModal)
  // typically has another field (Method Name) autoFocused at modal-open and
  // stealing focus here makes the autoFocus invisible. Subsequent
  // editingBlockOffset transitions still focus normally.
  const skipInitialAutoFocusRef = useRef(
    autoStartEditing && !value.trim() && !disabled,
  );

  /**
   * Focus the textarea when entering edit mode
   */
  useEffect(() => {
    if (skipInitialAutoFocusRef.current) {
      skipInitialAutoFocusRef.current = false;
      return;
    }
    if (editingBlockOffset !== null && textareaRef.current) {
      textareaRef.current.focus();
      if (editCursorPosition !== null) {
        textareaRef.current.setSelectionRange(editCursorPosition, editCursorPosition);
      }
      // Auto-grow the textarea when entering edit mode
      autoGrowTextarea();
    }
  }, [editingBlockOffset, editCursorPosition, autoGrowTextarea]);
  
  /**
   * Auto-grow textarea when content changes
   */
  useEffect(() => {
    if (editingBlockOffset !== null) {
      autoGrowTextarea();
    }
  }, [editingBlockContent, autoGrowTextarea, editingBlockOffset]);

  /**
   * Cmd+S (Mac) / Ctrl+S (Win/Linux) keyboard shortcut for manual
   * Save. Bound at the document level so it works whether the
   * focus is in the active textarea, on the container, or anywhere
   * else inside the editor's containing modal. Always preventDefault
   * so the browser's "Save page" dialog doesn't fire — even when
   * there's nothing to save (this matches Notion / Docs behavior).
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      // Only consume the shortcut if the active element is inside
      // our container — multiple editors mounted in the same DOM
      // (e.g. Notes + Methods open side-by-side) should each only
      // respond to Cmd+S when they "own" focus.
      const active = document.activeElement as HTMLElement | null;
      if (
        containerRef.current &&
        active &&
        containerRef.current.contains(active)
      ) {
        e.preventDefault();
        e.stopPropagation();
        manualSaveRef.current();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /**
   * Click-outside-the-editor handling under the manual-save model.
   *
   * Pre-2026-05-26 this exited edit mode + commit-on-blur whenever
   * the user mousedown'd anywhere outside the editor container. The
   * manual-save model removes that behavior: the buffer survives a
   * blur, edit mode stays active, and the textarea remains mounted
   * so the user can click back in and continue typing. The user
   * exits explicitly via the Save button, Cmd+S, Escape, or by
   * clicking a different block within the editor.
   *
   * We still keep a NO-OP listener slot here as a documentation
   * anchor for the previous behavior — future contributors looking
   * for "where does click-outside live" will land here and see the
   * deliberate decision.
   */
  useEffect(() => {
    // No click-outside handler under manual-save. See block comment.
    return undefined;
  }, [editingBlockOffset]);

  /**
   * Handle image error for broken images
   */
  const handleImageError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>, originalSrc: string) => {
      // For now, just log the error - could integrate with the broken image fixer
      console.warn("Image failed to load:", originalSrc);
    },
    []
  );

  /**
   * Apply a resize selection from the image popover.
   * Rewrites the corresponding image within the block's markdown source.
   */
  const handleImageResizeSelect = useCallback(
    (width: number | null) => {
      if (!imageResize) return;
      const block = blocks.find((b) => b.startOffset === imageResize.blockOffset);
      if (!block) {
        setImageResize(null);
        return;
      }

      const newBlockContent = rewriteImageBySrcAlt(
        block.content,
        imageResize.imageSrc,
        imageResize.imageAlt,
        width,
      );
      setImageResize(null);
      if (newBlockContent === block.content) return;

      // Splice against the live working document — pending edits
      // are preserved through image-resize. Stays local via
      // pushAndCommit; the user still has to Save explicitly.
      const base = valueRef.current;
      const newValue =
        base.substring(0, block.startOffset) +
        newBlockContent +
        base.substring(block.startOffset + block.content.length);
      pushAndCommit(newValue, "paste");
    },
    [imageResize, blocks, pushAndCommit],
  );

  /**
   * Handle inserting style guide syntax. Two paths:
   *   - Already in an edit session: write into the local buffer at the
   *     cursor, mirror to the ref, move the textarea cursor. No commit
   *     happens until blur.
   *   - Not yet in an edit session: enter one on the first block,
   *     insert the syntax at its start, and stay in the session for
   *     further typing. Same buffered-edit contract — commit at blur.
   */
  const handleInsertSyntax = useCallback(
    (syntax: string) => {
      if (editingBlockOffset === null) {
        // No block is being edited, find the first block or create one
        if (blocks.length > 0) {
          // Enter a buffered edit session anchored on the first block.
          beginEditSession();
          editSessionStartedBlankRef.current = blocks[0].type === "blankLine";
          isEditingRef.current = true;
          setEditingBlockOffset(blocks[0].startOffset);
          editingBlockOffsetRef.current = blocks[0].startOffset;
          const newContent = syntax + blocks[0].content;
          setEditingBlockContent(newContent);
          editingBlockContentRef.current = newContent;
          // Store the original block length + content. handleInsertSyntax
          // is an explicit "insert + start editing" action, so the dirty
          // flag must light up immediately — the buffer already differs
          // from the block's original content (`syntax + ...` vs original).
          editingBlockOriginalLengthRef.current = blocks[0].content.length;
          editingBlockOriginalContentRef.current = blocks[0].content;
          markDirty();
          setEditCursorPosition(syntax.length);

          // Move textarea cursor after the inserted syntax once it
          // mounts (focus effect handles the initial focus).
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.setSelectionRange(syntax.length, syntax.length);
            }
          }, 50);
        }
        return;
      }

      // We're editing a block, insert at cursor position
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = editingBlockContent.substring(0, start) + syntax + editingBlockContent.substring(end);

      editingBlockContentRef.current = newContent;
      setEditingBlockContent(newContent);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + syntax.length, start + syntax.length);
      }, 0);
    },
    [editingBlockOffset, blocks, editingBlockContent, beginEditSession]
  );

  /**
   * Inline "Split here" affordance. Same semantic as Shift+Enter: inserts a
   * hard paragraph split at the textarea's cursor, commits, and exits edit
   * mode so the next re-parse produces two paragraph blocks. Discoverable for
   * users who would not find the keyboard shortcut. Only rendered inside
   * paragraph blocks (see renderBlock); headings, lists, code, blockquotes,
   * tables do not surface it because splitting them mid-edit either makes no
   * sense or produces broken markdown.
   */
  const handleSplitHere = useCallback(() => {
    if (editingBlockOffset === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const hardSplit = "\n\n";
    const newContent =
      editingBlockContent.substring(0, start) +
      hardSplit +
      editingBlockContent.substring(end);
    const originalLength = editingBlockOriginalLengthRef.current;
    // Splice against snapshot under buffered-edit; fall back to live
    // value if no session is active.
    const base = editSessionSnapshotRef.current ?? valueRef.current;
    const newFullContent =
      base.substring(0, editingBlockOffset) +
      newContent +
      base.substring(editingBlockOffset + originalLength);
    // Bespoke transformation — bypass commitBufferedEdit.
    editSessionSnapshotRef.current = null;
    setEditSessionSnapshot(null);
    editSessionStartedBlankRef.current = false;
    pushAndCommit(newFullContent, "paste");
    handleEditBlur();
  }, [editingBlockOffset, editingBlockContent, pushAndCommit, handleEditBlur]);

  /**
   * Render a single block
   */
  const renderBlock = useCallback(
    (block: MarkdownBlock) => {
      // Check if this block is being edited by comparing start offsets
      const isEditing = editingBlockOffset !== null && block.startOffset === editingBlockOffset;

      if (isEditing) {
        // Render as textarea for editing.
        // Key off editingBlockOffset (state) rather than block.startOffset
        // (parsed value) so the textarea node identity is anchored to the
        // user's intent, not to whatever the re-parsed block list happens to
        // hand back this render.
        // NOTE: no onBlur. The document-level click-outside handler below
        // and the Escape key in handleEditKeyDown are the explicit exit
        // signals. A native blur on the textarea (clipboard subsystem,
        // browser extension, accessibility probe) used to dump the user
        // out of edit mode mid-paste, swallowing the pasted content.
        return (
          <div
            key={`editing-${editingBlockOffset}`}
            className="hybrid-block editing-block relative"
            data-block-type={block.type}
          >
            <textarea
              ref={textareaRef}
              value={editingBlockContent}
              onChange={handleEditChange}
              onKeyDown={handleEditKeyDown}
              disabled={disabled}
              className="w-full p-3 text-sm font-mono text-gray-800 bg-white border border-blue-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none overflow-hidden"
              style={{ lineHeight: "1.6", minHeight: "60px" }}
              placeholder="Type here..."
            />
            {block.type === "paragraph" && !disabled && (
              <Tooltip label="Split into new paragraph here (Shift+Enter)" placement="top">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // onMouseDown + preventDefault + stopPropagation, not
                    // onClick: the textarea must retain focus through the
                    // click so handleSplitHere reads selectionStart from the
                    // live cursor. A plain onClick would lose focus first and
                    // selectionStart would snap back to 0.
                    e.preventDefault();
                    e.stopPropagation();
                    handleSplitHere();
                  }}
                  className="absolute -top-2 -right-2 px-2 py-0.5 text-[10px] text-blue-700 bg-white border border-blue-300 rounded-full shadow-sm hover:bg-blue-50 z-10"
                >
                  Split here
                </button>
              </Tooltip>
            )}
          </div>
        );
      }

      // Render as preview
      // Use startOffset as key for stability - it doesn't change when content changes
      const isSelected = selectedBlockOffset === block.startOffset;
      return (
        <div
          key={`block-${block.startOffset}`}
          className={`hybrid-block preview-block relative cursor-pointer rounded transition-all duration-150 ${
            disabled
              ? "opacity-70 cursor-not-allowed"
              : isSelected
                ? "ring-2 ring-blue-400 bg-blue-50"
                : "hover:border-blue-200 hover:bg-blue-50/30"
          }`}
          data-block-type={block.type}
          onClick={(e) => {
            e.stopPropagation();
            handleBlockSelect(block);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            handleBlockEdit(block, e);
          }}
          onDragOver={(e) => {
            if (disabled) return;
            if (!Array.from(e.dataTransfer.types).includes("application/x-research-os-image")) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            // A blue ring while hovered makes the target block obvious.
            (e.currentTarget as HTMLElement).classList.add("ring-2", "ring-blue-400");
          }}
          onDragLeave={(e) => {
            (e.currentTarget as HTMLElement).classList.remove("ring-2", "ring-blue-400");
          }}
          onDrop={(e) => {
            if (disabled) return;
            const raw = e.dataTransfer.getData("application/x-research-os-image");
            if (!raw) return;
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).classList.remove("ring-2", "ring-blue-400");
            let parsed: { filename: string; caption?: string } | null = null;
            try {
              parsed = JSON.parse(raw) as { filename: string; caption?: string };
            } catch {
              return;
            }
            if (!parsed?.filename) return;
            const snippet = `![${parsed.caption ?? ""}](Images/${parsed.filename})`;
            // Insert against the LIVE working document so unsaved
            // pending edits aren't clobbered by the splice. Stays
            // local via pushAndCommit until the user Saves.
            const base = valueRef.current;
            const insertAt = block.startOffset + block.content.length;
            const before = base.slice(0, insertAt);
            const after = base.slice(insertAt);
            // \n\n on each side gives markdown a clean paragraph break; double
            // newlines collapse visually, so this is safe even if the user
            // already had blank lines here.
            pushAndCommit(
              `${before}\n\n${snippet}\n\n${after}`,
              "paste"
            );
          }}
          style={{ minHeight: block.type === "blankLine" ? "1.5em" : undefined }}
        >
          {isSelected && !disabled && (
            <div className="absolute -top-2 -right-2 flex items-center gap-1 bg-white border border-blue-300 rounded-full shadow-sm px-1 py-0.5 z-10">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleBlockEdit(block, e);
                }}
                title="Edit (or double-click the block)"
                className="px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-50 rounded-full"
              >
                Edit
              </button>
              <span className="w-px h-3 bg-gray-200" aria-hidden />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBlockByOffset(block.startOffset);
                }}
                title="Delete (or press Delete/Backspace)"
                className="px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 rounded-full"
              >
                Delete
              </button>
            </div>
          )}
          {block.type === "blankLine" ? (
            // Render blank lines as visible spacing - height based on number of newlines
            <div 
              className="blank-line" 
              style={{ height: `${Math.max(1, block.content.split('\n').length) * 1.5}em` }}
            >
              &nbsp;
            </div>
          ) : block.content.trim() ? (
            <div className="prose prose-sm prose-gray max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
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
                      return <a href={rawHref} {...aProps}>{children}</a>;
                    }
                    return (
                      <a
                        href={rawHref}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
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
                    // Canonicalize before the cache lookup so the entry written
                    // by the pre-resolve effect above (which already strips
                    // titles + angle brackets) is reachable when react-markdown
                    // hands us the same URL with surrounding noise intact.
                    const cacheKey = canonicalizeRefSrc(originalSrc);
                    const cachedBlob = useBlobUrls ? resolvedBlobUrls.get(cacheKey) : undefined;
                    // While we're waiting for the async blob URL for a local
                    // path, render a transparent placeholder so the browser
                    // doesn't request — and 404 on — the raw local path.
                    const needsResolution =
                      useBlobUrls && blobUrlResolver.isLocalPath(originalSrc) && !cachedBlob;
                    const resolvedSrc = needsResolution
                      ? IMAGE_PLACEHOLDER
                      : (cachedBlob ?? originalSrc);
                    return (
                      // eslint-disable-next-line @next/next/no-img-element -- src is a blob URL resolved from a local FSA file (or a transparent data: placeholder while resolving); next/image cannot optimize blob URLs and intrinsic dimensions are unknown for arbitrary user content
                      <img
                        src={resolvedSrc}
                        alt={originalAlt}
                        width={width}
                        data-tour-target="hybrid-editor-embedded-image"
                        className="max-w-full rounded-lg cursor-pointer"
                        // Chrome's "drop on <img>" default behavior
                        // intercepts native file drops before they bubble
                        // to the outer editor wrapper, so we route the
                        // drop here directly and stopPropagation so no
                        // other handler runs. draggable=false also keeps
                        // the browser from treating this img as a drag
                        // source (which can confuse the file drop).
                        draggable={false}
                        onDragOver={(e) => {
                          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(e) => {
                          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const files = Array.from(e.dataTransfer.files);
                          if (files.length === 0) return;
                          const images = files.filter((f) => f.type.startsWith("image/"));
                          const others = files.filter((f) => !f.type.startsWith("image/"));
                          if (images.length > 0) {
                            if (onImageDrop) {
                              onImageDrop(images);
                            } else if (allowAnyFileType && onFileDrop) {
                              onFileDrop(images);
                            }
                          }
                          if (others.length > 0 && allowAnyFileType && onFileDrop) {
                            onFileDrop(others);
                          }
                        }}
                        onError={(e) => handleImageError(e, originalSrc)}
                        onClick={(e) => {
                          if (disabled) return;
                          e.stopPropagation();
                          setImageResize({
                            blockOffset: block.startOffset,
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
                {block.content}
              </ReactMarkdown>
            </div>
          ) : (
            <span className="text-gray-300 italic text-sm">
              {placeholder || "Click to add content..."}
            </span>
          )}
        </div>
      );
    },
    [
      editingBlockOffset,
      editingBlockContent,
      selectedBlockOffset,
      disabled,
      handleBlockSelect,
      handleBlockEdit,
      deleteBlockByOffset,
      handleEditChange,
      handleEditBlur,
      handleEditKeyDown,
      handleSplitHere,
      handleImageError,
      handleFileLinkClick,
      imageBasePath,
      placeholder,
      useBlobUrls,
      resolvedBlobUrls,
      value,
      pushAndCommit,
      onImageDrop,
      onFileDrop,
      allowAnyFileType,
    ]
  );

  // If no content, show placeholder OR an inline textarea when we've been
  // asked to start in edit mode (caller passed autoStartEditing, or the user
  // clicked the placeholder). parseMarkdownBlocks("") returns []  — without
  // this branch a click-to-edit attempt sets state but renderBlock has no
  // block to attach a textarea to, leaving the editor area visually empty
  // and blocking type-to-create flows (CreateMethodModal markdown body).
  if (!value.trim()) {
    return (
      <div className="flex h-full">
        {/* Helper panel */}
        {showShortcutsHelper && (
          <div
            data-tour-target="hybrid-editor-shortcut-bar"
            className={`${helperCollapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-gray-100 bg-gray-50/30 flex flex-col transition-all duration-200`}
          >
            <Tooltip
              label={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
              placement="right"
            >
              <button
                type="button"
                onClick={() => setHelperCollapsed(!helperCollapsed)}
                aria-label={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors self-end m-1"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${helperCollapsed ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </Tooltip>

            {!helperCollapsed && (
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setHelperTab("shortcuts")}
                    className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      helperTab === "shortcuts"
                        ? "bg-white text-gray-800 font-medium shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Shortcuts
                  </button>
                  <button
                    type="button"
                    onClick={() => setHelperTab("styleguide")}
                    className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      helperTab === "styleguide"
                        ? "bg-white text-gray-800 font-medium shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Style Guide
                  </button>
                </div>

                {helperTab === "shortcuts" ? (
                  <div className="space-y-1">
                    {KEYBOARD_SHORTCUTS.filter((s) => !s.description.startsWith("Heading")).map((shortcut) => (
                      <div
                        key={shortcut.key + shortcut.shiftKey}
                        className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group"
                      >
                        <span className="text-xs text-gray-600 group-hover:text-gray-800">
                          {shortcut.description}
                        </span>
                        <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                          {shortcut.label}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Headings 1-6
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        {IS_MAC ? "⌘1-6" : "Ctrl+1-6"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Heading Up
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        {IS_MAC ? "⌘⌃+" : "Ctrl+Alt++"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Heading Down
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        {IS_MAC ? "⌘⌃-" : "Ctrl+Alt+-"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {MARKDOWN_STYLE_GUIDE.map((item, index) => (
                      <div
                        key={index}
                        className="px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group cursor-pointer"
                        onClick={() => handleInsertSyntax(item.syntax)}
                        title={`Click to insert: ${item.syntax}`}
                      >
                        <div className="text-xs font-mono text-gray-700 group-hover:text-blue-600 bg-gray-50 px-1.5 py-0.5 rounded mb-0.5">
                          {item.syntax}
                        </div>
                        <div className="text-[10px] text-gray-400 group-hover:text-gray-500">
                          {item.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        <div className="relative flex-1 flex flex-col min-h-0 h-full">
        {/* Save header chrome — same component used in the main
            branch. Floating top-right; disabled when not dirty,
            primary-blue when dirty. Hidden when there's no Save
            target (no edit session active AND no pending). */}
        <SaveChrome
          dirty={editBufferDirty}
          disabled={disabled}
          onSave={manualSave}
        />
        <div
          ref={containerRef}
          data-tour-target="hybrid-editor-textarea"
          className="hybrid-editor p-4 min-h-0 flex-1 overflow-y-auto cursor-text"
          onClick={() => {
            if (!disabled && editingBlockOffset === null) {
              // Create a new empty paragraph block to edit
              // Use offset 0 for new content
              beginEditSession();
              // Empty-document path: original block length is 0 and the
              // initial buffer is "", so commitBufferedEdit will replace
              // [0..0] of the snapshot with the typed buffer. No blank-
              // line guard needed because there are no surrounding
              // paragraphs to merge into.
              editSessionStartedBlankRef.current = false;
              isEditingRef.current = true;
              setEditingBlockOffset(0);
              editingBlockOffsetRef.current = 0;
              setEditingBlockContent("");
              editingBlockContentRef.current = "";
              editingBlockOriginalLengthRef.current = 0;
              editingBlockOriginalContentRef.current = "";
              setEditCursorPosition(0);
            }
          }}
        >
          {editingBlockOffset !== null ? (
            <textarea
              ref={textareaRef}
              value={editingBlockContent}
              onChange={handleEditChange}
              onKeyDown={handleEditKeyDown}
              disabled={disabled}
              className="w-full p-3 text-sm font-mono text-gray-800 bg-white border border-blue-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none overflow-hidden"
              style={{ lineHeight: "1.6", minHeight: "60px" }}
              placeholder={placeholder || "Type here..."}
            />
          ) : (
            <p className="text-sm text-gray-300 italic">
              {placeholder || "Click to start writing..."}
            </p>
          )}
        </div>
        </div>

        {/* Language Selector Popup */}
        {showLanguageSelector && (
          <div
            ref={languageSelectorRef}
            className="fixed bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-64 max-h-80 overflow-hidden"
            style={{
              top: languageSelectorPosition.top,
              left: languageSelectorPosition.left,
            }}
          >
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search language..."
                value={languageSearch}
                onChange={(e) => setLanguageSearch(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto max-h-60">
              {filteredLanguages.length > 0 ? (
                filteredLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleLanguageSelect(lang.code)}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center justify-between"
                  >
                    <span>{lang.label}</span>
                    {lang.code && (
                      <span className="text-gray-400 font-mono text-[10px]">{lang.code}</span>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-gray-400 text-center">
                  No languages found
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unsaved-changes modal — fires when the parent attempts an
            external value swap while we hold uncommitted edits. */}
        {pendingExternalValue !== null && (
          <UnsavedChangesModal
            onSave={handleUnsavedSave}
            onDiscard={handleUnsavedDiscard}
            onCancel={handleUnsavedCancel}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Helper panel */}
      {showShortcutsHelper && (
        <div
          data-tour-target="hybrid-editor-shortcut-bar"
          className={`${helperCollapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-gray-100 bg-gray-50/30 flex flex-col transition-all duration-200`}
        >
          <Tooltip
            label={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
            placement="right"
          >
            <button
              type="button"
              onClick={() => setHelperCollapsed(!helperCollapsed)}
              aria-label={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors self-end m-1"
            >
              <svg
                className={`w-4 h-4 transition-transform ${helperCollapsed ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </Tooltip>

          {!helperCollapsed && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setHelperTab("shortcuts")}
                  className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                    helperTab === "shortcuts"
                      ? "bg-white text-gray-800 font-medium shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Shortcuts
                </button>
                <button
                  type="button"
                  onClick={() => setHelperTab("styleguide")}
                  className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                    helperTab === "styleguide"
                      ? "bg-white text-gray-800 font-medium shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Style Guide
                </button>
              </div>

              {helperTab === "shortcuts" ? (
                <div className="space-y-1">
                  {KEYBOARD_SHORTCUTS.filter((s) => !s.description.startsWith("Heading")).map((shortcut) => (
                    <div
                      key={shortcut.key + shortcut.shiftKey}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group"
                    >
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        {shortcut.description}
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        {shortcut.label}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                    <span className="text-xs text-gray-600 group-hover:text-gray-800">
                      Headings 1-6
                    </span>
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                      {IS_MAC ? "⌘1-6" : "Ctrl+1-6"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                    <span className="text-xs text-gray-600 group-hover:text-gray-800">
                      Heading Up
                    </span>
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                      {IS_MAC ? "⌘⌃+" : "Ctrl+Alt++"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                    <span className="text-xs text-gray-600 group-hover:text-gray-800">
                      Heading Down
                    </span>
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                      {IS_MAC ? "⌘⌃-" : "Ctrl+Alt+-"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {MARKDOWN_STYLE_GUIDE.map((item, index) => (
                    <div
                      key={index}
                      className="px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group cursor-pointer"
                      onClick={() => handleInsertSyntax(item.syntax)}
                      title={`Click to insert: ${item.syntax}`}
                    >
                      <div className="text-xs font-mono text-gray-700 group-hover:text-blue-600 bg-gray-50 px-1.5 py-0.5 rounded mb-0.5">
                        {item.syntax}
                      </div>
                      <div className="text-[10px] text-gray-400 group-hover:text-gray-500">
                        {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      <div className="relative flex-1 flex flex-col min-h-0 h-full">
        {/* Save header chrome — pinned to the upper-right of the
            editor surface. Visible whenever there's content to render,
            disabled when the buffer matches the snapshot, primary-blue
            when dirty. The button is the ONLY user-driven path to
            commit edits to the parent under the manual-save model;
            Cmd+S is a document-level alias bound in the keydown
            effect higher up. */}
        <SaveChrome
          dirty={editBufferDirty}
          disabled={disabled}
          onSave={manualSave}
        />
        <div
          ref={containerRef}
          data-tour-target="hybrid-editor-textarea"
          className="hybrid-editor p-4 min-h-0 flex-1 overflow-y-auto"
        >
        {blocks.map((block) => renderBlock(block))}
        
        {/* Add new block button at the end */}
        {!disabled && blocks.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Append a new paragraph at the end. Under manual-save
              // this is a LOCAL pending edit: pushAndCommit routes
              // through the pending-document layer, not onChange.
              // The parent only sees this addition when the user
              // hits Save.
              const baseValue = valueRef.current;
              const newContent =
                baseValue +
                (baseValue && !baseValue.endsWith("\n") ? "\n\n" : "\n");
              pushAndCommit(newContent, "paste");
              // The new block will be created on next render
              // Find it and set it as editing by its offset
              setTimeout(() => {
                const newBlocks = parseMarkdownBlocks(newContent);
                const lastBlock = newBlocks[newBlocks.length - 1];
                if (lastBlock && lastBlock.content.trim() === "") {
                  // Open the buffered session anchored on the new
                  // blank-line block. The snapshot we take here is
                  // `newContent` (which the parent has just accepted),
                  // so commitBufferedEdit composes against it correctly.
                  beginEditSession();
                  editSessionStartedBlankRef.current = lastBlock.type === "blankLine";
                  isEditingRef.current = true;
                  setEditingBlockOffset(lastBlock.startOffset);
                  editingBlockOffsetRef.current = lastBlock.startOffset;
                  setEditingBlockContent("");
                  editingBlockContentRef.current = "";
                  // CRITICAL: sync the original-length ref to the new block's
                  // content. Without this, commitBufferedEdit computes
                  // newFullContent against whatever stale length was left by
                  // the previous edit session, which produces a wrong document
                  // slice on commit.
                  editingBlockOriginalLengthRef.current = lastBlock.content.length;
                  editingBlockOriginalContentRef.current = lastBlock.content;
                  setEditCursorPosition(0);
                }
              }, 0);
            }}
            className="mt-2 w-full py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded border border-dashed border-gray-200 hover:border-gray-300 transition-colors"
          >
            + Add paragraph
          </button>
        )}
        </div>
      </div>

      {/* Language Selector Popup */}
      {showLanguageSelector && (
        <div
          ref={languageSelectorRef}
          className="fixed bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-64 max-h-80 overflow-hidden"
          style={{
            top: languageSelectorPosition.top,
            left: languageSelectorPosition.left,
          }}
        >
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="Search language..."
              value={languageSearch}
              onChange={(e) => setLanguageSearch(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-60">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleLanguageSelect(lang.code)}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center justify-between"
                >
                  <span>{lang.label}</span>
                  {lang.code && (
                    <span className="text-gray-400 font-mono text-[10px]">{lang.code}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-gray-400 text-center">
                No languages found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Resize Popover */}
      {imageResize && (
        <ImageResizePopover
          x={imageResize.x}
          y={imageResize.y}
          currentWidth={imageResize.currentWidth}
          onSelect={handleImageResizeSelect}
          onClose={() => setImageResize(null)}
        />
      )}

      {/* File link click prompt — same component used by the parent
          LiveMarkdownEditor's preview mode. */}
      {fileViewerRequest && (
        <FileViewerModal
          filename={fileViewerRequest.filename}
          resolvedPath={fileViewerRequest.resolvedPath}
          kind={fileViewerRequest.kind}
          onClose={() => setFileViewerRequest(null)}
        />
      )}

      {/* Unsaved-changes modal — fires when the parent attempts an
          external value swap while we hold uncommitted edits. */}
      {pendingExternalValue !== null && (
        <UnsavedChangesModal
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
        />
      )}
    </div>
  );
}

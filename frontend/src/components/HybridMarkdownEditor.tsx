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
  findBlockAtOffset,
  updateBlockContent,
  type MarkdownBlock,
} from "@/lib/markdown-block-parser";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { fileService } from "@/lib/file-system/file-service";
import { rewriteImageBySrcAlt, parseWidthPercent } from "@/lib/image-resize-utils";
import ImageResizePopover from "./ImageResizePopover";
import FileViewerModal, { classifyFileLink, type FileViewerKind } from "./FileViewerModal";

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

// Keyboard shortcuts configuration
interface ShortcutConfig {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  requireCmdAndCtrl?: boolean; // For shortcuts that need both Cmd and Ctrl (e.g., Cmd+Ctrl+C)
  requireCtrlOnly?: boolean; // For shortcuts that need only Ctrl (not Cmd) - e.g., Ctrl+Q
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
    label: "⌘B",
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
    label: "⌘I",
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
    label: "⌘U",
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
    label: "⌘K",
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
    label: "⌘⇧X",
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
    label: "⌘⌃C",
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
    label: "⌘1",
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
    label: "⌘2",
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
    label: "⌘3",
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
    label: "⌘4",
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
    label: "⌘5",
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
    label: "⌘6",
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
    label: "⌃Q",
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
}: HybridMarkdownEditorProps) {
  // Track which block is currently being edited by its start offset
  // Using startOffset is more stable than block ID because it doesn't
  // change when the block content changes during editing
  const [editingBlockOffset, setEditingBlockOffset] = useState<number | null>(null);
  // Single-click selects a block (without entering edit mode), double-click
  // enters edit. Selection enables keyboard delete + future drag/reorder
  // without competing with the textarea's own cursor placement.
  const [selectedBlockOffset, setSelectedBlockOffset] = useState<number | null>(null);
  // Track the current content of the editing block (for live editing)
  const [editingBlockContent, setEditingBlockContent] = useState<string>("");
  // Track cursor position when entering edit mode
  const [editCursorPosition, setEditCursorPosition] = useState<number | null>(null);
  // Track the previous value to detect external changes
  const prevValueRef = useRef<string>(value);
  // Flag to track if we're in the middle of an edit
  const isEditingRef = useRef<boolean>(false);
  // Track the original block length when entering edit mode
  // This allows us to replace the correct portion of the document even when
  // the block structure changes (e.g., adding/removing newlines splits/merges blocks)
  const editingBlockOriginalLengthRef = useRef<number>(0);
  
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

  // Parse the markdown content into blocks
  const blocks = useMemo(() => parseMarkdownBlocks(value), [value]);

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
        while (end < value.length && value[end] === "\n") end++;
        if (end >= value.length) {
          while (start > 0 && value[start - 1] === "\n") start--;
        }
        onChange(value.slice(0, start) + value.slice(end));
        setSelectedBlockOffset(null);
      } else if (e.key === "Escape") {
        setSelectedBlockOffset(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const block = blocks.find((b) => b.startOffset === selectedBlockOffset);
        if (block) {
          setSelectedBlockOffset(null);
          isEditingRef.current = true;
          setEditingBlockOffset(block.startOffset);
          setEditingBlockContent(block.content);
          editingBlockOriginalLengthRef.current = block.content.length;
          setEditCursorPosition(0);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedBlockOffset, blocks, value, onChange]);

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
      
      // Insert the language code after ```
      const newContent = 
        editingBlockContent.substring(0, codeBlockInsertPosition) + 
        languageCode + 
        editingBlockContent.substring(codeBlockInsertPosition);
      
      setEditingBlockContent(newContent);
      
      // Update the full document using stored original block extent
      if (editingBlockOffset !== null) {
        const originalLength = editingBlockOriginalLengthRef.current;
        const newFullContent = 
          value.substring(0, editingBlockOffset) + 
          newContent + 
          value.substring(editingBlockOffset + originalLength);
        
        editingBlockOriginalLengthRef.current = newContent.length;
        onChange(newFullContent);
      }
      
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
    [codeBlockInsertPosition, editingBlockContent, editingBlockOffset, value, onChange]
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
        isEditingRef.current = false;
        setEditingBlockOffset(null);
        setEditingBlockContent("");
        setEditCursorPosition(null);
        setShowLanguageSelector(false);
      }
      setSelectedBlockOffset(block.startOffset);
    },
    [disabled, editingBlockOffset]
  );

  const handleBlockEdit = useCallback(
    (block: MarkdownBlock, event?: React.MouseEvent) => {
      if (disabled) return;

      // Entering edit takes over from selection — clear it so we don't show
      // both a selection halo and an editing textarea.
      setSelectedBlockOffset(null);

      isEditingRef.current = true;
      setEditingBlockOffset(block.startOffset);
      setEditingBlockContent(block.content);
      editingBlockOriginalLengthRef.current = block.content.length;

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
    [disabled]
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
      while (end < value.length && value[end] === "\n") end++;
      if (end >= value.length) {
        while (start > 0 && value[start - 1] === "\n") start--;
      }
      onChange(value.slice(0, start) + value.slice(end));
      setSelectedBlockOffset(null);
    },
    [blocks, value, onChange]
  );

  /**
   * Handle changes to the editing block content
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
        // Find the position of this line
        const lineStartIndex = textBeforeCursor.lastIndexOf('\n') + 1;
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
      
      setEditingBlockContent(newContent);
      
      // Update the full document content
      // Use the stored original block extent to replace the correct portion
      // This is more stable than finding the block from re-parsed blocks
      // because block boundaries can change during editing (e.g., adding newlines)
      if (editingBlockOffset !== null) {
        const originalLength = editingBlockOriginalLengthRef.current;
        // Replace the portion of the document from editingBlockOffset to editingBlockOffset + originalLength
        // with the new content
        const newFullContent = 
          value.substring(0, editingBlockOffset) + 
          newContent + 
          value.substring(editingBlockOffset + originalLength);
        
        // Update the original length for the next edit
        editingBlockOriginalLengthRef.current = newContent.length;
        
        onChange(newFullContent);
      } else {
        // Edge case: editing a non-existent block (empty document or new block)
        // Just use the content directly - this handles new notes/empty documents
        onChange(newContent);
      }
    },
    [value, onChange, editingBlockOffset]
  );

  /**
   * Handle leaving edit mode (blur or Escape)
   */
  const handleEditBlur = useCallback(() => {
    // Save any pending changes (already saved in onChange)
    isEditingRef.current = false;
    setEditingBlockOffset(null);
    setEditingBlockContent("");
    setEditCursorPosition(null);
    setShowLanguageSelector(false);
  }, []);

  /**
   * Helper function to update the full document using stored original block extent
   */
  const updateDocumentContent = useCallback(
    (newContent: string) => {
      if (editingBlockOffset !== null) {
        const originalLength = editingBlockOriginalLengthRef.current;
        const newFullContent = 
          value.substring(0, editingBlockOffset) + 
          newContent + 
          value.substring(editingBlockOffset + originalLength);
        
        editingBlockOriginalLengthRef.current = newContent.length;
        onChange(newFullContent);
      } else {
        // Edge case: editing a non-existent block (empty document or new block)
        onChange(newContent);
      }
    },
    [editingBlockOffset, value, onChange]
  );

  /**
   * Handle keyboard events in edit mode
   */
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        }
      }
    },
    [editingBlockContent, editingBlockOffset, updateDocumentContent, handleEditBlur, disabled]
  );

  /**
   * Focus the textarea when entering edit mode
   */
  useEffect(() => {
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
   * Handle clicking outside to exit edit mode
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        editingBlockOffset !== null &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleEditBlur();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [editingBlockOffset, handleEditBlur]);

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

      const newValue =
        value.substring(0, block.startOffset) +
        newBlockContent +
        value.substring(block.startOffset + block.content.length);
      onChange(newValue);
    },
    [imageResize, blocks, value, onChange],
  );

  /**
   * Handle inserting style guide syntax
   */
  const handleInsertSyntax = useCallback(
    (syntax: string) => {
      if (editingBlockOffset === null) {
        // No block is being edited, find the first block or create one
        if (blocks.length > 0) {
          // Click on the first block to start editing
          isEditingRef.current = true;
          setEditingBlockOffset(blocks[0].startOffset);
          setEditingBlockContent(blocks[0].content);
          // Store the original block length
          editingBlockOriginalLengthRef.current = blocks[0].content.length;
          setEditCursorPosition(0);
          
          // Insert syntax after a short delay
          setTimeout(() => {
            const newContent = syntax + blocks[0].content;
            setEditingBlockContent(newContent);
            // Update using stored extent
            const newFullContent = 
              value.substring(0, blocks[0].startOffset) + 
              newContent + 
              value.substring(blocks[0].startOffset + blocks[0].content.length);
            editingBlockOriginalLengthRef.current = newContent.length;
            onChange(newFullContent);
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
      
      setEditingBlockContent(newContent);
      updateDocumentContent(newContent);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + syntax.length, start + syntax.length);
      }, 0);
    },
    [editingBlockOffset, blocks, editingBlockContent, value, onChange, updateDocumentContent]
  );

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
            className="hybrid-block editing-block"
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
            const insertAt = block.startOffset + block.content.length;
            const before = value.slice(0, insertAt);
            const after = value.slice(insertAt);
            // \n\n on each side gives markdown a clean paragraph break; double
            // newlines collapse visually, so this is safe even if the user
            // already had blank lines here.
            onChange(`${before}\n\n${snippet}\n\n${after}`);
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
                      <img
                        src={resolvedSrc}
                        alt={originalAlt}
                        width={width}
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
      handleImageError,
      handleFileLinkClick,
      imageBasePath,
      placeholder,
      useBlobUrls,
      resolvedBlobUrls,
      value,
      onChange,
    ]
  );

  // If no content, show placeholder
  if (!value.trim() && editingBlockOffset === null) {
    return (
      <div className="flex h-full">
        {/* Helper panel */}
        {showShortcutsHelper && (
          <div className={`${helperCollapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-gray-100 bg-gray-50/30 flex flex-col transition-all duration-200`}>
            <button
              type="button"
              onClick={() => setHelperCollapsed(!helperCollapsed)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors self-end m-1"
              title={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
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
                        ⌘1-6
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Heading Up
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        ⌘⌃+
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Heading Down
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        ⌘⌃-
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
        
        <div
          ref={containerRef}
          className="hybrid-editor p-4 min-h-0 h-full overflow-y-auto cursor-text flex-1"
          onClick={() => {
            if (!disabled) {
              // Create a new empty paragraph block to edit
              // Use offset 0 for new content
              isEditingRef.current = true;
              setEditingBlockOffset(0);
              setEditingBlockContent("");
              setEditCursorPosition(0);
            }
          }}
        >
          <p className="text-sm text-gray-300 italic">
            {placeholder || "Click to start writing..."}
          </p>
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
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Helper panel */}
      {showShortcutsHelper && (
        <div className={`${helperCollapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-gray-100 bg-gray-50/30 flex flex-col transition-all duration-200`}>
          <button
            type="button"
            onClick={() => setHelperCollapsed(!helperCollapsed)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors self-end m-1"
            title={helperCollapsed ? "Expand helper panel" : "Collapse helper panel"}
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
                      ⌘1-6
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                    <span className="text-xs text-gray-600 group-hover:text-gray-800">
                      Heading Up
                    </span>
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                      ⌘⌃+
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                    <span className="text-xs text-gray-600 group-hover:text-gray-800">
                      Heading Down
                    </span>
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                      ⌘⌃-
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
      
      <div ref={containerRef} className="hybrid-editor p-4 min-h-0 h-full overflow-y-auto flex-1">
        {blocks.map((block) => renderBlock(block))}
        
        {/* Add new block button at the end */}
        {!disabled && blocks.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Append a new paragraph at the end
              const newContent = value + (value && !value.endsWith("\n") ? "\n\n" : "\n");
              onChange(newContent);
              // The new block will be created on next render
              // Find it and set it as editing by its offset
              setTimeout(() => {
                const newBlocks = parseMarkdownBlocks(newContent);
                const lastBlock = newBlocks[newBlocks.length - 1];
                if (lastBlock && lastBlock.content.trim() === "") {
                  isEditingRef.current = true;
                  setEditingBlockOffset(lastBlock.startOffset);
                  setEditingBlockContent("");
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
    </div>
  );
}

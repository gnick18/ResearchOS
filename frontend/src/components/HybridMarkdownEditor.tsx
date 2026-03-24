"use client";

import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import {
  parseMarkdownBlocks,
  findBlockAtOffset,
  updateBlockContent,
  type MarkdownBlock,
} from "@/lib/markdown-block-parser";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

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
}: HybridMarkdownEditorProps) {
  // Track which block is currently being edited by its start offset
  // Using startOffset is more stable than block ID because it doesn't
  // change when the block content changes during editing
  const [editingBlockOffset, setEditingBlockOffset] = useState<number | null>(null);
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
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const languageSelectorRef = useRef<HTMLDivElement>(null);
  
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
  const handleBlockClick = useCallback(
    (block: MarkdownBlock, event: React.MouseEvent) => {
      if (disabled) return;

      // Set this block as editing by its start offset
      isEditingRef.current = true;
      setEditingBlockOffset(block.startOffset);
      setEditingBlockContent(block.content);
      // Store the original block length so we can replace the correct portion
      // of the document even when block boundaries change during editing
      editingBlockOriginalLengthRef.current = block.content.length;

      // Calculate cursor position based on click location
      // The click position relative to the block element
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const clickY = event.clientY - rect.top;
      
      // Estimate line number based on click position
      const lineHeight = 24; // Approximate line height
      const estimatedLine = Math.floor(clickY / lineHeight);
      
      // Find the character offset for that line within the block
      const lines = block.content.split("\n");
      let offset = 0;
      for (let i = 0; i < Math.min(estimatedLine, lines.length - 1); i++) {
        offset += lines[i].length + 1; // +1 for newline
      }
      
      setEditCursorPosition(Math.min(offset, block.content.length));
    },
    [disabled]
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
        // Render as textarea for editing
        // Use startOffset as key for stability - it doesn't change when content changes
        return (
          <div
            key={`block-${block.startOffset}`}
            className="hybrid-block editing-block"
            data-block-type={block.type}
          >
            <textarea
              ref={textareaRef}
              value={editingBlockContent}
              onChange={handleEditChange}
              onBlur={handleEditBlur}
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
      return (
        <div
          key={`block-${block.startOffset}`}
          className={`hybrid-block preview-block cursor-pointer rounded transition-all duration-150 ${
            disabled
              ? "opacity-70 cursor-not-allowed"
              : "hover:border-blue-200 hover:bg-blue-50/30"
          }`}
          data-block-type={block.type}
          onClick={(e) => handleBlockClick(block, e)}
          style={{ minHeight: block.type === "blankLine" ? "1.5em" : undefined }}
        >
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
                rehypePlugins={[rehypeRaw, rehypeHighlight]}
                components={{
                  img: ({ src, alt, ...props }) => {
                    // Resolve relative image paths through the backend API
                    let resolvedSrc = String(src || "");
                    const originalSrc = resolvedSrc;

                    if (resolvedSrc.startsWith("../../Images/")) {
                      const imagePath = resolvedSrc.slice(3);
                      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(imagePath)}`;
                    } else if (imageBasePath && resolvedSrc.startsWith("./")) {
                      const relativePath = resolvedSrc.slice(2);
                      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(
                        imageBasePath + "/" + relativePath
                      )}`;
                    } else if (resolvedSrc.startsWith("Images/")) {
                      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(resolvedSrc)}`;
                    }

                    return (
                      <img
                        src={resolvedSrc}
                        alt={alt || ""}
                        className="max-w-full rounded-lg"
                        onError={(e) => handleImageError(e, originalSrc)}
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
      disabled,
      handleBlockClick,
      handleEditChange,
      handleEditBlur,
      handleEditKeyDown,
      handleImageError,
      imageBasePath,
      placeholder,
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
          className="hybrid-editor p-4 min-h-[300px] h-full overflow-y-auto cursor-text flex-1"
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
      
      <div ref={containerRef} className="hybrid-editor p-4 min-h-[300px] h-full overflow-y-auto flex-1">
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
    </div>
  );
}

"use client";

import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";

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

// Image resize percentage options
const RESIZE_OPTIONS = [25, 50, 75, 100];

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

// Regex patterns for detecting markdown images - must match ENTIRE selection
const MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const HTML_IMAGE_REGEX = /^<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>$/i;
// Regex for detecting image file paths (relative or with common extensions)
// Supports paths like: ./Images/file.png, Images/file.png, /path/to/file.jpg, file.png
const IMAGE_PATH_REGEX = /^\.?\/?[^\s<>"]+\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;
// More flexible regex to extract image paths from text that might have extra characters
const FLEXIBLE_IMAGE_PATH_REGEX = /[^\s<>"]+\.(png|jpg|jpeg|gif|webp|svg|bmp)/i;

/**
 * Check if the selected text is a valid image reference.
 * Valid formats:
 * - Markdown image: ![alt](src)
 * - HTML image: <img src="..." />
 * - Plain image path with common extensions
 * - Also tries to extract image paths from text with extra characters
 */
function isValidImageSelection(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  
  // Check for markdown image syntax (must be complete)
  if (MARKDOWN_IMAGE_REGEX.test(trimmed)) return true;
  
  // Check for HTML image syntax (must be complete)
  if (HTML_IMAGE_REGEX.test(trimmed)) return true;
  
  // Check for plain image paths with common extensions
  if (IMAGE_PATH_REGEX.test(trimmed)) return true;
  
  // Try to extract an image path from text that might have extra characters
  // This handles cases where the user selects text like "(./Images/file.png)" or similar
  const pathMatch = trimmed.match(FLEXIBLE_IMAGE_PATH_REGEX);
  if (pathMatch) {
    // Verify the extracted path is a valid image path
    const extractedPath = pathMatch[0];
    if (IMAGE_PATH_REGEX.test(extractedPath)) {
      return true;
    }
  }
  
  return false;
}

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

interface LiveMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onImageDrop?: (files: File[]) => void;
  /** Callback for uploading any file type (images and non-images) */
  onFileDrop?: (files: File[]) => void;
  /** Base path in the data repo for resolving relative image URLs (e.g. "results/task-5") */
  imageBasePath?: string;
  /** Whether to show the toolbar with Preview and Add Image buttons */
  showToolbar?: boolean;
  /** Callback when Add Image button is clicked (if not provided, uses internal file input) */
  onAddImage?: () => void;
  /** Whether the editor is in read-only mode */
  disabled?: boolean;
  /** Whether to show the keyboard shortcuts helper panel */
  showShortcutsHelper?: boolean;
  /** Whether to allow any file type uploads (not just images) */
  allowAnyFileType?: boolean;
}

/**
 * Adjust the heading level of the current line(s).
 * @param textarea - The textarea element
 * @param value - The current text value
 * @param onChange - Callback to update the value
 * @param increase - If true, increase heading level (## -> #). If false, decrease (## -> ###).
 */
function adjustHeadingLevel(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (value: string) => void,
  increase: boolean
): void {
  const cursorPos = textarea.selectionStart;
  
  // Find the start of the current line
  let lineStart = cursorPos;
  while (lineStart > 0 && value[lineStart - 1] !== '\n') {
    lineStart--;
  }
  
  // Find the end of the current line
  let lineEnd = cursorPos;
  while (lineEnd < value.length && value[lineEnd] !== '\n') {
    lineEnd++;
  }
  
  const line = value.substring(lineStart, lineEnd);
  
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
        return;
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
  
  const newValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
  onChange(newValue);
  
  // Restore focus and cursor position
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos + cursorOffset, cursorPos + cursorOffset);
  }, 0);
}

/**
 * Apply markdown formatting around selected text or insert formatting markers at cursor.
 * If the selected text is already wrapped with the formatting, it will be removed (toggle behavior).
 */
function applyMarkdownFormat(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (value: string) => void,
  config: ShortcutConfig
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = value.substring(start, end);

  let newValue: string;
  let newCursorStart: number;
  let newCursorEnd: number;

  if (selectedText) {
    // Check if the selected text is already wrapped with this formatting
    const isAlreadyWrapped = 
      selectedText.startsWith(config.prefix) && selectedText.endsWith(config.suffix);
    
    if (isAlreadyWrapped) {
      // Remove the formatting (toggle off)
      const innerText = selectedText.slice(config.prefix.length, -config.suffix.length);
      newValue = value.substring(0, start) + innerText + value.substring(end);
      newCursorStart = start;
      newCursorEnd = start + innerText.length;
    } else {
      // Wrap existing selection with formatting
      newValue = value.substring(0, start) + config.prefix + selectedText + config.suffix + value.substring(end);
      newCursorStart = start + config.prefix.length;
      newCursorEnd = start + config.prefix.length + selectedText.length;
    }
  } else {
    // No selection - insert markers and place cursor between them
    const insertion = config.prefix + config.suffix;
    newValue = value.substring(0, start) + insertion + value.substring(start);
    newCursorStart = start + config.cursorOffset;
    newCursorEnd = newCursorStart;
  }

  onChange(newValue);

  // Restore focus and set cursor position
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(newCursorStart, newCursorEnd);
  }, 0);
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
  showToolbar = true,
  onAddImage,
  disabled = false,
  showShortcutsHelper = true,
  allowAnyFileType = false,
}: LiveMarkdownEditorProps) {
  const [previewMode, setPreviewMode] = useState(false);
  const [showResizeDropdown, setShowResizeDropdown] = useState(false);
  const [helperCollapsed, setHelperCollapsed] = useState(false);
  const [hasValidImageSelection, setHasValidImageSelection] = useState(false);
  const [showDisabledPopup, setShowDisabledPopup] = useState(false);
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [languageSelectorPosition, setLanguageSelectorPosition] = useState({ top: 0, left: 0 });
  const [codeBlockInsertPosition, setCodeBlockInsertPosition] = useState<number | null>(null);
  const [languageSearch, setLanguageSearch] = useState("");
  const [helperTab, setHelperTab] = useState<HelperTab>("shortcuts");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizeDropdownRef = useRef<HTMLDivElement>(null);
  const languageSelectorRef = useRef<HTMLDivElement>(null);
  const disabledPopupTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Check if the current textarea selection is a valid image reference.
   * Updates the hasValidImageSelection state.
   */
  const checkSelectionValidity = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setHasValidImageSelection(false);
      return;
    }
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    // Use textarea.value directly to ensure we get the current content
    // (the value prop might be out of sync during rapid selection changes)
    const selectedText = textarea.value.substring(start, end);
    
    setHasValidImageSelection(isValidImageSelection(selectedText));
  }, []);

  /**
   * Track selection changes in the textarea.
   */
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleSelect = () => checkSelectionValidity();
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        checkSelectionValidity();
      }
    };
    const handleMouseUp = () => {
      setTimeout(checkSelectionValidity, 0);
    };

    textarea.addEventListener('select', handleSelect);
    textarea.addEventListener('keyup', handleKeyUp);
    textarea.addEventListener('mouseup', handleMouseUp);

    return () => {
      textarea.removeEventListener('select', handleSelect);
      textarea.removeEventListener('keyup', handleKeyUp);
      textarea.removeEventListener('mouseup', handleMouseUp);
    };
  }, [checkSelectionValidity]);

  /**
   * Clean up popup timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (disabledPopupTimeoutRef.current) {
        clearTimeout(disabledPopupTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Close dropdown and popup when clicking outside
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (resizeDropdownRef.current && !resizeDropdownRef.current.contains(event.target as Node)) {
        setShowResizeDropdown(false);
        setShowDisabledPopup(false);
      }
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
   * Handle text changes to detect code block creation
   */
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const textarea = textareaRef.current;
      if (!textarea) {
        onChange(newValue);
        return;
      }

      const cursorPos = textarea.selectionStart;
      
      // Check if user just typed ``` at the start of a line
      // Look for pattern: newline or start of string, then ```
      const textBeforeCursor = newValue.substring(0, cursorPos);
      const lines = textBeforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      
      // Check if current line is exactly ``` (code block start)
      if (currentLine === '```') {
        // Find the position of this line
        const lineStartIndex = textBeforeCursor.lastIndexOf('\n') + 1;
        
        // Get textarea position for popup
        const textareaRect = textarea.getBoundingClientRect();
        
        // Calculate approximate line height and position
        const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
        const lineIndex = lines.length - 1;
        const charWidth = 8; // Approximate monospace char width
        const topOffset = lineIndex * lineHeight;
        const leftOffset = currentLine.length * charWidth;
        
        setLanguageSelectorPosition({
          top: textareaRect.top + topOffset - textarea.scrollTop + lineHeight,
          left: textareaRect.left + leftOffset,
        });
        setCodeBlockInsertPosition(cursorPos);
        setShowLanguageSelector(true);
        setLanguageSearch("");
      }
      
      onChange(newValue);
    },
    [onChange]
  );

  /**
   * Handle language selection for code block
   */
  const handleLanguageSelect = useCallback(
    (languageCode: string) => {
      if (codeBlockInsertPosition === null) return;
      
      const textarea = textareaRef.current;
      if (!textarea) return;

      // Insert the language code after ```
      const newValue = 
        value.substring(0, codeBlockInsertPosition) + 
        languageCode + 
        value.substring(codeBlockInsertPosition);
      
      onChange(newValue);
      
      // Move cursor to after the language code
      const newCursorPos = codeBlockInsertPosition + languageCode.length;
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      
      setShowLanguageSelector(false);
      setLanguageSearch("");
      setCodeBlockInsertPosition(null);
    },
    [codeBlockInsertPosition, value, onChange]
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
   * Handle keyboard shortcuts for markdown formatting
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Check if this key combination matches any shortcut
      const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // Handle heading level shortcuts: Cmd+Ctrl+'+' (increase) and Cmd+Ctrl+'-' (decrease)
      // On Mac: need both metaKey (Cmd) AND ctrlKey
      // On Windows: check for Ctrl+Alt
      const cmdAndCtrlPressed = isMac 
        ? (e.metaKey && e.ctrlKey) 
        : (e.ctrlKey && e.altKey);
      
      if (cmdAndCtrlPressed && (e.key === '+' || e.key === '=' || e.key === '-')) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea && !disabled) {
          // '+' or '=' increases heading level (## -> #)
          // '-' decreases heading level (## -> ###)
          adjustHeadingLevel(textarea, value, onChange, e.key === '+' || e.key === '=');
        }
        return;
      }

      for (const shortcut of KEYBOARD_SHORTCUTS) {
        const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const shiftMatches = e.shiftKey === shortcut.shiftKey;
        const altMatches = e.altKey === shortcut.altKey;

        // Handle shortcuts that require both Cmd and Ctrl (e.g., Cmd+Ctrl+C for code block)
        if (shortcut.requireCmdAndCtrl) {
          // On Mac: need both metaKey (Cmd) AND ctrlKey
          // On Windows: this combination isn't typically used, but we check for Ctrl+Alt
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
                const selectedText = value.substring(start, end);
                
                let newValue: string;
                let insertPos: number;
                
                if (selectedText) {
                  // Wrap existing selection with code block
                  newValue = value.substring(0, start) + "```" + selectedText + "\n```" + value.substring(end);
                  insertPos = start + 3;
                } else {
                  // No selection - insert code block markers
                  newValue = value.substring(0, start) + "```\n\n```" + value.substring(start);
                  insertPos = start + 3;
                }
                
                onChange(newValue);
                
                // Get textarea position for popup
                const textareaRect = textarea.getBoundingClientRect();
                const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
                
                // Calculate line number at cursor position
                const textBeforeInsert = value.substring(0, start);
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
                applyMarkdownFormat(textarea, value, onChange, shortcut);
              }
            }
            return;
          }
        } else if (shortcut.requireCtrlOnly) {
          // Handle shortcuts that require only Ctrl (not Cmd) - e.g., Ctrl+Q for quote
          // On Mac: need ctrlKey only (not metaKey)
          // On Windows: need ctrlKey only
          const ctrlOnlyMatches = isMac 
            ? (e.ctrlKey && !e.metaKey) 
            : e.ctrlKey;
          
          if (keyMatches && ctrlOnlyMatches && shiftMatches && altMatches) {
            e.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && !disabled) {
              applyMarkdownFormat(textarea, value, onChange, shortcut);
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
              applyMarkdownFormat(textarea, value, onChange, shortcut);
            }
            return;
          }
        }
      }
    },
    [value, onChange, disabled]
  );

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
        // If allowAnyFileType is true, use onFileDrop for all files, fallback to onImageDrop for images only
        if (allowAnyFileType && onFileDrop) {
          onFileDrop(files);
        } else if (onImageDrop) {
          // Filter to only images for backward compatibility
          const imageFiles = files.filter(f => f.type.startsWith("image/"));
          if (imageFiles.length > 0) {
            onImageDrop(imageFiles);
          }
        }
      }
      e.target.value = "";
    },
    [onImageDrop, onFileDrop, allowAnyFileType]
  );

  /**
   * Handle resizing an image by converting markdown/HTML image to HTML with width.
   * Works with selected text that is either:
   * 1. Markdown image: ![alt](src)
   * 2. HTML image: <img src="..." />
   * 3. Just an image URL/path
   * 4. Text containing an image path (extracts the path)
   */
  const handleResizeImage = useCallback(
    (percentage: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      // Use textarea.value directly to ensure we get the current content
      const selectedText = textarea.value.substring(start, end);

      if (!selectedText.trim()) {
        alert("Please select an image in the editor first.");
        setShowResizeDropdown(false);
        return;
      }

      let newText = "";
      let insertPos = start;

      // Try to match markdown image syntax
      const mdMatch = selectedText.match(MARKDOWN_IMAGE_REGEX);
      if (mdMatch) {
        const alt = mdMatch[1] || "";
        const src = mdMatch[2];
        newText = `<img src="${src}" alt="${alt}" width="${percentage}%" />`;
        insertPos = start + newText.length;
      } else {
        // Try to match HTML image syntax
        const htmlMatch = selectedText.match(HTML_IMAGE_REGEX);
        if (htmlMatch) {
          const src = htmlMatch[1];
          // Check if width already exists
          const hasWidth = /width\s*=/i.test(selectedText);
          if (hasWidth) {
            // Replace existing width
            newText = selectedText.replace(/width\s*=\s*["']?[^"'\s>]+["']?/i, `width="${percentage}%"`);
          } else {
            // Add width attribute
            newText = selectedText.replace(/<img/i, `<img width="${percentage}%"`);
          }
          insertPos = start + newText.length;
        } else {
          // Try to extract an image path from the selected text
          const trimmed = selectedText.trim();
          const pathMatch = trimmed.match(FLEXIBLE_IMAGE_PATH_REGEX);
          const imagePath = pathMatch ? pathMatch[0] : trimmed;
          
          // Check if the extracted path is valid
          if (IMAGE_PATH_REGEX.test(imagePath)) {
            newText = `<img src="${imagePath}" width="${percentage}%" />`;
            insertPos = start + newText.length;
          } else {
            // Treat as plain URL/path
            newText = `<img src="${trimmed}" width="${percentage}%" />`;
            insertPos = start + newText.length;
          }
        }
      }

      // Update the value - use current textarea value to build the new value
      const currentValue = textarea.value;
      const updatedValue = currentValue.substring(0, start) + newText + currentValue.substring(end);
      onChange(updatedValue);

      // Set cursor position after the inserted text
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(insertPos, insertPos);
      }, 0);

      setShowResizeDropdown(false);
    },
    [onChange]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
          <button
            type="button"
            onClick={() => setPreviewMode(!previewMode)}
            disabled={disabled}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              previewMode
                ? "bg-blue-100 text-blue-700 font-medium"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            } disabled:opacity-50`}
            title="Click to toggle between edit mode and preview mode"
          >
            {previewMode ? "Edit" : "Preview"}
          </button>
          <button
            type="button"
            onClick={handleAddImageClick}
            disabled={disabled}
            className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
            title={allowAnyFileType ? "Click to upload any file from your computer" : "Click to upload an image file from your computer"}
          >
            {allowAnyFileType ? "Add File" : "Add Image"}
          </button>
          
          {/* Resize Image Button with Dropdown */}
          <div className="relative" ref={resizeDropdownRef}>
            <button
              type="button"
              onClick={() => {
                if (hasValidImageSelection) {
                  setShowResizeDropdown(!showResizeDropdown);
                  setShowDisabledPopup(false);
                } else {
                  setShowDisabledPopup(true);
                  setShowResizeDropdown(false);
                  // Auto-hide popup after 4 seconds
                  if (disabledPopupTimeoutRef.current) {
                    clearTimeout(disabledPopupTimeoutRef.current);
                  }
                  disabledPopupTimeoutRef.current = setTimeout(() => {
                    setShowDisabledPopup(false);
                  }, 4000);
                }
              }}
              disabled={disabled}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                hasValidImageSelection
                  ? "bg-blue-100 text-blue-700 font-medium hover:bg-blue-200"
                  : "bg-gray-100 text-gray-400 hover:bg-gray-150"
              } disabled:opacity-50`}
              title={hasValidImageSelection 
                ? "Choose a size percentage for the selected image" 
                : "Select an image path or markdown image syntax first"
              }
            >
              Resize Image
            </button>
            {showResizeDropdown && hasValidImageSelection && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1 min-w-[100px]">
                <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 cursor-help" title="Choose how big the image should appear">
                  Select size:
                </div>
                {RESIZE_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleResizeImage(pct)}
                    className="w-full px-3 py-1.5 text-xs text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    title={`Resize image to ${pct}% of its original size`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            )}
            {showDisabledPopup && !hasValidImageSelection && (
              <div className="absolute top-full left-0 mt-1 bg-amber-50 border border-amber-200 rounded-md shadow-lg z-10 p-3 max-w-[280px]">
                <p className="text-xs text-amber-800 font-medium mb-1.5">How to resize an image:</p>
                <p className="text-xs text-amber-700">
                  Select the entire image text, such as:
                </p>
                <ul className="text-xs text-amber-600 mt-1 space-y-0.5 ml-3">
                  <li>• <code className="bg-amber-100 px-1 rounded">![alt](image.png)</code></li>
                  <li>• <code className="bg-amber-100 px-1 rounded">&lt;img src="..."&gt;</code></li>
                  <li>• <code className="bg-amber-100 px-1 rounded">./path/image.png</code></li>
                </ul>
              </div>
            )}
          </div>
          
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
      <div className="flex flex-1 min-h-0">
        {/* Keyboard Shortcuts Helper Panel - only show in edit mode */}
        {showShortcutsHelper && !previewMode && (
          <div className={`${helperCollapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-gray-100 bg-gray-50/30 flex flex-col transition-all duration-200`}>
            {/* Collapse/Expand button */}
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
                {/* Tab Switcher */}
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
                    {/* Consolidated heading shortcut */}
                    <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 transition-colors group">
                      <span className="text-xs text-gray-600 group-hover:text-gray-800">
                        Headings 1-6
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                        ⌘1-6
                      </span>
                    </div>
                    {/* Heading level adjustment shortcuts */}
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
                        onClick={() => {
                          // Insert the syntax at cursor position
                          const textarea = textareaRef.current;
                          if (textarea && !disabled) {
                            const start = textarea.selectionStart;
                            const end = textarea.selectionEnd;
                            const newValue = value.substring(0, start) + item.syntax + value.substring(end);
                            onChange(newValue);
                            setTimeout(() => {
                              textarea.focus();
                              textarea.setSelectionRange(start + item.syntax.length, start + item.syntax.length);
                            }, 0);
                          }
                        }}
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

        {/* Editor / Preview */}
        <div className="flex-1 min-h-[300px] cursor-text">
          {previewMode ? (
            <div className="p-4 min-h-[300px]">
              {value.trim() ? (
                <div className="prose prose-sm prose-gray max-w-none" style={{ lineHeight: "1.7" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw, rehypeHighlight]}
                    components={{
                      img: ({ src, alt, ...props }) => {
                        // Resolve relative image paths through the backend API
                        let resolvedSrc = String(src || "");
                        if (imageBasePath && resolvedSrc.startsWith("./")) {
                          const relativePath = resolvedSrc.slice(2); // Remove "./"
                          resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(imageBasePath + "/" + relativePath)}`;
                        }
                        return (
                          <img
                            src={resolvedSrc}
                            alt={alt || ""}
                            className="max-w-full rounded-lg"
                            {...props}
                          />
                        );
                      },
                    }}
                  >
                    {value}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-gray-300 italic">
                  {placeholder || "Nothing to preview."}
                </p>
              )}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className="w-full h-full min-h-[400px] p-4 text-sm font-mono text-gray-800 bg-white resize-none focus:outline-none border-0 disabled:bg-gray-50 disabled:text-gray-500"
              style={{ lineHeight: "1.7" }}
              placeholder={placeholder || "Write in Markdown..."}
            />
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
    </div>
  );
}

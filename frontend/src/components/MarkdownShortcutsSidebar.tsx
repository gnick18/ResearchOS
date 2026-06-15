"use client";

import { useEffect, useRef, useState } from "react";
import Tooltip from "./Tooltip";

/**
 * MarkdownShortcutsSidebar — the "Shortcuts / Style Guide" left rail.
 *
 * Rendered by the inline (CodeMirror 6) editor inside LiveMarkdownEditor. The
 * Style Guide entries are click-to-insert; the host passes onInsertSyntax to
 * receive the raw markdown snippet and splice it into the CM6 editor via the
 * imperative insertRef.
 *
 * House style: no em-dashes, no emojis, custom inline SVG (no icon lib),
 * Tooltip not title=.
 */

type HelperTab = "shortcuts" | "styleguide";

// Detect Mac at module level so shortcut labels render correctly on all
// platforms.
const IS_MAC =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/**
 * The shortcut rows shown under the "Shortcuts" tab. Each row is a label plus a
 * platform-aware key hint that matches the CM6 keymap (markdown-keymap.ts) so
 * every listed shortcut actually fires in the inline editor. Headings 1-6
 * collapse into a single row because per-level rows would crowd the narrow column.
 */
const SHORTCUT_ROWS: Array<{ label: string; keyMac: string; keyOther: string }> =
  [
    { label: "Save", keyMac: "⌘S", keyOther: "Ctrl+S" },
    { label: "Focus mode", keyMac: "⌘⇧F", keyOther: "Ctrl+Shift+F" },
    { label: "Bold", keyMac: "⌘B", keyOther: "Ctrl+B" },
    { label: "Italic", keyMac: "⌘I", keyOther: "Ctrl+I" },
    { label: "Underline", keyMac: "⌘U", keyOther: "Ctrl+U" },
    { label: "Link", keyMac: "⌘K", keyOther: "Ctrl+K" },
    { label: "Strikethrough", keyMac: "⌘⇧X", keyOther: "Ctrl+Shift+X" },
    { label: "Code Block", keyMac: "⌘⌃C", keyOther: "Ctrl+Alt+C" },
    { label: "Quote", keyMac: "⌃Q", keyOther: "Ctrl+Q" },
    { label: "Headings 1-6", keyMac: "⌘1-6", keyOther: "Ctrl+1-6" },
    { label: "Heading Up", keyMac: "⌘⌃+", keyOther: "Ctrl+Alt++" },
    { label: "Heading Down", keyMac: "⌘⌃-", keyOther: "Ctrl+Alt+-" },
  ];

// Markdown style guide content (click-to-insert).
const MARKDOWN_STYLE_GUIDE = [
  { syntax: "# Heading 1", description: "Main title" },
  { syntax: "## Heading 2", description: "Section header" },
  { syntax: "### Heading 3", description: "Subsection" },
  { syntax: "**bold text**", description: "Bold" },
  { syntax: "*italic text*", description: "Italic" },
  { syntax: "<u>underline</u>", description: "Underline" },
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

interface MarkdownShortcutsSidebarProps {
  /** Click-to-insert handler for a Style Guide entry. */
  onInsertSyntax?: (syntax: string) => void;
  /** Focus-mode signal. In focus mode the rail collapses to the thin
   *  expandable strip instead of vanishing, so the cheat sheet stays one
   *  click away without cluttering the calm writing surface. Edge-triggered:
   *  collapses on focus-enter, re-expands on focus-exit; a manual toggle
   *  within a mode still sticks. */
  focusActive?: boolean;
}

export default function MarkdownShortcutsSidebar({
  onInsertSyntax,
  focusActive = false,
}: MarkdownShortcutsSidebarProps) {
  const [collapsed, setCollapsed] = useState(focusActive);
  const [tab, setTab] = useState<HelperTab>("shortcuts");

  // Collapse to the thin strip when entering focus mode, re-expand on exit.
  // Edge-triggered so a manual expand/collapse within a mode is preserved.
  const prevFocusActive = useRef(focusActive);
  useEffect(() => {
    if (focusActive !== prevFocusActive.current) {
      setCollapsed(focusActive);
      prevFocusActive.current = focusActive;
    }
  }, [focusActive]);

  return (
    <div
      data-tour-target="inline-editor-shortcut-bar"
      className={`${collapsed ? "w-8" : "w-52"} flex-shrink-0 border-r border-border bg-surface-sunken/30 flex flex-col transition-all duration-200`}
    >
      <Tooltip
        label={collapsed ? "Expand helper panel" : "Collapse helper panel"}
        placement="right"
      >
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand helper panel" : "Collapse helper panel"}
          className="p-1.5 text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken rounded transition-colors self-end m-1"
        >
          <svg
            className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </Tooltip>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex gap-1 mb-3 bg-surface-sunken rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setTab("shortcuts")}
              className={`flex-1 px-2 py-1 text-meta rounded-md transition-colors ${
                tab === "shortcuts"
                  ? "bg-surface-raised text-foreground font-medium shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Shortcuts
            </button>
            <button
              type="button"
              onClick={() => setTab("styleguide")}
              className={`flex-1 px-2 py-1 text-meta rounded-md transition-colors ${
                tab === "styleguide"
                  ? "bg-surface-raised text-foreground font-medium shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Style Guide
            </button>
          </div>

          {tab === "shortcuts" ? (
            <div className="space-y-1">
              {SHORTCUT_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-surface-sunken transition-colors group"
                >
                  <span className="text-meta text-foreground-muted group-hover:text-foreground">
                    {row.label}
                  </span>
                  <span className="ros-kbd text-meta font-mono text-foreground bg-surface-raised border border-border px-1.5 py-0.5 rounded">
                    {IS_MAC ? row.keyMac : row.keyOther}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {MARKDOWN_STYLE_GUIDE.map((item, index) => (
                <Tooltip
                  key={index}
                  label={`Click to insert: ${item.syntax}`}
                  placement="right"
                >
                  <div
                    className="px-2 py-1.5 rounded hover:bg-surface-sunken transition-colors group cursor-pointer"
                    onClick={() => onInsertSyntax?.(item.syntax)}
                  >
                    <div className="ros-kbd text-meta font-mono text-foreground group-hover:text-accent bg-surface-raised border border-border px-1.5 py-0.5 rounded mb-0.5">
                      {item.syntax}
                    </div>
                    <div className="text-meta text-foreground-muted group-hover:text-foreground-muted">
                      {item.description}
                    </div>
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

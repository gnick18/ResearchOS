"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterLanguages,
  PLAIN_TEXT_CODE,
  type CodeLanguage,
} from "@/lib/markdown/cm-inline-reveal/code-languages";

/**
 * CodeLanguagePicker — the searchable language picker the inline markdown editor
 * opens when you insert a fenced code block (Mod-Shift-c, or the Style Guide
 * "Code block" entry). Restores the pre-migration HybridMarkdownEditor picker:
 * type to filter, Up/Down to move, Enter to choose, Esc to cancel. The chosen
 * language is written onto the opening fence by the caller so the preview
 * colorizes the block.
 *
 * The popup is a self-contained overlay surface positioned near the caret. It
 * owns its own search + highlight state; the host owns only whether it is open
 * and where. Selecting "Plain Text" returns PLAIN_TEXT_CODE so the caller emits
 * a bare ``` fence with no language token.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons, brand tokens
 * (no raw hex / text-sky-*), Tooltip not title= (none needed here, text only).
 */

interface CodeLanguagePickerProps {
  /** Viewport-anchored position (top/left in px) to render the popup at. */
  position: { top: number; left: number };
  /** Fired with the chosen fence code (PLAIN_TEXT_CODE for no language). */
  onSelect: (code: string) => void;
  /** Fired when the user cancels (Esc, outside click, or blur). */
  onCancel: () => void;
}

export default function CodeLanguagePicker({
  position,
  onSelect,
  onCancel,
}: CodeLanguagePickerProps) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => filterLanguages(search), [search]);

  // Keep the highlighted row in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  // Focus the search box on open so typing filters immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on an outside click (mousedown so it fires before the editor refocus).
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onCancel]);

  // Scroll the active row into view as the user arrows through the list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function choose(lang: CodeLanguage | undefined) {
    if (!lang) return;
    onSelect(lang.code === "" ? PLAIN_TEXT_CODE : lang.code);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      ref={rootRef}
      data-testid="code-language-picker"
      className="fixed z-50 w-64 max-h-80 overflow-hidden rounded-lg border border-border bg-surface-overlay ros-popup-card-shadow"
      style={{ top: position.top, left: position.left }}
    >
      <div className="border-b border-border p-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search language..."
          aria-label="Search code block language"
          className="w-full rounded border border-border bg-surface-raised px-2 py-1.5 text-meta text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
        />
      </div>
      <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
        {results.length > 0 ? (
          results.map((lang, index) => (
            <button
              key={lang.code}
              type="button"
              data-index={index}
              // Use mousedown so the select fires before the outside-click
              // handler tears the popup down on the same gesture.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(lang);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-meta transition-colors ${
                index === activeIndex
                  ? "bg-accent-soft text-accent"
                  : "text-foreground hover:bg-surface-sunken"
              }`}
            >
              <span>{lang.label}</span>
              {lang.code && (
                <span className="font-mono text-meta text-foreground-muted">
                  {lang.code}
                </span>
              )}
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-center text-meta text-foreground-muted">
            No languages found
          </div>
        )}
      </div>
    </div>
  );
}

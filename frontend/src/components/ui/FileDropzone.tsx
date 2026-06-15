"use client";

// Shared file-picker dropzone. One consistent surface everywhere the app asks
// the user to pick a file: drag a file onto it OR click to choose, with a calm
// hover lift and a clear drag-over state. Wraps a hidden <input type="file"> so
// keyboard + click still work, and best-effort filters dropped files by the same
// `accept` string the input uses (a drop bypasses the input's own filtering).
//
// Folder pickers (showDirectoryPicker / the research-folder connect) are a
// different mechanism and are NOT handled here; this is for FILE picking.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";

/** Best-effort match of a dropped File against an input `accept` string. */
export function fileMatchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const tokens = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((tok) => {
    if (tok.startsWith(".")) return name.endsWith(tok);
    if (tok.endsWith("/*")) return type.startsWith(tok.slice(0, -1));
    return type === tok;
  });
}

export interface FileDropzoneProps {
  /** Receives the picked files (always length 1 unless `multiple`). */
  onFiles: (files: File[]) => void;
  /** Same string as a native input, e.g. "image/png,image/jpeg" or ".csv,.tsv". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Main line. Default: "Drag and drop a file" (or "files" when multiple). */
  label?: string;
  /** Smaller line after "click to choose", e.g. "PNG, JPG, WebP". */
  hint?: string;
  /** Registry glyph; default "import" (the import/upload concept). */
  icon?: IconName;
  /** Called when a drop contains no file matching `accept`. */
  onReject?: (message: string) => void;
  /** Tighter padding for inline rows (e.g. beside an avatar). */
  compact?: boolean;
  /** Optional content rendered above the text (e.g. a live preview). */
  children?: ReactNode;
  className?: string;
  /** Accessible name when the visible label is not enough. */
  ariaLabel?: string;
}

export default function FileDropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  label,
  hint,
  icon = "import",
  onReject,
  compact = false,
  children,
  className,
  ariaLabel,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    let files = Array.from(list);
    if (accept) {
      const ok = files.filter((f) => fileMatchesAccept(f, accept));
      if (ok.length === 0) {
        onReject?.(
          `That file type is not supported${hint ? ` (${hint})` : ""}.`,
        );
        return;
      }
      files = ok;
    }
    onFiles(multiple ? files : files.slice(0, 1));
  };

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const base =
    "group flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center transition-all duration-150";
  const pad = compact ? "px-3 py-2.5" : "px-4 py-6";
  const state = disabled
    ? "cursor-not-allowed opacity-50 border-border bg-surface"
    : dragOver
      ? "cursor-copy border-brand-action bg-[#1283c9]/5 scale-[1.01]"
      : "cursor-pointer border-border bg-surface hover:border-brand-action hover:bg-[#1283c9]/[0.03]";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(false);
        emit(e.dataTransfer.files);
      }}
      className={`${base} ${pad} ${state} ${className ?? ""}`}
    >
      {children}
      <Icon
        name={icon}
        className={`${compact ? "h-5 w-5" : "h-6 w-6"} transition-transform duration-150 ${
          dragOver
            ? "-translate-y-0.5 text-brand-action"
            : "text-foreground-muted group-hover:text-brand-action"
        }`}
      />
      <span className="text-meta font-semibold text-foreground">
        {dragOver
          ? "Drop to upload"
          : (label ?? (multiple ? "Drag and drop files" : "Drag and drop a file"))}
      </span>
      {!dragOver && (
        <span className="text-meta text-foreground-muted">
          or{" "}
          <span className="font-semibold text-brand-action">click to choose</span>
          {hint ? ` · ${hint}` : ""}
        </span>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

import Tooltip from "@/components/Tooltip";

/**
 * Docked right-rail chrome for the Lab comments thread, mirroring the version-
 * history sidebar pattern in the note + task popups. It supplies the rail header
 * (title, count, close) and a scroll container; the caller passes the thread
 * component (NoteCommentsThread / CommentsThread in variant="sidebar") as
 * children. Google-Docs-style: comments live beside the editor, not below it.
 *
 * Voice / style: no em-dashes, no emojis, inline SVG icons only.
 */
export default function CommentsSidebar({
  count,
  onClose,
  children,
}: {
  count: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="flex w-80 flex-shrink-0 flex-col border-l border-border bg-surface-sunken/60 min-h-0"
      aria-label="Lab comments"
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
          </svg>
          <span className="text-body font-semibold text-foreground">Comments</span>
          {count > 0 ? (
            <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-meta font-semibold text-foreground-muted tabular-nums">
              {count}
            </span>
          ) : null}
        </span>
        <Tooltip label="Close">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="rounded-md p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

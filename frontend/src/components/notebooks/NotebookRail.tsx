"use client";

import { useState, type ReactNode } from "react";
import type { Notebook } from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import ContextMenu from "@/components/ContextMenu";

// Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
// The Notes-tab LEFT RAIL of notebook containers. Replaces the old flat
// "Personal + shared 1:1 switcher". Four kinds of entry:
//   - ALL NOTES     everything the viewer can see (the default grid)
//   - UNFILED       notes with no notebook_id (the free-floating sticky notes)
//   - MY NOTEBOOKS  notebooks with exactly one member (personal, just you)
//   - SHARED        notebooks with other members (the 1:1s + any N-member ones)
// Selecting an entry filters the main note pane. Personal-mode only, exactly as
// the old switcher was gated; Lab Mode keeps its separate shared-notes browser.

/** The active rail selection. `kind` "notebook" carries the notebook id. */
export type RailSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "notebook"; id: string };

export function selectionEquals(a: RailSelection, b: RailSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "notebook" && b.kind === "notebook") return a.id === b.id;
  return true;
}

interface NotebookRailProps {
  selection: RailSelection;
  onSelect: (selection: RailSelection) => void;
  /** Personal notebooks (members.length === 1). */
  myNotebooks: Notebook[];
  /** Shared notebooks (members.length >= 2). */
  sharedNotebooks: Notebook[];
  currentUser: string | null | undefined;
  /** Total visible notes (the ALL bucket). */
  allCount: number;
  /** Notes with no notebook_id (the UNFILED bucket). */
  unfiledCount: number;
  onNewNotebook: () => void;
  onStartShared: () => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onAddMember: (notebook: Notebook) => void;
}

const BOOK_SVG = (
  <svg
    className="h-4 w-4 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const SHARED_BOOK_SVG = (
  <svg
    className="h-4 w-4 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ALL_SVG = (
  <svg
    className="h-4 w-4 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const UNFILED_SVG = (
  <svg
    className="h-4 w-4 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const PLUS_SVG = (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const OVERFLOW_SVG = (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </svg>
);

const RENAME_ICON = (
  <svg className="h-4 w-4 text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);

const ADD_MEMBER_ICON = (
  <svg className="h-4 w-4 text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="22" y1="11" x2="16" y2="11" />
  </svg>
);

const DELETE_ICON = (
  <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

function RailButton({
  active,
  onClick,
  icon,
  label,
  count,
  testId,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  testId: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="group/rail relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        data-testid={testId}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-body transition-colors ${
          active
            ? "bg-brand-action/10 font-medium text-brand-action"
            : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
        }`}
      >
        <span className={active ? "text-brand-action" : "text-foreground-muted"}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {typeof count === "number" && (
          <span className="ml-auto flex-shrink-0 text-meta text-foreground-muted">
            {count}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

export default function NotebookRail({
  selection,
  onSelect,
  myNotebooks,
  sharedNotebooks,
  currentUser,
  allCount,
  unfiledCount,
  onNewNotebook,
  onStartShared,
  onRenameNotebook,
  onDeleteNotebook,
  onAddMember,
}: NotebookRailProps) {
  // The open overflow menu (one at a time), positioned at the cursor.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    notebook: Notebook;
    isShared: boolean;
  } | null>(null);

  const sharedLabel = (nb: Notebook): string => {
    if (nb.title?.trim()) return nb.title;
    const others = nb.members.filter((m) => m !== currentUser);
    if (others.length === 1) return `1:1 with ${others[0]}`;
    if (others.length > 1) return `${others.length} members`;
    return "Shared notebook";
  };

  const overflowButton = (nb: Notebook, isShared: boolean) => (
    <Tooltip label="Notebook actions">
      <button
        type="button"
        aria-label={`Actions for ${nb.title?.trim() || "notebook"}`}
        data-testid={`notebook-overflow-${nb.id}`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: rect.right, y: rect.bottom, notebook: nb, isShared });
        }}
        className="ml-1 flex-shrink-0 rounded-md p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-foreground focus:opacity-100 group-hover/rail:opacity-100"
      >
        {OVERFLOW_SVG}
      </button>
    </Tooltip>
  );

  return (
    <nav
      className="flex w-56 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-border pr-3"
      data-testid="notebook-rail"
      aria-label="Notebooks"
    >
      {/* Top-level buckets */}
      <div className="flex flex-col gap-0.5">
        <RailButton
          active={selection.kind === "all"}
          onClick={() => onSelect({ kind: "all" })}
          icon={ALL_SVG}
          label="All notes"
          count={allCount}
          testId="rail-all"
        />
        <RailButton
          active={selection.kind === "unfiled"}
          onClick={() => onSelect({ kind: "unfiled" })}
          icon={UNFILED_SVG}
          label="Unfiled"
          count={unfiledCount}
          testId="rail-unfiled"
        />
      </div>

      {/* My notebooks (personal) */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            My notebooks
          </span>
          <Tooltip label="New notebook">
            <button
              type="button"
              onClick={onNewNotebook}
              aria-label="New notebook"
              data-testid="rail-new-notebook"
              className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-brand-action"
            >
              {PLUS_SVG}
            </button>
          </Tooltip>
        </div>
        {myNotebooks.length === 0 ? (
          <p className="px-2.5 py-1 text-meta italic text-foreground-muted">
            No notebooks yet
          </p>
        ) : (
          myNotebooks.map((nb) => (
            <RailButton
              key={nb.id}
              active={selection.kind === "notebook" && selection.id === nb.id}
              onClick={() => onSelect({ kind: "notebook", id: nb.id })}
              icon={BOOK_SVG}
              label={nb.title?.trim() || "Untitled notebook"}
              testId={`rail-notebook-${nb.id}`}
              trailing={overflowButton(nb, false)}
            />
          ))
        )}
      </div>

      {/* Shared notebooks */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Shared
          </span>
          <Tooltip label="Start a shared notebook">
            <button
              type="button"
              onClick={onStartShared}
              aria-label="Start a shared notebook"
              data-testid="rail-start-shared"
              className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-brand-action"
            >
              {PLUS_SVG}
            </button>
          </Tooltip>
        </div>
        {sharedNotebooks.length === 0 ? (
          <p className="px-2.5 py-1 text-meta italic text-foreground-muted">
            No shared notebooks yet
          </p>
        ) : (
          sharedNotebooks.map((nb) => (
            <RailButton
              key={nb.id}
              active={selection.kind === "notebook" && selection.id === nb.id}
              onClick={() => onSelect({ kind: "notebook", id: nb.id })}
              icon={SHARED_BOOK_SVG}
              label={sharedLabel(nb)}
              testId={`rail-notebook-${nb.id}`}
              trailing={overflowButton(nb, true)}
            />
          ))
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              icon: RENAME_ICON,
              onClick: () => onRenameNotebook(menu.notebook),
            },
            {
              label: menu.isShared ? "Add another member" : "Add a member",
              icon: ADD_MEMBER_ICON,
              onClick: () => onAddMember(menu.notebook),
            },
            {
              label: "Delete notebook",
              icon: DELETE_ICON,
              onClick: () => onDeleteNotebook(menu.notebook),
            },
          ]}
        />
      )}
    </nav>
  );
}

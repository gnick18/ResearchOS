"use client";

import { useState, type ReactNode } from "react";
import type { Notebook } from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import ContextMenu from "@/components/ContextMenu";
import { Icon } from "@/components/icons";
import { getSubjectIcon } from "./subject-icons";

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
  onCustomizeAppearance: (notebook: Notebook) => void;
}

const ICON_CLASS = "h-4 w-4 flex-shrink-0";
const SHARED_BOOK_SVG = <Icon name="users" className={ICON_CLASS} />;
const PAINT_ICON = <Icon name="pencil" className="h-4 w-4 text-foreground-muted" />;
const ALL_SVG = <Icon name="list" className={ICON_CLASS} />;
const UNFILED_SVG = <Icon name="file" className={ICON_CLASS} />;
const PLUS_SVG = <Icon name="plus" className="h-3.5 w-3.5" />;
const OVERFLOW_SVG = <Icon name="more" className="h-4 w-4" />;
const RENAME_ICON = <Icon name="pencil" className="h-4 w-4 text-foreground-muted" />;
const ADD_MEMBER_ICON = (
  <Icon name="userPlus" className="h-4 w-4 text-foreground-muted" />
);
const DELETE_ICON = <Icon name="trash" className="h-4 w-4 text-red-500" />;

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

/** Renders the color dot + subject icon (or fallback book icon) for a notebook. */
function NotebookIconSlot({
  notebook,
  active,
}: {
  notebook: Notebook;
  active: boolean;
}) {
  const SubIcon = getSubjectIcon(notebook.subject_icon);
  const color = notebook.color;
  if (SubIcon && color) {
    return (
      <span className="relative flex-shrink-0">
        <SubIcon
          className="h-4 w-4"
          style={{ color: active ? undefined : color }}
        />
      </span>
    );
  }
  if (SubIcon) {
    return <SubIcon className={ICON_CLASS} />;
  }
  if (color) {
    return (
      <span
        className={`h-3.5 w-3.5 flex-shrink-0 rounded-full ${active ? "bg-brand-action" : ""}`}
        style={{ backgroundColor: active ? undefined : color }}
      />
    );
  }
  return <Icon name="book" className={ICON_CLASS} />;
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
  onCustomizeAppearance,
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
          myNotebooks.map((nb) => {
            const isActive =
              selection.kind === "notebook" && selection.id === nb.id;
            return (
              <RailButton
                key={nb.id}
                active={isActive}
                onClick={() => onSelect({ kind: "notebook", id: nb.id })}
                icon={
                  <NotebookIconSlot notebook={nb} active={isActive} />
                }
                label={nb.title?.trim() || "Untitled notebook"}
                testId={`rail-notebook-${nb.id}`}
                trailing={overflowButton(nb, false)}
              />
            );
          })
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
          sharedNotebooks.map((nb) => {
            const isActive =
              selection.kind === "notebook" && selection.id === nb.id;
            const SubIcon = getSubjectIcon(nb.subject_icon);
            return (
              <RailButton
                key={nb.id}
                active={isActive}
                onClick={() => onSelect({ kind: "notebook", id: nb.id })}
                icon={
                  SubIcon || nb.color ? (
                    <NotebookIconSlot notebook={nb} active={isActive} />
                  ) : (
                    SHARED_BOOK_SVG
                  )
                }
                label={sharedLabel(nb)}
                testId={`rail-notebook-${nb.id}`}
                trailing={overflowButton(nb, true)}
              />
            );
          })
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
              label: "Customize appearance",
              icon: PAINT_ICON,
              onClick: () => onCustomizeAppearance(menu.notebook),
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

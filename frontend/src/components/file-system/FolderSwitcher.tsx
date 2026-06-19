"use client";

// Folder switcher (Phase A, multi-folder). A small, calm dropdown that lists
// the folders the app remembers and lets the user switch the active lab/folder
// without the OS picker. Reachable from the app header (next to the workspace
// name) and offered on the connect screen.
//
// Behavior mirrors the app-wide header dropdown convention (see
// HeaderOverflowMenu / ProjectCardKebab): a trigger button, a role="menu"
// panel, Escape-to-close, and mousedown-outside-to-close. Never traps focus.
//
// Hard-gated by NEXT_PUBLIC_MULTI_FOLDER: when the flag is off the remembered
// set is always empty (the context never reads it), so this renders nothing and
// the header is byte-identical to today.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons/Icon";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import { folderLabLabel } from "@/lib/file-system/folder-lab-label";
import { LAB_AS_FOLDER_ENABLED } from "@/lib/lab/lab-as-folder-config";

/** Format a lastOpenedAt timestamp as a short, calm relative string. */
function relativeOpened(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Opened just now";
  if (min < 60) return `Opened ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Opened ${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `Opened ${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `Opened ${months} mo ago`;
}

export default function FolderSwitcher({
  /** When set, render as a full-width list (connect screen) instead of the
   *  compact header pill + dropdown. */
  variant = "header",
  /** Header tint state (passed from AppShell). When the header is colored
   *  (lab branding / colored header), the bare muted trigger washes out, so we
   *  render it as a white pill with dark text, mirroring the PillWrap the
   *  neighboring header controls use. We can't wrap this in PillWrap from
   *  AppShell because this component returns null when there is nothing to
   *  switch, which would leave an empty floating pill. */
  tinted = false,
  /** When true, the header variant does not hide itself for single-folder or
   *  zero-folder users. The pill still renders (showing the current folder name
   *  and the "Open another folder" row) so the control is permanently reachable
   *  from the header regardless of how many folders the user has remembered.
   *  Has no effect on the panel variant. */
  always = false,
}: {
  variant?: "header" | "panel";
  tinted?: boolean;
  always?: boolean;
}) {
  const {
    rememberedFolders,
    directoryName,
    switchFolder,
    forgetFolder,
    renameFolder,
    connect,
    listFolders,
  } = useFileSystem();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Id of the row currently being renamed inline (panel variant only), plus the
  // working text. Null means no row is in edit mode.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Refresh the remembered set the first time the menu opens (or on mount for
  // the panel variant) so the list is current even if a different surface added
  // a folder since the last connect.
  useEffect(() => {
    if (!MULTI_FOLDER_ENABLED) return;
    if (variant === "panel" || open) {
      void listFolders();
    }
  }, [open, variant, listFolders]);

  useEscapeToClose(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Active folder is the one whose name matches the connected directory. Names
  // are not unique in general, but the connected directoryName is the live
  // signal we have in this component and is good enough to badge the row.
  const folders = useMemo(() => rememberedFolders, [rememberedFolders]);

  if (!MULTI_FOLDER_ENABLED) return null;

  // Header variant hides itself entirely when there is nothing to switch
  // between (zero or one folder and it is the active one). The "Open another
  // folder" action still lives in the connect screen and Settings, so the
  // header stays calm for solo single-folder users.
  // Exception: when `always` is true the pill stays visible regardless of how
  // many folders are remembered, so callers that want a permanent top-bar
  // control can opt in without changing the default behavior.
  if (variant === "header" && !always && folders.length <= 1) return null;

  async function onSwitch(id: string) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      await switchFolder(id);
    } finally {
      setBusy(false);
    }
  }

  async function onForget(id: string, name: string) {
    if (busy) return;
    // Guard so a misplaced tap never silently drops a remembered folder. This
    // only removes the remembered handle, the on-disk data is untouched, and the
    // connect screen / picker stays one click away so the user is never trapped.
    const ok =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Forget "${name}"? This removes it from your remembered folders. Your files on disk are not changed and you can reconnect the folder later.`,
          );
    if (!ok) return;
    setBusy(true);
    try {
      await forgetFolder(id);
    } finally {
      setBusy(false);
    }
  }

  function startRename(id: string, name: string) {
    if (busy) return;
    setEditingId(id);
    setDraftName(name);
  }

  function cancelRename() {
    setEditingId(null);
    setDraftName("");
  }

  async function saveRename(id: string) {
    const next = draftName.trim();
    if (!next) {
      cancelRename();
      return;
    }
    setBusy(true);
    try {
      await renameFolder(id, next);
    } finally {
      setBusy(false);
      cancelRename();
    }
  }

  async function onOpenAnother() {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      await connect();
    } finally {
      setBusy(false);
    }
  }

  function renderRows() {
    // Rename and the per-row controls are panel-only. The compact header
    // dropdown stays a quick switcher, the panel (connect screen / Settings) is
    // where folders are managed.
    const showManage = variant === "panel";
    return (
      <>
        {folders.map((f) => {
          const isActive = !!directoryName && f.name === directoryName;
          const isEditing = showManage && editingId === f.id;

          if (isEditing) {
            return (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <Icon
                  name="folder"
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <input
                  type="text"
                  value={draftName}
                  autoFocus
                  disabled={busy}
                  aria-label={`Rename ${f.name}`}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveRename(f.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-accent"
                />
                <Tooltip label="Save name" placement="left">
                  <button
                    type="button"
                    aria-label="Save name"
                    disabled={busy}
                    onClick={() => void saveRename(f.id)}
                    className="rounded-md p-1 text-foreground-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="Cancel" placement="left">
                  <button
                    type="button"
                    aria-label="Cancel rename"
                    disabled={busy}
                    onClick={cancelRename}
                    className="rounded-md p-1 text-foreground-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            );
          }

          return (
            <div
              key={f.id}
              className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-sunken"
            >
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => onSwitch(f.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
              >
                <Icon
                  name="folder"
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {f.name}
                    </span>
                    {isActive && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        <Icon name="check" className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-meta text-foreground-muted">
                    {/* Lab-as-folder (P1): when the feature is ON, show the
                        cached lab identity (Solo / "X - head" / "Y - member") so
                        the switcher reads as a lab switcher, followed by the
                        active / last-opened status. When the flag is OFF the line
                        is byte-identical to before the feature ("Active folder" /
                        relative time), so a pre-feature folder set is unchanged. */}
                    {LAB_AS_FOLDER_ENABLED ? (
                      <>
                        {folderLabLabel(f)} &middot;{" "}
                        {isActive ? "Active" : relativeOpened(f.lastOpenedAt)}
                      </>
                    ) : isActive ? (
                      "Active folder"
                    ) : (
                      relativeOpened(f.lastOpenedAt)
                    )}
                  </span>
                </span>
              </button>
              {showManage && (
                <Tooltip label="Rename this folder" placement="left">
                  <button
                    type="button"
                    aria-label={`Rename ${f.name}`}
                    disabled={busy}
                    onClick={() => startRename(f.id, f.name)}
                    className="rounded-md p-1 text-foreground-muted opacity-0 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                  >
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Forget this folder" placement="left">
                <button
                  type="button"
                  aria-label={`Forget ${f.name}`}
                  disabled={busy}
                  onClick={() => onForget(f.id, f.name)}
                  className="rounded-md p-1 text-foreground-muted opacity-0 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          );
        })}
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={onOpenAnother}
          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-50"
        >
          <Icon name="plus" className="h-4 w-4 shrink-0" />
          <span>Open another folder</span>
        </button>
      </>
    );
  }

  if (variant === "panel") {
    return (
      <div className="rounded-xl border border-border bg-surface-raised py-1">
        {renderRows()}
      </div>
    );
  }

  // Header variant: a compact pill that shows the active folder name and opens
  // a dropdown of the remembered set.
  const label = directoryName || "Switch folder";
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <Tooltip label="Switch folder" placement="bottom">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="folder-switcher-trigger"
          onClick={() => setOpen((v) => !v)}
          className={
            tinted
              ? // On the colored header the pill is forced bg-white in BOTH
                // themes, so the text must be a theme-invariant dark (text-gray-900),
                // matching the active nav-tab pill. text-foreground would be light
                // in dark mode = invisible on white.
                "flex max-w-[180px] items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-gray-900 shadow-sm transition-colors hover:bg-white/90"
              : "flex max-w-[180px] items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          }
        >
          <Icon name="folder" className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-64 max-w-[80vw] overflow-hidden rounded-xl border border-border bg-surface-raised py-1 shadow-lg"
        >
          {renderRows()}
        </div>
      )}
    </div>
  );
}

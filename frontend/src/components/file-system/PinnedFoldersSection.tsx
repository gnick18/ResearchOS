"use client";

// Settings: pinned folders pin-picker (top-bar folder picker).
//
// Lets the user choose WHICH connected folders show as the up-to-three inline
// quick-switch chips in the top nav bar. Each remembered folder gets its kind
// glyph + color + nickname and a pin toggle; once three are pinned the rest are
// disabled with a clear note. This is purely the chip-selection UX, it never
// touches the folder data or the separation between folders.
//
// Hard-gated by NEXT_PUBLIC_MULTI_FOLDER (via MULTI_FOLDER_ENABLED): when the
// flag is off the remembered set is always empty so this renders nothing and the
// Settings pane is byte-identical to today.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import { MAX_PINNED_FOLDERS } from "@/lib/file-system/indexeddb-store";
import {
  folderKindBadge,
  folderKindIcon,
  folderDisplayName,
} from "@/lib/file-system/folder-lab-label";

// Static pill classes per brand token (mirrors FolderSwitcher's KIND_PILL_CLASS).
// Tailwind v4 only emits whole-string utilities, so the token -> class pair is
// spelled out. folderKindBadge owns the role -> token mapping.
const KIND_PILL_CLASS: Record<string, string> = {
  "brand-ink": "bg-brand-ink/10 text-brand-ink",
  "brand-lead": "bg-brand-lead/10 text-brand-lead",
  "brand-purple": "bg-brand-purple/10 text-brand-purple",
  "brand-teach": "bg-brand-teach/10 text-brand-teach",
  "brand-learn": "bg-brand-learn/10 text-brand-learn",
};

export default function PinnedFoldersSection() {
  const { rememberedFolders, setFolderPinned } = useFileSystem();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Set when a pin was refused by the cap, so the user gets an inline note rather
  // than a silent no-op. Cleared on the next successful action.
  const [capNote, setCapNote] = useState(false);

  const pinnedCount = useMemo(
    () => rememberedFolders.filter((f) => f.pinned === true).length,
    [rememberedFolders],
  );

  if (!MULTI_FOLDER_ENABLED) return null;
  if (rememberedFolders.length === 0) return null;

  const atCap = pinnedCount >= MAX_PINNED_FOLDERS;

  async function onToggle(id: string, nextPinned: boolean) {
    if (busyId) return;
    setBusyId(id);
    setCapNote(false);
    try {
      const ok = await setFolderPinned(id, nextPinned);
      // A refused pin (cap reached) resolves false; surface the note.
      if (!ok && nextPinned) setCapNote(true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-sunken/40 p-3">
      <p className="text-body text-foreground font-medium">Pinned folders</p>
      <p className="text-meta text-foreground-muted mt-1">
        Pin up to {MAX_PINNED_FOLDERS} folders to show them as quick-switch chips
        in the top bar. The folder you are in always appears there too, even when
        it is not pinned.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {rememberedFolders.map((f) => {
          const badge = folderKindBadge(f);
          const pillClass =
            KIND_PILL_CLASS[badge.token] ?? "bg-brand-ink/10 text-brand-ink";
          const name = folderDisplayName(f);
          const isPinned = f.pinned === true;
          // Disable the toggle for unpinned rows once the cap is full (pinned
          // rows stay enabled so the user can always unpin).
          const disabled = busyId !== null || (!isPinned && atCap);
          return (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  name={folderKindIcon(f)}
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <span className="truncate text-body text-foreground">
                  {name}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${pillClass}`}
                >
                  {badge.label}
                </span>
              </div>
              <button
                type="button"
                aria-pressed={isPinned}
                aria-label={
                  isPinned ? `Unpin ${name}` : `Pin ${name} to the top bar`
                }
                disabled={disabled}
                onClick={() => onToggle(f.id, !isPinned)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium transition-colors disabled:opacity-50 ${
                  isPinned
                    ? "bg-brand-action/10 text-brand-action hover:bg-brand-action/15"
                    : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                }`}
              >
                <Icon name="pin" className="h-3.5 w-3.5" />
                {isPinned ? "Pinned" : "Pin"}
              </button>
            </li>
          );
        })}
      </ul>
      {atCap ? (
        <p className="text-meta text-foreground-muted mt-2">
          You have pinned {MAX_PINNED_FOLDERS}, the maximum. Unpin one to pin a
          different folder.
        </p>
      ) : null}
      {capNote ? (
        <p className="text-meta text-brand-action mt-2">
          That is more than {MAX_PINNED_FOLDERS} pinned folders. Unpin one first.
        </p>
      ) : null}
    </div>
  );
}

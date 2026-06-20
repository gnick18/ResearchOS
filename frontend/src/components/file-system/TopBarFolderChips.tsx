"use client";

// Top-bar folder picker (multi-folder quick-switch chips).
//
// ResearchOS already keeps each connected folder as a FULLY separate data store
// (a research lab, a classroom, a solo folder). This component is PURELY the
// switcher UX on top of that: it shows up to a few user-pinned folders as inline
// quick-switch chips in the top nav so a professor who keeps a lab AND a class as
// separate stores can flip between them in one click. It does NOT touch the data
// model or the separation.
//
// Behavior:
//   - <= 3 connected folders: show them ALL as inline chips, active one tinted.
//   - > 3 folders: show up to 3 PINNED chips (the active folder is always shown
//     even when unpinned) plus an overflow caret that opens the EXISTING
//     FolderSwitcher dropdown for the rest and for management. The dropdown is
//     not reimplemented here, the FolderSwitcher header trigger IS the caret.
//   - Clicking a chip calls switchFolder(id). The user picks WHICH folders are
//     pinned in Settings (PinnedFoldersSection).
//
// Hard-gated by NEXT_PUBLIC_MULTI_FOLDER (via MULTI_FOLDER_ENABLED): when the
// flag is off the remembered set is always empty, so this renders nothing and
// the header is byte-identical to today. The "Class / My work" view-lens toggle
// (PiViewModeToggle) is a DIFFERENT control (a within-folder view lens) and lives
// elsewhere in the bar untouched.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons/Icon";
import FolderSwitcher from "./FolderSwitcher";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import {
  folderKindBadge,
  folderKindIcon,
  folderDisplayName,
} from "@/lib/file-system/folder-lab-label";
import { selectTopBarChips } from "@/lib/file-system/topbar-folder-chips";

// Static text-color class per brand token (the chip glyph + active ring tint).
// Tailwind v4 only emits utilities it can see as whole strings, so the
// brand-token -> class pair is spelled out, mirroring FolderSwitcher's
// KIND_PILL_CLASS. folderKindBadge owns the role -> token mapping.
const KIND_TEXT_CLASS: Record<string, string> = {
  "brand-ink": "text-brand-ink",
  "brand-lead": "text-brand-lead",
  "brand-purple": "text-brand-purple",
  "brand-teach": "text-brand-teach",
  "brand-learn": "text-brand-learn",
};

export default function TopBarFolderChips({
  /** Header tint state (passed from AppShell). When the header is colored, the
   *  bare muted chips wash out, so the chip row renders as white pills with dark
   *  text, mirroring the neighboring header controls. */
  tinted = false,
}: {
  tinted?: boolean;
}) {
  const { rememberedFolders, directoryName, switchFolder } = useFileSystem();
  const [busy, setBusy] = useState(false);

  // Active folder matched by the connected directory name, the same signal the
  // existing FolderSwitcher uses to badge the active row. Names are not unique in
  // general but directoryName is the live signal we have here.
  const activeId = useMemo(() => {
    const active = rememberedFolders.find((f) => f.name === directoryName);
    return active ? active.id : null;
  }, [rememberedFolders, directoryName]);

  const { chips, showOverflow } = useMemo(
    () => selectTopBarChips(rememberedFolders, activeId),
    [rememberedFolders, activeId],
  );

  // Hooks above run unconditionally; gate only the render so rules-of-hooks holds.
  if (!MULTI_FOLDER_ENABLED) return null;
  // Nothing remembered yet. Defer to the FolderSwitcher (always pill) so the
  // permanent "Open another folder" affordance still reaches the user. This
  // matches the single-control behavior the header had before chips existed.
  if (rememberedFolders.length === 0) {
    return <FolderSwitcher variant="header" always tinted={tinted} />;
  }

  async function onChip(id: string) {
    if (busy || id === activeId) return;
    setBusy(true);
    try {
      await switchFolder(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {chips.map((f) => {
        const isActive = f.id === activeId;
        const badge = folderKindBadge(f);
        const glyphClass = KIND_TEXT_CLASS[badge.token] ?? "text-brand-ink";
        const name = folderDisplayName(f);
        // The chip chrome mirrors the existing header pill. The active chip gets
        // a solid surface + ring so the current context reads at a glance; the
        // inactive ones are calm and quiet.
        const base = tinted
          ? isActive
            ? "bg-white text-gray-900 shadow-sm ring-2 ring-white"
            : "bg-white/70 text-gray-700 hover:bg-white/90"
          : isActive
            ? "bg-surface-sunken text-foreground ring-1 ring-border"
            : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground";
        return (
          <Tooltip
            key={f.id}
            label={`${name} (${badge.label})`}
            placement="bottom"
          >
            <button
              type="button"
              aria-label={`Switch to ${name}`}
              aria-current={isActive ? "true" : undefined}
              data-testid="topbar-folder-chip"
              disabled={busy}
              onClick={() => onChip(f.id)}
              className={`flex max-w-[160px] items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-60 ${base}`}
            >
              <Icon
                name={folderKindIcon(f)}
                className={`h-4 w-4 shrink-0 ${isActive ? glyphClass : ""}`}
              />
              <span className="truncate">{name}</span>
            </button>
          </Tooltip>
        );
      })}
      {/* Overflow + management. The existing FolderSwitcher header trigger IS the
          caret + dropdown (we do not reimplement it). It renders the full
          remembered set, discovery, nicknames, and Open-another-folder. */}
      {showOverflow ? (
        <FolderSwitcher variant="header" always tinted={tinted} />
      ) : null}
    </div>
  );
}

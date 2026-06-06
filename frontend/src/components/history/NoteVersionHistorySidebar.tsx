"use client";

// Version Control Phase 1: the right-sidebar version-history viewer for the
// Notes pilot. READ-ONLY by default; the VC Phase 2 restore footer is gated by
// canRestore + onRestore.
//
// VC Phase 3 (shared-generalization): this is now a THIN WRAPPER over the
// entity-agnostic EntityVersionHistorySidebar. All behavior (day/session
// grouping, pagination, compaction summary, keyboard nav, focus trap, diff
// preview, restore footer) lives in the generic component; this wrapper just
// binds the Notes entity type + the Notes adapter and keeps the original
// {noteId, owner, ...} prop shape so existing call sites + the regression-canary
// tests stay byte-for-byte unchanged.

import EntityVersionHistorySidebar, {
  type VersionPreview,
  type VersionHistorySource,
} from "@/components/history/EntityVersionHistorySidebar";
import { notesAdapter } from "@/lib/history/notes-viewer";

// Re-export so NoteDetailPopup keeps importing VersionPreview from here.
export type { VersionPreview };

interface NoteVersionHistorySidebarProps {
  /** Numeric note id. */
  noteId: number;
  /** Note owner folder (note.username) the history file lives under. */
  owner: string;
  /** Close the sidebar + return to the live editable record. */
  onClose: () => void;
  /**
   * Push the selected version's diff up to the popup's document column.
   * `null` clears the preview (back to the live record).
   */
  onPreviewChange: (preview: VersionPreview | null) => void;
  /** Injected clock for deterministic relative labels (tests). Defaults to now. */
  now?: Date;
  /**
   * Canonical tracked state of the LIVE note record (canonicalize(liveNote)),
   * forwarded to the generic viewer so the engine can resolve a bare-genesis
   * anchor (the create-note-then-edit case). Without it every version
   * reconstructs to "" and the diffs render empty.
   */
  headCanonical?: string;
  /**
   * VC Phase 2: gates the sticky-footer "Restore this version" affordance. The
   * popup computes it (= not read-only AND owner-or-PI-unlocked) and passes it
   * down. When false the footer never renders, whatever is selected.
   */
  canRestore?: boolean;
  /**
   * VC Phase 2: invoked with the selected NON-HEAD version index when the user
   * confirms a restore. The popup owns the actual reverse-walk + write + the
   * after-restore exit, so the sidebar only surfaces the intent.
   */
  onRestore?: (versionIndex: number) => void | Promise<void>;
  /**
   * Phase 2 chunk 4: injectable version-history engine. When absent, the
   * sidebar falls back to the legacy delta engine (unchanged). NoteDetailPopup
   * passes makeLoroHistoryEngine(note) here when LORO_PILOT_ENABLED is on so
   * the version list + diffs read Loro native history instead of the delta store.
   */
  engine?: VersionHistorySource;
}

export default function NoteVersionHistorySidebar({
  noteId,
  owner,
  onClose,
  onPreviewChange,
  now,
  headCanonical,
  canRestore = false,
  onRestore,
  engine,
}: NoteVersionHistorySidebarProps) {
  return (
    <EntityVersionHistorySidebar
      entityType="notes"
      id={noteId}
      owner={owner}
      adapter={notesAdapter}
      onClose={onClose}
      onPreviewChange={onPreviewChange}
      now={now}
      headCanonical={headCanonical}
      canRestore={canRestore}
      onRestore={onRestore}
      engine={engine}
      // NoteDetailPopup hides its editor column at the same md breakpoint, so on
      // a narrow window the history panel takes the whole popup full-width
      // instead of cramming beside a squeezed editor (which clipped on the right).
      fullWidthOnNarrow
    />
  );
}

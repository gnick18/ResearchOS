/**
 * persist-entry-content -- the single seam that decides WHO writes note entry
 * CONTENT to disk.
 *
 * Background (Loro notes pilot). When LORO_PILOT_ENABLED is on and a NoteHandle
 * is open for the note, the Loro CRDT is the sole writer of entry content. It
 * persists to the `.researchos/<id>.loro` sidecar and the readable
 * `notes/<id>.json` mirror through `NoteHandle.flush()`. The legacy path
 * (`notesApi.updateEntry({ content })`) must NOT also write content in that
 * mode, otherwise the same bytes are double-written to `notes/<id>.json` (once
 * by the legacy write, once by the Loro mirror) which is wasteful and fragile.
 *
 * Note METADATA (note title/description, per-entry title/date) stays on the
 * legacy path in Phase 1; it is not Loro-bound and is synced INTO the CRDT by
 * `store._runCommit`'s `syncNoteMetadataToDoc`. This helper governs ONLY the
 * entry-content write, so metadata callers do not route through here.
 *
 * Flag-off (or handle not yet ready / open failed) keeps the legacy content
 * write exactly as before -- `loroOwnsContent` is false and the legacy writer
 * runs unchanged.
 */

export interface PersistEntryContentParams<T> {
  /**
   * True when the Loro CRDT owns entry content for this note, i.e.
   * `LORO_PILOT_ENABLED && !!loroHandle`. When true we flush the handle and do
   * NOT run the legacy writer. When false the legacy writer owns content.
   */
  loroOwnsContent: boolean;
  /** Flush the open NoteHandle (sidecar THEN readable mirror). */
  flushLoro: () => Promise<void>;
  /** The legacy disk write (e.g. notesApi.updateEntry({ content })). */
  writeLegacyContent: () => Promise<T>;
}

export interface PersistEntryContentResult<T> {
  /** The legacy writer's return value, or null when Loro owned the write. */
  legacyResult: T | null;
  /** True iff the legacy writer ran (i.e. Loro did NOT own content). */
  wroteLegacy: boolean;
}

/**
 * Route an entry-content save to the correct writer.
 *
 * - Loro owns content -> flush the handle, skip the legacy write.
 * - Otherwise -> run the legacy write and return its result.
 *
 * Callers do their own dirty-state bookkeeping (clearing unsaved trackers,
 * advancing the saved baseline) after this resolves, regardless of which writer
 * ran, so the unsaved-changes guard stays correct in both modes.
 */
export async function persistEntryContent<T>(
  params: PersistEntryContentParams<T>,
): Promise<PersistEntryContentResult<T>> {
  if (params.loroOwnsContent) {
    await params.flushLoro();
    return { legacyResult: null, wroteLegacy: false };
  }
  const legacyResult = await params.writeLegacyContent();
  return { legacyResult, wroteLegacy: true };
}

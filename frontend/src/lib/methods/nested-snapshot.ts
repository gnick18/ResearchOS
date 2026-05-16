/**
 * Shared adapter shape used by per-type method-tab viewers when they render
 * INSIDE a compound method's tab content. The adapter lets the compound's
 * parent route per-child snapshot reads and writes through
 * `compound_snapshots[child_id]` instead of the child going through its
 * own top-level `TaskMethodAttachment` field via `tasksApi.updateMethod*`.
 *
 * Each per-type viewer (`MarkdownMethodTabContent`, `PcrMethodTabContent`,
 * `LcMethodTabContent`, `PlateMethodTabContent`, `CellCultureMethodTabContent`,
 * the nested-compound case) accepts an optional `nestedSnapshot` prop with
 * this shape. When present, the viewer reads its initial state from
 * `read()` and persists user edits via `write(snapshot)` instead of via
 * the standalone-attachment API. When absent, the viewer behaves exactly
 * as it does today.
 *
 * `T` is the type-specific snapshot blob — e.g. `LCGradientProtocol` for
 * the LC viewer, `PlateAnnotationSnapshot` for plate, etc.
 */
export interface NestedSnapshotAdapter<T> {
  /** Return the current snapshot blob for this child, or null when the
   *  child has never been edited inside this compound (the viewer falls
   *  back to the source protocol's template). */
  read: () => T | null;
  /** Persist a new snapshot blob for this child. Implementations route the
   *  write into the compound's `compound_snapshots[child_id]` slot and
   *  serialize the parent's `compound_snapshots` JSON string back to the
   *  task's attachment row. Resolves when the write has been queued. */
  write: (snapshot: T) => Promise<void>;
  /** Clear the child's snapshot (revert to source template). Called by the
   *  "Reset to method" button inside the nested viewer. */
  reset: () => Promise<void>;
}

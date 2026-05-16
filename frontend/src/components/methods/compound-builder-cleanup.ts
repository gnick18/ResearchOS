import { methodsApi } from "@/lib/local-api";

/**
 * Rolls back orphan child methods created via the compound builder's
 * "Create new" tab when the user cancels out without saving the compound.
 *
 * Phase 0c shipped inline-child creation that hard-writes a real method
 * record on each "Create + add to compound" click. Without this rollback,
 * cancelling the builder leaves those children floating in the methods
 * library with no compound parent referencing them. The fix tracks the
 * IDs the builder created during a single session and deletes them here
 * when the user funnels through any of the cancel paths (Escape, X, the
 * Cancel button). The save path never invokes this helper, so children
 * persisted into a saved compound stay put.
 *
 * Best-effort semantics: a single delete failure is logged but does not
 * block the remaining ids from being cleaned up.
 */
export interface RollbackOptions {
  deleteFn?: (id: number) => Promise<void>;
}

export async function rollbackInlineCreatedChildren(
  ids: readonly number[],
  options: RollbackOptions = {},
): Promise<void> {
  const deleteFn = options.deleteFn ?? methodsApi.delete;
  for (const id of ids) {
    try {
      await deleteFn(id);
    } catch (err) {
      console.warn(
        `[CompoundMethodBuilder] rollback delete failed for inline-created child ${id}:`,
        err,
      );
    }
  }
}

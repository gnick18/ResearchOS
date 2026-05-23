/**
 * useUnsavedChangesGuard
 *
 * Subscribes to the browser's `beforeunload` event and shows the native
 * "Leave site?" dialog when `hasUnsavedChanges` is true.
 *
 * Optionally calls `onFlush()` synchronously before raising the dialog so
 * autosave-debounce windows can attempt an immediate flush (e.g. flush a
 * pending setTimeout write). The flush is fire-and-forget: the browser
 * does not wait for it before unloading in most modern engines, but it
 * gives a short-lived write a fighting chance for tab-close scenarios
 * where the user cancels the unload dialog.
 *
 * StrictMode double-fire: The effect re-registers on every render cycle in
 * StrictMode dev (mount -> unmount -> remount). Because the handler is
 * always replaced with the latest closure, this is safe -- no stale
 * references accumulate.
 *
 * Usage:
 *   useUnsavedChangesGuard(isDirty);
 *   useUnsavedChangesGuard(isDirty, { onFlush: flushPendingSave });
 */
import { useEffect } from "react";

interface UnsavedChangesGuardOptions {
  /** Called synchronously when the user tries to leave with unsaved changes.
   *  Intended for flushing a debounced write. Keep it synchronous where
   *  possible; async resolution is not guaranteed to complete before unload. */
  onFlush?: () => Promise<void> | void;
}

export function useUnsavedChangesGuard(
  hasUnsavedChanges: boolean,
  options?: UnsavedChangesGuardOptions,
): void {
  const onFlush = options?.onFlush;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      // Attempt a synchronous flush of any pending debounced write.
      if (onFlush) {
        try {
          onFlush();
        } catch {
          // Swallow: we still want to show the dialog even if flush errors.
        }
      }
      // Setting returnValue (non-empty string) is the cross-browser way
      // to trigger the native "Leave site?" dialog.
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, onFlush]);
}

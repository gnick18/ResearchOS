/**
 * useDraftPersistence
 *
 * Persists a form draft to sessionStorage so the user does not lose typed
 * content on accidental navigation. Works alongside useUnsavedChangesGuard:
 * the guard shows a browser dialog, this hook silently restores the draft
 * if the user bypasses it (or navigates in-app without a full unload).
 *
 * Lifecycle:
 *   - On mount: reads `draftKey` from sessionStorage. If a saved value is
 *     found AND `isDirty` is false (i.e. the form is empty/default), calls
 *     `onRestore` with the deserialized value so the parent can restore it.
 *   - While `isDirty` is true: writes `currentValue` to sessionStorage
 *     (debounced 300 ms for UI responsiveness).
 *   - `clearDraft()`: removes the sessionStorage entry. Call this after a
 *     successful submit so the next open starts fresh.
 *   - On unmount: the draft is intentionally left in sessionStorage so it
 *     survives in-app navigation (SPA route changes) and can be restored
 *     when the component remounts.
 *
 * Key namespacing:
 *   Use descriptive, namespaced keys to avoid collisions between forms:
 *   "researchos:draft:new-purchase:proj-42"
 *   "researchos:draft:new-task"
 *   "researchos:draft:new-method"
 *
 * StrictMode: The restore runs exactly once on the first mount because
 * `onRestore` is only called when a non-null draft is found and the form is
 * clean. Re-mounts in StrictMode find the same sessionStorage entry; the
 * `isDirty` guard prevents a double-restore when the first restore already
 * made the form dirty.
 *
 * Usage:
 *   const { clearDraft } = useDraftPersistence(
 *     "researchos:draft:new-purchase",
 *     formState,
 *     isDirty,
 *     { onRestore: (saved) => setFormState(saved) },
 *   );
 *   // On successful submit:
 *   clearDraft();
 *   onClose();
 */
import { useCallback, useEffect, useRef } from "react";

interface DraftPersistenceOptions<T> {
  /** Called on mount when a previously-saved draft is found and the form
   *  is still clean. Use this to hydrate the form fields from the draft. */
  onRestore?: (saved: T) => void;
}

interface DraftPersistenceResult {
  /** Remove the draft from sessionStorage. Call after successful submit. */
  clearDraft: () => void;
}

const DEBOUNCE_MS = 300;

export function useDraftPersistence<T>(
  draftKey: string,
  currentValue: T,
  isDirty: boolean,
  options?: DraftPersistenceOptions<T>,
): DraftPersistenceResult {
  const onRestore = options?.onRestore;
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent re-running the restore effect when onRestore identity changes.
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // On mount: attempt to restore a previously-saved draft.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw === null) return;
      const saved = JSON.parse(raw) as T;
      // Only restore when the form is still clean so we don't overwrite
      // content the user has already started typing in this session.
      if (!isDirty && onRestoreRef.current) {
        onRestoreRef.current(saved);
      }
    } catch {
      // Malformed JSON or sessionStorage unavailable -- silently ignore.
    }
    // Intentionally omit isDirty from deps: we only want this to run once
    // on mount, not re-fire every time isDirty flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // While dirty: debounce-write to sessionStorage.
  useEffect(() => {
    if (!isDirty) return;

    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(currentValue));
      } catch {
        // sessionStorage full or unavailable -- silently ignore.
      }
    }, DEBOUNCE_MS);

    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
      }
    };
  }, [draftKey, currentValue, isDirty]);

  const clearDraft = useCallback(() => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // sessionStorage unavailable -- silently ignore.
    }
  }, [draftKey]);

  return { clearDraft };
}

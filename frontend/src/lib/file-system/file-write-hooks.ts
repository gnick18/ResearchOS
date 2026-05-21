// frontend/src/lib/file-system/file-write-hooks.ts
//
// Tiny registry that lets higher-level modules (e.g. the streak
// activity tracker in S1) observe every successful write through
// `fileService` without creating a static import cycle.
//
// Why this exists: streak-activity-tracker imports streak-sidecar,
// which imports fileService. If fileService statically imported the
// tracker we'd have a cycle. Instead, the tracker (or any other
// observer) registers a callback here at module init; fileService
// only depends on this tiny pure-data module.
//
// Contract:
//  - Observers are fire-and-forget. fileService does NOT await them.
//  - Observer exceptions are caught at the dispatch boundary. A
//    streak-write failure can never propagate into the data-write
//    path.
//  - Path is normalized to forward-slash-joined (file-service already
//    splits on "/" internally so this matches).

export type FileWriteObserver = (path: string) => void;

const observers = new Set<FileWriteObserver>();

/** Register an observer for successful writes. Returns an unsubscribe
 *  fn. Safe to call multiple times; idempotent on the same callback
 *  ref. Used by the streak activity tracker (S1). */
export function registerFileWriteObserver(cb: FileWriteObserver): () => void {
  observers.add(cb);
  return () => {
    observers.delete(cb);
  };
}

/** Fire every registered observer with the given path. Called by
 *  fileService at the end of a successful atomicWrite. Each observer
 *  is wrapped in a try/catch so one bad observer can't poison the
 *  write path. */
export function notifyFileWritten(path: string): void {
  if (observers.size === 0) return;
  for (const cb of observers) {
    try {
      cb(path);
    } catch (err) {
      // Defensive: never let an observer error escape the write path.
      console.warn(
        "[file-write-hooks] observer threw for path",
        path,
        err,
      );
    }
  }
}

/** @internal: test-only. Clears all registered observers. */
export function __resetFileWriteObserversForTests(): void {
  observers.clear();
}

// Folder-handle liveness probe (folder-missing detection, 2026-06-16).
//
// A persisted FileSystemDirectoryHandle (stored in IndexedDB so the app can
// reconnect without re-picking) keeps reporting its `.name` and its permission
// grant even after the underlying folder is moved, renamed, or deleted on disk.
// The handle only errors when an actual filesystem operation hits the missing
// directory. So "Connected to: Walk" can be shown for a folder that is gone, and
// the structure check then reads as "not a ResearchOS folder" (same false a
// genuinely empty folder produces), which is the misleading "Initialize New
// Folder" prompt + the failed init.
//
// This probe tells the two apart: it forces the browser to resolve the directory
// by reading one entry. A present folder (even empty) enumerates fine; a folder
// that is gone throws NotFoundError. Used by finishConnect to surface a clear
// "your folder moved or was deleted" path instead of the init prompt.
//
// Note: the File System Access API deliberately does NOT expose a handle's
// absolute path (privacy), so callers can show the folder NAME but never the
// full on-disk path.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether a directory handle's underlying folder is gone (moved, renamed, or
 * deleted). Returns true only when a read throws NotFoundError. Any other
 * outcome (the read succeeds, or it fails for a different reason like a transient
 * permission state) returns false, so this never hijacks the normal flow on an
 * ambiguous error. It is the caller's job to have a live readwrite grant first.
 */
export async function isDirectoryHandleMissing(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    // Reading a single entry forces the browser to resolve the directory on
    // disk. An empty-but-present folder resolves to { done: true } without
    // throwing; a folder that no longer exists rejects with NotFoundError.
    const iterator = handle.values();
    await iterator.next();
    return false;
  } catch (err) {
    return isNotFoundError(err);
  }
}

/** True for the DOMException a vanished directory throws. Name-based so it holds
 *  across browsers without relying on instanceof against a specific realm. */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "NotFoundError"
  );
}

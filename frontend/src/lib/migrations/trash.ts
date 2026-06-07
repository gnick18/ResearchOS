// The no-data-loss contract for destructive migrations: never hard-delete, move
// the file to a recoverable trash location instead. A mistaken removal is always
// recoverable from disk at _trash/migrations/<migrationId>/<original-path>.

import { fileService } from "@/lib/file-system/file-service";

/**
 * Move a file into the migration trash instead of deleting it. Reads the raw
 * bytes, writes them under `_trash/migrations/<migrationId>/<path>` (original
 * path preserved so it is obvious what it was), then removes the original.
 * Returns true if a file was moved, false if the source did not exist.
 */
export async function trashFile(
  path: string,
  migrationId: string,
): Promise<boolean> {
  const content = await fileService.readText(path);
  if (content === null) return false; // nothing there to trash
  const trashPath = `_trash/migrations/${migrationId}/${path}`;
  // Write the copy FIRST, then delete the original, so a failure mid-way leaves
  // the original intact (never a window where the data exists nowhere).
  await fileService.writeText(trashPath, content);
  await fileService.deleteFile(path);
  return true;
}

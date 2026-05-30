// frontend/src/lib/notes/revert-window-sweep.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). The folder-connect
// expiry sweep for the 24h undo-restore window.
//
// A restore stamps `revert_undo_window` onto the live note. The popup
// render-gate hides the Undo button once `expires_at` has passed, so the field
// is harmless after expiry, but it lingers on disk. This pass, run at
// folder-connect time alongside the trash auto-cleanup, strips expired windows
// so a connected folder self-heals rather than accumulating dead sidecars.
//
// Grant-locked decision: build the sweep NOW (not lazy-only). It rides the
// existing connect-time cleanup loop in file-system-context.tsx, right after
// `runAutoCleanupPass`.
//
// Best-effort + idempotent: a per-note failure is logged and skipped; the next
// connect retries. Never throws into the connect flow.

import { fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

export interface RevertWindowSweepSummary {
  /** Note files scanned for a window field. */
  scanned: number;
  /** Notes that carried a window field at all (expired or not). */
  withWindow: number;
  /** Expired windows stripped + rewritten. */
  stripped: number;
  /** Unexpired windows left untouched. */
  kept: number;
  /** Per-note read/write failures (logged, skipped). */
  errors: number;
}

/**
 * Strip expired `revert_undo_window` fields from every note in one user's
 * folder. A window is expired when `now >= expires_at`. Unexpired windows are
 * preserved so an active undo affordance survives a reconnect.
 *
 * `now` is injectable for deterministic tests; defaults to the wall clock.
 */
export async function runRevertWindowSweep(
  username: string,
  now: number = Date.now(),
): Promise<RevertWindowSweepSummary> {
  const summary: RevertWindowSweepSummary = {
    scanned: 0,
    withWindow: 0,
    stripped: 0,
    kept: 0,
    errors: 0,
  };

  const dirPath = `users/${username}/notes`;
  let fileNames: string[] = [];
  try {
    fileNames = await fileService.listFiles(dirPath);
  } catch (err) {
    console.warn(
      `[revert-window-sweep] could not list ${dirPath} for ${username}:`,
      err,
    );
    summary.errors++;
    return summary;
  }

  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    // Skip sidecar/index files (e.g. `_index.json`); real notes are `<id>.json`.
    if (fileName.startsWith("_")) continue;
    const filePath = `${dirPath}/${fileName}`;
    try {
      const note = await fileService.readJson<Note>(filePath);
      if (!note) continue;
      summary.scanned++;
      const win = note.revert_undo_window;
      if (!win) continue;
      summary.withWindow++;
      const expiresAt = new Date(win.expires_at).getTime();
      // Treat an unparseable expiry as expired (defensive: a malformed window
      // can never be undone, so it should not linger).
      const expired = Number.isNaN(expiresAt) || now >= expiresAt;
      if (!expired) {
        summary.kept++;
        continue;
      }
      const { revert_undo_window: _drop, ...withoutWindow } = note;
      await fileService.writeJson(filePath, withoutWindow);
      summary.stripped++;
    } catch (err) {
      console.warn(`[revert-window-sweep] failed for ${filePath}:`, err);
      summary.errors++;
    }
  }

  return summary;
}

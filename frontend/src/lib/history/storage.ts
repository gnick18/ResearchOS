// Version Control Phase 0: storage layer for the per-record jsonl history file.
//
// Path: users/<owner>/_history/<type>/<id>.jsonl (per-owner namespace, mirrors
// the per-user-folder resolution in lib/storage/json-store.ts and the trash
// layout in lib/trash/trash-paths.ts).
//
// The engine is built against the HistoryStorage interface so the compaction
// battery can run against an in-memory store with no fileService mocking. The
// production binding (fileServiceHistoryStorage) wires:
//   - readRaw   -> fileService.readText  (whole-file read; null when missing)
//   - append    -> read-modify-write via atomic writeText (OneDrive-friendly,
//                  same pattern PROPOSAL.md 3c specifies until a real
//                  append-only primitive lands)
//   - rewrite   -> atomic tmp+move via fileService.writeText (compaction)
//
// writeText routes through fileService.atomicWrite (tmp file then FSA move),
// so a torn compaction rewrite can only ever leave the OLD file intact, never
// a partial file (R4-prep 2b / test 8).

import { fileService } from "../file-system/file-service";

/** Build the on-disk history path for a record. */
export function historyFilePath(
  owner: string,
  type: string,
  id: string | number,
): string {
  return `users/${owner}/_history/${type}/${id}.jsonl`;
}

/**
 * Storage primitives the engine needs. Deliberately small and string-oriented
 * (the engine owns jsonl parsing) so an in-memory test double is trivial.
 */
export interface HistoryStorage {
  /** Whole-file read. Returns null when the file does not exist. */
  readRaw(path: string): Promise<string | null>;
  /**
   * Append one already-serialized jsonl line (no trailing newline supplied by
   * the caller; the implementation owns newline handling). Read-modify-write.
   */
  appendLine(path: string, line: string): Promise<void>;
  /**
   * Atomically replace the whole file with `content`. Used by compaction.
   * Must be crash-safe (tmp+move): a failure leaves the prior file intact.
   */
  rewrite(path: string, content: string): Promise<void>;
}

/** Production storage bound to the app's fileService. */
export const fileServiceHistoryStorage: HistoryStorage = {
  async readRaw(path: string): Promise<string | null> {
    return fileService.readText(path);
  },

  async appendLine(path: string, line: string): Promise<void> {
    // Read-modify-write. Per PROPOSAL.md 3c this is the chosen append strategy
    // until/unless a real append-only primitive is adopted: it keeps the file
    // OneDrive-sync-friendly and routes through the same atomic write the rest
    // of the app uses.
    const existing = (await fileService.readText(path)) ?? "";
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    const next = existing + (needsNewline ? "\n" : "") + line + "\n";
    await fileService.writeText(path, next);
  },

  async rewrite(path: string, content: string): Promise<void> {
    // writeText -> atomicWrite (tmp+move). Crash-safe full overwrite.
    await fileService.writeText(path, content);
  },
};

/** Serialize an array of rows into jsonl text (trailing newline). */
export function rowsToJsonl(rows: unknown[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Parse jsonl text into rows. Blank lines are skipped. A single corrupt line is
 * skipped rather than thrown, so one bad line in a history file cannot wedge the
 * whole engine. appendEdit reads history internally before every write, so an
 * unguarded throw here would silently stop ALL new history writes for that note.
 */
export function jsonlToRows<T>(raw: string | null): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Corrupt/partial line (e.g. a torn final write): skip it and keep the
      // rest of the file readable instead of throwing the whole parse away.
      continue;
    }
  }
  return out;
}

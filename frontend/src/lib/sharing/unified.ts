// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): the
// unified sharing primitive. Pure functions + types + read/write helpers
// shared across every shareable record type.
//
// See LAB_MODE_RETIREMENT_PROPOSAL.md §2 for the design. The locked
// decisions (Grant 2026-05-23) are:
//
//   1. One shape: { username: string; level: "read" | "edit" }[]
//   2. "*" sentinel = whole-lab shortcut, expanded at read time
//   3. Lab Head implicit view-all (role privilege; no entry written)
//   4. Lab Head edit-anywhere gated on the Phase 5 passcode session
//
// Pure functions only — no global state, no I/O. The wrappers that
// actually talk to the file system live in `lib/owner-scoped/index.ts`.

import type { SharedUser } from "@/lib/types";

/** The "*" sentinel that means "every current lab member" in a
 *  shared_with entry. Exported so callers can compare against it
 *  without hard-coding the string. */
export const WHOLE_LAB_SENTINEL = "*";

/**
 * A minimal "shareable record" shape. Every store record that uses the
 * unified sharing primitive has at least these two fields. The full
 * record types in `lib/types.ts` extend this implicitly (Task / Note /
 * Method / etc. each carry `owner` + `shared_with`).
 */
export interface ShareableRecord {
  owner: string;
  shared_with: SharedUser[];
}

/**
 * The viewer the read/write helpers compare against. Carries account
 * type so the implicit Lab Head view-all rule can fire.
 */
export interface Viewer {
  username: string;
  account_type: "solo" | "lab" | "lab_head";
}

/**
 * Lab Head edit-session view. Mirrors the shape of `EditSessionState`
 * in `lib/lab/edit-session.ts` without dragging the full module in.
 */
export interface EditSessionView {
  /** Returns true if the Phase 5 passcode window is currently
   *  unlocked for edits against the given target owner's records. */
  isUnlockedFor(targetOwner: string): boolean;
}

/**
 * Normalize a single SharedUser-ish on-disk entry to the unified shape.
 * Pre-R1 records have `permission: "view" | "edit"`; the unified shape
 * uses `level: "read" | "edit"`. This is the read-side adapter so
 * `canRead` / `canWrite` always see the new shape regardless of what's
 * on disk.
 *
 * "view" → "read" is the only mapping. Anything unknown defaults to
 * "read" (most conservative).
 */
/** A SharedUser with `level` guaranteed (the normalized read-time shape).
 *  Used internally so functions like canRead / canWrite / expandSharedWith
 *  don't have to deal with `level?: ...`. */
export interface NormalizedSharedUser {
  username: string;
  level: "read" | "edit";
}

export function normalizeSharedEntry(
  entry: SharedUser | { username: string; permission?: string; level?: string },
): NormalizedSharedUser {
  const e = entry as { username: string; permission?: string; level?: string };
  if (e.level === "edit" || e.level === "read") {
    return { username: e.username, level: e.level };
  }
  if (e.permission === "edit") {
    return { username: e.username, level: "edit" };
  }
  // "view" or unknown → "read".
  return { username: e.username, level: "read" };
}

/** Normalize a whole array. Idempotent on already-unified shapes. */
export function normalizeSharedWith(raw: unknown): NormalizedSharedUser[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedSharedUser[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { username?: unknown };
    if (typeof e.username !== "string" || e.username.length === 0) continue;
    out.push(normalizeSharedEntry(entry as SharedUser));
  }
  return out;
}

/**
 * Can this viewer see this record at all?
 *
 *   - Owner always reads.
 *   - Lab Head always reads (implicit view-all, no share entry needed).
 *   - "*" sentinel in shared_with means anyone in the lab reads.
 *   - Otherwise the viewer must be in shared_with explicitly.
 */
export function canRead(record: ShareableRecord, viewer: Viewer): boolean {
  if (!record) return false;
  if (record.owner === viewer.username) return true;
  if (viewer.account_type === "lab_head") return true;
  const list = normalizeSharedWith(record.shared_with);
  return list.some(
    (s) => s.username === viewer.username || s.username === WHOLE_LAB_SENTINEL,
  );
}

/**
 * Can this viewer modify this record?
 *
 *   - Owner always writes.
 *   - Lab Head writes IFF the edit session is unlocked for the
 *     record's owner (Phase 5 passcode-gated edit-anywhere).
 *   - Otherwise the viewer must be in shared_with with level: "edit".
 *     The "*" sentinel with level: "edit" grants the whole lab edit.
 */
export function canWrite(
  record: ShareableRecord,
  viewer: Viewer,
  session: EditSessionView,
): boolean {
  if (!record) return false;
  if (record.owner === viewer.username) return true;
  if (
    viewer.account_type === "lab_head" &&
    session.isUnlockedFor(record.owner)
  ) {
    return true;
  }
  const list = normalizeSharedWith(record.shared_with);
  return list.some(
    (s) =>
      (s.username === viewer.username || s.username === WHOLE_LAB_SENTINEL) &&
      s.level === "edit",
  );
}

/**
 * Resolve "*" entries to the concrete set of current lab members.
 * The owner is excluded (they always have implicit access; no need to
 * show them in a recipient list). When a user appears both as an
 * explicit entry AND via "*", the highest level wins (edit > read).
 */
export function expandSharedWith(
  shared_with: SharedUser[],
  allLabUsernames: string[],
  ownerUsername: string,
): NormalizedSharedUser[] {
  const expanded = new Map<string, "read" | "edit">();
  const normalized = normalizeSharedWith(shared_with);
  for (const entry of normalized) {
    if (entry.username === WHOLE_LAB_SENTINEL) {
      for (const u of allLabUsernames) {
        if (u === ownerUsername) continue;
        const prev = expanded.get(u);
        if (prev !== "edit") expanded.set(u, entry.level);
      }
    } else {
      const prev = expanded.get(entry.username);
      if (prev !== "edit") expanded.set(entry.username, entry.level);
    }
  }
  return Array.from(expanded.entries()).map(([username, level]) => ({
    username,
    level,
  }));
}

/**
 * Insert / update an entry. Idempotent: re-running with the same level
 * is a no-op. Returns a NEW array (input is not mutated).
 */
export function upsertSharedEntry(
  shared_with: SharedUser[],
  username: string,
  level: "read" | "edit",
): NormalizedSharedUser[] {
  const list = normalizeSharedWith(shared_with);
  const idx = list.findIndex((s) => s.username === username);
  if (idx >= 0) {
    list[idx] = { username, level };
  } else {
    list.push({ username, level });
  }
  return list;
}

/** Remove an entry by username. Returns a NEW array. */
export function removeSharedEntry(
  shared_with: SharedUser[],
  username: string,
): NormalizedSharedUser[] {
  return normalizeSharedWith(shared_with).filter(
    (s) => s.username !== username,
  );
}

/** True iff the shared_with list contains the "*" sentinel. */
export function isWholeLabShared(shared_with: SharedUser[]): boolean {
  return normalizeSharedWith(shared_with).some(
    (s) => s.username === WHOLE_LAB_SENTINEL,
  );
}

/**
 * The "no-op" edit session — fail every isUnlockedFor check. Used when
 * a caller wants a `canWrite` check that ignores the Phase 5 PI bypass
 * (e.g. for asserting "does the OWNER personally have write rights to
 * this record" without the PI override).
 */
export const NEVER_UNLOCKED: EditSessionView = {
  isUnlockedFor: () => false,
};

/**
 * Convert a `ShareRequest`'s mixed-shape level/permission fields into
 * the canonical `level`. Callers can pass either field; readers see one
 * unified value. Used by `sharingApi.shareX` to bridge the gap during
 * the migration window when some callers still pass `permission`.
 */
export function readShareRequestLevel(req: {
  level?: "read" | "edit";
  permission?: "view" | "edit";
}): "read" | "edit" {
  if (req.level === "edit" || req.level === "read") return req.level;
  if (req.permission === "edit") return "edit";
  // "view" or unset → "read" (the more conservative default).
  return "read";
}

/**
 * Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
 * method auto-grant transient read. When a viewer has a shared task
 * that references a method they wouldn't otherwise be able to read,
 * grant them transient read access AND emit a `method-transient-read`
 * audit entry so the method owner can see who's auto-reading their
 * methods via task-share.
 *
 * Depth-1 only: we check direct task->method references. We do NOT
 * recurse into compound-method children (a viewer who can read a
 * compound method via task-share does NOT auto-read its children;
 * they'd need to canRead each child independently).
 *
 * This helper is PURE — it returns a boolean. Audit emission is
 * driven separately by callers that have file-system access (see
 * `frontend/src/lib/lab/pi-audit.ts::emitMethodTransientReadAudit`).
 * Keeping unified.ts I/O-free preserves the rest of the surface as a
 * pure-functions module.
 *
 * @param method   The method record being read.
 * @param viewer   The viewer trying to read.
 * @param viewerSharedTaskMethodIds  The set of method_ids referenced by
 *   tasks the viewer can already canRead (owner-or-shared). Caller
 *   computes this once per page-load so we don't re-walk the task
 *   index per method.
 * @returns `true` if the auto-grant fires, `false` otherwise.
 */
export function canReadMethodViaTask(
  method: ShareableRecord & { id?: number; method_id?: number },
  viewer: Viewer,
  viewerSharedTaskMethodIds: Set<number>,
): boolean {
  if (!method) return false;
  if (method.owner === viewer.username) return false; // owner already reads via canRead.
  // Method id can live on either `id` (top-level) or `method_id` (legacy).
  const mid = typeof method.id === "number" ? method.id : method.method_id;
  if (typeof mid !== "number") return false;
  return viewerSharedTaskMethodIds.has(mid);
}

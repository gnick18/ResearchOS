// Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): append-only
// writer for the per-user PI audit log.
//
// Decision #2 (Grant 2026-05-23): FULL old/new field diff per edit. We
// capture both the pre-edit value and the post-edit value verbatim. No
// summarization. One entry per changed field — a single save that
// touches N fields writes N audit entries.
//
// Storage shape (per proposal section 2c): one file per target user at
// `users/<target_user>/_pi_audit.json`. The PI already has shared-folder
// write access (that's what lab mode is), so no new permission model is
// needed; per-user files avoid the cross-user write race a single lab-
// root log would create.
//
// File schema:
//
//   {
//     "version": 1,
//     "entries": [ ...PiAuditEntry ]
//   }
//
// Append-only by design. There is no `removeAuditEntry` export. Old
// records can never be edited or deleted via the application; if a user
// wants to scrub history they must do so directly on disk and accept
// the integrity break.

import { fileService } from "../file-system/file-service";

// Per-user write queue serializes read-modify-write operations on each
// `users/<target_user>/_pi_audit.json` so concurrent callers (e.g. two
// browser tabs each appending after a PI edit) don't race the underlying
// atomic-write pattern (.tmp create + write + move) and silently truncate
// entries. Same template as the calendar feeds fix at commit 4f093714
// (`lib/calendar/external-feeds-store.ts`) — keyed by target user so
// distinct users do NOT serialize against each other (multiple PIs in
// the same folder don't block each other). Tab-scoped only; does not
// protect against cross-tab / cross-process writes.
const auditWriteQueues = new Map<string, Promise<unknown>>();
function enqueueAuditWrite<T>(
  username: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = auditWriteQueues.get(username) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow errors on the queue chain so a single failed write doesn't
  // poison every subsequent write. Caller still receives the original
  // rejection via the returned promise.
  auditWriteQueues.set(
    username,
    next.catch(() => {}),
  );
  return next;
}

/**
 * One audit log entry. One per field change per save.
 *
 * `field_path` is a dot-separated path through the record shape (e.g.
 * `"name"`, `"sub_tasks.0.title"`, `"comments[3].text"`). Free-form
 * string so callers don't need a schema enumeration.
 *
 * `old_value` / `new_value` are JSON-cloneable. For complex sub-trees
 * (a whole sub_tasks array, for instance) the caller may pass the
 * stringified JSON instead so the file stays diffable on disk. Both
 * shapes round-trip through `JSON.stringify(data, null, 2)`.
 */
export interface PiAuditEntry {
  /** Unique entry id. UUID-style. */
  id: string;
  /** A synthetic id grouping related entries (e.g. "lab-head-action",
   *  "owner-clear", "auto-grant"). The old PI 5-min edit-session id is gone. */
  session_id: string;
  /** Lab head who made the edit (the "actor"). Always === the session's
   *  username at write time. Stored alongside session_id so a reader
   *  doesn't have to cross-reference a separate session index. */
  actor: string;
  /** Target user (i.e. the user whose folder this file lives in).
   *  Recorded redundantly so an entry copied out of context is still
   *  self-describing. */
  target_user: string;
  /** Record type: "task" | "note" | "purchase_item" | (future kinds).
   *  Free-form string so new record types don't break the writer. */
  record_type: string;
  /** Record identifier (numeric id for tasks/notes/items; string ok). */
  record_id: string | number;
  /** Dot path through the record shape. See class docs. */
  field_path: string;
  /** Pre-edit value. JSON-cloneable. */
  old_value: unknown;
  /** Post-edit value. JSON-cloneable. */
  new_value: unknown;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

interface PiAuditFile {
  version: 1;
  entries: PiAuditEntry[];
}

function auditPath(targetUser: string): string {
  return `users/${targetUser}/_pi_audit.json`;
}

function newEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Append one or more audit entries to `users/<target_user>/_pi_audit.json`.
 * The file is created if missing. Each input is filled with `id` and
 * `timestamp` if the caller didn't provide them.
 *
 * Concurrent writes: this is a read-modify-write, serialized through the
 * per-user `auditWriteQueues` chain above so two tabs racing to append
 * (Mira saves in tab A while a sibling tab B finishes its own save)
 * don't silently truncate each other's entries. Mira-Distracted P0 fix
 * 2026-05-23. Previously the comment here noted the race was tolerated
 * "since lab-mode editing is per-PI and short" — that assumption breaks
 * in any multi-tab session.
 */
export async function appendAuditEntries(
  targetUser: string,
  entries: Array<Omit<PiAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  return enqueueAuditWrite(targetUser, async () => {
    const now = new Date().toISOString();
    const filled: PiAuditEntry[] = entries.map((e) => ({
      id: e.id ?? newEntryId(),
      timestamp: e.timestamp ?? now,
      session_id: e.session_id,
      actor: e.actor,
      target_user: e.target_user,
      record_type: e.record_type,
      record_id: e.record_id,
      field_path: e.field_path,
      old_value: e.old_value,
      new_value: e.new_value,
    }));

    const existing = await fileService.readJson<PiAuditFile>(auditPath(targetUser));
    const merged: PiAuditFile = {
      version: 1,
      entries: [...(existing?.entries ?? []), ...filled],
    };
    await fileService.writeJson(auditPath(targetUser), merged);
  });
}

/**
 * Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
 * emit a `method-transient-read` audit entry. Fires whenever a viewer
 * auto-reads a method via a shared-task auto-grant (depth-1; see
 * `canReadMethodViaTask` in `lib/sharing/unified.ts`).
 *
 * Schema deviation: this entry type sets `actor: "system"` (no human
 * actor — the read was automatic), `session_id: "auto-grant"` (no
 * 5-min unlock window), and uses `field_path: "transient-read"` as a
 * sentinel. The shared PiAuditEntry interface is wide enough to carry
 * this without a separate file.
 *
 * Fire-and-forget: callers should NOT await. Failures are swallowed
 * so a write hiccup on the audit log never blocks a read path.
 */
export function emitMethodTransientReadAudit(args: {
  methodOwner: string;
  methodId: number;
  viewer: string;
}): void {
  // Self-read isn't a transient grant — guard at the call site too,
  // but defensive here.
  if (args.methodOwner === args.viewer) return;
  void appendAuditEntries(args.methodOwner, [
    {
      session_id: "auto-grant",
      actor: "system",
      target_user: args.methodOwner,
      record_type: "method-transient-read",
      record_id: args.methodId,
      field_path: "transient-read",
      old_value: null,
      new_value: { viewer: args.viewer, method_id: args.methodId },
    },
  ]).catch((err) => {
    // Audit log writes are best-effort. A failure here must not
    // disrupt the underlying read path that triggered it.
    console.warn("[pi-audit] emitMethodTransientReadAudit failed", err);
  });
}

/**
 * Read all audit entries for a user. Returns [] if the file doesn't
 * exist. The reader is not paginated — labs accumulate a few hundred
 * entries at most over the lifetime of the demo and the file is JSON,
 * so a full scan is fine.
 */
export async function readAuditEntries(targetUser: string): Promise<PiAuditEntry[]> {
  const data = await fileService.readJson<PiAuditFile>(auditPath(targetUser));
  if (!data || !Array.isArray(data.entries)) return [];
  return data.entries;
}

/**
 * Mira-Distracted P0 #2 helper (2026-05-23): perform a data write +
 * audit append as a single serialized chain on the per-user audit
 * write queue. Reduces the failure window where a tab-unload between
 * the data write and the audit append leaves the record changed with
 * no audit trail.
 *
 * Sequencing:
 *   1. Both writes run inside one `enqueueAuditWrite` slot so they
 *      share the queue's promise chain. A second writer (e.g. a sibling
 *      tab) racing on the same target user CANNOT interleave its own
 *      audit append between this caller's data write and audit append.
 *   2. The data write runs first.
 *   3. The audit append uses the post-write result to compute entries,
 *      then writes them via the same queue slot. (Note: the audit
 *      append is INSIDE the same queue slot, not a re-enqueue, so it's
 *      guaranteed to be the very next operation on this chain.)
 *
 * Atomicity caveats this helper does NOT solve (full atomicity needs a
 * transaction primitive we don't have):
 *   - Tab-unload mid-data-write still leaves the file in whatever state
 *     the FSA `move()` got to. Same as before.
 *   - Tab-unload AFTER the data write resolves but BEFORE the audit
 *     append starts: still possible in theory, but the gap is the
 *     event-loop tick between the two awaits, much shorter than the
 *     pre-helper gap which included unrelated React state updates,
 *     queryClient.refetchQueries, etc.
 *   - If the data write succeeds but the audit append throws, the data
 *     write has already landed; the helper re-throws the audit error
 *     so the caller can decide to surface vs swallow. Current callsites
 *     swallow via try/catch + console.warn (acceptable for now).
 *
 * Migration plan: NOT a drop-in for every audit-emitting callsite right
 * now. This chip migrates only TaskDetailPopup (the highest-traffic
 * surface) so the pattern is established; sibling callsites in
 * `lib/notes/owner-scoped-api.ts`, `lib/purchases/owner-scoped-api.ts`,
 * `lib/lab/user-archive.ts`, `lib/lab/pi-actions.ts` migrate in a
 * future pass.
 */
export async function writeWithAudit<T>(args: {
  targetUser: string;
  /** The data write. Must resolve to the value the caller wants to
   *  return (e.g. the updated record). */
  dataWrite: () => Promise<T>;
  /** Compute audit entries from the data-write result. Runs AFTER the
   *  data write succeeds. Return `[]` to skip the audit append (e.g.
   *  no fields actually changed). */
  buildEntries: (result: T) => Array<
    Omit<PiAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }
  >;
}): Promise<T> {
  return enqueueAuditWrite(args.targetUser, async () => {
    const result = await args.dataWrite();
    const entries = args.buildEntries(result);
    if (entries.length === 0) return result;

    const now = new Date().toISOString();
    const filled: PiAuditEntry[] = entries.map((e) => ({
      id: e.id ?? newEntryId(),
      timestamp: e.timestamp ?? now,
      session_id: e.session_id,
      actor: e.actor,
      target_user: e.target_user,
      record_type: e.record_type,
      record_id: e.record_id,
      field_path: e.field_path,
      old_value: e.old_value,
      new_value: e.new_value,
    }));

    const existing = await fileService.readJson<PiAuditFile>(
      auditPath(args.targetUser),
    );
    const merged: PiAuditFile = {
      version: 1,
      entries: [...(existing?.entries ?? []), ...filled],
    };
    await fileService.writeJson(auditPath(args.targetUser), merged);
    return result;
  });
}

/**
 * Build per-field-diff entries from an old / new object pair. The
 * caller decides which fields are "edit-worthy" by passing them in
 * `fieldPaths`. Each entry compares `JSON.stringify(old[f]) !==
 * JSON.stringify(new[f])` — i.e. structural equality. Unchanged fields
 * are skipped.
 *
 * Helper for the popup save handlers: rather than each popup
 * hand-computing diff entries, they collect a list of touched field
 * paths and pass them here.
 */
export function buildFieldDiffEntries(args: {
  actor: string;
  session_id: string;
  target_user: string;
  record_type: string;
  record_id: string | number;
  oldRecord: Record<string, unknown>;
  newRecord: Record<string, unknown>;
  fieldPaths: string[];
}): Array<Omit<PiAuditEntry, "id" | "timestamp">> {
  const out: Array<Omit<PiAuditEntry, "id" | "timestamp">> = [];
  for (const path of args.fieldPaths) {
    const oldVal = args.oldRecord[path];
    const newVal = args.newRecord[path];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
    out.push({
      session_id: args.session_id,
      actor: args.actor,
      target_user: args.target_user,
      record_type: args.record_type,
      record_id: args.record_id,
      field_path: path,
      old_value: oldVal ?? null,
      new_value: newVal ?? null,
    });
  }
  return out;
}

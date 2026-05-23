// Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): read/write
// helpers for the lab-wide PI announcements file.
//
// Storage shape (per LAB_HEAD_PROPOSAL.md §2f + the Phase 3 brief):
// `_announcements.json` at the LAB ROOT (sibling to `users/`), so all
// members can read it. Only PIs are allowed to write — gating lives in
// the UI (lab-head session edit mode), not the file system.
//
//   {
//     "version": 1,
//     "announcements": [
//       { "id", "author", "text", "created_at", "pinned"? }
//     ]
//   }
//
// Append-only from the caller's perspective. PIs can edit / delete their
// OWN announcements (the `update` / `remove` helpers below match on the
// author for safety, but the UI is the real enforcement layer).
//
// Audit: writes go through `appendAuditEntries` against a lab-level
// audit log at `_pi_audit.json` (sibling to `users/`). This is distinct
// from the per-user `users/<username>/_pi_audit.json` files that record
// edits to individual records — announcements are lab-wide, so the
// audit log lives lab-wide too.

import { fileService } from "../file-system/file-service";
import type { PiAuditEntry } from "./pi-audit";

/** On-disk shape of `_announcements.json` at the lab root. */
export interface AnnouncementEntry {
  /** Unique announcement id. UUID-style. */
  id: string;
  /** Lab-head username that posted it. Members can't post (UI-enforced). */
  author: string;
  /** Free-form text body. No markdown rendering in Phase 3. */
  text: string;
  /** ISO 8601. */
  created_at: string;
  /** Pinned announcements float to the top. Default false / omitted. */
  pinned?: boolean;
}

interface AnnouncementsFile {
  version: 1;
  announcements: AnnouncementEntry[];
}

const ANNOUNCEMENTS_PATH = "_announcements.json";
const LAB_AUDIT_PATH = "_pi_audit.json";

function newAnnouncementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read every announcement. Returns [] when the file is missing OR
 * malformed (defensive — a single bad write must not poison the lab
 * inbox for every member).
 */
export async function listAnnouncements(): Promise<AnnouncementEntry[]> {
  const data = await fileService.readJson<AnnouncementsFile>(ANNOUNCEMENTS_PATH);
  if (!data || !Array.isArray(data.announcements)) return [];
  return data.announcements;
}

/**
 * Post a new announcement. Caller MUST be a lab head; that gate is
 * enforced in the composer UI (Phase 5 session edit mode). Writes an
 * audit entry to the lab-level audit log alongside the announcement.
 */
export async function postAnnouncement(args: {
  author: string;
  text: string;
  pinned?: boolean;
  /** Phase 5 session id for the audit log. When omitted (e.g. demo
   *  seeding) the audit entry is skipped — production paths always
   *  pass it. */
  sessionId?: string;
}): Promise<AnnouncementEntry> {
  const now = new Date().toISOString();
  const entry: AnnouncementEntry = {
    id: newAnnouncementId(),
    author: args.author,
    text: args.text,
    created_at: now,
    pinned: args.pinned ?? false,
  };
  const existing = await fileService.readJson<AnnouncementsFile>(ANNOUNCEMENTS_PATH);
  const merged: AnnouncementsFile = {
    version: 1,
    announcements: [...(existing?.announcements ?? []), entry],
  };
  await fileService.writeJson(ANNOUNCEMENTS_PATH, merged);
  if (args.sessionId) {
    await appendLabAuditEntry({
      session_id: args.sessionId,
      actor: args.author,
      target_user: "_lab",
      record_type: "announcement",
      record_id: entry.id,
      field_path: "text",
      old_value: null,
      new_value: entry.text,
    });
  }
  return entry;
}

/**
 * Update one of the caller's own announcements. Returns the new entry
 * or `null` if the announcement doesn't exist / belongs to someone
 * else. Mirrors the post audit-entry shape — old_value carries the
 * pre-edit text, new_value the post-edit text.
 */
export async function updateAnnouncement(args: {
  id: string;
  author: string;
  text?: string;
  pinned?: boolean;
  sessionId?: string;
}): Promise<AnnouncementEntry | null> {
  const existing = await fileService.readJson<AnnouncementsFile>(ANNOUNCEMENTS_PATH);
  if (!existing || !Array.isArray(existing.announcements)) return null;
  const idx = existing.announcements.findIndex((a) => a.id === args.id);
  if (idx === -1) return null;
  const original = existing.announcements[idx];
  if (original.author !== args.author) return null;
  const updated: AnnouncementEntry = {
    ...original,
    text: args.text ?? original.text,
    pinned: args.pinned ?? original.pinned,
  };
  const merged: AnnouncementsFile = {
    version: 1,
    announcements: existing.announcements.map((a, i) => (i === idx ? updated : a)),
  };
  await fileService.writeJson(ANNOUNCEMENTS_PATH, merged);
  if (args.sessionId) {
    if (args.text !== undefined && args.text !== original.text) {
      await appendLabAuditEntry({
        session_id: args.sessionId,
        actor: args.author,
        target_user: "_lab",
        record_type: "announcement",
        record_id: updated.id,
        field_path: "text",
        old_value: original.text,
        new_value: updated.text,
      });
    }
    if (args.pinned !== undefined && args.pinned !== !!original.pinned) {
      await appendLabAuditEntry({
        session_id: args.sessionId,
        actor: args.author,
        target_user: "_lab",
        record_type: "announcement",
        record_id: updated.id,
        field_path: "pinned",
        old_value: !!original.pinned,
        new_value: !!updated.pinned,
      });
    }
  }
  return updated;
}

/**
 * Delete one of the caller's own announcements. Returns true on success,
 * false if the announcement doesn't exist OR belongs to a different
 * author.
 */
export async function deleteAnnouncement(args: {
  id: string;
  author: string;
  sessionId?: string;
}): Promise<boolean> {
  const existing = await fileService.readJson<AnnouncementsFile>(ANNOUNCEMENTS_PATH);
  if (!existing || !Array.isArray(existing.announcements)) return false;
  const target = existing.announcements.find((a) => a.id === args.id);
  if (!target) return false;
  if (target.author !== args.author) return false;
  const merged: AnnouncementsFile = {
    version: 1,
    announcements: existing.announcements.filter((a) => a.id !== args.id),
  };
  await fileService.writeJson(ANNOUNCEMENTS_PATH, merged);
  if (args.sessionId) {
    await appendLabAuditEntry({
      session_id: args.sessionId,
      actor: args.author,
      target_user: "_lab",
      record_type: "announcement",
      record_id: target.id,
      field_path: "_deleted",
      old_value: { text: target.text, pinned: !!target.pinned },
      new_value: null,
    });
  }
  return true;
}

// ── Lab-level audit log ─────────────────────────────────────────────────
//
// Mirror of `lib/lab/pi-audit.ts:appendAuditEntries` but written to the
// LAB-ROOT `_pi_audit.json` (sibling to `users/`). Announcements are
// lab-wide, so their audit trail belongs lab-wide too. We don't reuse
// the per-user writer because the target_user field would be misleading
// for a lab-wide record.

async function appendLabAuditEntry(
  entry: Omit<PiAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string },
): Promise<void> {
  try {
    const filled: PiAuditEntry = {
      id: entry.id ?? newAnnouncementId(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      session_id: entry.session_id,
      actor: entry.actor,
      target_user: entry.target_user,
      record_type: entry.record_type,
      record_id: entry.record_id,
      field_path: entry.field_path,
      old_value: entry.old_value,
      new_value: entry.new_value,
    };
    const existing = await fileService.readJson<{
      version: 1;
      entries: PiAuditEntry[];
    }>(LAB_AUDIT_PATH);
    const merged = {
      version: 1 as const,
      entries: [...(existing?.entries ?? []), filled],
    };
    await fileService.writeJson(LAB_AUDIT_PATH, merged);
  } catch (err) {
    // Audit write failure must not block the announcement write — the
    // attribution is recoverable from the announcement.author field even
    // without the audit row.
    console.warn("[announcements] lab-audit write failed", err);
  }
}

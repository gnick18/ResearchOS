// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): one-time
// per-record migration to the unified sharing primitive.
//
// Each shareable record type (Task / Note / Method / Project / Link / Goal /
// Purchase / MassSpecProtocol / List=Task) had its own ad-hoc sharing shape
// pre-R1. This helper rewrites those into the canonical
// `shared_with: SharedUser[]` with `level: "read" | "edit"` field.
//
// FLAG: this is a DATA-SHAPE migration. It is destructive (drops
// `is_public` on Method / MassSpecProtocol and `is_shared` on Note) and
// it WRITES every record on disk. Run once per user; idempotent on
// re-runs (records already in the unified shape pass through unchanged).
//
// Migration table (locked decisions from §2b + §6 of the proposal):
//
//   | Type            | Pre-R1 shape                          | R1 shape                                              |
//   |-----------------|---------------------------------------|--------------------------------------------------------|
//   | Task            | shared_with[].permission "view"|"edit" | shared_with[].level "read"|"edit" (existing → "edit")  |
//   | Project         | shared_with[].permission              | shared_with[].level                                    |
//   | Method          | shared_with[].permission + is_public  | shared_with[].level, is_public:true → "*" entry, drop  |
//   | MassSpecProtocol| shared_with?[].permission + is_public | same as Method                                         |
//   | Note            | is_shared: boolean                    | is_shared dropped → "*" entry if was true             |
//   | LabLink         | no sharing                            | shared_with: [{ "*", level: "edit" }] (lab-wide today) |
//   | HighLevelGoal   | hide_goals_from_lab user-setting      | per-goal shared_with: [] OR [{"*","read"}]            |
//   | PurchaseItem    | no sharing (inherits parent task)     | shared_with: [] default                                |
//
// Storage: a per-user marker file at
// `users/<u>/_sharing_migration.json` records when the migration last ran
// (idempotency). The migration helper checks it before doing any work;
// re-runs are no-ops unless the marker file is deleted.

import { fileService } from "../file-system/file-service";
import {
  getUserMetadata,
  setUserMetadataField,
} from "../file-system/user-metadata";
import type { SharedUser } from "@/lib/types";

/** Bump to force re-migration across the whole user base. */
export const SHARING_MIGRATION_VERSION = 1;

interface SharingMigrationMarker {
  version: number;
  migrated_at: string;
  per_type_counts: Record<string, number>;
}

function markerPath(username: string): string {
  return `users/${username}/_sharing_migration.json`;
}

async function readMarker(
  username: string,
): Promise<SharingMigrationMarker | null> {
  try {
    return await fileService.readJson<SharingMigrationMarker>(
      markerPath(username),
    );
  } catch {
    return null;
  }
}

async function writeMarker(
  username: string,
  counts: Record<string, number>,
): Promise<void> {
  await fileService.writeJson<SharingMigrationMarker>(markerPath(username), {
    version: SHARING_MIGRATION_VERSION,
    migrated_at: new Date().toISOString(),
    per_type_counts: counts,
  });
}

/** Normalize a single legacy entry to the unified `level` shape. */
function normalizeEntry(raw: unknown): SharedUser | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as { username?: unknown; permission?: unknown; level?: unknown };
  if (typeof e.username !== "string" || e.username.length === 0) return null;
  // Already unified.
  if (e.level === "read" || e.level === "edit") {
    return { username: e.username, level: e.level };
  }
  // Legacy "permission": "edit" → "edit"; "view" → "read".
  if (e.permission === "edit") {
    return { username: e.username, level: "edit" };
  }
  if (e.permission === "view") {
    return { username: e.username, level: "read" };
  }
  // Anything else defaults to "read".
  return { username: e.username, level: "read" };
}

function normalizeArray(raw: unknown): SharedUser[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedUser[] = [];
  for (const entry of raw) {
    const n = normalizeEntry(entry);
    if (n) out.push(n);
  }
  return out;
}

/**
 * For Task migration: today's `shared_with` entries always granted full
 * edit access on tasks the recipient explicitly received (the receiver-
 * side workflow assumed edit). So a legacy "view" maps to "edit" too.
 *
 * Per the brief table row #2: "Each username → { username, level: 'edit' }
 * (matches today's behavior — shared = full edit)".
 */
function migrateTaskSharedWith(raw: unknown): SharedUser[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedUser[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { username?: unknown; permission?: unknown; level?: unknown };
    if (typeof e.username !== "string" || e.username.length === 0) continue;
    // Already unified — keep as-is.
    if (e.level === "read" || e.level === "edit") {
      out.push({ username: e.username, level: e.level });
      continue;
    }
    // Legacy task shares always meant edit.
    out.push({ username: e.username, level: "edit" });
  }
  return out;
}

function migrateMethodLikeRecord(raw: Record<string, unknown>): {
  changed: boolean;
  record: Record<string, unknown>;
} {
  const list = normalizeArray(raw.shared_with);
  const isPublic = raw.is_public === true;
  let changed = false;
  // Add the "*" sentinel if was public AND not already wildcarded.
  if (isPublic && !list.some((s) => s.username === "*")) {
    list.push({ username: "*", level: "read" });
    changed = true;
  }
  if (
    JSON.stringify(raw.shared_with) !== JSON.stringify(list) ||
    "is_public" in raw
  ) {
    changed = true;
  }
  const next: Record<string, unknown> = { ...raw, shared_with: list };
  // Drop is_public per Grant 2026-05-23 OQ resolution.
  delete next.is_public;
  return { changed, record: next };
}

/** Result of one record-type migration pass. */
interface PassResult {
  scanned: number;
  rewritten: number;
}

async function migrateUserDir(
  username: string,
  dirName: string,
  transform: (record: Record<string, unknown>) => {
    changed: boolean;
    record: Record<string, unknown>;
  },
): Promise<PassResult> {
  const dir = `users/${username}/${dirName}`;
  let files: string[] = [];
  try {
    files = await fileService.listFiles(dir);
  } catch {
    return { scanned: 0, rewritten: 0 };
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  let rewritten = 0;
  for (const fname of jsonFiles) {
    const path = `${dir}/${fname}`;
    try {
      const raw = await fileService.readJson<Record<string, unknown>>(path);
      if (!raw) continue;
      const { changed, record } = transform(raw);
      if (changed) {
        await fileService.writeJson(path, record);
        rewritten += 1;
      }
    } catch (err) {
      console.warn(
        `[migrate-unified] failed to migrate ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { scanned: jsonFiles.length, rewritten };
}

/**
 * Migrate every shareable record under one user's folder. Idempotent:
 * re-running on already-migrated data is a no-op (the per-record
 * transforms detect the unified shape and return changed=false).
 *
 * Per-user metadata (`hide_goals_from_lab`) drives the per-goal
 * migration. Read once, applied to every goal of that user.
 */
export async function migrateUserToUnifiedSharing(
  username: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // Read hide_goals_from_lab once (per-user flag).
  let hideGoalsForUser = false;
  try {
    const entry = await getUserMetadata(username);
    hideGoalsForUser = Boolean(entry?.hide_goals_from_lab);
  } catch {
    // Best-effort: if metadata isn't readable, default to "share with lab"
    // which is the safer no-data-loss default.
  }

  // 1. Tasks (covers Task / Experiment / Workbench List — they're all Tasks).
  {
    const res = await migrateUserDir(username, "tasks", (raw) => {
      const before = JSON.stringify(raw.shared_with);
      const list = migrateTaskSharedWith(raw.shared_with);
      const after = JSON.stringify(list);
      if (before === after && Array.isArray(raw.shared_with)) {
        // Already unified.
        return { changed: false, record: raw };
      }
      return { changed: true, record: { ...raw, shared_with: list } };
    });
    counts.tasks = res.rewritten;
  }

  // 2. Projects.
  {
    const res = await migrateUserDir(username, "projects", (raw) => {
      const before = JSON.stringify(raw.shared_with);
      const list = normalizeArray(raw.shared_with);
      const after = JSON.stringify(list);
      if (before === after && Array.isArray(raw.shared_with)) {
        return { changed: false, record: raw };
      }
      return { changed: true, record: { ...raw, shared_with: list } };
    });
    counts.projects = res.rewritten;
  }

  // 3. Methods (rename + is_public drop).
  {
    const res = await migrateUserDir(username, "methods", (raw) =>
      migrateMethodLikeRecord(raw),
    );
    counts.methods = res.rewritten;
  }

  // 4. MassSpec protocols (same as methods).
  {
    const res = await migrateUserDir(username, "mass_spec_methods", (raw) =>
      migrateMethodLikeRecord(raw),
    );
    counts.mass_spec_methods = res.rewritten;
  }

  // 5. Notes (drop is_shared, normalize to shared_with).
  {
    const res = await migrateUserDir(username, "notes", (raw) => {
      let list = normalizeArray(raw.shared_with);
      const wasShared = raw.is_shared === true;
      let changed = false;
      if (wasShared && !list.some((s) => s.username === "*")) {
        list = [...list, { username: "*", level: "read" }];
        changed = true;
      }
      // Drop is_shared field even if false (clean drop).
      if ("is_shared" in raw) changed = true;
      if (!Array.isArray(raw.shared_with)) changed = true;
      const next: Record<string, unknown> = { ...raw, shared_with: list };
      delete next.is_shared;
      return { changed, record: next };
    });
    counts.notes = res.rewritten;
  }

  // 6. High-level goals — honor per-user hide_goals_from_lab once.
  {
    const res = await migrateUserDir(username, "goals", (raw) => {
      if (Array.isArray(raw.shared_with)) {
        // Already migrated.
        return { changed: false, record: raw };
      }
      const list: SharedUser[] = hideGoalsForUser
        ? []
        : [{ username: "*", level: "read" }];
      return {
        changed: true,
        record: { ...raw, owner: raw.owner ?? username, shared_with: list },
      };
    });
    counts.goals = res.rewritten;
  }

  // 7. Purchase items — no sharing today, just add the empty array.
  {
    const res = await migrateUserDir(username, "purchase_items", (raw) => {
      if (Array.isArray(raw.shared_with)) {
        return { changed: false, record: raw };
      }
      return {
        changed: true,
        record: { ...raw, shared_with: [] },
      };
    });
    counts.purchase_items = res.rewritten;
  }

  await writeMarker(username, counts);
  return counts;
}

/**
 * Migrate the lab-scoped lab_links.json store. Today every lab link is
 * lab-wide writable, so every existing link gets
 * `shared_with: [{ username: "*", level: "edit" }]` as its initial value.
 */
export async function migrateLabLinksToUnified(): Promise<number> {
  const dir = `lab_links`;
  let files: string[] = [];
  try {
    files = await fileService.listFiles(dir);
  } catch {
    return 0;
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  let rewritten = 0;
  for (const fname of jsonFiles) {
    const path = `${dir}/${fname}`;
    try {
      const raw = await fileService.readJson<Record<string, unknown>>(path);
      if (!raw) continue;
      if (Array.isArray(raw.shared_with)) continue; // already migrated
      const next: Record<string, unknown> = {
        ...raw,
        owner: raw.owner ?? "lab",
        shared_with: [{ username: "*", level: "edit" }],
      };
      await fileService.writeJson(path, next);
      rewritten += 1;
    } catch (err) {
      console.warn(
        `[migrate-unified] failed to migrate lab link ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return rewritten;
}

/**
 * Top-level entry point: migrate the current user only. Cheap to call on
 * every app boot — the marker file short-circuits when already at the
 * current SHARING_MIGRATION_VERSION.
 *
 * To FORCE re-migration (e.g. when bumping the version), bump
 * `SHARING_MIGRATION_VERSION` and the marker check will fail.
 */
export async function ensureSharingMigrated(username: string): Promise<void> {
  if (!username) return;
  try {
    const marker = await readMarker(username);
    if (marker && marker.version === SHARING_MIGRATION_VERSION) return;
  } catch {
    // Fall through and run the migration.
  }
  try {
    const counts = await migrateUserToUnifiedSharing(username);
    console.log(
      `[ensureSharingMigrated] migrated unified sharing for ${username}:`,
      counts,
    );
  } catch (err) {
    console.warn(
      `[ensureSharingMigrated] migration failed for ${username}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Force the per-user `hide_goals_from_lab` flag to false. Called after
 * the goal migration completes — the per-user value is now redundant
 * because per-goal `shared_with` is the new source of truth. Setting
 * it to false (rather than truly deleting the field) is the safe way
 * to "drop" it within the existing metadata schema: the goal
 * migration already encoded the user's intent into each goal's
 * `shared_with`, so flipping the per-user flag has no behavioral
 * effect either way going forward.
 */
export async function dropHideGoalsFromLabFlag(username: string): Promise<void> {
  try {
    await setUserMetadataField(username, "hide_goals_from_lab", false);
  } catch {
    // Field is best-effort cleanup; failure here doesn't matter.
  }
}

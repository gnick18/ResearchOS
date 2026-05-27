/**
 * User-rename propagation walker (orchestrator manager, 2026-05-27).
 *
 * Background:
 *   usersApi.rename() moves users/<oldName>/ → users/<newName>/, migrates the
 *   _user_metadata.json entry, fixes the per-folder Main pin, and refreshes
 *   currentUser. It did NOT, however, walk the JSON sidecars to update
 *   user-bearing fields embedded inside the records themselves.
 *
 *   The load-bearing symptom: taskResultsBase(task) interpolates `task.owner`
 *   into the storage path. A renamed user's tasks kept the old owner stamp,
 *   so the experiment popup tried to read notes.md / results.md at
 *   users/<oldName>/results/task-N/* (no such directory after rename) and
 *   surfaced an empty editor while the file sat right there at
 *   users/<newName>/results/task-N/*.
 *
 *   Same drift applies to shared_with entries on OTHER users' records that
 *   reference the renamed user, and to created_by stamps on public-namespace
 *   methods/protocols the renamed user authored.
 *
 * Scope:
 *   This module rewrites every user-bearing field on every entity JSON in:
 *     1. Own directory  : users/<newName>/<entity>/*.json
 *        - owner (Project, Task, Method, HighLevelGoal, LabLink, MassSpec)
 *        - username (Note)
 *        - assignee (Task)
 *        - flagged.by (Task, Note, PurchaseItem)
 *        - approved_by / declined_by (PurchaseItem)
 *        - external_project.owner (Task)
 *        - method_attachments[].owner (Task, when value === oldName)
 *        - comments[].author (Task, Note)
 *        - comments[].mentions[] entries (Task, Note)
 *        - shared_with[].username entries (Project, Task, Note, Method,
 *          HighLevelGoal, LabLink, MassSpec)
 *
 *     2. Other users' directories : users/<otherUser>/<entity>/*.json
 *        - shared_with[].username entries (where username === oldName)
 *        - assignee (PI flow)
 *        - flagged.by
 *        - approved_by / declined_by
 *        - external_project.owner (when a foreign task is hosted in a
 *          project owned by the renamed user, the hosting task's
 *          external_project.owner needs to flip)
 *        - method_attachments[].owner (when the attached method belongs to
 *          the renamed user)
 *        - comments[].author / mentions[]
 *
 *     3. Public namespace : users/public/<entity>/*.json
 *        - created_by (Method, PCRProtocol, LCGradient, Plate,
 *          CellCultureSchedule, CodingWorkflow, QPCRAnalysis, MassSpec)
 *
 * Out of scope (preserved as-is for historical accuracy):
 *   - audit_log entries
 *   - _history/ records
 *   - _notifications.json, _shifted-alerts.json (transient feed sidecars
 *     stamped at event time; treated as historical for the same reason
 *     audit_log is)
 *   - _streak.json, _sharing_migration.json (per-user state already moved
 *     with the directory rename)
 *
 * Idempotent: re-running on a folder already at the new name is a no-op
 * (nothing matches oldName anymore). Per-entity write failures are logged
 * and skipped; one bad file does not abort the rename transaction.
 */

import { fileService } from "../file-system/file-service";

/** Entity directory names that live inside each user's folder. Order is
 *  irrelevant; we just iterate them. Add new entity types here as the
 *  schema grows. Sidecar JSONs that are NOT per-entity (e.g. _counters.json)
 *  start with an underscore and are filtered out at the listing layer. */
const USER_SCOPED_ENTITY_DIRS = [
  "projects",
  "tasks",
  "dependencies",
  "methods",
  "events",
  "goals",
  "pcr_protocols",
  "lc_gradients",
  "plate_layouts",
  "cell_culture_schedules",
  "mass_spec_methods",
  "coding_workflows",
  "qpcr_analyses",
  "purchase_items",
  "item_catalog",
  "lab_links",
  "notes",
] as const;

/** Public entity directories. Records here carry `created_by` (the
 *  authoring user) but no `owner` (they're whole-lab by definition). */
const PUBLIC_ENTITY_DIRS = [
  "methods",
  "pcr_protocols",
  "lc_gradients",
  "plate_layouts",
  "cell_culture_schedules",
  "mass_spec_methods",
  "coding_workflows",
  "qpcr_analyses",
] as const;

/** Directory names under users/ that are NOT individual users. Mirrors the
 *  skip set in user-discovery.ts and usersApi.list. */
const NON_USER_DIRS = new Set([
  "public",
  "lab",
  "_no_user_",
]);

interface PropagationCounts {
  updated: number;
  byEntity: Record<string, number>;
}

interface PropagationResult {
  own: PropagationCounts;
  others: PropagationCounts;
  publicNs: PropagationCounts;
}

function emptyCounts(): PropagationCounts {
  return { updated: 0, byEntity: {} };
}

function bump(counts: PropagationCounts, entity: string): void {
  counts.updated += 1;
  counts.byEntity[entity] = (counts.byEntity[entity] ?? 0) + 1;
}

/** Rewrite every user-bearing field on `record` from oldName → newName.
 *  Returns true if anything changed (caller decides whether to write back).
 *  Idempotent: a record whose fields don't match oldName comes back
 *  unchanged and the function returns false. */
export function rewriteUserFields(
  record: Record<string, unknown>,
  oldName: string,
  newName: string,
): boolean {
  let changed = false;

  const replaceStringField = (key: string): void => {
    const value = record[key];
    if (typeof value === "string" && value === oldName) {
      record[key] = newName;
      changed = true;
    }
  };

  // Direct username-bearing string fields. Skip if the key is missing or
  // null/undefined — we never add a field that wasn't there.
  for (const key of [
    "owner",
    "username",
    "created_by",
    "assignee",
    "approved_by",
    "declined_by",
  ]) {
    replaceStringField(key);
  }

  // flagged.by (PiFlag on Task / Note / PurchaseItem)
  const flagged = record.flagged;
  if (flagged && typeof flagged === "object") {
    const flaggedRec = flagged as Record<string, unknown>;
    if (typeof flaggedRec.by === "string" && flaggedRec.by === oldName) {
      flaggedRec.by = newName;
      changed = true;
    }
  }

  // external_project.owner (Task ExternalProjectRef)
  const ext = record.external_project;
  if (ext && typeof ext === "object") {
    const extRec = ext as Record<string, unknown>;
    if (typeof extRec.owner === "string" && extRec.owner === oldName) {
      extRec.owner = newName;
      changed = true;
    }
  }

  // method_attachments[].owner (Task — entries with owner === null point at
  // the task's own user and are left untouched on purpose; only explicit
  // owner strings get rewritten).
  const attachments = record.method_attachments;
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att && typeof att === "object") {
        const attRec = att as Record<string, unknown>;
        if (typeof attRec.owner === "string" && attRec.owner === oldName) {
          attRec.owner = newName;
          changed = true;
        }
      }
    }
  }

  // shared_with[].username (Project, Task, Note, Method, HighLevelGoal,
  // LabLink, MassSpec). Whole-lab sentinel "*" is preserved.
  const sharedWith = record.shared_with;
  if (Array.isArray(sharedWith)) {
    for (const entry of sharedWith) {
      if (entry && typeof entry === "object") {
        const entryRec = entry as Record<string, unknown>;
        if (
          typeof entryRec.username === "string" &&
          entryRec.username === oldName
        ) {
          entryRec.username = newName;
          changed = true;
        }
      }
    }
  }

  // comments[].author + comments[].mentions[] (Task, Note)
  const comments = record.comments;
  if (Array.isArray(comments)) {
    for (const comment of comments) {
      if (comment && typeof comment === "object") {
        const commentRec = comment as Record<string, unknown>;
        if (
          typeof commentRec.author === "string" &&
          commentRec.author === oldName
        ) {
          commentRec.author = newName;
          changed = true;
        }
        const mentions = commentRec.mentions;
        if (Array.isArray(mentions)) {
          for (let i = 0; i < mentions.length; i++) {
            if (mentions[i] === oldName) {
              mentions[i] = newName;
              changed = true;
            }
          }
        }
      }
    }
  }

  return changed;
}

/** Walk every JSON file directly under `dirPath` and rewrite user-bearing
 *  fields oldName → newName. Bumps `counts` with the entity name once per
 *  modified file. Per-file errors are logged and skipped. */
async function walkEntityDir(
  dirPath: string,
  entityName: string,
  oldName: string,
  newName: string,
  counts: PropagationCounts,
): Promise<void> {
  let fileNames: string[];
  try {
    fileNames = await fileService.listFiles(dirPath);
  } catch (err) {
    console.warn(
      `[propagateOwnerRename] listFiles failed for ${dirPath}, skipping`,
      err,
    );
    return;
  }

  for (const name of fileNames) {
    if (!name.endsWith(".json")) continue;
    // Skip hidden/sidecar files (e.g. _hosted.json manifests live alongside
    // entity files in projects/; they're per-project but not per-entity).
    // Per-entity files are numeric-id-named (`1.json`, `42.json`); anything
    // starting with an underscore is a sidecar.
    if (name.startsWith("_")) continue;

    const filePath = `${dirPath}/${name}`;
    let record: Record<string, unknown> | null = null;
    try {
      record = await fileService.readJson<Record<string, unknown>>(filePath);
    } catch (err) {
      console.warn(
        `[propagateOwnerRename] readJson failed for ${filePath}, skipping`,
        err,
      );
      continue;
    }
    if (!record || typeof record !== "object") continue;

    const mutated = rewriteUserFields(record, oldName, newName);
    if (!mutated) continue;

    try {
      await fileService.writeJson(filePath, record);
      bump(counts, entityName);
    } catch (err) {
      console.warn(
        `[propagateOwnerRename] writeJson failed for ${filePath}, skipping`,
        err,
      );
    }
  }
}

/** Walk every entity directory inside `users/<userDir>/` and rewrite
 *  user-bearing fields oldName → newName. `counts` accumulates the result. */
async function walkUserDir(
  userDir: string,
  oldName: string,
  newName: string,
  counts: PropagationCounts,
): Promise<void> {
  for (const entity of USER_SCOPED_ENTITY_DIRS) {
    const dirPath = `users/${userDir}/${entity}`;
    await walkEntityDir(dirPath, entity, oldName, newName, counts);
  }
  // Project hosted manifests live alongside projects/<id>.json as a sidecar
  // <id>-hosted.json. The hosted entries carry `owner` (the foreign task's
  // owner) and `sharedBy` — both string usernames that may reference the
  // renamed user. Walked separately because they're not numeric-id-named.
  await walkProjectHostedManifests(userDir, oldName, newName, counts);
}

/** Project hosted-manifest sidecars (users/<u>/projects/<id>-hosted.json).
 *  Shape: { version: 1, hostedTasks: ProjectHostedTaskEntry[] } where each
 *  entry has { owner, taskId, sharedAt, sharedBy }. Rewrites owner and
 *  sharedBy when they match oldName. */
async function walkProjectHostedManifests(
  userDir: string,
  oldName: string,
  newName: string,
  counts: PropagationCounts,
): Promise<void> {
  const dirPath = `users/${userDir}/projects`;
  let fileNames: string[];
  try {
    fileNames = await fileService.listFiles(dirPath);
  } catch {
    return;
  }
  for (const name of fileNames) {
    if (!name.endsWith("-hosted.json")) continue;
    const filePath = `${dirPath}/${name}`;
    let record: { version?: number; hostedTasks?: unknown[] } | null = null;
    try {
      record = await fileService.readJson(filePath);
    } catch (err) {
      console.warn(
        `[propagateOwnerRename] readJson failed for ${filePath}, skipping`,
        err,
      );
      continue;
    }
    if (!record || !Array.isArray(record.hostedTasks)) continue;
    let changed = false;
    for (const entry of record.hostedTasks) {
      if (!entry || typeof entry !== "object") continue;
      const entryRec = entry as Record<string, unknown>;
      if (typeof entryRec.owner === "string" && entryRec.owner === oldName) {
        entryRec.owner = newName;
        changed = true;
      }
      if (
        typeof entryRec.sharedBy === "string" &&
        entryRec.sharedBy === oldName
      ) {
        entryRec.sharedBy = newName;
        changed = true;
      }
    }
    if (!changed) continue;
    try {
      await fileService.writeJson(filePath, record);
      bump(counts, "projects-hosted");
    } catch (err) {
      console.warn(
        `[propagateOwnerRename] writeJson failed for ${filePath}, skipping`,
        err,
      );
    }
  }
}

/** Walk every public-namespace entity directory and rewrite user-bearing
 *  fields oldName → newName. `created_by` is the main target here; public
 *  records also carry `shared_with: [{ username: "*", ... }]` so we still
 *  run the full rewrite (the "*" sentinel is preserved). */
async function walkPublicDir(
  oldName: string,
  newName: string,
  counts: PropagationCounts,
): Promise<void> {
  for (const entity of PUBLIC_ENTITY_DIRS) {
    const dirPath = `users/public/${entity}`;
    await walkEntityDir(dirPath, entity, oldName, newName, counts);
  }
}

/**
 * Propagate a username rename across every entity JSON on disk.
 *
 * Call after the directory rename (users/<old>/ → users/<new>/) and metadata
 * entry migration have succeeded. Best-effort: per-file errors are logged
 * and skipped, so a single corrupted JSON cannot abort the broader rename
 * transaction.
 *
 * Returns a summary `{ own, others, publicNs }` for the caller to log /
 * surface in tests. The orchestrator log line at the call site combines all
 * three into a single "user-rename propagation: updated N entities" entry.
 */
export async function propagateOwnerRename(
  oldName: string,
  newName: string,
): Promise<PropagationResult> {
  const result: PropagationResult = {
    own: emptyCounts(),
    others: emptyCounts(),
    publicNs: emptyCounts(),
  };

  if (!oldName || !newName || oldName === newName) {
    return result;
  }

  let userDirs: string[];
  try {
    userDirs = await fileService.listDirectories("users");
  } catch (err) {
    console.warn(
      "[propagateOwnerRename] listDirectories('users') failed; aborting walk",
      err,
    );
    return result;
  }

  for (const dirName of userDirs) {
    if (NON_USER_DIRS.has(dirName)) continue;
    // The renamed user's own directory: walk + bump `own`. Every other
    // user directory: walk + bump `others` (the rewriter only touches
    // shared_with entries / mentions / comments by oldName in that case
    // because the entity owner/username field will not match).
    const counts = dirName === newName ? result.own : result.others;
    await walkUserDir(dirName, oldName, newName, counts);
  }

  await walkPublicDir(oldName, newName, result.publicNs);

  const total =
    result.own.updated + result.others.updated + result.publicNs.updated;
  const breakdown = [
    ...Object.entries(result.own.byEntity).map(
      ([k, v]) => `own/${k}:${v}`,
    ),
    ...Object.entries(result.others.byEntity).map(
      ([k, v]) => `others/${k}:${v}`,
    ),
    ...Object.entries(result.publicNs.byEntity).map(
      ([k, v]) => `public/${k}:${v}`,
    ),
  ].join(", ");
  console.log(
    `[propagateOwnerRename] '${oldName}' → '${newName}': updated ${total} entities${
      breakdown ? ` (${breakdown})` : ""
    }`,
  );

  return result;
}

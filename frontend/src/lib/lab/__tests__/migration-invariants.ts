// Universal invariant checker for the Phase 7a multiuser -> solo migration.
//
// Both verification suites (the synthetic CI matrix and the real-fixture
// harness) call snapshotFolder() before the migration and checkMigrationInvariants()
// after, so the guarantees are defined ONCE and cannot drift between suites.
//
// This is test-support code (node:fs), never imported by the app bundle.
//
// The guarantees, in plain terms:
//   I1 SOLO RESULT      exactly the primary remains under users/.
//   I2 NO DATA LOSS     every moved user's tree is byte-identical in BOTH their
//                       bundle and trash (binary files included); the original
//                       is gone from users/.
//   I3 PRIMARY CONTENT  every retained primary file is byte-identical EXCEPT
//                       files the executor reported stripping; and within those,
//                       a deep diff proves only whitelisted share/prune fields
//                       changed and surviving array entries are byte-identical
//                       (the strip only REMOVES, never mutates content).
//   I4 NO DANGLING      zero share-semantic references to a moved user remain
//                       anywhere in the primary tree (deep recursive scan).
//   I5 VALID JSON       every rewritten file still parses.
//   I6 PI RESET         a lab_head primary is clamped to member.
//   I7 NO STRAY WRITES  the executor created no unexpected files under the primary.
//
// No emojis, no em-dashes, no mid-sentence colons.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import type { MigrationPlan } from "../migrate-to-solo";
import type { MigrationExecResult } from "../migrate-to-solo-executor";
import {
  SHARE_ARRAY_FIELDS,
  SCALAR_OWNER_FIELDS,
  SHARED_WITH_ME_ARRAYS,
  NOTIFICATION_OWNER_FIELDS,
  NOTIFICATIONS_ARRAY_FIELD,
  classifyFile,
  isMovedUser,
  isWildcard,
  resolveUsername,
} from "../migration-ref-policy";

// discoverUsers()'s SKIP_DIRECTORIES + the "_"-prefix marker convention.
const SKIP = new Set(["public", "lab", "_no_user_"]);

export interface FileHash {
  sha: string;
  size: number;
}

export interface FolderSnapshot {
  users: string[];
  /** Per user: user-internal relpath -> hash. */
  userHashes: Map<string, Map<string, FileHash>>;
  /** Per user: user-internal relpath -> parsed JSON (null if not json/unparseable). */
  userJson: Map<string, Map<string, unknown>>;
  /** Whole-folder root-relative hashes (idempotency / conservation baseline). */
  wholeHashes: Map<string, FileHash>;
  /** Primary settings account_type at snapshot time (or null). */
  primaryAccountType: string | null;
}

// ---------------------------------------------------------------------------
// Low-level fs helpers.
// ---------------------------------------------------------------------------

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Hash every file under dir; keys are relative to `base` (defaults to dir). */
export async function hashTree(dir: string, base = dir): Promise<Map<string, FileHash>> {
  const out = new Map<string, FileHash>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      for (const [k, v] of await hashTree(abs, base)) out.set(k, v);
    } else if (e.isFile()) {
      const buf = await fs.readFile(abs);
      out.set(path.relative(base, abs), {
        sha: crypto.createHash("sha256").update(buf).digest("hex"),
        size: buf.length,
      });
    }
  }
  return out;
}

/**
 * Person directories directly under users/, mirroring discoverUsers():
 * excludes specials (public / lab / _no_user_), "_"-prefixed markers, AND
 * users tombstoned via `deleted_at` in users/_user_metadata.json. An archived
 * user's directory therefore lingers on disk but is invisible (so it does not
 * break the one-user solo derivation), which matches production.
 */
export async function listUsers(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.join(root, "users"), { withFileTypes: true });
  } catch {
    return [];
  }
  let meta: Record<string, { deleted_at?: string }> = {};
  try {
    meta = JSON.parse(await fs.readFile(path.join(root, "users", "_user_metadata.json"), "utf8"));
  } catch {
    /* none */
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !SKIP.has(n) && !n.startsWith("_"))
    .filter((n) => !meta[n]?.deleted_at)
    .sort();
}

/** Parse every .json under a user dir into a user-internal map. */
async function readUserJson(userDir: string, base = userDir): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(userDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(userDir, e.name);
    if (e.isDirectory()) {
      for (const [k, v] of await readUserJson(abs, base)) out.set(k, v);
    } else if (e.name.endsWith(".json")) {
      try {
        out.set(path.relative(base, abs), JSON.parse(await fs.readFile(abs, "utf8")));
      } catch {
        out.set(path.relative(base, abs), null);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// snapshotFolder: capture everything the checker needs BEFORE the migration.
// ---------------------------------------------------------------------------

export async function snapshotFolder(root: string, primary: string): Promise<FolderSnapshot> {
  const users = await listUsers(root);
  const userHashes = new Map<string, Map<string, FileHash>>();
  const userJson = new Map<string, Map<string, unknown>>();
  for (const u of users) {
    const dir = path.join(root, "users", u);
    userHashes.set(u, await hashTree(dir));
    userJson.set(u, await readUserJson(dir));
  }
  const wholeHashes = await hashTree(root);
  let primaryAccountType: string | null = null;
  try {
    const s = JSON.parse(await fs.readFile(path.join(root, "users", primary, "settings.json"), "utf8"));
    if (s && typeof s === "object" && typeof s.account_type === "string") primaryAccountType = s.account_type;
  } catch {
    /* none */
  }
  return { users, userHashes, userJson, wholeHashes, primaryAccountType };
}

// ---------------------------------------------------------------------------
// Value helpers.
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * True if `post` is obtainable from `pre` purely by DELETING elements: every
 * post element appears in pre, in order, byte-for-byte. This proves a strip
 * only removed entries and never mutated a surviving one.
 */
function isValueSubsequence(post: unknown[], pre: unknown[]): boolean {
  if (post.length > pre.length) return false;
  let i = 0;
  for (const p of pre) {
    if (i < post.length && deepEqual(post[i], p)) i++;
  }
  return i === post.length;
}

/** Top-level keys whose value differs (deep) between two objects. */
function changedTopKeys(pre: Record<string, unknown>, post: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (!deepEqual(pre[k], post[k])) changed.push(k);
  }
  return changed;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The top-level keys a given file class is allowed to have changed. */
function allowedChangedKeys(relInternal: string): Set<string> {
  // classifyFile keys off the basename; pass a fake leading path is fine.
  const klass = classifyFile("users/x/" + relInternal);
  if (klass === "shared_with_me") return new Set(SHARED_WITH_ME_ARRAYS);
  if (klass === "hosted") return new Set(["hostedTasks"]);
  if (klass === "notifications") return new Set(["notifications"]); // { version, notifications: [...] }
  // record:
  const keys = new Set<string>([...SHARE_ARRAY_FIELDS, ...SCALAR_OWNER_FIELDS, "is_shared", "external_project"]);
  if (relInternal.includes("shared_notebooks/")) keys.add("title"); // 1:1 rename
  return keys;
}

// ---------------------------------------------------------------------------
// Dangling-reference scan, FILE-AWARE so it mirrors the executor's strip scope
// exactly. It flags only genuine dangling pointers (active share grants, the
// record's own owner, external_project, and the three sidecars' entry owners),
// NOT nested attribution like method_attachments[].owner / comment authors,
// which gray-degrade to an archived user and are intentionally kept.
// ---------------------------------------------------------------------------

function danglingInFile(rel: string, val: unknown, moved: Set<string>, out: string[]): void {
  switch (classifyFile(rel)) {
    case "notifications": {
      const list = isPlainObject(val) && Array.isArray(val[NOTIFICATIONS_ARRAY_FIELD])
        ? (val[NOTIFICATIONS_ARRAY_FIELD] as unknown[])
        : Array.isArray(val)
          ? val
          : [];
      for (const e of list) {
        if (!isPlainObject(e)) continue;
        for (const f of NOTIFICATION_OWNER_FIELDS) {
          if (typeof e[f] === "string" && moved.has(e[f] as string)) out.push(`${rel} :: notifications[].${f}=${e[f]}`);
        }
      }
      return;
    }
    case "shared_with_me": {
      if (!isPlainObject(val)) return;
      for (const arr of SHARED_WITH_ME_ARRAYS) {
        if (Array.isArray(val[arr])) {
          for (const e of val[arr] as unknown[]) {
            if (isPlainObject(e) && typeof e.owner === "string" && moved.has(e.owner)) out.push(`${rel} :: ${arr}[].owner=${e.owner}`);
          }
        }
      }
      return;
    }
    case "hosted": {
      if (!isPlainObject(val) || !Array.isArray(val.hostedTasks)) return;
      for (const e of val.hostedTasks as unknown[]) {
        if (!isPlainObject(e)) continue;
        if (typeof e.owner === "string" && moved.has(e.owner)) out.push(`${rel} :: hostedTasks[].owner=${e.owner}`);
        if (typeof e.sharedBy === "string" && moved.has(e.sharedBy)) out.push(`${rel} :: hostedTasks[].sharedBy=${e.sharedBy}`);
      }
      return;
    }
    default: {
      // A normal record: active grants + the record's OWN top-level owner +
      // external_project. Nested attribution is intentionally not flagged.
      if (!isPlainObject(val)) return;
      for (const f of SHARE_ARRAY_FIELDS) {
        if (Array.isArray(val[f])) {
          for (const e of val[f] as unknown[]) {
            if (isWildcard(e)) out.push(`${rel} :: ${f}[]="*"`);
            else if (isMovedUser(e, moved)) out.push(`${rel} :: ${f}[]=${resolveUsername(e)}`);
          }
        }
      }
      for (const f of SCALAR_OWNER_FIELDS) {
        if (typeof val[f] === "string" && moved.has(val[f] as string)) out.push(`${rel} :: ${f}=${val[f]}`);
      }
      const ext = val.external_project;
      if (isPlainObject(ext) && typeof ext.owner === "string" && moved.has(ext.owner)) out.push(`${rel} :: external_project.owner=${ext.owner}`);
    }
  }
}

// ---------------------------------------------------------------------------
// checkMigrationInvariants
// ---------------------------------------------------------------------------

export interface InvariantResult {
  violations: string[];
  stats: {
    movedUsers: number;
    primaryFilesChanged: number;
    primaryFilesTotal: number;
    danglingRefs: number;
    bundledFilesVerified: number;
  };
}

export async function checkMigrationInvariants(
  root: string,
  pre: FolderSnapshot,
  plan: MigrationPlan,
  result: MigrationExecResult,
  opts: { primary: string },
): Promise<InvariantResult> {
  const primary = opts.primary;
  const moved = new Set(plan.usersToMove.map((u) => u.username));
  const v: string[] = [];
  let bundledFilesVerified = 0;

  // I1 SOLO RESULT.
  const usersAfter = await listUsers(root);
  if (!(usersAfter.length === 1 && usersAfter[0] === primary)) {
    v.push(`I1 solo result: users after = [${usersAfter.join(", ")}], expected [${primary}]`);
  }

  // I2 NO DATA LOSS (per moved user: bundle + trash byte-identical, original gone).
  for (const u of moved) {
    const orig = pre.userHashes.get(u) ?? new Map<string, FileHash>();
    const bundle = await hashTree(path.join(root, "_migration_bundles", u, "users", u));
    const trash = await hashTree(path.join(root, "_trash", "migrated_users", u));
    for (const [rel, h] of orig) {
      const b = bundle.get(rel);
      if (!b) v.push(`I2 ${u}: missing from bundle: ${rel}`);
      else if (b.sha !== h.sha) v.push(`I2 ${u}: corrupted in bundle: ${rel}`);
      else bundledFilesVerified++;
      const t = trash.get(rel);
      if (!t || t.sha !== h.sha) v.push(`I2 ${u}: trash not byte-equal: ${rel}`);
    }
    if (bundle.size !== orig.size) v.push(`I2 ${u}: bundle file count ${bundle.size} != original ${orig.size}`);
    if (await pathExists(path.join(root, "users", u))) v.push(`I2 ${u}: still present under users/`);
  }

  // I3 PRIMARY CONTENT (byte-identical except reported strips; deep-diff proves
  // only whitelisted fields changed and surviving entries are untouched).
  const strippedSet = new Set(
    result.sharesStripped.map((s) => {
      const pfx = `users/${primary}/`;
      return s.file.startsWith(pfx) ? s.file.slice(pfx.length) : s.file;
    }),
  );
  const prePrimary = pre.userHashes.get(primary) ?? new Map<string, FileHash>();
  const preJson = pre.userJson.get(primary) ?? new Map<string, unknown>();
  const postPrimary = await hashTree(path.join(root, "users", primary));
  const postJson = await readUserJson(path.join(root, "users", primary));
  let changedCount = 0;

  for (const [rel, h] of prePrimary) {
    const post = postPrimary.get(rel);
    if (!post) {
      v.push(`I3 primary file lost: ${rel}`);
      continue;
    }
    if (post.sha === h.sha) continue; // unchanged
    changedCount++;
    // Only json files may change, and only if reported stripped OR the
    // settings.json lab_head -> member reset (handled separately, not a strip).
    if (!rel.endsWith(".json")) {
      v.push(`I3 non-json primary file changed (must be byte-stable): ${rel}`);
      continue;
    }
    const isSettingsReset = rel === "settings.json" && pre.primaryAccountType === "lab_head";
    if (!strippedSet.has(rel) && !isSettingsReset) {
      v.push(`I3 primary file changed but NOT reported in sharesStripped: ${rel}`);
    }
    const preVal = preJson.get(rel);
    const postVal = postJson.get(rel);
    if (postVal === null) {
      v.push(`I3 rewritten file no longer valid JSON: ${rel}`);
      continue;
    }
    if (isSettingsReset && isPlainObject(preVal) && isPlainObject(postVal)) {
      // The ONLY change permitted in the reset is account_type: lab_head -> member.
      const changed = changedTopKeys(preVal, postVal);
      const bad = changed.filter((k) => k !== "account_type");
      if (bad.length) v.push(`I3 settings.json reset changed extra keys: ${bad.join(", ")}`);
      if (postVal.account_type !== "member") v.push(`I3 settings.json account_type not member: ${String(postVal.account_type)}`);
      continue;
    }
    // Array-rooted (e.g. _notifications.json): only removals allowed.
    if (Array.isArray(preVal) && Array.isArray(postVal)) {
      if (!isValueSubsequence(postVal, preVal)) {
        v.push(`I3 array-root file mutated surviving entries (not pure removal): ${rel}`);
      }
      continue;
    }
    if (isPlainObject(preVal) && isPlainObject(postVal)) {
      const changed = changedTopKeys(preVal, postVal);
      const allowed = allowedChangedKeys(rel);
      for (const k of changed) {
        if (!allowed.has(k)) {
          v.push(`I3 ${rel}: disallowed key changed: "${k}" (content corruption risk)`);
          continue;
        }
        // For array fields, surviving entries must be byte-identical (only removals).
        if (Array.isArray(preVal[k]) && Array.isArray(postVal[k])) {
          if (!isValueSubsequence(postVal[k] as unknown[], preVal[k] as unknown[])) {
            v.push(`I3 ${rel}: field "${k}" mutated surviving entries (not pure removal)`);
          }
        }
      }
      continue;
    }
    v.push(`I3 ${rel}: shape changed unexpectedly (object<->array<->scalar)`);
  }
  // I7 NO STRAY WRITES: no NEW files appeared under the primary.
  for (const rel of postPrimary.keys()) {
    if (!prePrimary.has(rel)) v.push(`I7 stray new file under primary: ${rel}`);
  }

  // I4 NO DANGLING refs in the primary tree (file-aware, mirrors strip scope).
  const dangling: string[] = [];
  for (const [rel, val] of postJson) {
    if (val === null) continue;
    danglingInFile(`users/${primary}/${rel}`, val, moved, dangling);
  }
  for (const d of dangling) v.push(`I4 dangling ref: ${d}`);

  // I6 PI RESET.
  if (pre.primaryAccountType === "lab_head") {
    try {
      const s = JSON.parse(await fs.readFile(path.join(root, "users", primary, "settings.json"), "utf8"));
      if (s?.account_type !== "member") {
        v.push(`I6 PI reset: account_type is "${s?.account_type}", expected "member"`);
      }
    } catch {
      v.push(`I6 PI reset: settings.json unreadable after migration`);
    }
  }

  return {
    violations: v,
    stats: {
      movedUsers: moved.size,
      primaryFilesChanged: changedCount,
      primaryFilesTotal: prePrimary.size,
      danglingRefs: dangling.length,
      bundledFilesVerified,
    },
  };
}

/** Whole-folder hash for idempotency comparison (root-relative). */
export async function wholeFolderHash(root: string): Promise<Map<string, FileHash>> {
  return hashTree(root);
}

/** Compare two whole-folder hashes; returns drifted relpaths (empty == identical). */
export function diffWholeHash(before: Map<string, FileHash>, after: Map<string, FileHash>): string[] {
  const drift: string[] = [];
  for (const [rel, h] of after) {
    const b = before.get(rel);
    if (!b || b.sha !== h.sha) drift.push(rel);
  }
  for (const rel of before.keys()) if (!after.has(rel)) drift.push(`-${rel}`);
  return drift;
}

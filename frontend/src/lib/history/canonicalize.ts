// Version Control Phase 0: deterministic canonical serialization of a record.
//
// The delta store diffs the TRACKED state of a record. Two records that are
// semantically identical must serialize to the SAME string regardless of:
//   1. key insertion order (object keys are sorted recursively), and
//   2. volatile per-save stamps (excluded via the denylist below).
//
// Why a denylist, not an allowlist: records gain fields over time (new entity
// versions, additive sidecar fields). An allowlist would silently drop a new
// field from history the moment it ships. A denylist tracks "everything minus
// the known-noisy stamps", so new real content is captured automatically and
// only the noise is filtered.

/**
 * Volatile-stamp denylist. These fields change on (nearly) every save and
 * would pollute every delta with a meaningless one-line churn. They are
 * stamped onto the history ROW (actor / owner / ts) from save context, NOT
 * diffed, so dropping them from the tracked state loses no information.
 *
 * Categories:
 *   - write-time stamps: updated_at, last_edited_at, last_edited_by
 *   - derived / index / hash fields: anything ending in `_hash`, plus the
 *     handful of known derived caches below.
 *
 * `last_edited_by` is the ACTOR, captured on the row. `owner` is also captured
 * on the row, but we intentionally do NOT denylist `owner`: an owner change
 * (record handed to another user) is a real, auditable content change and
 * should appear in the diff.
 */
const VOLATILE_STAMP_DENYLIST = new Set<string>([
  "updated_at",
  "last_edited_at",
  "last_edited_by",
  // Derived / transient caches that some entity types carry. These are
  // recomputed on read and must not pollute diffs.
  "_dirty",
  "_local_only",
]);

/**
 * Suffixes that mark a field as derived / index / hash. Any top-level or
 * nested key ending in one of these is dropped from the tracked state.
 */
const VOLATILE_SUFFIXES = ["_hash", "_index", "_cache"];

function isVolatileKey(key: string): boolean {
  if (VOLATILE_STAMP_DENYLIST.has(key)) return true;
  for (const suffix of VOLATILE_SUFFIXES) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Recursively strip volatile keys and produce a value with deterministic
 * key ordering. Arrays preserve order (order is content). Plain objects get
 * their keys sorted. Primitives pass through.
 *
 * `undefined` values are dropped (JSON.stringify would drop them anyway, but
 * we drop them eagerly so the recursive sort is stable).
 */
function stripAndSort(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripAndSort(item));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(obj)
    .filter((k) => !isVolatileKey(k))
    .filter((k) => obj[k] !== undefined)
    .sort();
  for (const key of keys) {
    out[key] = stripAndSort(obj[key]);
  }
  return out;
}

/**
 * Deterministic JSON serialization of the TRACKED state of a record.
 *
 * Guarantees:
 *   - Same logical record -> same string regardless of key insertion order.
 *   - Volatile-denylist fields (write stamps, *_hash, derived caches) are
 *     excluded so they never appear in a diff.
 *   - Pretty-printed with a trailing newline so jsdiff produces clean,
 *     human-readable line-oriented unified diffs (one field per line region).
 */
export function canonicalize(record: unknown): string {
  const tracked = stripAndSort(record);
  // Pretty-print: line-per-field output makes the unified diff readable and
  // keeps hunks small (a single-field edit touches a single line).
  return JSON.stringify(tracked, null, 2) + "\n";
}

/** Exposed for tests + documentation of the contract. */
export const __denylistForTests = {
  exact: VOLATILE_STAMP_DENYLIST,
  suffixes: VOLATILE_SUFFIXES,
};

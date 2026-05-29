/**
 * Per-account method-type ENABLE/DISABLE curation (Extension Store Phase U2).
 *
 * The anti-clutter mechanism from plans/METHOD_LIBRARY_DESIGN.md §4.3 and
 * plans/EXTENSION_STORE_DESIGN.md §1.3: a user picks which method types stay
 * available in their new-method picker + template library, hiding the ones
 * they never use. Persisted as the additive, optional `enabledMethodTypes`
 * field on `UserSettings` (per-account, folder-scoped settings.json).
 *
 * THE CONTRACT (load-bearing; every consumer must honor it):
 *
 *  - ABSENT `enabledMethodTypes` => ALL types enabled. Existing users, who
 *    have no such field on disk, therefore see no change. (Default differs
 *    from the doc's "ship a short default set" proposal; see the brief.
 *    Default-all-enabled is the no-regression choice for U2.)
 *  - An EMPTY array is a real "everything off" choice, distinct from absent.
 *  - Enablement gates CREATION + PICKER/STORE-DEFAULT VISIBILITY ONLY. It
 *    must NEVER be consulted by viewer/editor dispatch: an already-created or
 *    shared method of a disabled type still renders. `compound` is never
 *    user-toggleable (it is `hiddenFromPicker` and reached only by extending
 *    an existing method), so it is always treated as enabled by this layer.
 *
 * This module is pure resolution + persistence glue over the settings store;
 * it ships no executable extension code.
 */

import {
  METHOD_TYPE_REGISTRY,
  type MethodTypeId,
  type MethodTypeMeta,
} from "./method-type-registry";
import {
  patchUserSettings,
  readUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";

/** Every method type id the build ships, in registry order. */
export function allMethodTypeIds(): MethodTypeId[] {
  return (Object.values(METHOD_TYPE_REGISTRY) as MethodTypeMeta[]).map(
    (m) => m.id,
  );
}

/**
 * The curated short set of method types a BRAND-NEW account starts with
 * (u2-curated-default bot, 2026-05-29). Grant's call: new users land on a
 * tidy picker (Markdown + PDF + PCR), discovering the rest in the store and
 * enabling them on demand via the existing per-type toggle.
 *
 * IMPORTANT scope: this is the value STAMPED into a freshly-created account's
 * `enabledMethodTypes` at creation time ONLY (see `usersApi.create` in
 * local-api.ts). It is NOT part of `DEFAULT_SETTINGS` and does NOT change the
 * resolution contract: an EXISTING account whose settings.json has no
 * `enabledMethodTypes` field still resolves to ALL types enabled (the absent
 * => all rule in `resolveEnabledMethodTypes`). Existing users therefore see
 * zero change; only newly created accounts carry this curated set on disk.
 *
 * `compound` is intentionally absent: it is `hiddenFromPicker` /
 * always-enabled and never persisted into the set (it is implied). The three
 * ids below are verified against `method-type-registry.ts`.
 */
export const CURATED_DEFAULT_METHOD_TYPES: readonly MethodTypeId[] = [
  "markdown",
  "pdf",
  "pcr",
];

/**
 * Types that are NEVER user-toggleable, so they are always treated as
 * enabled regardless of the persisted set. Today only `compound`, which is
 * `hiddenFromPicker` and reached by extending an existing method rather than
 * as a standalone picker choice. Disabling it would be meaningless (it never
 * appears in the picker) and could break the "extend into kit" flow.
 */
const ALWAYS_ENABLED: ReadonlySet<MethodTypeId> = new Set<MethodTypeId>([
  "compound",
]);

function isMethodTypeId(value: unknown): value is MethodTypeId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(METHOD_TYPE_REGISTRY, value)
  );
}

/**
 * Resolve the raw persisted `enabledMethodTypes` into the effective enabled
 * SET of `MethodTypeId`s, applying the absent => all-enabled default and the
 * always-enabled carve-outs. Unknown ids are dropped.
 *
 * Pure + synchronous so the picker / store / tests can call it on a settings
 * snapshot without async I/O.
 */
export function resolveEnabledMethodTypes(
  raw: string[] | null | undefined,
): Set<MethodTypeId> {
  // Absent (null/undefined) => everything enabled (back-compat default).
  if (raw == null) {
    return new Set<MethodTypeId>(allMethodTypeIds());
  }
  const set = new Set<MethodTypeId>();
  for (const id of raw) {
    if (isMethodTypeId(id)) set.add(id);
  }
  // Always-enabled carve-outs are forced on regardless of the persisted set.
  for (const id of ALWAYS_ENABLED) set.add(id);
  return set;
}

/**
 * Is `id` enabled given the raw persisted set? `compound` (and any future
 * always-enabled type) is always true. Used by creation/picker gates only,
 * NEVER by viewer dispatch.
 */
export function isMethodTypeEnabled(
  id: MethodTypeId,
  raw: string[] | null | undefined,
): boolean {
  if (ALWAYS_ENABLED.has(id)) return true;
  return resolveEnabledMethodTypes(raw).has(id);
}

/**
 * Filter a list of cosmetic metas (e.g. a picker category) down to the
 * enabled types. Convenience for the picker, which already works in
 * `MethodTypeMeta[]`.
 */
export function filterEnabledMetas(
  metas: MethodTypeMeta[],
  raw: string[] | null | undefined,
): MethodTypeMeta[] {
  const enabled = resolveEnabledMethodTypes(raw);
  return metas.filter((m) => enabled.has(m.id));
}

/**
 * Compute the next `enabledMethodTypes` array after toggling one type, given
 * the CURRENT raw persisted value. Returns a concrete array (never absent) so
 * the result is unambiguous on disk:
 *
 *  - Toggling off when the field was absent materializes "all types except
 *    this one" (the user's first explicit curation choice).
 *  - Toggling on a previously-disabled type adds it back.
 *  - `compound` (always-enabled) is never written into the set and a request
 *    to toggle it is a no-op echo of the current value.
 *
 * The returned array preserves registry order for a stable on-disk shape.
 */
export function toggleMethodTypeEnabled(
  id: MethodTypeId,
  enabled: boolean,
  raw: string[] | null | undefined,
): string[] {
  // Never persist an always-enabled type; it is implied. Return the
  // current materialized set unchanged so callers can no-op cleanly.
  const current = resolveEnabledMethodTypes(raw);
  if (ALWAYS_ENABLED.has(id)) {
    return materialize(current);
  }
  if (enabled) {
    current.add(id);
  } else {
    current.delete(id);
  }
  return materialize(current);
}

/** Serialize an enabled set to a registry-ordered array, dropping the
 *  always-enabled carve-outs (they are implied, never persisted). */
function materialize(set: Set<MethodTypeId>): string[] {
  return allMethodTypeIds().filter(
    (id) => set.has(id) && !ALWAYS_ENABLED.has(id),
  );
}

// ── Persistence helpers (thin wrappers over the settings store) ──────────────

/** Read the active user's effective enabled set from disk. */
export async function readEnabledMethodTypes(
  username: string,
): Promise<Set<MethodTypeId>> {
  const settings = await readUserSettings(username);
  return resolveEnabledMethodTypes(settings.enabledMethodTypes);
}

/**
 * Persist a single type's enabled/disabled state for the user, returning the
 * updated settings. Reads the current value, computes the next array via
 * `toggleMethodTypeEnabled`, and patches settings.json.
 */
export async function setMethodTypeEnabled(
  username: string,
  id: MethodTypeId,
  enabled: boolean,
): Promise<UserSettings> {
  const current = await readUserSettings(username);
  const next = toggleMethodTypeEnabled(
    id,
    enabled,
    current.enabledMethodTypes,
  );
  return patchUserSettings(username, { enabledMethodTypes: next });
}

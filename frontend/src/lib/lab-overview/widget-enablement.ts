/**
 * Per-account widget ENABLE/DISABLE curation (Extension Store Phase U3).
 *
 * The widget analogue of `frontend/src/lib/methods/method-type-enablement.ts`
 * (plans/EXTENSION_STORE_DESIGN.md §3.5): a user picks which dashboard / home
 * WIDGETS stay available in their "+ Add widget" palette + the Widget store,
 * hiding the ones they never use. Persisted as the additive, optional
 * `enabledWidgets` field on `UserSettings` (per-account, folder-scoped
 * settings.json).
 *
 * THE CONTRACT (load-bearing; every consumer must honor it):
 *
 *  - ABSENT `enabledWidgets` => ALL widgets enabled. Existing users, who have
 *    no such field on disk, therefore see no change. (Default-all-enabled is
 *    the no-regression choice for U3.)
 *  - An EMPTY array is a real "everything off" choice, distinct from absent.
 *  - Enablement gates PALETTE / STORE-DEFAULT OFFERING ONLY, and ONLY ON TOP
 *    OF the existing account-type + surface gating. It NEVER widens
 *    visibility: this layer is an extra `&&` over `visibleCatalog` /
 *    `widgetHasSurface`, never an `||`. A member still never sees a PI-only
 *    widget, enabled or not.
 *  - Enablement must NEVER hide, delete, or break an ALREADY-PLACED widget
 *    instance: a disabled widget already on a saved layout keeps rendering,
 *    it just stops being OFFERED in the Add palette. So enablement is
 *    consulted only by the palette / store-default offering path, never by
 *    the layout reader or the tile/popup render path.
 *
 * Widget ids are matched on the BASE catalog id (`baseWidgetId`) so an
 * auto-created instance id like `single-project#alex:5` resolves to the
 * `single-project` definition's enablement state.
 *
 * This module is pure resolution + persistence glue over the settings store;
 * it ships no executable extension code.
 */

import { WIDGET_CATALOG, baseWidgetId } from "@/components/lab-overview/widgets/registry";
import type { WidgetDefinition } from "@/components/lab-overview/widgets/types";
import {
  readUserSettings,
  updateUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";

/** Every widget id the build ships, in registry order. */
export function allWidgetIds(): string[] {
  return WIDGET_CATALOG.map((w) => w.id);
}

function isWidgetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    WIDGET_CATALOG.some((w) => w.id === baseWidgetId(value))
  );
}

/**
 * Resolve the raw persisted `enabledWidgets` into the effective enabled SET
 * of widget ids, applying the absent => all-enabled default. Unknown ids are
 * dropped. Ids are normalized to their BASE catalog id (so a stored instance
 * id resolves to its definition).
 *
 * Pure + synchronous so the palette / store / tests can call it on a settings
 * snapshot without async I/O.
 */
export function resolveEnabledWidgets(
  raw: string[] | null | undefined,
): Set<string> {
  // Absent (null/undefined) => everything enabled (back-compat default).
  if (raw == null) {
    return new Set<string>(allWidgetIds());
  }
  const set = new Set<string>();
  for (const id of raw) {
    if (isWidgetId(id)) set.add(baseWidgetId(id));
  }
  return set;
}

/**
 * Is `id` enabled given the raw persisted set? Tolerant of instance ids
 * (strips the `#…` suffix). Used by the palette / store-default offering gate
 * only, NEVER by the layout reader or render path.
 */
export function isWidgetEnabled(
  id: string,
  raw: string[] | null | undefined,
): boolean {
  return resolveEnabledWidgets(raw).has(baseWidgetId(id));
}

/**
 * Filter an (already account/surface-gated) catalog down to the enabled
 * widgets. This is the palette/store OFFERING filter: it is layered ON TOP OF
 * `visibleCatalog` / `widgetHasSurface`, never instead of them, so it can only
 * ever HIDE a widget, never reveal one the account/surface gating would
 * exclude.
 */
export function filterEnabledWidgets(
  catalog: WidgetDefinition[],
  raw: string[] | null | undefined,
): WidgetDefinition[] {
  const enabled = resolveEnabledWidgets(raw);
  return catalog.filter((w) => enabled.has(baseWidgetId(w.id)));
}

/**
 * Compute the next `enabledWidgets` array after toggling one widget, given the
 * CURRENT raw persisted value. Returns a concrete array (never absent) so the
 * result is unambiguous on disk:
 *
 *  - Toggling off when the field was absent materializes "all widgets except
 *    this one" (the user's first explicit curation choice).
 *  - Toggling on a previously-disabled widget adds it back.
 *
 * The returned array preserves registry order for a stable on-disk shape.
 */
export function toggleWidgetEnabled(
  id: string,
  enabled: boolean,
  raw: string[] | null | undefined,
): string[] {
  const base = baseWidgetId(id);
  const current = resolveEnabledWidgets(raw);
  if (enabled) {
    current.add(base);
  } else {
    current.delete(base);
  }
  return materialize(current);
}

/** Serialize an enabled set to a registry-ordered array. */
function materialize(set: Set<string>): string[] {
  return allWidgetIds().filter((id) => set.has(id));
}

// ── Persistence helpers (thin wrappers over the settings store) ──────────────

/** Read the active user's effective enabled set from disk. */
export async function readEnabledWidgets(
  username: string,
): Promise<Set<string>> {
  const settings = await readUserSettings(username);
  return resolveEnabledWidgets(settings.enabledWidgets);
}

/**
 * Persist a single widget's enabled/disabled state for the user, returning the
 * updated settings. Computes the next array via `toggleWidgetEnabled` from the
 * LATEST persisted value and writes it back.
 *
 * The read-modify-write runs inside `updateUserSettings`, which serializes
 * writes per user (enablement-race bot, 2026-05-30). Two toggles fired in the
 * same tick therefore compose instead of clobber: the second reads the first's
 * result, so both changes survive.
 */
export async function setWidgetEnabled(
  username: string,
  id: string,
  enabled: boolean,
): Promise<UserSettings> {
  return updateUserSettings(username, (current) => ({
    enabledWidgets: toggleWidgetEnabled(id, enabled, current.enabledWidgets),
  }));
}

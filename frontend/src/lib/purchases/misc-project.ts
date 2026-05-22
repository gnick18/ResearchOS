/**
 * Miscellaneous purchases — hidden per-user project bootstrap.
 *
 * Backs the "Miscellaneous" category surfaced on /purchases. When a user
 * adds a purchase that doesn't belong to a real project (conference
 * flights, ad-hoc lab snacks, personal gear charged to a shared card),
 * NewPurchaseModal routes it to a permanent hidden project named
 * `_misc_purchases` so the purchase still has a `project_id` foreign-key
 * landing without polluting the project list on Home / Workbench / Gantt.
 *
 * Why a hidden project (Grant 2026-05-22, shape pick: "Reserved category +
 * hidden misc project"):
 *   - the existing purchases data model already requires a `project_id`
 *     for every purchase task; introducing a project_id-less code path
 *     would touch every reader (Gantt, Workbench grouping, search, ...);
 *   - a per-user hidden project keeps the schema flat and lets ordinary
 *     project-scoped tooling (cascade delete, share manifests, activity
 *     log) still apply if the user ever wants to inspect or unhide it;
 *   - the "Miscellaneous" label is reserved as a string constant on the
 *     PurchaseItem.category column for downstream filtering, but the
 *     project_id is the source of truth.
 *
 * Hidden visibility contract: `fetchAllProjectsIncludingShared` filters
 * out `is_hidden` projects by default. Only callers that explicitly pass
 * `{ includeHidden: true }` see this project — that is currently only
 * the /purchases page.
 */

import { projectsApi } from "@/lib/local-api";
import type { Project } from "@/lib/types";

/**
 * On-disk project name for the per-user miscellaneous-purchases bucket.
 * The leading underscore signals "reserved system project" — ordinary
 * project-name validation does not reject it, but it lines up with the
 * convention used elsewhere in the codebase (e.g. `_shared_with_me.json`).
 */
export const MISC_PROJECT_NAME = "_misc_purchases";

/**
 * Human-readable display label that surfaces wherever the misc project
 * would otherwise render its raw name. Also used as the reserved value
 * stored on `PurchaseItem.category` so downstream filters / dashboards
 * can recognise misc items without a project lookup.
 */
export const MISC_CATEGORY_LABEL = "Miscellaneous";

/**
 * Neutral gray so accidental surfaces don't draw the eye. Aligns with
 * the Tailwind `gray-400` swatch used by the home-archived chip.
 */
const MISC_PROJECT_COLOR = "#9ca3af";

/**
 * Large sort_order so any leaked render lands at the bottom of the list.
 * Picked well above the practical reorder ceiling (a few hundred at most)
 * so it sorts last even after a full manual reorder.
 */
const MISC_PROJECT_SORT_ORDER = 999_999;

/**
 * Predicate: is `p` the reserved miscellaneous-purchases project?
 *
 * Matches on the conjunction of `is_hidden && name === MISC_PROJECT_NAME`
 * so a user-created project that happens to be named `_misc_purchases`
 * (without the hidden flag) does NOT collapse into the misc bucket. The
 * bootstrap below always sets both fields, so a legitimate misc project
 * always satisfies both clauses.
 */
export function isMiscProject(p: Project): boolean {
  return p.is_hidden === true && p.name === MISC_PROJECT_NAME;
}

/**
 * Find-or-create the misc-purchases project for `username`. Idempotent:
 *   - if a hidden project named `_misc_purchases` already exists for
 *     this user, return it unchanged;
 *   - otherwise persist a new one with the canonical color + sort_order
 *     and return the freshly written record.
 *
 * The write goes through `projectsApi.create` so the global counter and
 * the `tour:project-created` dispatch fire identically to a normal user
 * create — that keeps the project-id allocator consistent and surfaces
 * the misc bootstrap to any future telemetry that listens for project
 * creates. The hidden flag prevents the new project from appearing on
 * Home / Workbench / Gantt etc. via the default
 * `fetchAllProjectsIncludingShared` filter.
 *
 * `username` is currently used only for the explicit-error case (helps
 * callers in tests fail loudly when there's no logged-in user); the
 * actual read + write route through `projectsApi`, which operates on the
 * current user's directory. Mismatched usernames are not detected here;
 * the caller is responsible for invoking this with `currentUser`.
 */
export async function ensureMiscProject(username: string): Promise<Project> {
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    throw new Error("ensureMiscProject: username is required");
  }
  // Scan the user's existing projects via `projectsApi.list()`, which
  // bypasses the default-hidden filter in `fetchAllProjectsIncludingShared`
  // and reads the raw on-disk list for the current user.
  const existing = await projectsApi.list();
  const match = existing.find((p) => isMiscProject(p));
  if (match) return match;

  const created = await projectsApi.create({
    name: MISC_PROJECT_NAME,
    color: MISC_PROJECT_COLOR,
    is_hidden: true,
    sort_order: MISC_PROJECT_SORT_ORDER,
  });
  return created;
}

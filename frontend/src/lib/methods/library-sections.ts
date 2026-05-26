// Helpers for splitting the Methods Library page into two visually
// separated sections: "My Methods" (own private methods + own categories)
// and "Shared with Lab" (every public / shared-with-me method that the
// current user did not create privately).
//
// Why this lives in its own file:
//   The page tsx grew to 2000+ lines and the partitioning logic is the
//   load-bearing piece for the new layout (post-2026-05-26 Grant
//   direction: "We should reorganize shared methods to show up in their
//   own area on the methods tab seperate from a users own categories
//   that they make. The shared methods dont need to be organized with
//   the same project folder as the owner"). Keeping it small + pure
//   means we can unit-test it directly without rendering the page.
//
// Background, why this is needed:
//   Pre-2026-05-26, `/methods` grouped EVERY method by `folder_path`,
//   including the lab-shared methods in `users/public/methods/*.json`.
//   Those public records were authored by other lab members in their
//   own categories (e.g. "Molecular Biology"), so a brand-new user
//   would land on /methods and see other-people's categories appear in
//   their library. That violated the mental model "my library is the
//   stuff I created or someone explicitly shared with me, grouped how
//   *I* organize it".
//
// Ownership predicate:
//   A method is "mine" iff `method.owner === currentUser` AND it isn't
//   tagged `is_shared_with_me`. Methods in `users/public/methods/*` carry
//   `owner: "public"` (not the creator's username, since `created_by`
//   is nulled at create time by methodsApi.create). They go into
//   "Shared with Lab" by definition, even if the same user originally
//   published them (the schema doesn't preserve that authorship).
//
// Sub-grouping inside "Shared with Lab":
//   v1 groups by `owner` (lab member username, or "Lab" for the public
//   namespace) so the section is scannable without inheriting the
//   owner's own `folder_path` taxonomy. Sub-grouping by `folder_path`
//   was the original bug; sub-grouping by owner gives the receiver a
//   useful structural cue ("these are Kritika's shared methods") without
//   leaking her private category names into their library.

import type { Method } from "@/lib/types";

/**
 * True when `method` belongs in the current user's "My Methods" section.
 * Owner-of-record AND not received via shared-with-me overlay.
 *
 * Public methods (owner === "public") always return false even if the
 * current user originally authored them, because the schema doesn't
 * preserve that authorship (created_by is nulled by methodsApi.create).
 * They surface in "Shared with Lab" with the existing Public badge.
 */
export function isOwnMethod(method: Method, currentUser: string): boolean {
  if (!currentUser) return false;
  if (method.is_shared_with_me) return false;
  return method.owner === currentUser;
}

/**
 * The inverse predicate. Used so the page's filtering reads naturally
 * in both directions.
 */
export function isSharedMethod(method: Method, currentUser: string): boolean {
  return !isOwnMethod(method, currentUser);
}

/**
 * Partition a method list into (own, shared) buckets in a single pass.
 * Preserves source-array order within each bucket, callers can sort
 * after partitioning.
 */
export function partitionMethodsByOwnership(
  methods: Method[],
  currentUser: string,
): { own: Method[]; shared: Method[] } {
  const own: Method[] = [];
  const shared: Method[] = [];
  for (const m of methods) {
    if (isOwnMethod(m, currentUser)) {
      own.push(m);
    } else {
      shared.push(m);
    }
  }
  return { own, shared };
}

/**
 * Group "My Methods" by their `folder_path` for the existing
 * category-driven layout. Methods with no folder land in
 * "Uncategorized". Matches the legacy behavior verbatim, the only
 * change vs. pre-restructure is that callers feed in `own` instead of
 * the full list.
 */
export function groupOwnMethodsByFolder(
  ownMethods: Method[],
): Record<string, Method[]> {
  const grouped: Record<string, Method[]> = {};
  for (const m of ownMethods) {
    const folder = m.folder_path || "Uncategorized";
    if (!grouped[folder]) grouped[folder] = [];
    grouped[folder].push(m);
  }
  return grouped;
}

/**
 * Display label for a shared method's owner. Public-namespace methods
 * (`owner === "public"`) get a generic "Lab" label because we don't
 * know who originally authored them; everyone else surfaces under their
 * username. Receivers see e.g. "kritika" as the heading for a method
 * that Kritika shared with them via the unified-sharing primitive.
 */
export function sharedOwnerLabel(method: Method): string {
  if (method.owner === "public" || !method.owner) return "Lab";
  return method.owner;
}

/**
 * Group "Shared with Lab" by `sharedOwnerLabel(method)`. This is the
 * deliberate replacement for the old `folder_path` grouping, the
 * owner's private category names DO NOT leak into the receiver's
 * library, but receivers still see a per-author cue ("here are
 * Kritika's shared methods, here are the lab-wide public ones").
 */
export function groupSharedMethodsByOwner(
  sharedMethods: Method[],
): Record<string, Method[]> {
  const grouped: Record<string, Method[]> = {};
  for (const m of sharedMethods) {
    const label = sharedOwnerLabel(m);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(m);
  }
  return grouped;
}

/**
 * Case-insensitive contains-search across the fields a user might
 * reasonably look for (name, tags, source_path, folder_path). Used by
 * both sections so the search bar at the top of the page filters
 * coherently across "My" and "Shared".
 */
export function matchesMethodSearch(method: Method, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (method.name?.toLowerCase().includes(q)) return true;
  if (method.source_path?.toLowerCase().includes(q)) return true;
  if (method.folder_path?.toLowerCase().includes(q)) return true;
  if (method.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

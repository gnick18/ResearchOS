// Composite-key helpers for dropdown filters that key off Project / Method
// records. Background: per-user numeric ids collide across owners (alex's
// project 1 vs morgan's project 1, alex's private method 2 vs the public
// method 2). A bare `<option value={p.id}>` produces two options with
// `value="1"`, the browser snaps `selectedIndex` to the first one, and any
// downstream filter that compares `task.project_id === filters.projectId`
// silently merges results from BOTH owners. Persona 18 caught this on
// `/search`; the §7 composite-key sweep (commits 36816a9d -> b086fb4c)
// already landed display-side fixes, but the form layer still emits raw
// numeric ids. This module is the form-layer counterpart: encode the
// composite "<owner>:<id>" as the option value, parse it back to an
// {owner, id} pair on read, and provide a single predicate so the search
// page (and any future filter form) doesn't reinvent the matching rule.
//
// Mirrors the shape of `taskKey()` in lib/types.ts (which uses the
// `is_shared_with_me` flag to pick a namespace); here the namespace is
// always the literal `owner` field because Project.owner and Method.owner
// are themselves the disambiguator on the form side.

export type FilterKey = string; // `${owner}:${id}` — opaque to callers

export interface FilterKeyParts {
  owner: string;
  id: number;
}

/**
 * Sentinel filter-key value that scopes the project filter pill bar to
 * "orphan" tasks (project_id === null). Background: tasks created in the
 * Miscellaneous / standalone slot persist with project_id null (see
 * TaskModal.tsx where projectId === 0 maps to null on save). The
 * composite-key matchers in this file all require `task.project_id ===
 * parts.id`, and `null === <anything>` is always false, so a user with any
 * specific project pill selected can't see their orphan experiments at
 * all (Workbench header counts them, panel renders empty).
 *
 * We use a literal double-underscored token so it cannot collide with the
 * `<owner>:<id>` composite-key format (real owners cannot contain `__` as
 * a leading sentinel; the parser also rejects keys with no colon).
 * Treated as an opaque constant: callers import this rather than typing
 * the magic string.
 */
export const STANDALONE_FILTER_KEY: FilterKey = "__standalone__";

/** Build a composite filter key from an owned record. */
export function encodeFilterKey(record: { owner: string; id: number }): FilterKey {
  return `${record.owner}:${record.id}`;
}

/**
 * Parse a composite filter key back into its parts. Returns null on any
 * malformed input (empty string, missing colon, non-numeric id) so callers
 * can treat a parse failure the same as "no filter set". The owner half
 * may itself contain colons in pathological cases (usernames are not
 * supposed to but we don't rely on it); only the LAST colon is treated as
 * the separator so `username` is allowed to be any string.
 */
export function parseFilterKey(key: FilterKey | null | undefined): FilterKeyParts | null {
  if (!key) return null;
  const lastColon = key.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === key.length - 1) return null;
  const owner = key.slice(0, lastColon);
  const idStr = key.slice(lastColon + 1);
  const id = Number(idStr);
  if (!Number.isInteger(id)) return null;
  return { owner, id };
}

/**
 * Project-filter predicate. Returns true when the task belongs to the
 * project identified by `filterKey`. A null/empty filter key means "no
 * project filter" -> always passes. Both halves of the composite must
 * match: `task.project_id === id` AND `task.owner === owner`.
 *
 * Why match on `task.owner` and not a separate `task.project_owner`: a
 * task lives in its own owner's namespace and references projects in that
 * same namespace via `project_id`. Cross-owner project hosting goes
 * through `task.external_project`, not `project_id`, so `task.owner` is
 * always the correct disambiguator for the native project membership.
 */
export function matchesProjectFilter(
  task: { owner: string; project_id: number | null },
  filterKey: FilterKey | null | undefined,
): boolean {
  const parts = parseFilterKey(filterKey);
  if (!parts) return true;
  return task.project_id === parts.id && task.owner === parts.owner;
}

/**
 * Multi-key OR variant for the global project-filter pills (Gantt /
 * Workbench / Purchases). Returns true when the task belongs to ANY
 * project in `filterKeys`. An empty array means "no filter" -> always
 * passes, matching the existing `.length === 0` short-circuit those pages
 * use. Composite-key strings disambiguate alex:1 from morgan:1, which the
 * old `selectedProjectIds.includes(task.project_id)` bare-numeric form
 * collapsed (persona 18 collision; same root cause as the /search fix at
 * ab1548a8).
 */
export function matchesAnyProjectFilter(
  task: { owner: string; project_id: number | null },
  filterKeys: readonly FilterKey[],
): boolean {
  if (filterKeys.length === 0) return true;
  for (const key of filterKeys) {
    // Standalone sentinel: matches orphan tasks (project_id === null) that
    // the composite-key matcher cannot reach. Falls through to the next
    // key on miss so the sentinel composes with real project keys via OR
    // (a Workbench user can scope to "SLUT + Standalone" in one filter).
    if (key === STANDALONE_FILTER_KEY) {
      // Orphan / standalone bucket: tasks created in the Miscellaneous
      // slot. The persisted Task shape stores `project_id: 0` for "no
      // project" (see local-api.ts where null is normalized to 0 on
      // disk), but callers reading from the wire / intermediate shapes
      // may see literal `null` here too. Both are treated as orphans.
      if (task.project_id === null || task.project_id === 0) return true;
      continue;
    }
    if (matchesProjectFilter(task, key)) return true;
  }
  return false;
}

/**
 * Lab-mode search uses a server-side endpoint (labApi.search) that takes
 * a flat `usernames` CSV plus separate numeric `project_id` / `method_id`
 * params. The dropdown layer carries composite "<owner>:<id>" keys to
 * avoid the same per-user id collision (alex:1 vs morgan:1) Persona 18
 * caught on the client-side /search page; this helper bridges the two
 * shapes: parse the composite key into a numeric id for the API plus an
 * owner narrowing for the usernames CSV.
 *
 * Narrowing rule: when a specific project or method is picked, the owner
 * half of its composite key IS the disambiguator and overrides the
 * caller's baseline usernames. Project narrowing wins if both keys are
 * set with different owners (cross-owner combinations are pathological,
 * and project is the broader, more-anchored filter). A method whose
 * owner equals the synthetic public marker ("public" by default) does
 * not narrow at all because the marketplace method pool lives across
 * every user's task method_ids.
 *
 * Returned `usernames` is the CSV string the API expects, or undefined
 * for "no filter, search all users". `projectId` / `methodId` are
 * numbers when a key was parsed, null otherwise.
 */
export function narrowLabSearchByCompositeKeys(input: {
  baselineUsernames: readonly string[];
  projectKey: FilterKey | null | undefined;
  methodKey: FilterKey | null | undefined;
  publicMarker?: string;
}): {
  usernames: string | undefined;
  projectId: number | null;
  methodId: number | null;
} {
  const publicMarker = input.publicMarker ?? "public";
  const projectParts = parseFilterKey(input.projectKey);
  const methodParts = parseFilterKey(input.methodKey);

  let ownerNarrowing: string | null = null;
  if (projectParts) {
    ownerNarrowing = projectParts.owner;
  } else if (methodParts && methodParts.owner !== publicMarker) {
    ownerNarrowing = methodParts.owner;
  }

  let usernames: string | undefined;
  if (ownerNarrowing !== null) {
    usernames = ownerNarrowing;
  } else {
    const csv = input.baselineUsernames.join(",");
    usernames = csv.length > 0 ? csv : undefined;
  }

  return {
    usernames,
    projectId: projectParts?.id ?? null,
    methodId: methodParts?.id ?? null,
  };
}

/**
 * Method-filter predicate. Returns true when the task's primary method
 * attachment resolves to the method identified by `filterKey`. A
 * null/empty filter key means "no method filter" -> always passes.
 *
 * The method side is trickier than projects because a task's
 * `method_ids[0]` is just a bare number — the disambiguator lives on
 * `method_attachments[].owner`. Resolution rules (mirrors
 * resolveMethodForAttachment in lib/methods/lookup.ts):
 *
 *   - If a matching attachment carries an explicit `owner`, the
 *     effective method owner is that field.
 *   - If the attachment owner is null (legacy or locally-owned), the
 *     effective method owner is the task owner.
 *   - If no attachment exists at all for the primary method id, fall
 *     back to the task owner.
 *
 * The filter then matches when BOTH `primaryMethodId === id` AND
 * `effectiveMethodOwner === owner`.
 */
export function matchesMethodFilter(
  task: {
    owner: string;
    method_ids: number[] | null | undefined;
    method_attachments: Array<{ method_id: number; owner: string | null }> | null | undefined;
  },
  filterKey: FilterKey | null | undefined,
): boolean {
  const parts = parseFilterKey(filterKey);
  if (!parts) return true;
  const primaryMethodId = task.method_ids?.[0] ?? null;
  if (primaryMethodId === null) return false;
  if (primaryMethodId !== parts.id) return false;
  const attachment = task.method_attachments?.find((a) => a.method_id === primaryMethodId);
  const effectiveOwner = attachment?.owner ?? task.owner;
  return effectiveOwner === parts.owner;
}

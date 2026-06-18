// Workspace-username normalization (data-shape migration, 2026-06-18).
//
// Background: the folder-local workspace username (deriveWorkspaceUsername) was
// allowed to keep spaces and capitalization so a greeting reads as a real name
// ("Welcome back, Aspergillus fumigatus"). That value also doubles as a folder
// name (users/<username>/) and as project.owner, so a spaced name leaked into
// "@handle" displays ("@Aspergillus fumigatus") and into project keys
// ("Aspergillus fumigatus:1"). The display-time fix (formatUsernameHandle)
// stopped the malformed render, but the STORED name still carries the space.
//
// This step normalizes the stored name to its space-free handle slug
// (toHandleSlug) by reusing usersApi.rename, which already moves the folder
// (copy-then-remove, so no data is lost) and propagates the new name into every
// user-bearing field across all entities, including comments[].mentions[], so
// mention surfaces stay consistent. It runs BEFORE the registry migration pass
// (see DataMigrationRunner) so the per-user marker is written to the already
// renamed users/<slug>/ folder, never recreating the old path.
//
// Gated OFF by default (USERNAME_NORMALIZE_ENABLED) until verified on a real
// folder. House style: no em-dashes, no emojis, no mid-sentence colons.

import { toHandleSlug } from "@/lib/account/workspace-username";
import { usersApi } from "@/lib/local-api";

/**
 * Gates the stored-username normalization. Env-driven so it is controllable from
 * Vercel without a code change, NEXT_PUBLIC so the client boot path reads it.
 * Default false (unset), so the rename stays dormant until verified on a real
 * connected folder. Set NEXT_PUBLIC_USERNAME_NORMALIZE_ENABLED to "1" or "true"
 * (in frontend/.env.local for local dev) to turn it on.
 */
export const USERNAME_NORMALIZE_ENABLED =
  process.env.NEXT_PUBLIC_USERNAME_NORMALIZE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_USERNAME_NORMALIZE_ENABLED === "true";

export interface UsernameNormalizeResult {
  /** True only when a rename was actually performed this call. */
  renamed: boolean;
  /** The name the pass should continue under (the slug when renamed, else the
   *  original). Callers pass this to runPendingMigrations. */
  username: string;
  /** Set when renamed: the prior, spaced name. For logging only. */
  from?: string;
}

/**
 * Whether `username` already is its own handle slug. Idempotency hinges on this:
 * once a name is slug-form, toHandleSlug is a fixed point, so a second pass is a
 * no-op. A username whose slug differs needs normalizing; one with no slug-able
 * characters at all is left untouched (the rename would have no valid target).
 */
export function needsUsernameNormalize(username: string): boolean {
  const slug = toHandleSlug(username);
  return slug.length > 0 && slug !== username;
}

/**
 * Normalize the connected user's stored workspace username to its handle slug,
 * in place, by renaming the folder. Returns the name the caller should run the
 * rest of the migration pass under.
 *
 * Best-effort and non-fatal: a failed rename returns the original name so the
 * registry pass still runs (and the next connect retries). No-op (and a flag
 * short-circuit) keep the hot path cheap when there is nothing to do.
 *
 * @param renameUser injectable for tests; defaults to usersApi.rename.
 */
export async function normalizeWorkspaceUsername(
  username: string,
  renameUser: (
    oldName: string,
    newName: string,
  ) => Promise<unknown> = usersApi.rename,
): Promise<UsernameNormalizeResult> {
  if (!USERNAME_NORMALIZE_ENABLED) return { renamed: false, username };
  if (!needsUsernameNormalize(username)) return { renamed: false, username };

  const slug = toHandleSlug(username);
  try {
    await renameUser(username, slug);
    console.info(
      `[migrations] normalized workspace username '${username}' to '${slug}'`,
    );
    return { renamed: true, username: slug, from: username };
  } catch (error) {
    // A collision (slug already taken by another folder) or any FSA error must
    // not block the rest of the pass. Stay on the old name; the display-time
    // slug still keeps the UI clean, and the next connect retries.
    console.warn(
      `[migrations] workspace-username normalize for '${username}' failed, staying on the old name`,
      error,
    );
    return { renamed: false, username };
  }
}

import { fileService } from "./file-service";
import {
  deterministicUserColor,
  pickUserColor,
  USER_COLOR_PALETTE as HEX_USER_COLOR_PALETTE,
} from "./user-color";

const METADATA_PATH = "users/_user_metadata.json";

/**
 * Username sanity check for the metadata-write paths.
 *
 * Without this guard, a falsy / placeholder username flowing in from
 * an upstream bad-caller would pollute `_user_metadata.json` with
 * entries keyed by `undefined`, `null`, empty string, or the literal
 * strings `"undefined"` / `"null"`. Grant hit exactly this bug:
 * an entry literally named `"undefined"` started appearing in the
 * Lab Roster surface (lab-roster ghost cleanup, 2026-05-26).
 *
 * We log a warn with a short stack trace so the offending call site
 * surfaces in dev console, but we do NOT throw — a defective caller
 * shouldn't break unrelated flows. The caller's promise resolves to
 * `null` (or the metadata snapshot when called via
 * `ensureLabUserMetadata`) so downstream code keeps running.
 */
function isInvalidUsername(username: unknown): boolean {
  if (typeof username !== "string") return true;
  if (username.length === 0) return true;
  // Literal stringification of bad values from upstream callers that
  // template `${maybeNullish}` into a username slot.
  if (username === "undefined" || username === "null") return true;
  return false;
}

function warnInvalidUsername(
  context: string,
  username: unknown,
): void {
  const trace = new Error("invalid username trace").stack;
  console.warn(
    `[user-metadata] ${context} called with invalid username ${JSON.stringify(username)} (typeof=${typeof username}); skipping write to avoid polluting _user_metadata.json`,
    trace,
  );
}

// Module-level write queue serializes all read-modify-write operations on
// _user_metadata.json so concurrent callers don't race the underlying
// atomic-write pattern (.tmp create + write + move). The race surfaced as
// "Failed to move _user_metadata.json.tmp. A FileSystemHandle cannot be
// moved while it is locked" when the W6 onboarding step triggered two
// rapid setUserMetadataField calls (color + hide_goals_from_lab via
// writeUserSettings) that overlapped a parallel ensureLabUserMetadata
// call from a list-users API path. The atomic-write pattern protects
// against torn writes (.tmp checkpoint survives) but doesn't serialize
// concurrent .tmp file manipulation on the same final path; this queue
// closes that gap. Tab-scoped (does NOT protect against cross-tab or
// cross-process writes — those would need an FSA lock layer above).
let metadataWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueMetadataWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = metadataWriteQueue.then(fn, fn);
  // Chain the queue but swallow errors so a single failed write doesn't
  // poison every subsequent write. Caller still receives the original
  // rejection via the returned promise.
  metadataWriteQueue = next.catch(() => {});
  return next;
}

/** Special sentinel stored in the `color` field (no `#` prefix, so it is
 *  never confused with a hex color). A user who picks this option renders
 *  with BeakerBot's 5-stop pastel body gradient rather than any single-
 *  hue swatch. Only one user per folder can own it (same uniqueness rules
 *  as a regular palette swatch). `color_secondary` is meaningless for
 *  rainbow users and should be treated as absent. */
export const RAINBOW_COLOR = "rainbow";

/** Second rainbow option: the SATURATED ("vivid") 5-stop ramp (the same one
 *  dark mode uses) rather than the pastel one. Same sentinel rules as
 *  RAINBOW_COLOR. Stored as "rainbow-vivid" (no `#`, never a hex). */
export const RAINBOW_VIVID_COLOR = "rainbow-vivid";

/** Both rainbow sentinels. Neither is a hex and neither is ever auto-assigned
 *  (opt-in only, via the color picker). */
export const RAINBOW_SENTINELS = new Set<string>([
  RAINBOW_COLOR,
  RAINBOW_VIVID_COLOR,
]);

const USER_COLOR_PALETTE = [
  // The hex swatches come from the single source (user-color.ts) so the
  // auto-assign / fallback colors stay identical to every other surface.
  ...HEX_USER_COLOR_PALETTE,
  // Special sentinels: BeakerBot rainbow (pastel) + vivid rainbow. Must remain
  // LAST so existing users keep their assigned palette index.
  RAINBOW_COLOR,
  RAINBOW_VIVID_COLOR,
];

export interface UserMetadataEntry {
  color: string;
  /** Optional second color for a 2-stop linear gradient. When null/undefined
   *  the user renders as a single solid color (the default). Users opt into
   *  gradients via Settings → Profile so labs with more than 10 members
   *  can stay visually distinct in Lab Mode. */
  color_secondary?: string | null;
  created_at: string;
  // Per-user opt-out from lab-mode goals visibility (#14). When true,
  // labApi.getGoals() skips this user. Default = false (visible).
  hide_goals_from_lab?: boolean;
  // Soft-delete tombstone (ISO timestamp). When set, discoverUsers /
  // usersApi.list filter the user out of pickers even if a cloud-sync
  // provider (OneDrive Files On-Demand, Dropbox, etc.) re-creates the
  // directory as a placeholder underneath us. See INVESTIGATION_USER_LEAKS.md.
  deleted_at?: string;
  // Onboarding v3 Phase 3 fake lab partner marker. When true, this user
  // was spawned by the Lab Mode tour (L2 / L19) as a temporary teammate
  // so the user could practice sharing, edit, and view-only permission
  // flavors. Phase 4 cleanup uses the flag to surface a discard option
  // alongside the lab_user artifact that wraps this entry. Mirrors the
  // existing `tutorial_test: true` flag on Telegram image sidecars (W12)
  // so cleanup logic across surfaces follows the same pattern. The flag
  // is purely informational; no other consumer alters behavior based on
  // it (lab mode still surfaces the user normally during the tour).
  is_tutorial?: boolean;
  // Per-user override for the "ResearchOS events" (native) calendar row
  // swatch in CalendarSidebar. Absent / undefined falls back to the
  // shared NATIVE_CALENDAR_DEFAULT_COLOR (#3b82f6). Stored per-user so
  // each account in a folder can theme its native row independently of
  // the others (mirrors how `color` is per-user). No migration needed:
  // existing entries without the field render exactly as before.
  native_calendar_color?: string;
  // Multi-lab P3 ghost-cleanup marker (lab-roster-materialize.ts). True when
  // this entry was CREATED by the roster materialize for a co-member of someone
  // else's lab (a cached identity, not a real local user this viewer made). Only
  // entries carrying this flag are eligible for the roster reconcile to
  // TOMBSTONE (set deleted_at) when the member leaves the relay roster, so the
  // reconcile can never tombstone a genuine local / co-located user. Absent /
  // false = "not a materialized co-member, never auto-tombstone". Additive +
  // optional: entries written before this slice load unchanged (the reconcile
  // simply skips them, the conservative default).
  materialized_member?: boolean;
  // Structured-research-metadata foundation (metadata implementation bot,
  // 2026-05-28). The person's ORCID iD, stored in the canonical bare
  // hyphenated 16-character form (e.g. "0000-0002-1825-0097") with NO
  // URL prefix. Lives on the person, not on tasks. Optional + additive:
  // entries written before this slice load unchanged (absent / null =
  // "not set"). Written via the existing `setUserMetadataField` path and
  // read via `getUserMetadata` / `readAllUserMetadata`. Validation
  // (MOD 11-2 checksum) is a SOFT warning surfaced in the Settings UI —
  // never gates the save.
  orcid?: string | null;
}

export interface UserMetadataFile {
  users: Record<string, UserMetadataEntry>;
  /** Per-folder pin for the "Main" user (the gold-star account that
   *  Lab Mode exits back to, the picker badges as "(Main)", etc.).
   *
   *  Previously stored only in IndexedDB under `research-os-main-user`,
   *  which leaked across folder switches: disconnecting from folder A
   *  and reconnecting to folder B silently kept folder A's main pin
   *  applied to whatever same-named user happened to live in B. Grant
   *  hit this 2026-05-23 ("It just switched the test to the main even
   *  though I'm 99% sure I never clicked the star").
   *
   *  Now persisted as a folder-scoped field. The IndexedDB key still
   *  exists as a read-fallback during the migration window (see
   *  `usersApi.getMainUser` in local-api.ts); once a folder writes its
   *  `main_user` field the IDB key is no longer consulted for that
   *  folder. New folders start with `main_user` absent and require an
   *  explicit star-click to populate it.
   *
   *  Absent / empty-string / undefined all mean "no Main set"; the
   *  picker renders without a (Main) badge in that case.
   */
  main_user?: string | null;
}

/** The hash-into-palette fallback. Delegates to the single source
 *  (user-color.ts deterministicUserColor) so this surface and the roster
 *  materialize / the pre-folder picker all resolve the same fallback color for
 *  a username. Rainbow is excluded by construction (the shared palette is
 *  hex-only), so the hash never implicitly hands out a rainbow option — it must
 *  be explicitly chosen via the color picker. */
function hashColor(username: string): string {
  return deterministicUserColor(username);
}

function pickColor(takenColors: Set<string>, username: string): string {
  // Delegates to the single source (user-color.ts pickUserColor): prefer an
  // unused hex swatch, else the deterministic hash. The shared palette is
  // hex-only so a rainbow sentinel is never auto-assigned (opt-in only).
  return pickUserColor(takenColors, username);
}

/**
 * Heuristic: does this value look like a single `UserMetadataEntry` (the
 * VALUE side of the users map), as opposed to the top-level wrapper or a
 * scalar field? Used only to recognize a flat legacy map — a plain object
 * keyed by username -> entry written WITHOUT the `{ users: {…} }` wrapper.
 *
 * We accept any plain object that is NOT itself a wrapper (no nested `users`
 * key). Real entries always carry at least `color` + `created_at`, but we do
 * not require specific fields here so the recognizer stays robust to partial
 * / future entries; the negative checks (must be a plain object, must not be
 * an array, must not look like a wrapper) are what make it safe.
 */
function looksLikeUserMetadataEntry(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // A nested `users` object would mean we mistook the wrapper for an entry.
  if ("users" in (value as Record<string, unknown>)) return false;
  return true;
}

/**
 * Reads `users/_user_metadata.json` and normalizes it to the canonical
 * `{ users: {…} }` wrapper shape.
 *
 * The HAPPY PATH is unchanged: a well-formed `{ users: {…} }` object is
 * returned verbatim (so `main_user` and any other top-level fields ride
 * along untouched, exactly as before).
 *
 * The added tolerance handles a FLAT LEGACY map — the file is a plain
 * `{ <username>: <entry>, … }` object with no `users` wrapper. This shape is
 * what the demo/fixture seed ships (and what any pre-wrapper folder could
 * hold). Without this, such a file parsed to `{}` and every downstream
 * consumer (e.g. `useArchivedUsers`) saw zero users, so the archived-member
 * filter silently no-opped and archived accounts leaked into share / mention
 * / assignee pickers. We treat the whole object AS the users map in that case.
 *
 * REAL connected folders always go through `ensureLabUserMetadata`, which
 * writes the wrapper, so they hit the happy path and behave exactly as
 * before; the flat-map branch only triggers for the legacy/demo shape.
 */
async function readMetadataFile(): Promise<UserMetadataFile> {
  if (!fileService.isConnected()) return { users: {} };
  // Read as `unknown` because this path deliberately normalizes across two
  // on-disk shapes (the canonical wrapper and a flat legacy map); the narrowing
  // below establishes the concrete type rather than trusting the file's claim.
  const data = await fileService.readJson<unknown>(METADATA_PATH);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { users: {} };
  }
  // Canonical wrapper shape — unchanged behavior. `data.users` must be a plain
  // object (not an array / scalar) to count; otherwise fall through to the
  // flat-map recognizer rather than trusting a malformed wrapper.
  const wrapped = data as UserMetadataFile;
  if (
    wrapped.users &&
    typeof wrapped.users === "object" &&
    !Array.isArray(wrapped.users)
  ) {
    return wrapped;
  }
  // Tolerant fallback: a flat legacy map keyed by username -> entry, written
  // WITHOUT the wrapper. Recognize it only when every value looks like a user
  // entry (a plain non-wrapper object) so we never misread an unrelated file.
  const flat = data as Record<string, unknown>;
  const values = Object.values(flat);
  if (
    values.length > 0 &&
    values.every((v) => looksLikeUserMetadataEntry(v))
  ) {
    return { users: flat as Record<string, UserMetadataEntry> };
  }
  return { users: {} };
}

/**
 * Read-only snapshot of the user metadata map for UI consumers. Does NOT
 * mutate the file (unlike ensureLabUserMetadata). Returns an empty object
 * when no folder is connected.
 */
export async function readAllUserMetadata(): Promise<Record<string, UserMetadataEntry>> {
  const file = await readMetadataFile();
  return file.users;
}

/**
 * Ensures every username has a persisted color and created_at in
 * users/_user_metadata.json. Returns the full metadata map.
 *
 * Colors are assigned from a fixed palette on first sight; we prefer
 * unused palette colors before falling back to a hash. Once assigned,
 * a user's color never changes.
 */
export async function ensureLabUserMetadata(
  usernames: string[],
): Promise<Record<string, UserMetadataEntry>> {
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    let mutated = false;

    const takenColors = new Set<string>(
      Object.values(file.users).map((entry) => entry.color),
    );

    const now = new Date().toISOString();
    for (const username of usernames) {
      // Guard: drop falsy / placeholder usernames so a defective upstream
      // call site can't pollute the metadata file. See `isInvalidUsername`
      // doc for the bug class this protects against.
      if (isInvalidUsername(username)) {
        warnInvalidUsername("ensureLabUserMetadata", username);
        continue;
      }
      if (file.users[username]) continue;
      const color = pickColor(takenColors, username);
      takenColors.add(color);
      file.users[username] = { color, created_at: now };
      mutated = true;
    }

    if (mutated && fileService.isConnected()) {
      try {
        await fileService.writeJson(METADATA_PATH, file);
      } catch (err) {
        console.error("ensureLabUserMetadata: failed to persist metadata", err);
      }
    }

    return file.users;
  });
}

export function fallbackUserColor(username: string): string {
  return hashColor(username);
}

/** Exported palette so the user-creation color picker can render the same
 *  swatches the Settings page uses without re-declaring the array. The
 *  master palette lives here because `_user_metadata.json` is the source
 *  of truth for stored colors — Settings imports its own copy that stays
 *  in sync by convention. */
export const USER_METADATA_COLOR_PALETTE = USER_COLOR_PALETTE;

/**
 * Returns a random palette color that no other user currently owns as a
 * solid (preferring unused swatches before falling back to the hash). Used
 * by the user-creation color picker to seed its "random default" so the
 * popup opens with a sensible suggestion the user can either accept or
 * change. Pure read — does NOT mutate the metadata file.
 *
 * Pass the read-only metadata snapshot (from `readAllUserMetadata`) so the
 * picker reflects what colors are already taken. Tombstoned users are
 * ignored (their slot is free to reclaim).
 */
export function suggestInitialColorForNewUser(
  username: string,
  byOtherUsers: Record<string, UserMetadataEntry>,
): string {
  const takenColors = new Set<string>();
  for (const entry of Object.values(byOtherUsers)) {
    if (entry.deleted_at) continue;
    // Only block on SOLID colors (no secondary) — mirrors the collision
    // rule the Settings picker enforces. Gradients don't reserve their
    // primary stop against new solid users.
    if (entry.color_secondary) continue;
    takenColors.add(entry.color);
  }
  return pickColor(takenColors, username);
}

/**
 * Persists a brand-new user's initial color choice to _user_metadata.json.
 * Idempotent: if an entry already exists for `username` (e.g. the user was
 * pre-seeded by ensureLabUserMetadata before they finished the color
 * picker), the explicit `color` argument wins so the user's pick is never
 * silently dropped. Routes through the serial write queue same as the
 * other writers so concurrent ensureLabUserMetadata / setUserMetadataField
 * calls can't race the .tmp create + move.
 *
 * Called by the UserLoginScreen create flow after the user accepts the
 * color picker so the color is persisted BEFORE the new user's folder
 * structure is built — once stored, every later UserAvatar render hits
 * the persisted entry and the color never gets re-rolled from the
 * username hash on rename (the original bug).
 */
export async function createUserMetadataEntry(
  username: string,
  color: string,
  colorSecondary?: string | null,
): Promise<UserMetadataEntry | null> {
  if (!fileService.isConnected()) return null;
  if (isInvalidUsername(username)) {
    warnInvalidUsername("createUserMetadataEntry", username);
    return null;
  }
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    const existing = file.users[username];
    const now = new Date().toISOString();
    if (existing) {
      // Honor the explicit pick over any pre-seeded entry, but preserve
      // other fields (hide-flag, tutorial marker, etc.) so we don't clobber
      // state set by a parallel writer. Secondary is only written when
      // the caller passes a non-undefined value so the legacy single-color
      // path still works.
      file.users[username] = {
        ...existing,
        color,
        ...(colorSecondary !== undefined ? { color_secondary: colorSecondary } : {}),
      };
    } else {
      file.users[username] = {
        color,
        ...(colorSecondary !== undefined ? { color_secondary: colorSecondary } : {}),
        created_at: now,
      };
    }
    try {
      await fileService.writeJson(METADATA_PATH, file);
    } catch (err) {
      console.error("createUserMetadataEntry: failed to persist", err);
      return null;
    }
    return file.users[username];
  });
}

/**
 * Sets a single field on a user's metadata entry, preserving all other
 * fields. The user is auto-created with palette color + now() if missing.
 */
export async function setUserMetadataField<K extends keyof UserMetadataEntry>(
  username: string,
  field: K,
  value: UserMetadataEntry[K],
): Promise<UserMetadataEntry | null> {
  if (!fileService.isConnected()) return null;
  // Guard: drop falsy / placeholder usernames so a defective upstream
  // call site can't pollute the metadata file with entries keyed by
  // `undefined`, `null`, or the literal strings `"undefined"` /
  // `"null"`. See `isInvalidUsername` doc for the bug class.
  if (isInvalidUsername(username)) {
    warnInvalidUsername("setUserMetadataField", username);
    return null;
  }
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    const existing = file.users[username];
    if (existing) {
      file.users[username] = { ...existing, [field]: value };
    } else {
      const takenColors = new Set<string>(
        Object.values(file.users).map((entry) => entry.color),
      );
      file.users[username] = {
        color: pickColor(takenColors, username),
        created_at: new Date().toISOString(),
        [field]: value,
      };
    }
    try {
      await fileService.writeJson(METADATA_PATH, file);
    } catch (err) {
      console.error("setUserMetadataField: failed to persist", err);
      return null;
    }
    return file.users[username];
  });
}

/**
 * Reads a single user's metadata without ensuring/writing. Returns null
 * if the user isn't recorded yet.
 */
export async function getUserMetadata(
  username: string,
): Promise<UserMetadataEntry | null> {
  const file = await readMetadataFile();
  return file.users[username] ?? null;
}

/** Default color for the native "ResearchOS events" calendar-sidebar row
 *  when the user hasn't picked an override. Re-declared here (matches
 *  `NATIVE_CALENDAR_DEFAULT_COLOR` in lib/calendar/calendar-colors.ts) so
 *  file-system callers don't have to import the calendar module. */
const NATIVE_CALENDAR_FALLBACK = "#3b82f6";

/**
 * Reads the per-user override for the native "ResearchOS events" calendar
 * swatch. Returns the persisted value when present, otherwise the
 * historical default ("#3b82f6"). Pure read — does not mutate the
 * metadata file.
 */
export async function getNativeCalendarColor(
  username: string,
): Promise<string> {
  const entry = await getUserMetadata(username);
  const v = entry?.native_calendar_color;
  if (typeof v === "string" && v.length > 0) return v;
  return NATIVE_CALENDAR_FALLBACK;
}

/**
 * Persists the per-user override for the native "ResearchOS events"
 * calendar swatch. Routed through `setUserMetadataField` so it shares the
 * same serial write queue as every other metadata mutation. Returns the
 * updated entry (or null when no folder is connected).
 */
export async function setNativeCalendarColor(
  username: string,
  color: string,
): Promise<UserMetadataEntry | null> {
  return setUserMetadataField(username, "native_calendar_color", color);
}

/**
 * Reads the per-folder Main user pin from users/_user_metadata.json.
 *
 * Returns null when:
 *   - No folder is connected
 *   - The metadata file doesn't exist yet (fresh folder)
 *   - The `main_user` field is absent / null / empty string
 *
 * Crucially, returns null for a never-set `main_user` even if the
 * folder has users — Main now requires an explicit star-click to set.
 * The auto-promote-on-connect behavior the IndexedDB-only impl had is
 * intentionally gone (Bug 2 root cause, fixed 2026-05-23).
 */
export async function readMainUser(): Promise<string | null> {
  const file = await readMetadataFile();
  const v = file.main_user;
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

/**
 * Writes the per-folder Main user pin to users/_user_metadata.json.
 *
 * Pass an empty string OR null to clear the pin (deletion path used by
 * `performUserDelete` when the Main user is the one being deleted).
 *
 * Routed through the write queue so it can't race a concurrent
 * `ensureLabUserMetadata` / `setUserMetadataField` call on the same
 * file. Returns the persisted value (null when cleared) for caller
 * convenience.
 */
export async function writeMainUser(
  username: string | null,
): Promise<string | null> {
  if (!fileService.isConnected()) return null;
  const normalized =
    typeof username === "string" && username.length > 0 ? username : null;
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    if (normalized === null) {
      // Drop the field entirely rather than persisting `null` so older
      // readers (and external diff tools) see a clean absence rather
      // than a literal null marker.
      delete file.main_user;
    } else {
      file.main_user = normalized;
    }
    try {
      await fileService.writeJson(METADATA_PATH, file);
    } catch (err) {
      console.error("writeMainUser: failed to persist", err);
      return null;
    }
    return normalized;
  });
}

/**
 * Atomically sets both `color` and `color_secondary` on a user's metadata
 * entry in a single read-modify-write cycle. Without this, two sequential
 * `setUserMetadataField` calls would race the read so the second one could
 * clobber the first when the underlying file backend interleaves them.
 *
 * Pass `null` for `secondary` to clear an existing gradient back to solid.
 *
 * The user is auto-created (palette color + now()) if missing — same shape
 * as `setUserMetadataField` — but the explicit `color` argument always wins.
 */
export async function setUserMetadataColors(
  username: string,
  primary: string,
  secondary: string | null,
): Promise<UserMetadataEntry | null> {
  if (!fileService.isConnected()) return null;
  if (isInvalidUsername(username)) {
    warnInvalidUsername("setUserMetadataColors", username);
    return null;
  }
  // Route through the same serial queue as `setUserMetadataField` and
  // `ensureLabUserMetadata`. Without this, a `setUserMetadataColors` call
  // from `writeUserSettings` (Settings → color picker) could race a
  // concurrent `ensureLabUserMetadata` (login-screen list refresh, lab-mode
  // user-tasks lookup) and both try to `createWritable` on
  // `_user_metadata.json.tmp` at the same time, throwing
  // NoModificationAllowedError. Grant hit this 2026-05-23 immediately after
  // renaming a user and then trying to change the color from Settings.
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    const existing = file.users[username];
    if (existing) {
      file.users[username] = {
        ...existing,
        color: primary,
        color_secondary: secondary,
      };
    } else {
      file.users[username] = {
        color: primary,
        color_secondary: secondary,
        created_at: new Date().toISOString(),
      };
    }
    try {
      await fileService.writeJson(METADATA_PATH, file);
    } catch (err) {
      console.error("setUserMetadataColors: failed to persist", err);
      return null;
    }
    return file.users[username];
  });
}

/**
 * Migrate a user's metadata entry from `oldUsername` to `newUsername`,
 * preserving all fields (color, color_secondary, created_at,
 * hide_goals_from_lab, is_tutorial, etc.). No-op when:
 *  - oldUsername has no entry (nothing to migrate; the caller can still
 *    proceed — the new user will get a fresh palette entry on first read).
 *  - oldUsername === newUsername.
 *
 * Called from `usersApi.rename` so a user's color travels with them across
 * a folder rename. Without this, after a rename the entry stays keyed by
 * the old username and the user appears to "lose" their color (the next
 * write creates a fresh entry under the new key, taking the next available
 * palette slot rather than the color they actually picked). See rename
 * bug-fix 2026-05-23.
 *
 * If the new key already has an entry, the migrate is skipped (the caller
 * is responsible for refusing the rename in the collision-check path; we
 * defensively keep the new key's existing entry intact here as well).
 */
/**
 * One-shot self-heal sweep over `_user_metadata.json` (lab-roster ghost
 * cleanup, 2026-05-26). Drops entries that are:
 *   1. Invalid usernames (falsy / "undefined" / "null") — these are the
 *      pollution left behind by a defective historical caller that the
 *      new write-guards (`isInvalidUsername`) now block at the source.
 *   2. Orphans — username has no `deleted_at` tombstone AND no on-disk
 *      directory entry in `validUsernames`. The user folder was hard-
 *      deleted years ago (pre-tombstone era) and the metadata row is
 *      now dead weight.
 *
 * Tombstoned entries (real `deleted_at` set) STAY. They block name
 * reuse and serve as the soft-delete record per the collision logic in
 * `usersApi.rename` (local-api.ts:5005-5008).
 *
 * Idempotent — safe to call on every folder-connect. No-op when the
 * file holds nothing to prune. Logs a single info line when pruning
 * actually happened so the activity is visible in dev console without
 * spamming on the cold path.
 *
 * Caller passes the live `discoverUsers()` result so the sweep doesn't
 * have to import the discovery module (avoids the cycle the metadata
 * module would otherwise have on user-discovery, which already imports
 * from here).
 */
export async function pruneOrphanUserMetadataEntries(
  validUsernames: string[],
): Promise<{ pruned: string[] }> {
  if (!fileService.isConnected()) return { pruned: [] };
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    const valid = new Set(validUsernames);
    const pruned: string[] = [];
    for (const username of Object.keys(file.users)) {
      const entry = file.users[username];
      if (isInvalidUsername(username)) {
        delete file.users[username];
        pruned.push(username);
        continue;
      }
      // Keep tombstones — they're load-bearing for the rename-collision
      // check that prevents un-tombstoning a deleted user by name reuse.
      if (entry?.deleted_at) continue;
      if (!valid.has(username)) {
        delete file.users[username];
        pruned.push(username);
      }
    }
    if (pruned.length > 0) {
      try {
        await fileService.writeJson(METADATA_PATH, file);
        console.info(
          `[user-metadata] pruneOrphanUserMetadataEntries: removed ${pruned.length} stale entr${
            pruned.length === 1 ? "y" : "ies"
          } (${pruned.map((u) => JSON.stringify(u)).join(", ")})`,
        );
      } catch (err) {
        console.error(
          "pruneOrphanUserMetadataEntries: failed to persist",
          err,
        );
        return { pruned: [] };
      }
    }
    return { pruned };
  });
}

export async function renameUserMetadataEntry(
  oldUsername: string,
  newUsername: string,
): Promise<void> {
  if (!fileService.isConnected()) return;
  if (oldUsername === newUsername) return;
  return enqueueMetadataWrite(async () => {
    const file = await readMetadataFile();
    const entry = file.users[oldUsername];
    if (!entry) return;
    if (file.users[newUsername]) {
      // Collision at the metadata level — leave both entries in place
      // and let the caller surface the collision (the rename-folder
      // step would have errored first). Better than silently merging.
      console.warn(
        `renameUserMetadataEntry: refusing to overwrite existing entry for '${newUsername}'`,
      );
      return;
    }
    file.users[newUsername] = { ...entry };
    delete file.users[oldUsername];
    try {
      await fileService.writeJson(METADATA_PATH, file);
    } catch (err) {
      console.error("renameUserMetadataEntry: failed to persist", err);
    }
  });
}

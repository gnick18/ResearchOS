import { fileService } from "./file-service";

const METADATA_PATH = "users/_user_metadata.json";

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

const USER_COLOR_PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
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
}

export interface UserMetadataFile {
  users: Record<string, UserMetadataEntry>;
}

function hashColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLOR_PALETTE[Math.abs(hash) % USER_COLOR_PALETTE.length];
}

function pickColor(takenColors: Set<string>, username: string): string {
  for (const color of USER_COLOR_PALETTE) {
    if (!takenColors.has(color)) return color;
  }
  return hashColor(username);
}

async function readMetadataFile(): Promise<UserMetadataFile> {
  if (!fileService.isConnected()) return { users: {} };
  const data = await fileService.readJson<UserMetadataFile>(METADATA_PATH);
  if (!data || typeof data !== "object" || !data.users) return { users: {} };
  return data;
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
}

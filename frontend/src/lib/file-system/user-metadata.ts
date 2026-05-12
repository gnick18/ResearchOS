import { fileService } from "./file-service";

const METADATA_PATH = "users/_user_metadata.json";

const USER_COLOR_PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export interface UserMetadataEntry {
  color: string;
  created_at: string;
  // Per-user opt-out from lab-mode goals visibility (#14). When true,
  // labApi.getGoals() skips this user. Default = false (visible).
  hide_goals_from_lab?: boolean;
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

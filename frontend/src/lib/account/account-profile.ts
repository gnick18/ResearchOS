// Cloud-accounts Phase 1 (Chunk B): the cloud account profile (Neon).
//
// This is the social, keypair-free part of an account: a globally-unique @handle
// plus a display name and affiliation, keyed by the account's OWNER KEY (the
// peppered email hash that billing already uses, ownerKeyForEmail). It is
// deliberately separate from the keypair-era `directory_profiles` (keyed by the
// Ed25519 fingerprint), because a cloud account exists BEFORE any data keypair.
// When a keypair is later provisioned (Phase 2) the two can be linked; for now
// this table is the account's LinkedIn-style identity, bound off the OAuth
// session alone with no client signature.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Account profiles cannot reach Neon.");
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export interface AccountProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  /**
   * Phase 3 Chunk 3A: a small profile avatar. v1 storage is a capped data URL
   * (a base64 PNG/JPEG/WEBP under AVATAR_MAX_BYTES) held inline on the row. R2 is
   * the scale path if avatars ever grow past a thumbnail, but a thumbnail-sized
   * data URL keeps the lookup a single read with no second fetch. Null when the
   * account has not set one, the UI falls back to an initial-based placeholder.
   */
  avatarUrl: string | null;
}

/**
 * Phase 3 Chunk 3A avatar cap. A thumbnail-sized avatar fits comfortably under
 * this; we reject anything larger server-side so a row stays small and the
 * profile read stays cheap. ~64KB of decoded image, measured on the raw data-URL
 * string length (base64 adds ~33%, so the on-the-wire string is allowed a little
 * more headroom than the decoded bytes).
 */
export const AVATAR_MAX_BYTES = 96 * 1024;

/** The image MIME types we accept for an avatar data URL. */
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Validates an avatar value for storage. Accepts null (clear the avatar) or a
 * data URL whose MIME is an allowed image type and whose total string length is
 * within AVATAR_MAX_BYTES. Returns null when valid, else a human reason. This is
 * pure so it is unit-tested and can be reused on both the client (pre-upload
 * gate) and the server (authoritative cap).
 */
export function validateAvatar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "The avatar must be an image data URL.";
  const v = value.trim();
  if (v === "") return null;
  const match = /^data:([a-z/+.-]+);base64,/i.exec(v);
  if (!match) return "The avatar must be a base64 image data URL.";
  if (!AVATAR_MIME.has(match[1].toLowerCase())) {
    return "Use a PNG, JPEG, or WEBP image.";
  }
  if (v.length > AVATAR_MAX_BYTES) {
    return "That image is too large. Pick one under 64 KB.";
  }
  return null;
}

/** Handles a third party could mistake for a system route or that we want to keep. */
const RESERVED = new Set([
  "account", "admin", "api", "app", "business", "dept", "department",
  "institution", "researchers", "settings", "u", "wiki", "demo", "pricing",
  "about", "login", "signin", "signup", "help", "support", "root", "system",
]);

/** Canonical handle form: lowercase, trimmed. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Validates a handle: 3-30 chars, lowercase alphanumeric plus single internal
 * hyphen/underscore, not reserved. Returns null when valid, else a reason.
 */
export function validateHandle(raw: string): string | null {
  const h = normalizeHandle(raw);
  if (h.length < 3) return "Handles need at least 3 characters.";
  if (h.length > 30) return "Handles can be at most 30 characters.";
  if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(h)) {
    return "Use letters, numbers, hyphens, and underscores; start and end with a letter or number.";
  }
  if (RESERVED.has(h)) return "That handle is reserved.";
  return null;
}

export async function ensureAccountProfileSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS account_profiles (
      owner_key     text PRIMARY KEY,
      handle        text NOT NULL UNIQUE,
      display_name  text,
      affiliation   text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  // Phase 3 Chunk 3A: additive, idempotent avatar column. A nullable TEXT holds
  // the capped data URL inline (see AVATAR_MAX_BYTES). Safe to run on every call.
  await sql`ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS avatar_url text`;
}

function rowToProfile(r: {
  handle: string;
  display_name: string | null;
  affiliation: string | null;
  avatar_url?: string | null;
}): AccountProfile {
  return {
    handle: r.handle,
    displayName: r.display_name,
    affiliation: r.affiliation,
    avatarUrl: r.avatar_url ?? null,
  };
}

/** The account's own profile, or null if they have not claimed a handle yet. */
export async function getAccountProfile(ownerKey: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT handle, display_name, affiliation, avatar_url FROM account_profiles WHERE owner_key = ${ownerKey} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null; avatar_url: string | null }>;
  return rows[0] ? rowToProfile(rows[0]) : null;
}

/** Public lookup by handle (for /u/<handle>). Read-only, no owner key revealed. */
export async function getAccountProfileByHandle(handle: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const h = normalizeHandle(handle);
  const rows = (await sql`
    SELECT handle, display_name, affiliation, avatar_url FROM account_profiles WHERE handle = ${h} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null; avatar_url: string | null }>;
  return rows[0] ? rowToProfile(rows[0]) : null;
}

/** Whether a handle is free (optionally ignoring the caller's own current row). */
export async function isHandleAvailable(
  handle: string,
  exceptOwnerKey?: string,
): Promise<boolean> {
  const sql = getSql();
  const h = normalizeHandle(handle);
  const rows = (await sql`
    SELECT owner_key FROM account_profiles WHERE handle = ${h} LIMIT 1
  `) as Array<{ owner_key: string }>;
  if (rows.length === 0) return true;
  return exceptOwnerKey != null && rows[0].owner_key === exceptOwnerKey;
}

/**
 * Creates or updates the caller's profile. Validates + enforces handle
 * uniqueness. Returns { ok: true, profile } or { ok: false, error }.
 */
export async function upsertAccountProfile(
  ownerKey: string,
  input: {
    handle: string;
    displayName?: string | null;
    affiliation?: string | null;
    /**
     * Phase 3 Chunk 3A. Pass a data URL to set the avatar, null to clear it, or
     * omit (undefined) to leave any existing avatar untouched. The data URL is
     * validated + capped here so an oversize image never reaches the row.
     */
    avatarUrl?: string | null;
  },
): Promise<{ ok: true; profile: AccountProfile } | { ok: false; error: string }> {
  const handleErr = validateHandle(input.handle);
  if (handleErr) return { ok: false, error: handleErr };
  const h = normalizeHandle(input.handle);
  if (!(await isHandleAvailable(h, ownerKey))) {
    return { ok: false, error: "That handle is already taken." };
  }
  // "Leave unchanged" (undefined) vs "set/clear" (string | null). When the caller
  // does not mention the avatar we keep the row's current value; otherwise we
  // validate the provided value and overwrite.
  const setAvatar = input.avatarUrl !== undefined;
  const avatar = input.avatarUrl ?? null;
  if (setAvatar) {
    const avatarErr = validateAvatar(input.avatarUrl);
    if (avatarErr) return { ok: false, error: avatarErr };
  }
  const sql = getSql();
  await ensureAccountProfileSchema();
  // Two explicit branches rather than a nested sql fragment: when the avatar is
  // mentioned we overwrite the column, otherwise we preserve the existing value
  // with COALESCE(EXCLUDED.avatar_url, account_profiles.avatar_url) where the
  // inserted value is the current one. Keeping the queries literal avoids any
  // tagged-template fragment ambiguity in the neon driver.
  type Row = {
    handle: string;
    display_name: string | null;
    affiliation: string | null;
    avatar_url: string | null;
  };
  let rows: Row[];
  if (setAvatar) {
    rows = (await sql`
      INSERT INTO account_profiles (owner_key, handle, display_name, affiliation, avatar_url, updated_at)
      VALUES (${ownerKey}, ${h}, ${input.displayName ?? null}, ${input.affiliation ?? null}, ${avatar}, now())
      ON CONFLICT (owner_key) DO UPDATE SET
        handle = EXCLUDED.handle,
        display_name = EXCLUDED.display_name,
        affiliation = EXCLUDED.affiliation,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now()
      RETURNING handle, display_name, affiliation, avatar_url
    `) as Row[];
  } else {
    rows = (await sql`
      INSERT INTO account_profiles (owner_key, handle, display_name, affiliation, updated_at)
      VALUES (${ownerKey}, ${h}, ${input.displayName ?? null}, ${input.affiliation ?? null}, now())
      ON CONFLICT (owner_key) DO UPDATE SET
        handle = EXCLUDED.handle,
        display_name = EXCLUDED.display_name,
        affiliation = EXCLUDED.affiliation,
        updated_at = now()
      RETURNING handle, display_name, affiliation, avatar_url
    `) as Row[];
  }
  return { ok: true, profile: rowToProfile(rows[0]) };
}

/** A base handle suggestion from an email or name (not guaranteed unique). */
export function baseHandleFrom(emailOrName: string): string {
  const local = emailOrName.split("@")[0] ?? emailOrName;
  let h = local.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  if (h.length < 3) h = `${h}researcher`.slice(0, 12);
  return h.slice(0, 24);
}

/** A free handle suggestion derived from an email/name, appending a counter if needed. */
export async function suggestHandle(emailOrName: string): Promise<string> {
  const base = baseHandleFrom(emailOrName);
  if (validateHandle(base) === null && (await isHandleAvailable(base))) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}${i}`.slice(0, 30);
    if (validateHandle(candidate) === null && (await isHandleAvailable(candidate))) {
      return candidate;
    }
  }
  return base; // fallback, the claim route will reject if truly taken
}

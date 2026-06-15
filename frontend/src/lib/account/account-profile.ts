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
import {
  EMPTY_LINKS,
  validateAvatar,
  validateBio,
  normalizeLinks,
  type ProfileLinks,
} from "./account-profile-validation";

// Re-export the pure validation surface so server callers keep importing from
// account-profile.ts. Client components import from account-profile-validation
// directly to stay off the Neon driver.
export {
  EMPTY_LINKS,
  AVATAR_MAX_BYTES,
  BIO_MAX_CHARS,
  validateAvatar,
  validateBio,
  normalizeLinks,
  type ProfileLinks,
} from "./account-profile-validation";

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
  /**
   * Wizard go-live (researcher-social-layer): a short free-text bio, capped at
   * BIO_MAX_CHARS. Null when unset. Editable in the profile step and Settings.
   */
  bio: string | null;
  /**
   * Wizard go-live: typed external links (ORCID, ResearchGate, personal site).
   * Always present as an object so callers never branch on undefined; an unset
   * link is null. Stored as a jsonb column so the set can grow without a schema
   * change.
   */
  links: ProfileLinks;
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
  // Wizard go-live: additive, idempotent bio + typed-links columns. bio is a
  // capped TEXT; links is jsonb so the set can grow without another migration.
  await sql`ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS bio text`;
  await sql`ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS links jsonb`;
}

/** Coerce a jsonb links value (object, JSON string, or null) into ProfileLinks. */
function parseLinks(raw: unknown): ProfileLinks {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...EMPTY_LINKS };
    }
  }
  if (!obj || typeof obj !== "object") return { ...EMPTY_LINKS };
  const v = obj as Record<string, unknown>;
  const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
  return {
    orcid: str(v.orcid),
    researchgate: str(v.researchgate),
    website: str(v.website),
  };
}

function rowToProfile(r: {
  handle: string;
  display_name: string | null;
  affiliation: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  links?: unknown;
}): AccountProfile {
  return {
    handle: r.handle,
    displayName: r.display_name,
    affiliation: r.affiliation,
    avatarUrl: r.avatar_url ?? null,
    bio: r.bio ?? null,
    links: parseLinks(r.links),
  };
}

/** The account's own profile, or null if they have not claimed a handle yet. */
export async function getAccountProfile(ownerKey: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT handle, display_name, affiliation, avatar_url, bio, links FROM account_profiles WHERE owner_key = ${ownerKey} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null; avatar_url: string | null; bio: string | null; links: unknown }>;
  return rows[0] ? rowToProfile(rows[0]) : null;
}

/** Public lookup by handle (for /u/<handle>). Read-only, no owner key revealed. */
export async function getAccountProfileByHandle(handle: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const h = normalizeHandle(handle);
  const rows = (await sql`
    SELECT handle, display_name, affiliation, avatar_url, bio, links FROM account_profiles WHERE handle = ${h} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null; avatar_url: string | null; bio: string | null; links: unknown }>;
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
    /**
     * Wizard go-live. Pass a string to set the bio, null to clear it, or omit
     * (undefined) to leave any existing bio untouched. Capped at BIO_MAX_CHARS.
     */
    bio?: string | null;
    /**
     * Wizard go-live. Pass a links object to set it (each field validated +
     * normalized), null to clear all links, or omit to leave existing links
     * untouched.
     */
    links?: Record<string, unknown> | null;
  },
): Promise<{ ok: true; profile: AccountProfile } | { ok: false; error: string }> {
  const handleErr = validateHandle(input.handle);
  if (handleErr) return { ok: false, error: handleErr };
  const h = normalizeHandle(input.handle);
  if (!(await isHandleAvailable(h, ownerKey))) {
    return { ok: false, error: "That handle is already taken." };
  }

  // Optional fields use "omit (undefined) = leave unchanged, null = clear,
  // value = set" semantics. To keep a single literal upsert (no per-field SQL
  // branching), we read the current row and merge the mentioned fields over it,
  // then write the merged values unconditionally.
  if (input.avatarUrl !== undefined) {
    const avatarErr = validateAvatar(input.avatarUrl);
    if (avatarErr) return { ok: false, error: avatarErr };
  }
  if (input.bio !== undefined) {
    const bioErr = validateBio(input.bio);
    if (bioErr) return { ok: false, error: bioErr };
  }
  let nextLinks: ProfileLinks | undefined;
  if (input.links !== undefined) {
    const norm = normalizeLinks(input.links);
    if (!norm.ok) return { ok: false, error: norm.error };
    nextLinks = norm.links;
  }

  const current = await getAccountProfile(ownerKey);
  const avatar =
    input.avatarUrl !== undefined ? input.avatarUrl ?? null : current?.avatarUrl ?? null;
  const bio =
    input.bio !== undefined ? input.bio?.trim() || null : current?.bio ?? null;
  const links = nextLinks ?? current?.links ?? EMPTY_LINKS;

  const sql = getSql();
  await ensureAccountProfileSchema();
  type Row = {
    handle: string;
    display_name: string | null;
    affiliation: string | null;
    avatar_url: string | null;
    bio: string | null;
    links: unknown;
  };
  const rows = (await sql`
    INSERT INTO account_profiles (owner_key, handle, display_name, affiliation, avatar_url, bio, links, updated_at)
    VALUES (${ownerKey}, ${h}, ${input.displayName ?? null}, ${input.affiliation ?? null}, ${avatar}, ${bio}, ${JSON.stringify(links)}::jsonb, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      handle = EXCLUDED.handle,
      display_name = EXCLUDED.display_name,
      affiliation = EXCLUDED.affiliation,
      avatar_url = EXCLUDED.avatar_url,
      bio = EXCLUDED.bio,
      links = EXCLUDED.links,
      updated_at = now()
    RETURNING handle, display_name, affiliation, avatar_url, bio, links
  `) as Row[];
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

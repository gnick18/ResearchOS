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
}

function rowToProfile(r: {
  handle: string;
  display_name: string | null;
  affiliation: string | null;
}): AccountProfile {
  return { handle: r.handle, displayName: r.display_name, affiliation: r.affiliation };
}

/** The account's own profile, or null if they have not claimed a handle yet. */
export async function getAccountProfile(ownerKey: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT handle, display_name, affiliation FROM account_profiles WHERE owner_key = ${ownerKey} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null }>;
  return rows[0] ? rowToProfile(rows[0]) : null;
}

/** Public lookup by handle (for /u/<handle>). Read-only, no owner key revealed. */
export async function getAccountProfileByHandle(handle: string): Promise<AccountProfile | null> {
  const sql = getSql();
  const h = normalizeHandle(handle);
  const rows = (await sql`
    SELECT handle, display_name, affiliation FROM account_profiles WHERE handle = ${h} LIMIT 1
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null }>;
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
  input: { handle: string; displayName?: string | null; affiliation?: string | null },
): Promise<{ ok: true; profile: AccountProfile } | { ok: false; error: string }> {
  const handleErr = validateHandle(input.handle);
  if (handleErr) return { ok: false, error: handleErr };
  const h = normalizeHandle(input.handle);
  if (!(await isHandleAvailable(h, ownerKey))) {
    return { ok: false, error: "That handle is already taken." };
  }
  const sql = getSql();
  await ensureAccountProfileSchema();
  const rows = (await sql`
    INSERT INTO account_profiles (owner_key, handle, display_name, affiliation, updated_at)
    VALUES (${ownerKey}, ${h}, ${input.displayName ?? null}, ${input.affiliation ?? null}, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      handle = EXCLUDED.handle,
      display_name = EXCLUDED.display_name,
      affiliation = EXCLUDED.affiliation,
      updated_at = now()
    RETURNING handle, display_name, affiliation
  `) as Array<{ handle: string; display_name: string | null; affiliation: string | null }>;
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

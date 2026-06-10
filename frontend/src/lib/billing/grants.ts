// Gift pools (operator-issued allowance grants). A "gift card" of free storage
// and/or monthly activity, added on top of an owner's plan allowance, so beta
// testers and goodwill cases get a bigger pool without a paid plan. Each grant
// sets its own bonus amounts and an optional expiry; the operator issues and
// revokes them one at a time from /admin/business.
//
// Keyed by owner_key (the peppered email hash, the same identity the rest of
// billing uses), so a grant on a PI's key lifts the whole LAB shared pool (the
// pool resolves to the PI key) and a grant on a solo user lifts theirs. The
// allowance functions in db.ts add getActiveGrant on top; the grant only ever
// matters once BILLING_ENABLED is on (enforcement is dormant until then), so
// grants can be seeded safely before launch.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Billing grants cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export interface GrantRecord {
  id: number;
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  /** The email or name the operator typed, so the admin roster is readable. */
  label: string | null;
  note: string | null;
  /** ISO string, or null for a permanent grant. */
  expiresAt: string | null;
  createdAt: string;
}

export async function ensureGrantsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_grants (
      id          BIGSERIAL PRIMARY KEY,
      owner_key   TEXT NOT NULL,
      bonus_bytes BIGINT NOT NULL DEFAULT 0,
      bonus_writes BIGINT NOT NULL DEFAULT 0,
      label       TEXT,
      note        TEXT,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_grants_owner_key
      ON billing_grants (owner_key)
  `;
}

/** Issues a gift pool to an owner. Returns the new grant id. */
export async function issueGrant(params: {
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  label?: string | null;
  note?: string | null;
  expiresAt?: string | null;
}): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO billing_grants
      (owner_key, bonus_bytes, bonus_writes, label, note, expires_at)
    VALUES (
      ${params.ownerKey},
      ${Math.max(0, Math.floor(params.bonusBytes))},
      ${Math.max(0, Math.floor(params.bonusWrites))},
      ${params.label ?? null},
      ${params.note ?? null},
      ${params.expiresAt ?? null}
    )
    RETURNING id
  `) as { id: number }[];
  return rows[0]?.id ?? 0;
}

/** Revokes (deletes) a grant by id. Idempotent. */
export async function revokeGrant(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM billing_grants WHERE id = ${id}`;
}

/**
 * The owner's total ACTIVE bonus (sum of non-expired grants on their key). A
 * grant with expires_at in the past stops counting automatically. Returns zeros
 * when the owner has no active grant.
 */
export async function getActiveGrant(
  ownerKey: string,
): Promise<{ bonusBytes: number; bonusWrites: number }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      COALESCE(SUM(bonus_bytes), 0) AS bytes,
      COALESCE(SUM(bonus_writes), 0) AS writes
    FROM billing_grants
    WHERE owner_key = ${ownerKey}
      AND (expires_at IS NULL OR expires_at > now())
  `) as Array<{ bytes: string | number; writes: string | number }>;
  return {
    bonusBytes: Number(rows[0]?.bytes ?? 0),
    bonusWrites: Number(rows[0]?.writes ?? 0),
  };
}

/** Every grant, newest first, for the operator roster. */
export async function listGrants(): Promise<GrantRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, owner_key, bonus_bytes, bonus_writes, label, note, expires_at, created_at
    FROM billing_grants
    ORDER BY created_at DESC
  `) as Array<{
    id: number;
    owner_key: string;
    bonus_bytes: string | number;
    bonus_writes: string | number;
    label: string | null;
    note: string | null;
    expires_at: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    ownerKey: r.owner_key,
    bonusBytes: Number(r.bonus_bytes),
    bonusWrites: Number(r.bonus_writes),
    label: r.label,
    note: r.note,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

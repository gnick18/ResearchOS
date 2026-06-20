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
// A grant can now also carry a comped plan TIER (gift_tier: "solo" | "lab" |
// "dept"). When present, the lab is treated as being on that tier for
// entitlement purposes, with no Stripe subscription and a $0 charge. A comped
// tier ALWAYS requires an expires_at (decision 3, Grant 2026-06-19): no
// permanent comped-tier grants. Allowance-only grants keep their existing
// optional-expiry behavior. AI tokens are a separate product and are never
// comped here (decision 1).
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

/** The three giftable plan tiers (Grant 2026-06-19, decision 2). */
export type GiftTier = "solo" | "lab" | "dept";

/** Tier rank for resolution: higher index = higher tier. */
const TIER_RANK: Record<GiftTier, number> = { solo: 1, lab: 2, dept: 3 };

export interface GrantRecord {
  id: number;
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  /** The email or name the operator typed, so the admin roster is readable. */
  label: string | null;
  note: string | null;
  /** ISO string, or null for a permanent allowance-only grant. A comped-tier
   *  grant always has this set (decision 3: no permanent comped tiers). */
  expiresAt: string | null;
  /** The comped plan tier, or null for an allowance-only grant. */
  giftTier: GiftTier | null;
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
  // Additive migration: comped plan tier column. NULL means allowance-only
  // (today's behavior), so existing rows are byte-identical to before.
  await sql`ALTER TABLE billing_grants ADD COLUMN IF NOT EXISTS gift_tier TEXT`;
}

/** Issues a gift pool to an owner. Returns the new grant id.
 *
 *  When giftTier is provided, expiresAt MUST also be provided because comped
 *  tiers are always time-bounded (Grant 2026-06-19, decision 3). Omitting it
 *  throws so the caller can surface a clear validation error to the UI. */
export async function issueGrant(params: {
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  label?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  giftTier?: GiftTier | null;
}): Promise<number> {
  // Decision 3: a comped tier always requires an expiry. Permanent comps are
  // not offered because an indefinite billing override would silently remove
  // cost visibility and be hard to audit or roll back.
  if (params.giftTier && !params.expiresAt) {
    throw new Error(
      `A comped tier (${params.giftTier}) requires an expiresAt. ` +
        "Permanent comped tiers are not allowed (Grant 2026-06-19, decision 3). " +
        "Provide a month count so the grant has a fixed end date.",
    );
  }
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO billing_grants
      (owner_key, bonus_bytes, bonus_writes, label, note, expires_at, gift_tier)
    VALUES (
      ${params.ownerKey},
      ${Math.max(0, Math.floor(params.bonusBytes))},
      ${Math.max(0, Math.floor(params.bonusWrites))},
      ${params.label ?? null},
      ${params.note ?? null},
      ${params.expiresAt ?? null},
      ${params.giftTier ?? null}
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

/**
 * The HIGHEST active comped plan tier on the owner key, or null when none is
 * active. "Active" means the grant is not expired (expires_at > now()). Tier
 * rank: dept > lab > solo. Returns null when the owner has no active
 * comped-tier grant.
 *
 * A grant resolves on the OWNER key, which is the PI key for a lab pool, so
 * a comp on the PI lifts the whole lab just as the allowance grant does. The
 * expiry filter matches getActiveGrant; the comped-tier filter mirrors that
 * pattern with the additional gift_tier IS NOT NULL guard.
 */
export async function getActiveCompedTier(
  ownerKey: string,
): Promise<GiftTier | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT gift_tier
    FROM billing_grants
    WHERE owner_key = ${ownerKey}
      AND gift_tier IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > now()
  `) as Array<{ gift_tier: string }>;
  if (rows.length === 0) return null;
  // Return the highest-ranked tier across all active comped grants.
  let best: GiftTier | null = null;
  for (const r of rows) {
    const t = r.gift_tier as GiftTier;
    if (!best || TIER_RANK[t] > TIER_RANK[best]) {
      best = t;
    }
  }
  return best;
}

/**
 * Deletes all billing_grants rows that were issued by staged PI provisioning for
 * this owner key. The note column identifies them: the stage route always writes
 * note = 'staged PI provision' (exactly). Returns the count of rows deleted.
 *
 * Called by the unstage route AFTER the slug is confirmed releasable (no bound
 * lab_sites row), so a deleted grant never belongs to an already-live lab.
 * Callers must ensure the staging row is still 'pending' before calling this.
 */
export async function revokeStagedGrant(ownerKey: string): Promise<number> {
  if (!ownerKey) return 0;
  const sql = getSql();
  const rows = (await sql`
    DELETE FROM billing_grants
    WHERE owner_key = ${ownerKey}
      AND note = 'staged PI provision'
    RETURNING id
  `) as Array<{ id: number }>;
  return rows.length;
}

/** Every grant, newest first, for the operator roster. */
export async function listGrants(): Promise<GrantRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, owner_key, bonus_bytes, bonus_writes, label, note, expires_at, gift_tier, created_at
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
    gift_tier: string | null;
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
    giftTier: (r.gift_tier as GiftTier | null) ?? null,
    createdAt: r.created_at,
  }));
}

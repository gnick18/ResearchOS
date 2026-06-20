// BeakerBot AI billing, Neon schema for the token ledger (Phase 1).
//
// Two tables, the same idempotent style as ensureBillingSchema in db.ts.
//   ai_balances: one row per owner (peppered email hash), the current token
//     balance and a one-shot flag recording that the sign-up gift has been minted
//     for this owner. Keying the gift to the owner row means it can be granted
//     exactly once and never re-minted.
//   ai_ledger: an append-only journal of every balance change (grant, usage,
//     topup), so the balance is always reconstructable and each charge is
//     auditable. usd_micros records the dollar value behind the tokens for our
//     own cost accounting and later Stripe reconciliation. stripe_event_id is the
//     idempotency key for Phase 3 top-ups (a redelivered Stripe event credits
//     once).
//
// The Neon driver is built lazily from DATABASE_URL, the same lazy singleton as
// db.ts and ops.ts. Schema creation is idempotent and cheap to call at the start
// of each ledger operation.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** The Neon tagged-template the ledger logic runs against. Matches the shape db.ts
 *  and ops.ts use, so the ledger can be unit-tested with a mock of this type. */
export type Sql = NeonQueryFunction<false, false>;

let sqlSingleton: Sql | null = null;

export function getSql(): Sql {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. AI billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

let schemaEnsured = false;

/** Creates the AI ledger tables if they do not exist. Idempotent, the same
 *  CREATE TABLE IF NOT EXISTS pattern as ensureBillingSchema. */
export async function ensureAiBillingSchema(sql: Sql = getSql()): Promise<void> {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_balances (
      owner_key text primary key,
      tokens_remaining bigint not null default 0,
      gift_granted boolean not null default false,
      updated_at timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_ledger (
      id bigserial primary key,
      owner_key text not null,
      kind text not null,
      tokens_delta bigint not null,
      task_id text,
      prompt_tokens int,
      completion_tokens int,
      cached_tokens int,
      usd_micros bigint,
      stripe_event_id text,
      created_at timestamptz default now()
    )
  `;
  // Additive, idempotent backfill of cached_tokens for a ledger created before
  // prompt-cache accounting (BeakerBot prompt-cache lever, 2026-06-20). cached_tokens
  // records how many of a turn's prompt_tokens were served from Fireworks' prompt
  // cache (it is on by default, so a stable ~50k prefix is re-read ~10x cheaper).
  // It is OUR cost-accounting only, it never changes what the user is charged. Runs
  // once on the next ledger op against an existing table, a no-op thereafter.
  await sql`ALTER TABLE ai_ledger ADD COLUMN IF NOT EXISTS cached_tokens int`;
  // A redelivered Stripe top-up event must credit once. A partial unique index on
  // the non-null event ids enforces that at the database level, belt and braces
  // with the application-level idempotency check in creditTokens.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_ledger_stripe_event_id_uniq
      ON ai_ledger (stripe_event_id)
      WHERE stripe_event_id IS NOT NULL
  `;
  schemaEnsured = true;
}

/** Test-only, resets the cached schema flag so a fresh mock sql is re-initialized. */
export function __resetAiSchemaCacheForTests(): void {
  schemaEnsured = false;
}

// BeakerBot AI billing, the token ledger logic (Phase 1).
//
// Reads and mutates the ai_balances / ai_ledger tables (ai-ledger-db.ts). Every
// balance change is both an UPDATE of the balance row and an append to the
// journal, done in ONE statement so the two can never drift. The functions take
// an optional sql seam (defaulting to the lazy Neon singleton) so the logic is
// unit-testable with a mocked tagged-template, no live DATABASE_URL needed.
//
// Fail-closed posture (this is money): the proxy that calls getOrGrantBalance
// refuses the model call when the balance is not positive, so a deduct that dips
// a single turn slightly negative is acceptable (the model cannot be un-asked
// once it answers), and the NEXT turn is then refused.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { STARTER_GRANT_TOKENS, usdMicrosForTokens } from "./ai-config";
import {
  ensureAiBillingSchema,
  getSql,
  type Sql,
} from "./ai-ledger-db";

type BalanceRow = { tokens_remaining: string | number };

/**
 * Returns the owner's current token balance, granting the one-time sign-up gift
 * on the FIRST call for this owner. Race-safe, two parallel first-calls cannot
 * both mint the gift, the INSERT ... ON CONFLICT DO NOTHING lets exactly one
 * winner create the row (and append the grant journal entry against the same
 * win), the loser re-reads the already-granted balance. Idempotent on re-reads
 * because gift_granted is set in the same insert, so a re-grant never fires.
 */
export async function getOrGrantBalance(
  ownerKey: string,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureAiBillingSchema(sql);

  // Atomic first-use grant. The CTE inserts the balance row with the gift only if
  // no row exists yet, and the ledger insert fires only when that insert actually
  // created the row (the SELECT on the CTE is empty on a conflict), so the journal
  // entry and the balance are minted together or not at all.
  await sql`
    WITH granted AS (
      INSERT INTO ai_balances (owner_key, tokens_remaining, gift_granted, updated_at)
      VALUES (${ownerKey}, ${STARTER_GRANT_TOKENS}, true, now())
      ON CONFLICT (owner_key) DO NOTHING
      RETURNING owner_key
    )
    INSERT INTO ai_ledger (owner_key, kind, tokens_delta, usd_micros)
    SELECT ${ownerKey}, 'grant', ${STARTER_GRANT_TOKENS}, ${usdMicrosForTokens(
      STARTER_GRANT_TOKENS,
    )}
    FROM granted
  `;

  const rows = (await sql`
    SELECT tokens_remaining FROM ai_balances WHERE owner_key = ${ownerKey}
  `) as BalanceRow[];
  return Number(rows[0]?.tokens_remaining ?? 0);
}

export interface UsageInput {
  taskId: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Deducts a turn's tokens from the balance and appends a usage journal row, in
 * one statement (the UPDATE and the ledger INSERT share a CTE so they are atomic).
 * Returns the new balance. The deduction is post-call because token counts are
 * only known once the model answers, so a single turn may dip the balance
 * slightly negative, that is by design and the next turn is refused.
 */
export async function recordUsage(
  ownerKey: string,
  input: UsageInput,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureAiBillingSchema(sql);
  const prompt = Math.max(0, Math.floor(input.promptTokens || 0));
  const completion = Math.max(0, Math.floor(input.completionTokens || 0));
  const total = prompt + completion;

  const rows = (await sql`
    WITH upd AS (
      UPDATE ai_balances
      SET tokens_remaining = tokens_remaining - ${total}, updated_at = now()
      WHERE owner_key = ${ownerKey}
      RETURNING tokens_remaining
    ),
    logged AS (
      INSERT INTO ai_ledger
        (owner_key, kind, tokens_delta, task_id, prompt_tokens, completion_tokens, usd_micros)
      SELECT ${ownerKey}, 'usage', ${-total}, ${input.taskId}, ${prompt},
             ${completion}, ${usdMicrosForTokens(total)}
      FROM upd
      RETURNING id
    )
    SELECT tokens_remaining FROM upd
  `) as BalanceRow[];
  return Number(rows[0]?.tokens_remaining ?? 0);
}

/**
 * Credits a prepaid top-up to the balance and appends a topup journal row,
 * idempotent on the Stripe event id (a redelivered webhook credits once). Defined
 * for Phase 3 (the Stripe top-up wiring), not yet called from any route. The
 * ON CONFLICT on the partial unique index over stripe_event_id is the
 * idempotency guard, a duplicate event inserts no ledger row and so adds no
 * tokens. Returns the resulting balance.
 */
export async function creditTokens(
  ownerKey: string,
  tokens: number,
  stripeEventId: string,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureAiBillingSchema(sql);
  const add = Math.max(0, Math.floor(tokens || 0));

  // Append the topup row only if this event id has not been recorded. The partial
  // unique index makes the INSERT a no-op on a redelivered event.
  const inserted = (await sql`
    INSERT INTO ai_ledger
      (owner_key, kind, tokens_delta, usd_micros, stripe_event_id)
    VALUES (${ownerKey}, 'topup', ${add}, ${usdMicrosForTokens(
      add,
    )}, ${stripeEventId})
    ON CONFLICT (stripe_event_id) WHERE stripe_event_id IS NOT NULL DO NOTHING
    RETURNING id
  `) as Array<{ id: string | number }>;

  // Only move the balance when the journal row was actually created, so the credit
  // and its record stay in lockstep and a duplicate event is a true no-op.
  if (inserted.length > 0) {
    const rows = (await sql`
      INSERT INTO ai_balances (owner_key, tokens_remaining, gift_granted, updated_at)
      VALUES (${ownerKey}, ${add}, false, now())
      ON CONFLICT (owner_key) DO UPDATE SET
        tokens_remaining = ai_balances.tokens_remaining + ${add},
        updated_at = now()
      RETURNING tokens_remaining
    `) as BalanceRow[];
    return Number(rows[0]?.tokens_remaining ?? 0);
  }

  const rows = (await sql`
    SELECT tokens_remaining FROM ai_balances WHERE owner_key = ${ownerKey}
  `) as BalanceRow[];
  return Number(rows[0]?.tokens_remaining ?? 0);
}

/** A recent task's summed usage, name-less (the UI labels it). */
export interface RecentTask {
  taskId: string;
  kind: string;
  tokens: number;
}

/**
 * The owner's recent usage tasks, grouped by task_id, newest first. Sums the
 * (negative) usage deltas into a positive token total per task, so the UI can
 * render one row per BeakerBot task with its cost. The kind is always "usage"
 * here (the journal kind), the UI names the task from its own per-task context.
 */
export async function getRecentTasks(
  ownerKey: string,
  limit = 10,
  sql: Sql = getSql(),
): Promise<RecentTask[]> {
  await ensureAiBillingSchema(sql);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 10));
  const rows = (await sql`
    SELECT task_id,
           SUM(-tokens_delta) AS tokens,
           MAX(created_at) AS last_at
    FROM ai_ledger
    WHERE owner_key = ${ownerKey} AND kind = 'usage' AND task_id IS NOT NULL
    GROUP BY task_id
    ORDER BY last_at DESC
    LIMIT ${safeLimit}
  `) as Array<{ task_id: string; tokens: string | number }>;
  return rows.map((r) => ({
    taskId: r.task_id,
    kind: "usage",
    tokens: Number(r.tokens ?? 0),
  }));
}

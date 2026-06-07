// Activity throttle (flat-plan model, chunk C, Grant 2026-06-07).
//
// Past a plan's monthly activity allowance we do NOT charge per write; we slow
// the account's cloud sync down. The mechanism is a push RATE LIMIT, not a drop:
// when an owner is over allowance, accepted pushes are spaced out (one every few
// seconds), so real-time sync degrades to periodic. This loses no data because
// the client holds the whole document locally (Loro) and simply retries the
// rejected push later, merging cleanly. Normal and even heavy human use never
// trips this; an automated or runaway client hits the wall.
//
// The whole throttle is dormant unless BILLING_ENABLED is on, so beta (free for
// everyone) runs the push path exactly as before.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { activityAllowanceForOwner } from "./db";
import { opsSince } from "./ops";

/** When over allowance, accept at most one push per this interval, per owner. */
export const THROTTLED_MIN_INTERVAL_MS = 5000;

let sqlSingleton: NeonQueryFunction<false, false> | null = null;
let schemaEnsured = false;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Throttle cannot reach Neon.");
  sqlSingleton = neon(url);
  return sqlSingleton;
}

async function ensureThrottleSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_throttle (
      owner_key text primary key,
      last_push_at timestamptz not null default now()
    )
  `;
  schemaEnsured = true;
}

/** First day of the current month, YYYY-MM-DD, the activity window start. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

export interface ThrottleState {
  /** Whether this owner is over their monthly activity allowance. */
  over: boolean;
  writes: number;
  allowance: number;
}

/**
 * Pure decision: is an owner over their allowance? A zero or negative allowance
 * means unlimited (never over), so a misconfigured plan never throttles.
 */
export function isOverAllowance(writes: number, allowance: number): boolean {
  return allowance > 0 && writes >= allowance;
}

/**
 * Whether an owner has passed their monthly activity allowance. Reads this
 * month's write count against the plan allowance. A zero/negative allowance is
 * treated as unlimited (never over), so a misconfigured plan never throttles.
 */
export async function activityThrottleState(ownerKey: string): Promise<ThrottleState> {
  const [{ writes }, allowance] = await Promise.all([
    opsSince(ownerKey, monthStartISO()).catch(() => ({ writes: 0, writtenBytes: 0 })),
    activityAllowanceForOwner(ownerKey).catch(() => 0),
  ]);
  return { over: isOverAllowance(writes, allowance), writes, allowance };
}

export interface RateGateResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Rate gate for an over-allowance owner. Allows a push only if at least
 * THROTTLED_MIN_INTERVAL_MS has passed since the last accepted one, recording
 * the new time atomically. When not allowed, the caller returns a retryable
 * signal and the client pushes again later (no data is lost, the edit stays in
 * the local Loro doc). Only call this for owners already known to be over.
 */
export async function rateGate(ownerKey: string): Promise<RateGateResult> {
  if (!schemaEnsured) await ensureThrottleSchema();
  const sql = getSql();
  const intervalMs = THROTTLED_MIN_INTERVAL_MS;
  // INSERT new owners (allowed); on conflict, only bump the timestamp if enough
  // time has passed. RETURNING is empty exactly when the gate blocks.
  const rows = (await sql`
    INSERT INTO billing_throttle (owner_key, last_push_at)
    VALUES (${ownerKey}, now())
    ON CONFLICT (owner_key) DO UPDATE SET last_push_at = now()
      WHERE billing_throttle.last_push_at < now() - (${intervalMs} || ' milliseconds')::interval
    RETURNING owner_key
  `) as { owner_key: string }[];
  const allowed = rows.length > 0;
  return { allowed, retryAfterMs: allowed ? 0 : intervalMs };
}

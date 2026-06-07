// Cost circuit breaker (Grant 2026-06-07).
//
// A global guard against a runaway provider bill, the case per-user billing
// cannot cover: the app goes viral while everyone is still on the free beta, and
// our Cloudflare / Vercel / Neon costs climb with no one paying. When the
// estimated monthly cost crosses a configured budget, the breaker TRIPS and the
// cost-driving cloud operations (collab writes, relay uploads) pause with a
// friendly "sync paused" message. The local-first app keeps working for everyone
// because local data never touches our servers, so nobody loses work, they just
// sync later.
//
// Decisions (Grant 2026-06-07): pause CLOUD WRITES only (not a full site gate),
// and MANUAL reset only (once tripped it stays tripped until the operator resets
// it on /admin, so spending never silently resumes).
//
// This is a SAFETY layer, active regardless of BILLING_ENABLED. It is inert
// until a budget is set (budget 0 = never auto-trips), and a manual trip always
// works. Provider-side hard caps (Vercel Spend Management, Neon limits) are the
// outer layer the operator sets on those dashboards; this is the graceful inner
// layer.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { estimateMonthlyInfraCostCents } from "@/lib/sharing/capacity-shared";
import { getCapacityMetrics } from "@/lib/sharing/capacity";
import { estimatedOpsCostCents } from "./config";
import { ensureOpsSchema, totalWritesSince } from "./ops";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;
let schemaEnsured = false;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Breaker cannot reach Neon.");
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export async function ensureBreakerSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_breaker (
      id           int primary key default 1,
      tripped      boolean not null default false,
      reason       text,
      tripped_at   timestamptz,
      budget_cents bigint not null default 0,
      updated_at   timestamptz default now()
    )
  `;
  // Seed the singleton row once.
  await sql`
    INSERT INTO billing_breaker (id) VALUES (1) ON CONFLICT (id) DO NOTHING
  `;
  schemaEnsured = true;
}

export interface BreakerState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null;
  budgetCents: number;
}

type BreakerRow = {
  tripped: boolean;
  reason: string | null;
  tripped_at: string | null;
  budget_cents: string | number;
};

export async function getBreakerState(): Promise<BreakerState> {
  if (!schemaEnsured) await ensureBreakerSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT tripped, reason, tripped_at, budget_cents FROM billing_breaker WHERE id = 1
  `) as BreakerRow[];
  const r = rows[0];
  return {
    tripped: r?.tripped === true,
    reason: r?.reason ?? null,
    trippedAt: r?.tripped_at ?? null,
    budgetCents: Number(r?.budget_cents ?? 0),
  };
}

/** Sets the monthly budget ceiling (cents). 0 disables auto-tripping. */
export async function setBudgetCents(cents: number): Promise<void> {
  if (!schemaEnsured) await ensureBreakerSchema();
  const sql = getSql();
  await sql`
    UPDATE billing_breaker
    SET budget_cents = ${Math.max(0, Math.floor(cents))}, updated_at = now()
    WHERE id = 1
  `;
  invalidateCache();
}

/** Trips the breaker (idempotent), recording the reason. */
export async function tripBreaker(reason: string): Promise<void> {
  if (!schemaEnsured) await ensureBreakerSchema();
  const sql = getSql();
  await sql`
    UPDATE billing_breaker
    SET tripped = true, reason = ${reason}, tripped_at = now(), updated_at = now()
    WHERE id = 1 AND tripped = false
  `;
  invalidateCache();
}

/** Operator reset (manual only, by decision). Clears the tripped state. */
export async function resetBreaker(): Promise<void> {
  if (!schemaEnsured) await ensureBreakerSchema();
  const sql = getSql();
  await sql`
    UPDATE billing_breaker
    SET tripped = false, reason = null, tripped_at = null, updated_at = now()
    WHERE id = 1
  `;
  invalidateCache();
}

/**
 * Evaluates the current estimated monthly cost against the budget and trips the
 * breaker if it is over. No-op when the budget is unset (0). Returns whether the
 * breaker is now tripped. Called by the cost-breaker cron.
 */
export async function evaluateBudget(
  currentCostCents: number,
): Promise<{ tripped: boolean; budgetCents: number; costCents: number }> {
  const state = await getBreakerState();
  if (
    !state.tripped &&
    state.budgetCents > 0 &&
    currentCostCents >= state.budgetCents
  ) {
    await tripBreaker(
      `estimated monthly cost ${currentCostCents} cents reached the ${state.budgetCents}-cent budget`,
    );
    return { tripped: true, budgetCents: state.budgetCents, costCents: currentCostCents };
  }
  return {
    tripped: state.tripped,
    budgetCents: state.budgetCents,
    costCents: currentCostCents,
  };
}

// --- global cost estimate ---------------------------------------------------

/** First day of the current month, YYYY-MM-DD. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

/** The fixed monthly base split by vendor (Workers + Vercel = $25). */
export const WORKERS_BASE_CENTS = 500;
export const VERCEL_BASE_CENTS = 2000;

export interface GlobalCostEstimate {
  /** Variable storage cost above the free tiers (DO + R2), excludes the base. */
  storageCents: number;
  /** Variable Durable Objects (collab doc) storage cost. */
  doCents: number;
  /** Variable R2 (file) storage cost. */
  r2Cents: number;
  /** Variable activity cost from this month's writes. */
  activityCents: number;
  /** The fixed monthly base (Workers + Vercel), shown for context, NOT budgeted. */
  fixedBaseCents: number;
  /** What the budget is compared against: variable cost only (storage + activity). */
  variableCents: number;
  /** Everything including the fixed base, for display. */
  totalCents: number;
}

/**
 * The estimated monthly cost across all providers. The breaker compares the
 * budget against the VARIABLE cost only (storage above the free tiers + this
 * month's activity), NOT the fixed base (Workers + Vercel), which we pay every
 * month regardless and is not a runaway signal. So a budget of "$20" means "$20
 * of variable spend above our normal fixed cost before we pause", which is the
 * intuitive thing. Activity is included because a viral spike shows up as writes
 * long before it shows up as stored bytes.
 */
export async function estimateGlobalMonthlyCostCents(): Promise<GlobalCostEstimate> {
  await ensureOpsSchema();
  const [metrics, writes] = await Promise.all([
    getCapacityMetrics().catch(() => null),
    totalWritesSince(monthStartISO()).catch(() => 0),
  ]);
  const storage = estimateMonthlyInfraCostCents(
    metrics?.neon.collabBytes ?? null,
    metrics?.r2.usedBytes ?? null,
  );
  // Variable storage = DO + R2 above their free tiers (excludes the fixed base).
  const storageCents = storage.doCents + storage.r2Cents;
  const activityCents = estimatedOpsCostCents(writes);
  const variableCents = storageCents + activityCents;
  return {
    storageCents,
    doCents: storage.doCents,
    r2Cents: storage.r2Cents,
    activityCents,
    fixedBaseCents: storage.fixedBaseCents,
    variableCents,
    totalCents: variableCents + storage.fixedBaseCents,
  };
}

// --- hot-path read (cached) -------------------------------------------------

let cache: { paused: boolean; exp: number } | null = null;
const CACHE_TTL_MS = 30_000;

function invalidateCache(): void {
  cache = null;
}

/**
 * Whether cloud writes are currently paused by the breaker. Cached for ~30s so
 * the cost-driving paths can call it on every request cheaply. Fails OPEN (not
 * paused) if the state cannot be read, so a DB hiccup never blocks writes; the
 * provider hard cap remains the backstop.
 */
export async function isCloudPaused(): Promise<boolean> {
  const now = Date.now();
  if (cache && cache.exp > now) return cache.paused;
  let paused = false;
  try {
    paused = (await getBreakerState()).tripped;
  } catch {
    paused = false; // fail open
  }
  cache = { paused, exp: now + CACHE_TTL_MS };
  return paused;
}

// AI ledger cleanup (DEV/OPERATOR tool). Pre-launch hygiene: the spend test and a
// large local top-up wrote real ai_balances / ai_ledger rows under test/demo
// owners. This lets the operator INSPECT those rows (GET) and DELETE a specific
// owner's rows (POST) before go-live, so real users start clean.
//
// GET  /api/dev/ai-ledger-cleanup            -> lists balances + per-owner ledger counts
// POST /api/dev/ai-ledger-cleanup {ownerKey} -> deletes that owner's rows
//
// Gated by BILLING_SIM_SECRET bearer (404 if unset/mismatched), same as
// billing-sim, so it is inert unless the operator holds the secret. NEVER deletes
// without an explicit ownerKey, so it can never wipe the whole table by accident.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { ensureAiBillingSchema, getSql } from "@/lib/billing/ai-ledger-db";

export const runtime = "nodejs";

function authed(request: Request): boolean {
  const secret = process.env.BILLING_SIM_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authed(request)) return new Response("not found", { status: 404 });
  try {
    const sql = getSql();
    await ensureAiBillingSchema(sql);
    const balances = (await sql`
      SELECT owner_key, tokens_remaining, gift_granted
      FROM ai_balances ORDER BY tokens_remaining DESC
    `) as Array<{ owner_key: string; tokens_remaining: number; gift_granted: boolean }>;
    const counts = (await sql`
      SELECT owner_key, count(*)::int AS rows FROM ai_ledger GROUP BY owner_key
    `) as Array<{ owner_key: string; rows: number }>;
    const ledgerByOwner = Object.fromEntries(counts.map((c) => [c.owner_key, c.rows]));
    return Response.json({
      ok: true,
      // owner keys are peppered hashes (operator-only surface), shown so the
      // operator can spot the obvious test owners (e.g. an implausibly large
      // tokens_remaining from the local top-up) before deleting.
      balances: balances.map((b) => ({
        ownerKey: b.owner_key,
        tokensRemaining: Number(b.tokens_remaining),
        giftGranted: b.gift_granted,
        ledgerRows: ledgerByOwner[b.owner_key] ?? 0,
      })),
    });
  } catch {
    return Response.json({ ok: false, error: "list failed" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!authed(request)) return new Response("not found", { status: 404 });
  let body: { ownerKey?: unknown };
  try {
    body = (await request.json()) as { ownerKey?: unknown };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const ownerKey = typeof body.ownerKey === "string" ? body.ownerKey.trim() : "";
  if (!ownerKey) {
    return Response.json({ ok: false, error: "ownerKey required" }, { status: 400 });
  }
  try {
    const sql = getSql();
    await ensureAiBillingSchema(sql);
    const ledger = (await sql`
      DELETE FROM ai_ledger WHERE owner_key = ${ownerKey} RETURNING id
    `) as Array<{ id: number }>;
    const balance = (await sql`
      DELETE FROM ai_balances WHERE owner_key = ${ownerKey} RETURNING owner_key
    `) as Array<{ owner_key: string }>;
    return Response.json({
      ok: true,
      ownerKey,
      deletedLedgerRows: ledger.length,
      deletedBalanceRows: balance.length,
    });
  } catch {
    return Response.json({ ok: false, error: "delete failed" }, { status: 500 });
  }
}

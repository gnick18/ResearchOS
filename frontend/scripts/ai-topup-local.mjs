#!/usr/bin/env node
// Local spend-test helper: tops up the ACTIVE tester's AI balance so a tiered
// spend test (heavy multi-turn tasks) does not hit the out-of-credits wall.
//
// Safety: it credits ONLY the single owner_key of the most recent ai_ledger
// activity (you, the person running the test). It never blanket-updates the
// table, so it is safe even if DATABASE_URL points at a shared/prod database.
//
// Run from frontend/:  node scripts/ai-topup-local.mjs [tokens]
// Default top-up sets the balance to 100,000,000 tokens.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const target = Number(process.argv[2]) || 100_000_000;

function loadDatabaseUrl() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in frontend/.env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const sql = neon(loadDatabaseUrl());

// The owner_key with the most recent ledger row is the active tester.
const recent = await sql`
  SELECT owner_key, MAX(created_at) AS last_at
  FROM ai_ledger
  GROUP BY owner_key
  ORDER BY last_at DESC
  LIMIT 5
`;

if (!recent.length) {
  console.log(
    "No ai_ledger rows yet. Run ONE BeakerBot turn first (so your balance row + owner_key exist), then re-run this.",
  );
  process.exit(0);
}

if (recent.length > 1) {
  console.log(`Found ${recent.length} active owner_keys (showing recent first):`);
  for (const r of recent) {
    console.log(`  ${String(r.owner_key).slice(0, 16)}...  last ${new Date(r.last_at).toLocaleString()}`);
  }
  console.log("\nCrediting only the MOST RECENT (the top one), which is you.");
}

const ownerKey = recent[0].owner_key;
const rows = await sql`
  UPDATE ai_balances
  SET tokens_remaining = ${target}, updated_at = now()
  WHERE owner_key = ${ownerKey}
  RETURNING tokens_remaining
`;

if (!rows.length) {
  console.log(`No ai_balances row for owner ${String(ownerKey).slice(0, 16)}... (unexpected). Nothing changed.`);
  process.exit(1);
}

console.log(
  `\nTopped up owner ${String(ownerKey).slice(0, 16)}... to ${Number(rows[0].tokens_remaining).toLocaleString()} tokens. Run your tiered tasks now.`,
);

#!/usr/bin/env node
// AI spend-test report. Reads the ai_ledger usage rows and computes the REAL
// blended inference cost + input:output split, so the bare-cost basis in
// src/lib/billing/ai-config.ts can be tuned from measurement instead of a guess.
//
// Run from frontend/:  node scripts/ai-spend-report.mjs [hoursWindow]
// Default window is the last 6 hours (the spend-test session). Read-only.
//
// Fireworks gpt-oss-120b standard tier: input $0.15/1M, output $0.60/1M.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const IN_RATE = 0.15 / 1_000_000; // $/token input (uncached)
const OUT_RATE = 0.6 / 1_000_000; // $/token output
// Fireworks prompt caching is on by default and serves a repeated prefix at a
// large discount (~80% off input). cached_tokens is a SUBSET of prompt_tokens, so
// real input cost = (prompt - cached) * IN_RATE + cached * CACHED_IN_RATE.
const CACHED_IN_RATE = IN_RATE * 0.2; // ~80% discount on cache-served input
const INDIVIDUAL_MARKUP = 1.4;
const ORG_MARKUP = 2.0;

const hours = Number(process.argv[2]) || 6;

function loadDatabaseUrl() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in frontend/.env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const fmt = (n) => Math.round(n).toLocaleString();
const per1m = (rate) => `$${(rate * 1_000_000).toFixed(3)}/1M`;

const sql = neon(loadDatabaseUrl());

const rows = await sql`
  SELECT task_id,
         SUM(prompt_tokens)             AS in_tok,
         SUM(completion_tokens)         AS out_tok,
         SUM(COALESCE(cached_tokens,0)) AS cached_tok,
         COUNT(*)                       AS turns,
         MAX(created_at)                AS last_at
  FROM ai_ledger
  WHERE kind = 'usage'
    AND created_at > now() - (${hours} || ' hours')::interval
  GROUP BY task_id
  ORDER BY last_at DESC
`;

if (!rows.length) {
  console.log(`No usage rows in the last ${hours}h. Run a few BeakerBot turns first (or widen the window: node scripts/ai-spend-report.mjs 24).`);
  process.exit(0);
}

let totalIn = 0;
let totalOut = 0;
let totalCached = 0;
let totalTurns = 0;

// Real cost of one turn, accounting for the prompt-cache discount on cached input.
const turnCost = (inT, cachedT, outT) =>
  (inT - cachedT) * IN_RATE + cachedT * CACHED_IN_RATE + outT * OUT_RATE;

console.log(`\n=== Per-task usage (last ${hours}h, newest first) ===`);
console.log(`  time      task              turns   in        cached    out      total     cost`);
for (const r of rows) {
  const inT = Number(r.in_tok || 0);
  const outT = Number(r.out_tok || 0);
  const cachedT = Math.min(inT, Number(r.cached_tok || 0));
  const tot = inT + outT;
  const cost = turnCost(inT, cachedT, outT);
  totalIn += inT;
  totalOut += outT;
  totalCached += cachedT;
  totalTurns += Number(r.turns || 0);
  const time = r.last_at ? new Date(r.last_at).toTimeString().slice(0, 8) : "--:--:--";
  console.log(
    `  ${time}  ${String(r.task_id).slice(0, 16).padEnd(16)}  ${String(r.turns).padStart(3)}    ${fmt(inT).padStart(8)}  ${fmt(cachedT).padStart(8)}  ${fmt(outT).padStart(7)}  ${fmt(tot).padStart(8)}  $${cost.toFixed(4)}`,
  );
}

const totalTokens = totalIn + totalOut;
const realCost = turnCost(totalIn, totalCached, totalOut);
const blendedRate = realCost / totalTokens; // $/token, the measured bare cost
const inPct = (100 * totalIn) / totalTokens;
const cacheHitPct = totalIn > 0 ? (100 * totalCached) / totalIn : 0;
// What the input would have cost with NO caching, so the savings are explicit.
const uncachedInputCost = totalIn * IN_RATE + totalOut * OUT_RATE;
const taskCount = rows.length;

console.log(`\n=== Totals ===`);
console.log(`  tasks: ${taskCount}   turns: ${totalTurns}`);
console.log(`  input tokens:  ${fmt(totalIn)}  (${inPct.toFixed(1)}%)`);
console.log(`  output tokens: ${fmt(totalOut)}  (${(100 - inPct).toFixed(1)}%)`);
console.log(`  total tokens:  ${fmt(totalTokens)}`);
console.log(`  our real cost: $${realCost.toFixed(4)}`);

console.log(`\n=== Prompt cache ===`);
console.log(`  cached input tokens: ${fmt(totalCached)} of ${fmt(totalIn)} input  (${cacheHitPct.toFixed(1)}% hit)`);
if (totalCached === 0) {
  console.log(`  NO cache hits seen. Either the prefix is not stable (a per-turn change early in`);
  console.log(`  the message order is busting it) or these rows predate cached_tokens accounting.`);
} else {
  console.log(`  cache saved us ~$${(uncachedInputCost - realCost).toFixed(4)} this window (${(100 * (1 - realCost / uncachedInputCost)).toFixed(1)}% off the no-cache cost)`);
}

console.log(`\n=== Measured rates ===`);
console.log(`  MEASURED blended bare cost: ${per1m(blendedRate)}`);
console.log(`  current basis (output rate): ${per1m(OUT_RATE)}  -> overcharging by ${(OUT_RATE / blendedRate).toFixed(2)}x vs real`);
console.log(`  avg cost per task: $${(realCost / taskCount).toFixed(4)}   avg tokens/task: ${fmt(totalTokens / taskCount)}`);

console.log(`\n=== If we set bare cost = measured blended (${per1m(blendedRate)}) ===`);
const indiv = blendedRate * INDIVIDUAL_MARKUP;
const org = blendedRate * ORG_MARKUP;
console.log(`  individual rate (1.4x): ${per1m(indiv)}`);
console.log(`  org rate (2.0x):        ${per1m(org)}`);
console.log(`  starter grant (25c @ indiv): ${fmt(0.25 / indiv)} tokens`);
console.log(`  packs $10/$25/$50: ${fmt(10 / indiv)} / ${fmt(25 / indiv)} / ${fmt(50 / indiv)} tokens`);
console.log(`  (vs current packs at $0.84/1M: 11,904,762 / 29,761,905 / 59,523,810)\n`);

console.log(
  "Tip: for per-tier pricing copy, paste this output and tell me which tasks were\n" +
    "light / medium / heavy (by time or order); I will compute per-tier averages\n" +
    "(tokens + cost per task) for the pricing page.\n",
);

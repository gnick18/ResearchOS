// Per-owner cap state, for the Cloudflare collab Durable Object to consult
// before persisting an enforced doc. The DO knows only the doc's owner_pubkey
// (Ed25519 hex, set on the first grant); it cannot read Neon directly, so it
// fetches this endpoint and caches the result. Returns { over, reason }.
//
// GET /api/billing/owner-state?ownerPubkey=<hex>
// Returns: { over: boolean, reason: "quota" | "activity" | null } -- over is true
// when the owner's lab-wide STORAGE pool exceeds its cap OR the monthly ACTIVITY
// pool exceeds its write allowance, AND billing enforcement is live. reason says
// which (storage wins when both).
//
// Dormant until launch: when BILLING_ENABLED is off this always returns
// { over: false }, so the per-owner cap is inert and the global breaker +
// per-doc cap + Vercel hard pause remain the only backstop. That matches the
// LAB_TIER_ENABLED flip not depending on per-owner enforcement.
//
// FAIL-OPEN everywhere: no binding, a DB hiccup, a missing pubkey, or any throw
// reads as { over: false }. A billing-side problem must never wedge collab. The
// DO caches this again and also fails open, so a Vercel hiccup is harmless too.
//
// Secret gate (RELAY_BREAKER_SECRET), same as breaker-state and doc-size: the
// request must carry `Authorization: Bearer <secret>` when the secret is set;
// open when unset (dev). The payload is a single boolean, so exposure if open is
// negligible, but the secret keeps it from being trivially polled in prod.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { NextResponse } from "next/server";

import { isBillingEnabled } from "@/lib/billing/config";
import { activityAllowanceForOwner, quotaBytesForOwner } from "@/lib/billing/db";
import { ensureLabSchema, resolveBillingOwner } from "@/lib/billing/lab";
import { currentWritePeriod } from "@/lib/billing/period";
import { resolveModelAPlanId } from "@/lib/billing/model-a/resolve";
import { modelACapState } from "@/lib/billing/model-a/enforcement";
import { getLabPoolUsage, getLabPoolWrites } from "@/lib/collab/server/db";
import { getBindingByPubkey } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

function notOver() {
  return NextResponse.json(
    { over: false, reason: null },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const secret = process.env.RELAY_BREAKER_SECRET;
  if (secret) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Dormant unless billing enforcement is live. Until launch the backstop is the
  // global breaker + per-doc cap, so per-owner caps never block a write.
  if (!isBillingEnabled()) return notOver();

  const url = new URL(req.url);
  const ownerPubkey = (url.searchParams.get("ownerPubkey") ?? "").trim();
  if (!ownerPubkey) return notOver();

  try {
    // Resolve the Ed25519 pubkey to the peppered email hash billing keys by
    // (the same hash the directory and ownerKeyForEmail use).
    const binding = await getBindingByPubkey(ownerPubkey);
    if (!binding) return notOver(); // no billable owner yet

    // Resolve to the BILLING owner so the cap is checked against the lab-wide
    // SHARED POOL, not the individual member. A lab member resolves to the PI's
    // key (one allowance for the whole lab); a solo user resolves to themselves.
    // The pool usage = the billing owner's own docs PLUS every active member's
    // docs (the tally stays keyed by the real owner for the PI's roster, so the
    // membership sum happens here). For a solo user there are no members, so the
    // pool is just their own usage.
    await ensureLabSchema();
    const ownerKey = await resolveBillingOwner(binding.emailHash);
    const period = currentWritePeriod();

    // Model A: a paid owner (solo/lab) is gated by their SETTABLE MONTHLY $ CAP,
    // not a storage byte cap (storage is a-la-carte, never a hard wall). A null
    // cap never trips, so an uncapped paid owner is only ever bounded by the
    // global cost breaker. Free owners fall through to the legacy free-allowance
    // check below (they have no produce/cloud usage to bill anyway).
    const planId = await resolveModelAPlanId(ownerKey);
    if (planId === "solo" || planId === "lab") {
      const capState = await modelACapState(ownerKey, period, { planId, labCount: 1 });
      return NextResponse.json(
        { over: capState.over, reason: capState.reason },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const [usage, cap, writes, writeAllowance] = await Promise.all([
      getLabPoolUsage(ownerKey),
      quotaBytesForOwner(ownerKey),
      getLabPoolWrites(ownerKey, period),
      activityAllowanceForOwner(ownerKey),
    ]);

    // Either the lab-wide storage pool is over its cap, or the lab-wide monthly
    // ACTIVITY pool is over its write allowance. Storage takes precedence in the
    // reason so the DO surfaces the more permanent "Storage limit reached"; an
    // activity-only overage shows "Monthly activity limit reached". Both pause
    // durable persistence (edits still fan out live + stay local).
    const storageOver = usage > cap;
    const activityOver = writes > writeAllowance;
    const reason = storageOver ? "quota" : activityOver ? "activity" : null;

    return NextResponse.json(
      { over: storageOver || activityOver, reason },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return notOver(); // fail open, never block collab on a read error
  }
}

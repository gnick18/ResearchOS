// Per-owner storage cap state, for the Cloudflare collab Durable Object to
// consult before persisting an enforced doc. The DO knows only the doc's
// owner_pubkey (Ed25519 hex, set on the first grant); it cannot read Neon
// directly, so it fetches this endpoint and caches the result. Returns { over }.
//
// GET /api/billing/owner-state?ownerPubkey=<hex>
// Returns: { over: boolean } -- true only when this owner's tallied usage
// exceeds their plan cap AND billing enforcement is live.
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
import { quotaBytesForOwner } from "@/lib/billing/db";
import { getOwnerUsage } from "@/lib/collab/server/db";
import { getBindingByPubkey } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

function notOver() {
  return NextResponse.json({ over: false }, { headers: { "cache-control": "no-store" } });
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

    const ownerKey = binding.emailHash;
    const [usage, cap] = await Promise.all([
      getOwnerUsage(ownerKey),
      quotaBytesForOwner(ownerKey),
    ]);

    return NextResponse.json(
      { over: usage > cap },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return notOver(); // fail open, never block collab on a read error
  }
}

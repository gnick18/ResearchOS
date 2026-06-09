// Cost-breaker pause state, for the Cloudflare collab Durable Object to consult
// before persisting. The DO cannot read the breaker DB (Neon) directly, so it
// fetches this endpoint and caches the result. Returns { paused }.
//
// isCloudPaused is itself cached (~30s) and FAIL-OPEN (a DB hiccup reads as
// not-paused), so this endpoint never wrongly blocks writes. The DO caches it
// again and also fails open, so a Vercel hiccup never wedges collab either.
//
// Optionally gated by a shared secret (RELAY_BREAKER_SECRET) so only the relay
// can read it; open when the secret is unset (dev). The payload is only a
// boolean, so the exposure if open is negligible, but the secret keeps it from
// being trivially polled in prod.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { NextResponse } from "next/server";

import { isCloudPaused } from "@/lib/billing/breaker";

export async function GET(req: Request) {
  const secret = process.env.RELAY_BREAKER_SECRET;
  if (secret) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let paused = false;
  try {
    paused = await isCloudPaused();
  } catch {
    paused = false; // fail open, never block collab on a read error
  }

  return NextResponse.json(
    { paused },
    { headers: { "cache-control": "no-store" } },
  );
}

// DO -> Vercel write-activity report. The Cloudflare collab Durable Object posts
// the number of durable writes it has applied since its last report here on each
// backup alarm tick, so the Neon collab_owner_writes monthly tally stays current
// for the per-owner ACTIVITY throttle (activity = compute, the real cost driver).
//
// POST /api/collab/activity
// Body: { ownerPubkey: string; writes: number }   // writes is a DELTA
// Returns: { ok: true }
//
// The month bucket (period) is stamped by SERVER time here, so the DO never
// needs a clock and month rollover is authoritative on Vercel. ownerPubkey
// (Ed25519 hex from the DO grant) resolves to the peppered email hash via
// getBindingByPubkey, exactly like /api/collab/doc-size; no binding -> no
// billable owner, skip silently. The tally is keyed by the REAL owner; the lab
// pool is summed at read time in owner-state.
//
// Secret gate (RELAY_BREAKER_SECRET): fail closed only when the secret is SET.
// Never throws to the caller (the DO must not retry-storm a metering hiccup).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { NextResponse } from "next/server";

import { currentWritePeriod } from "@/lib/billing/period";
import {
  ensureOwnerWritesSchema,
  incrementOwnerWrites,
} from "@/lib/collab/server/db";
import { getBindingByPubkey } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RELAY_BREAKER_SECRET;
  if (secret) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = (await req.json()) as {
      ownerPubkey?: unknown;
      writes?: unknown;
    };

    const ownerPubkey =
      typeof body.ownerPubkey === "string" ? body.ownerPubkey.trim() : "";
    const writes =
      typeof body.writes === "number" && Number.isFinite(body.writes)
        ? Math.max(0, Math.floor(body.writes))
        : 0;

    if (!ownerPubkey || writes <= 0) {
      return NextResponse.json({ ok: true });
    }

    const binding = await getBindingByPubkey(ownerPubkey);
    if (!binding) {
      // No directory binding yet: no billable owner. Skip silently.
      return NextResponse.json({ ok: true });
    }

    await ensureOwnerWritesSchema();
    await incrementOwnerWrites(binding.emailHash, writes, currentWritePeriod());

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

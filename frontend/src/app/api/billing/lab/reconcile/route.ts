// DO -> Vercel lab roster reconcile. The LabRecordDO posts its current member
// roster here whenever the membership log changes (create / add / remove /
// rotate), so a member who joined by an invite link gets enrolled in the lab's
// shared BILLING pool. Lab membership lives in the DO (Cloudflare), which has no
// Neon touchpoint, so this hook is the only place the billing layer learns who
// is in a lab. Closes the invite-link gap in LAB_SHARED_BILLING_POOL.md.
//
// POST /api/billing/lab/reconcile
// Body: { piPubkey: string, members: { pubkey: string; username?: string }[] }
// Returns: { ok: true }
//
// The DO sends Ed25519 PUBKEYS only (never emails); we resolve each to the
// peppered email hash the billing layer keys by, via getBindingByPubkey, exactly
// like the doc-size + owner-state routes. A pubkey with no directory binding has
// no billable identity yet, so it is skipped silently. If the PI's pubkey does
// not resolve there is no billable lab, so we skip the whole reconcile.
//
// Secret gate: if RELAY_BREAKER_SECRET is set the request must carry
// `Authorization: Bearer <secret>`; open when unset (local dev). Never throws to
// the caller (the DO must not retry-storm a billing hiccup).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { NextResponse } from "next/server";

import { ensureLabSchema, reconcileLabMembers } from "@/lib/billing/lab";
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
      piPubkey?: unknown;
      members?: unknown;
    };

    const piPubkey =
      typeof body.piPubkey === "string" ? body.piPubkey.trim() : "";
    if (!piPubkey) {
      return NextResponse.json({ error: "piPubkey required" }, { status: 400 });
    }
    const rawMembers = Array.isArray(body.members) ? body.members : [];

    // Resolve the PI pubkey to the billing lab owner key. No binding -> no
    // billable lab yet (the PI has not registered a directory identity), skip.
    const piBinding = await getBindingByPubkey(piPubkey);
    if (!piBinding) {
      return NextResponse.json({ ok: true });
    }
    const labOwnerKey = piBinding.emailHash;

    // Resolve each roster member pubkey to its billing key; skip unbindable ones.
    // A member with no directory binding has no billable identity YET (their
    // auto-bind has not landed, see lab-profile-auto-bind.ts). We count and log
    // these so the residual gap is observable instead of silent: a non-zero
    // `unbound` on a stable lab means a member is in the data lab but absent from
    // the billing pool, which a /lab/resync after their next login should clear.
    const resolved: { memberOwnerKey: string; label?: string | null }[] = [];
    let unbound = 0;
    for (const m of rawMembers) {
      const pubkey =
        m && typeof (m as { pubkey?: unknown }).pubkey === "string"
          ? (m as { pubkey: string }).pubkey.trim()
          : "";
      if (!pubkey) continue;
      const binding = await getBindingByPubkey(pubkey);
      if (!binding) {
        unbound += 1;
        continue; // no billable identity yet
      }
      const username = (m as { username?: unknown }).username;
      resolved.push({
        memberOwnerKey: binding.emailHash,
        label: typeof username === "string" ? username : null,
      });
    }

    await ensureLabSchema();
    await reconcileLabMembers(labOwnerKey, resolved);

    if (unbound > 0) {
      console.warn(
        `[billing] lab reconcile: ${unbound} roster member(s) have no directory binding yet and were not enrolled in the pool`,
      );
    }

    return NextResponse.json({ ok: true, enrolled: resolved.length, unbound });
  } catch {
    // Never throw to the DO; reconcile self-heals on the next membership change.
    return NextResponse.json({ ok: true });
  }
}

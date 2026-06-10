// DO -> Vercel size report. The Cloudflare collab Durable Object posts the
// current snapshot byteLength + owner pubkey here on each backup alarm tick
// (~5 min) so the Neon collab_doc_sizes table stays current for billing.
//
// POST /api/collab/doc-size
// Body: { docId: string; ownerPubkey: string; bytes: number }
// Returns: { ok: true }
//
// Secret gate: if RELAY_BREAKER_SECRET is set, the request must carry
// `Authorization: Bearer <secret>`. When the secret is unset (local dev or
// wrangler dev) the endpoint is open -- the payload is non-sensitive metering
// data, so the gate is a defence-in-depth measure, not a hard requirement.
//
// Resolution: ownerPubkey (Ed25519 hex from the DO grant) is resolved to an
// email hash via getBindingByPubkey. When no binding exists the doc has not
// been shared through the directory yet (e.g. an open in-lab doc that has
// never been granted), so it has no billable owner and we skip silently.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { NextResponse } from "next/server";

import { ensureDocSizesSchema, upsertDocSize } from "@/lib/collab/server/db";
import { getBindingByPubkey } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  // Shared-secret gate (fail closed only when the secret is set).
  const secret = process.env.RELAY_BREAKER_SECRET;
  if (secret) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = (await req.json()) as {
      docId?: unknown;
      ownerPubkey?: unknown;
      bytes?: unknown;
    };

    const docId = typeof body.docId === "string" ? body.docId.trim() : "";
    const ownerPubkey =
      typeof body.ownerPubkey === "string" ? body.ownerPubkey.trim() : "";
    const bytes =
      typeof body.bytes === "number" && Number.isFinite(body.bytes)
        ? Math.max(0, Math.floor(body.bytes))
        : -1;

    if (!docId || !ownerPubkey || bytes < 0) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    // Resolve Ed25519 pubkey to the peppered email hash the billing layer uses.
    const binding = await getBindingByPubkey(ownerPubkey);
    if (!binding) {
      // No directory binding yet: the doc has no billable owner. Skip silently.
      return NextResponse.json({ ok: true });
    }

    // Tally is keyed by the REAL doc owner (the member), so the PI's roster keeps
    // its per-member usage breakdown. The lab-wide SHARED POOL is computed at the
    // enforcement layer (owner-state) by summing the PI plus active members, so
    // the free tier is still a per-lab shared resource. See
    // docs/proposals/LAB_SHARED_BILLING_POOL.md.
    await ensureDocSizesSchema();
    await upsertDocSize({
      docId,
      ownerHash: binding.emailHash,
      bytes,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never throw to the caller: a metering failure must not surface as an
    // error to the DO (which would retry and clog the backup alarm path).
    return NextResponse.json({ ok: true });
  }
}

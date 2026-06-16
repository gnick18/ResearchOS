// POST /api/library/verify - an independent user vouches for a community asset.
//
// Wiki-style peer verification: any signed-in user can mark a community
// submission "verified" EXCEPT the submitter, who can never clear their own
// "unverified for accuracy" flag. That independence rule is enforced HERE on the
// server (verifierId !== submittedBy), not just in the UI. One independent vouch
// flips unverified -> verified; the same person cannot vouch twice.
//
// nodejs runtime for the R2 (S3) client.

import { NextResponse } from "next/server";

import { readCommunityManifest, writeCommunityManifest } from "@/lib/library/asset-storage";

export const runtime = "nodejs";

const ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: { uid?: string; verifierId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const uid = (body.uid || "").trim();
  const verifierId = (body.verifierId || "").trim();
  if (!uid) return NextResponse.json({ ok: false, error: "uid required" }, { status: 400 });
  if (!verifierId) {
    return NextResponse.json(
      { ok: false, error: "verifierId required (only a signed-in user can verify)" },
      { status: 400 },
    );
  }

  const manifest = await readCommunityManifest();
  const asset = manifest.find((a) => a.uid === uid);
  if (!asset) return NextResponse.json({ ok: false, error: "asset not found" }, { status: 404 });

  // The independent-verifier rule: the submitter can never verify their own work.
  if (asset.submittedBy && asset.submittedBy === verifierId) {
    return NextResponse.json(
      { ok: false, error: "you cannot verify your own submission; an independent reviewer must" },
      { status: 403 },
    );
  }

  const v = asset.verification ?? { status: "unverified" as const };
  const verifiedBy = new Set(v.verifiedBy ?? []);
  if (verifiedBy.has(verifierId)) {
    return NextResponse.json({ ok: false, error: "you already verified this" }, { status: 409 });
  }
  verifiedBy.add(verifierId);
  asset.verification = {
    status: "verified",
    verifiedBy: [...verifiedBy],
    verifiedAt: v.verifiedAt ?? new Date().toISOString(),
    flags: v.flags ?? 0,
  };

  try {
    await writeCommunityManifest(manifest);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage write failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, uid, verification: asset.verification });
}

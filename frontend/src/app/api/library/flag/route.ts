// POST /api/library/flag - report a community asset as wrong (bad license,
// mis-tagged, junk). Increments a flag count; once it crosses the threshold the
// asset is UNPUBLISHED from the community manifest (its SVG is left in storage to
// be garbage-collected later). Independent of the submitter, like verify.
//
// nodejs runtime for the R2 (S3) client.

import { NextResponse } from "next/server";

import { readCommunityManifest, writeCommunityManifest } from "@/lib/library/asset-storage";

export const runtime = "nodejs";

const ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

/** Reports needed to auto-unpublish a community asset. */
const FLAG_PULL_THRESHOLD = 3;

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: { uid?: string; reporterId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const uid = (body.uid || "").trim();
  if (!uid) return NextResponse.json({ ok: false, error: "uid required" }, { status: 400 });

  const manifest = await readCommunityManifest();
  const idx = manifest.findIndex((a) => a.uid === uid);
  if (idx === -1) return NextResponse.json({ ok: false, error: "asset not found" }, { status: 404 });

  const asset = manifest[idx];
  const v = asset.verification ?? { status: "unverified" as const };
  const flags = (v.flags ?? 0) + 1;
  let pulled = false;

  if (flags >= FLAG_PULL_THRESHOLD) {
    // Enough independent reports: unpublish. Drop it from the manifest so it stops
    // appearing; a previously-granted "verified" status does not save it.
    manifest.splice(idx, 1);
    pulled = true;
  } else {
    // Below threshold: record the report and knock any verified status back to
    // unverified so a contested asset is re-reviewed.
    asset.verification = {
      status: v.status === "curated" ? "curated" : "unverified",
      verifiedBy: v.verifiedBy,
      verifiedAt: v.verifiedAt,
      flags,
    };
  }

  try {
    await writeCommunityManifest(manifest);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage write failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, uid, flags, pulled });
}

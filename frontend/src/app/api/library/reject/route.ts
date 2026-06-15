// POST /api/library/reject - a signed-in reviewer rejects a community asset with
// a written reason. The asset leaves the live community manifest and moves to a
// separate community-removed.json, retained REMOVAL_RETENTION_DAYS so anyone can
// revert it (see /api/library/revert). The reviewer's @handle + reason are kept
// the whole time as an audit trail. Distinct from /flag (an anonymous vote count):
// a reject is one accountable actor pulling an asset, with justification.
//
// nodejs runtime for the R2 (S3) client.

import { NextResponse } from "next/server";

import {
  readCommunityManifest,
  writeCommunityManifest,
  readRemovedManifest,
  writeRemovedManifest,
} from "@/lib/library/asset-storage";
import { REMOVAL_RETENTION_DAYS, type RemovedAsset } from "@/lib/figure/asset-library";

export const runtime = "nodejs";

const ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

/** Minimum reason length so "no" or an empty space cannot stand in for a reason. */
const MIN_REASON = 4;

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: { uid?: string; actorId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const uid = (body.uid || "").trim();
  const actorId = (body.actorId || "").trim();
  const reason = (body.reason || "").trim();
  if (!uid) return NextResponse.json({ ok: false, error: "uid required" }, { status: 400 });
  if (!actorId) {
    return NextResponse.json(
      { ok: false, error: "actorId required (only a signed-in user can reject)" },
      { status: 400 },
    );
  }
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      { ok: false, error: `a written reason (at least ${MIN_REASON} characters) is required to reject` },
      { status: 400 },
    );
  }

  const manifest = await readCommunityManifest();
  const idx = manifest.findIndex((a) => a.uid === uid);
  if (idx === -1) {
    return NextResponse.json({ ok: false, error: "asset not found" }, { status: 404 });
  }
  const asset = manifest[idx];

  const now = new Date();
  const removal: RemovedAsset["removal"] = {
    removedAt: now.toISOString(),
    removedBy: actorId,
    reason,
    autoExpiresAt: new Date(
      now.getTime() + REMOVAL_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };

  // Pull from the live manifest, push into the removed manifest (de-duping any
  // prior removal record for the same uid).
  manifest.splice(idx, 1);
  const removed = await readRemovedManifest();
  const removedNext: RemovedAsset[] = removed.filter((a) => a.uid !== uid);
  removedNext.push({ ...asset, removal });

  try {
    await writeCommunityManifest(manifest);
    await writeRemovedManifest(removedNext);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage write failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, uid, removal });
}

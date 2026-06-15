// POST /api/library/revert - any signed-in user restores a removed (rejected)
// community asset within its retention window. It returns to the live manifest as
// "unverified" so it re-enters peer review. Past the window the GC has already
// purged the SVG + record, so a revert then returns 410 Gone.
//
// Wiki-style accountability: removals are not destructive for 30 days, and the
// undo is open to anyone with an account (not just the rejector), mirroring the
// app's Trash. nodejs runtime for the R2 (S3) client.

import { NextResponse } from "next/server";

import {
  readCommunityManifest,
  writeCommunityManifest,
  readRemovedManifest,
  writeRemovedManifest,
  purgeExpiredRemovals,
} from "@/lib/library/asset-storage";
import type { LibraryAsset } from "@/lib/figure/asset-library";

export const runtime = "nodejs";

const ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: { uid?: string; actorId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const uid = (body.uid || "").trim();
  const actorId = (body.actorId || "").trim();
  if (!uid) return NextResponse.json({ ok: false, error: "uid required" }, { status: 400 });
  if (!actorId) {
    return NextResponse.json(
      { ok: false, error: "actorId required (only a signed-in user can revert)" },
      { status: 400 },
    );
  }

  // GC first so an entry whose window lapsed is treated as gone, not revived.
  await purgeExpiredRemovals();

  const removed = await readRemovedManifest();
  const found = removed.find((a) => a.uid === uid);
  if (!found) {
    return NextResponse.json(
      { ok: false, error: "not in the removed list (already restored, or the 30-day window lapsed)" },
      { status: 410 },
    );
  }

  // Strip the removal block and re-publish as unverified so it re-enters review.
  const { removal: _removal, ...rest } = found;
  void _removal;
  const restored: LibraryAsset = { ...rest, verification: { status: "unverified", flags: 0 } };

  const manifest = await readCommunityManifest();
  if (!manifest.some((a) => a.uid === uid)) manifest.push(restored);
  const removedNext = removed.filter((a) => a.uid !== uid);

  try {
    await writeCommunityManifest(manifest);
    await writeRemovedManifest(removedNext);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage write failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, uid, restoredBy: actorId });
}

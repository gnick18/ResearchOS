// GET /api/library/removed - list community assets currently inside the 30-day
// removal window: each with who rejected it, the reason, and when it expires. Runs
// a lazy GC pass first so anything past its window is purged (and excluded) without
// needing a cron. Powers the "Recently removed" surface in the review queue.
//
// nodejs runtime for the R2 (S3) client.

import { NextResponse } from "next/server";

import { readRemovedManifest, purgeExpiredRemovals } from "@/lib/library/asset-storage";

export const runtime = "nodejs";

const ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

export async function GET() {
  if (!ENABLED) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  try {
    await purgeExpiredRemovals();
    const removed = await readRemovedManifest();
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage read failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

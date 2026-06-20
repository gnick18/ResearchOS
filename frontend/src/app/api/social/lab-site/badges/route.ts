// Lab badge snapshot publish endpoint (badges phase 2, social lane).
//
//   PUT /api/social/lab-site/badges  -> write the caller's published badge
//     snapshot to their lab_sites row. Body: { badgeSnapshot: unknown }.
//     The snapshot is validated via parseBadgeSnapshot (the single defensive
//     boundary), then serialized and stored via upsertLabBadgeSnapshot.
//
// Authorization mirrors /api/social/lab-site/page exactly: flag check, session
// -> owner key resolution, owns-lab check, entitlement check. The inline
// authorizePageWrite helper from the page route is reproduced here (same logic,
// same order, same fail-closed contract) rather than shared so this file stays
// self-contained and the page route cannot drift.
//
// A null or empty badgeSnapshot field clears a previously published snapshot so
// the public page renders nothing for badges.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import { getSiteByOwner, upsertLabBadgeSnapshot } from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import {
  parseBadgeSnapshot,
  serializeBadgeSnapshot,
} from "@/lib/badges/snapshot";

export const runtime = "nodejs";

/**
 * Shared auth gate for badge writes: flag, session, ownership, entitlement.
 * Returns the resolved owner key on success, or a denial Response on any
 * failure. Fails closed in order: flag -> signed-in -> owns-lab -> entitled.
 */
async function authorizeBadgeWrite(): Promise<
  { ok: true; ownerKey: string } | { ok: false; response: Response }
> {
  if (!isLabSitesEnabled()) {
    return { ok: false, response: json(404, { error: "not found" }) };
  }
  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  // Badge writes target the caller's own lab (targetOwnerKey === callerOwnerKey
  // by construction), so a caller can never publish to another lab's snapshot.
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return { ok: false, response: json(verdict.status, { error: verdict.error }) };
  }
  return { ok: true, ownerKey: callerOwnerKey as string };
}

// ---------------------------------------------------------------------------
// PUT -- publish (or clear) the lab's badge snapshot
// ---------------------------------------------------------------------------

export async function PUT(request: Request): Promise<Response> {
  const gate = await authorizeBadgeWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // Validate the body shape. The badgeSnapshot field is REQUIRED (unlike the
  // optional snapshots on a page publish). An absent or non-object value is a
  // 400 so the caller cannot accidentally publish an empty snapshot silently.
  if (!body || typeof body !== "object") {
    return json(400, { error: "invalid request" });
  }
  const b = body as Record<string, unknown>;
  if (!("badgeSnapshot" in b)) {
    return json(400, { error: "invalid request" });
  }

  // parseBadgeSnapshot is the single defensive boundary: it normalizes the
  // untrusted incoming shape and re-validates pins against the earned set, so a
  // buggy or malicious client can never store an unearned pin.
  const snapshot = parseBadgeSnapshot(b.badgeSnapshot);

  // The lab must have a site row before we can write a badge snapshot to it.
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  const badgeSnapshotJson = serializeBadgeSnapshot(snapshot);

  try {
    await upsertLabBadgeSnapshot(ownerKey, badgeSnapshotJson);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, { ok: true });
}

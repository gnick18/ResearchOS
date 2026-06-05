// Phase 3c chunk 1: collab open route.
//
// POST /api/collab/open
//
// Body (signed collab-open request):
//   { action: "collab-open", email, issuedAt, docId, signature }
//
// Returns:
//   { snapshot: string | null, updates: string[], version: number }
//   where snapshot and each update are base64-encoded Loro bytes.
//
// The client calls this when opening a shared note to pull the canonical
// server state. It reconciles this against its local Loro doc, then joins
// the live DO room (chunk 2). No DB write happens here, only a read.
//
// Auth: Ed25519 signed collab-open request, caller must be a doc member.
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL.

import {
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyCollabRequest } from "@/lib/collab/server/auth";
import { ensureCollabSchema, getCatchup, isMember } from "@/lib/collab/server/db";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "open failed" } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  await ensureCollabSchema();

  const verified = await verifyCollabRequest(body, "collab-open", getPepper());
  if (!verified) {
    return json(400, GENERIC_FAILURE);
  }

  const { emailHash, parsed } = verified;
  const { docId } = parsed;

  // Membership check. The caller must be a registered member of the doc.
  const member = await isMember(docId, emailHash);
  if (!member) {
    return json(403, { error: "not a member" });
  }

  const catchup = await getCatchup(docId);
  if (!catchup) {
    // The doc row does not exist yet. The grant route creates it, so a missing
    // doc at open time means the caller has a stale membership (should not happen
    // in normal flow but treat as forbidden rather than exposing the doc absence).
    return json(404, { error: "doc not found" });
  }

  // Encode binary blobs as base64 for JSON transport.
  const snapshotB64 = catchup.snapshot
    ? Buffer.from(catchup.snapshot).toString("base64")
    : null;

  const updatesB64 = catchup.updates.map((u) =>
    Buffer.from(u.updateBytes).toString("base64"),
  );

  return json(200, {
    snapshot: snapshotB64,
    updates: updatesB64,
    version: catchup.version,
  });
}

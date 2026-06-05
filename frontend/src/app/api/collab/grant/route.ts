// Phase 3c chunk 1: collab grant route.
//
// POST /api/collab/grant
//
// Body (signed collab-grant request):
//   { action: "collab-grant", email, issuedAt, docId, memberEmail, signature }
//
// Returns:
//   { ok: true }
//
// Adds a collaborator to a doc server-side. The caller MUST be the doc owner.
// The new member's email is resolved to their directory email hash via the
// existing directory lookup; they must be a registered ResearchOS user. Once
// added, the member can call /api/collab/open and /api/collab/push.
//
// If the doc row does not exist yet (this is the first share grant for a new
// doc), the route creates it with the caller as owner, then adds the member.
//
// Auth: Ed25519 signed collab-grant request, caller must be the doc owner.
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL.

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { getBindingByHash } from "@/lib/sharing/directory/db";
import {
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyCollabRequest } from "@/lib/collab/server/auth";
import {
  addMember,
  createCollabDoc,
  ensureCollabSchema,
  getOwner,
  isMember,
} from "@/lib/collab/server/db";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "grant failed" } as const;

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

  const verified = await verifyCollabRequest(body, "collab-grant", getPepper());
  if (!verified) {
    return json(400, GENERIC_FAILURE);
  }

  const { emailHash: callerHash, parsed } = verified;
  const { docId } = parsed;
  // memberEmail is guaranteed present for collab-grant (parseCollabBody checks it).
  const memberEmailRaw = parsed.memberEmail as string;

  // If the doc already exists, the caller must be the owner.
  // If the doc does not exist yet, the caller becomes the owner (first grant).
  const existingOwner = await getOwner(docId);
  if (existingOwner !== null && existingOwner !== callerHash) {
    return json(403, { error: "not the owner" });
  }

  // Resolve the member email to their directory hash. They must be registered.
  const memberCanonical = canonicalizeEmail(memberEmailRaw);
  const memberHash = hashEmail(memberCanonical, getPepper());
  const memberBinding = await getBindingByHash(memberHash);
  if (!memberBinding) {
    return json(404, { error: "member is not on ResearchOS" });
  }

  // Create the doc row if it does not exist yet.
  if (existingOwner === null) {
    try {
      await createCollabDoc({ docId, ownerEmailHash: callerHash });
    } catch {
      // A race where two concurrent first-grants for the same doc both try to
      // create it. Ignore the duplicate, the row exists.
    }
  }

  // Idempotent: addMember upserts on conflict.
  const alreadyMember = await isMember(docId, memberHash);
  if (!alreadyMember) {
    await addMember(docId, memberHash, "editor");
  }

  return json(200, { ok: true });
}

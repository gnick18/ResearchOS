// Phase 3c chunk 1: collab revoke route.
//
// POST /api/collab/revoke
//
// Body (signed collab-revoke request):
//   { action: "collab-revoke", email, issuedAt, docId, memberEmail, signature }
//
// Returns:
//   { ok: true }
//
// Removes a collaborator from a doc. The caller MUST be the doc owner. If the
// member being removed is the last remaining member (including the owner
// themselves), the entire doc is deleted from the server: collab_docs,
// collab_doc_updates, and collab_doc_members are all cleared. This implements
// the "stop-sharing removes the server copy" rule from the design doc section 8,
// decision 3.
//
// Auth: Ed25519 signed collab-revoke request, caller must be the doc owner.
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL.

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyCollabRequest } from "@/lib/collab/server/auth";
import {
  deleteCollabDoc,
  ensureCollabSchema,
  getOwner,
  listMembers,
  removeMember,
} from "@/lib/collab/server/db";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "revoke failed" } as const;

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

  const verified = await verifyCollabRequest(body, "collab-revoke", getPepper());
  if (!verified) {
    return json(400, GENERIC_FAILURE);
  }

  const { emailHash: callerHash, parsed } = verified;
  const { docId } = parsed;
  const memberEmailRaw = parsed.memberEmail as string;

  // Caller must be the doc owner.
  const existingOwner = await getOwner(docId);
  if (!existingOwner || existingOwner !== callerHash) {
    return json(403, { error: "not the owner" });
  }

  // Resolve the member email to their directory hash.
  const memberCanonical = canonicalizeEmail(memberEmailRaw);
  const memberHash = hashEmail(memberCanonical, getPepper());

  // Remove the member.
  await removeMember(docId, memberHash);

  // If no members remain after the removal, delete the entire doc server copy.
  // This covers the case where the owner revokes the last external collaborator
  // and then also revokes themselves (or revokes the only other member on a
  // two-person doc), effectively stopping all sharing.
  const remaining = await listMembers(docId);
  if (remaining.length === 0) {
    await deleteCollabDoc(docId);
  }

  return json(200, { ok: true });
}

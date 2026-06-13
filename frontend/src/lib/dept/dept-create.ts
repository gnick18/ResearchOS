// Department tier Phase 1: client entry to create a department + become its admin.
//
// Mirrors lab-create.ts one tier up, but lighter: there is no relay/DO and no lab
// key. We generate a dept id, POST the public bits to /api/dept/create (the
// admin_owner_key is derived server-side from the session), and return the id.
// The CALLER persists `dept_admin_of` to the user's settings (a later slice).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

export interface CreateDeptResult {
  deptId: string;
  /** True when the caller already administered a department (idempotent re-entry). */
  existing: boolean;
}

/**
 * Creates a department for the current user. Requires an unlocked identity (its
 * signing pubkey is stored so the dept-join route can verify the invites this
 * admin later mints).
 *
 * @throws if the API rejects the create.
 */
export async function createDeptForCurrentUser(params: {
  identity: StoredIdentity;
  name: string;
  idImpl?: () => string;
}): Promise<CreateDeptResult> {
  const name = params.name.trim();
  if (!name) throw new Error("createDeptForCurrentUser: a department name is required");
  const deptId = (params.idImpl ?? (() => crypto.randomUUID()))();
  const res = await fetch("/api/dept/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deptId,
      name,
      adminEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    }),
  });
  if (!res.ok) {
    throw new Error(`createDeptForCurrentUser: create rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { deptId?: string; existing?: boolean };
  return { deptId: data.deptId ?? deptId, existing: data.existing === true };
}

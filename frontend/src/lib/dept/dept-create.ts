// Department tier: client entry to create a department + become its admin.
//
// Mirrors lab-create.ts one tier up, but lighter: there is no relay/DO and no lab
// key. We generate a dept id and POST { deptId, name } to /api/dept/create; the
// admin_owner_key is derived server-side from the authenticated session, so this
// needs no local device identity and works in a folderless browser. Invites are
// server-issued opaque tokens, so no admin signing key is sent. The CALLER
// persists `dept_admin_of` to the user's settings only when a folder is connected.
//
// No emojis, no em-dashes, no mid-sentence colons.

export interface CreateDeptResult {
  deptId: string;
  /** True when the caller already administered a department (idempotent re-entry). */
  existing: boolean;
}

/**
 * Creates a department for the current authenticated user (server derives the
 * admin owner key from the session email).
 *
 * @throws if the API rejects the create.
 */
export async function createDeptForCurrentUser(params: {
  name: string;
  idImpl?: () => string;
}): Promise<CreateDeptResult> {
  const name = params.name.trim();
  if (!name) throw new Error("createDeptForCurrentUser: a department name is required");
  const deptId = (params.idImpl ?? (() => crypto.randomUUID()))();
  const res = await fetch("/api/dept/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deptId, name }),
  });
  if (!res.ok) {
    throw new Error(`createDeptForCurrentUser: create rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { deptId?: string; existing?: boolean };
  return { deptId: data.deptId ?? deptId, existing: data.existing === true };
}

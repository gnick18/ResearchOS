// Institution tier: client entry to create an institution + become admin.
// Mirrors dept-create.ts one tier up. Creates off the authenticated session
// (server derives the admin owner key from the email), so no local device
// identity is needed and it works in a folderless browser. Invites are
// server-issued opaque tokens, so no admin signing key is sent.
//
// No emojis, no em-dashes, no mid-sentence colons.

export interface CreateInstitutionResult {
  institutionId: string;
  existing: boolean;
}

export async function createInstitutionForCurrentUser(params: {
  name: string;
  idImpl?: () => string;
}): Promise<CreateInstitutionResult> {
  const name = params.name.trim();
  if (!name) throw new Error("createInstitutionForCurrentUser: a name is required");
  const institutionId = (params.idImpl ?? (() => crypto.randomUUID()))();
  const res = await fetch("/api/institution/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ institutionId, name }),
  });
  if (!res.ok) {
    throw new Error(`createInstitutionForCurrentUser: rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { institutionId?: string; existing?: boolean };
  return { institutionId: data.institutionId ?? institutionId, existing: data.existing === true };
}

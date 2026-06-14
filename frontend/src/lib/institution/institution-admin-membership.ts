// Institution tier Phase 4: admin-side helpers (mint a dept-admin invite, read
// the dept roster). Mirrors dept-admin-membership.ts one tier up.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";

/**
 * Mints an institution invite via the server (unified opaque-token invites) and
 * returns the shareable /institution/join#<token> link. No local signing key, so
 * it works folderless; the server authorizes the caller as the institution admin.
 *
 * @throws if the API rejects the mint.
 */
export async function mintInviteForInstitutionAdmin(params: {
  institutionId: string;
  origin: string;
}): Promise<{ link: string }> {
  const res = await fetch("/api/institution/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ institutionId: params.institutionId }),
  });
  if (!res.ok) {
    throw new Error(`mintInviteForInstitutionAdmin: mint rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("mintInviteForInstitutionAdmin: no token returned");
  return { link: `${params.origin}/institution/join#${data.token}` };
}

export interface InstitutionRosterDept {
  deptId: string;
  label: string | null;
  status: "invited" | "active" | "declined";
}
export interface InstitutionRosterResult {
  institution: { institutionId: string; name: string } | null;
  depts: InstitutionRosterDept[];
}

export async function loadInstitutionRoster(): Promise<InstitutionRosterResult> {
  if (isDemoOrWikiCapture()) {
    const { demoInstitutionRoster } = await import("./demo-fixtures");
    return demoInstitutionRoster();
  }
  try {
    const res = await fetch("/api/institution/roster");
    if (!res.ok) return { institution: null, depts: [] };
    const data = (await res.json()) as Partial<InstitutionRosterResult>;
    return {
      institution: data.institution ?? null,
      depts: Array.isArray(data.depts) ? data.depts : [],
    };
  } catch {
    return { institution: null, depts: [] };
  }
}

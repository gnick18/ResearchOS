// Institution tier Phase 4: admin-side helpers (mint a dept-admin invite, read
// the dept roster). Mirrors dept-admin-membership.ts one tier up.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import {
  mintInstitutionInvite,
  encodeInstitutionInviteLink,
  DEFAULT_INSTITUTION_INVITE_TTL_MS,
  type InstitutionInvitePayload,
} from "./institution-invite";

export function mintInviteForInstitutionAdmin(params: {
  institutionId: string;
  institutionName: string;
  username: string;
  identity: StoredIdentity;
  origin: string;
  ttlMs?: number;
}): { invite: InstitutionInvitePayload; link: string } {
  const invite = mintInstitutionInvite({
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    adminUsername: params.username,
    adminEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    adminEd25519Priv: params.identity.keys.signing.privateKey,
    expiresAt: Date.now() + (params.ttlMs ?? DEFAULT_INSTITUTION_INVITE_TTL_MS),
  });
  return { invite, link: encodeInstitutionInviteLink(params.origin, invite) };
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

// Department tier Phase 1: head-side helpers for the dept admin surface.
//
// Mint a lab-head invite link, and read the dept roster, without threading the
// dept session through React context. Mirrors lab-head-membership.ts one tier up.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import {
  mintDeptInvite,
  encodeDeptInviteLink,
  DEFAULT_DEPT_INVITE_TTL_MS,
  type DeptInvitePayload,
} from "./dept-invite";

/** Mints a dept invite for a lab head and returns the payload + shareable link. */
export function mintInviteForDeptAdmin(params: {
  deptId: string;
  deptName: string;
  username: string;
  identity: StoredIdentity;
  origin: string;
  ttlMs?: number;
}): { invite: DeptInvitePayload; link: string } {
  const invite = mintDeptInvite({
    deptId: params.deptId,
    deptName: params.deptName,
    adminUsername: params.username,
    adminEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    adminEd25519Priv: params.identity.keys.signing.privateKey,
    expiresAt: Date.now() + (params.ttlMs ?? DEFAULT_DEPT_INVITE_TTL_MS),
  });
  return { invite, link: encodeDeptInviteLink(params.origin, invite) };
}

export interface DeptRosterLabHead {
  memberKey: string;
  label: string | null;
  status: "invited" | "active" | "declined";
}
export interface DeptRosterResult {
  department: { deptId: string; name: string } | null;
  labHeads: DeptRosterLabHead[];
}

/** Reads the current dept admin's department + lab-head roster. Null-safe. In
 *  demo / wiki-capture mode there is no account or Neon, so a fixture roster
 *  stands in (the contained dept demo). */
export async function loadDeptRoster(): Promise<DeptRosterResult> {
  if (isDemoOrWikiCapture()) {
    const { demoDeptRoster } = await import("./demo-fixtures");
    return demoDeptRoster();
  }
  try {
    const res = await fetch("/api/dept/roster");
    if (!res.ok) return { department: null, labHeads: [] };
    const data = (await res.json()) as Partial<DeptRosterResult>;
    return {
      department: data.department ?? null,
      labHeads: Array.isArray(data.labHeads) ? data.labHeads : [],
    };
  } catch {
    return { department: null, labHeads: [] };
  }
}

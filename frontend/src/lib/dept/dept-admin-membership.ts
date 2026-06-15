// Department tier Phase 1: head-side helpers for the dept admin surface.
//
// Mint a lab-head invite link, and read the dept roster, without threading the
// dept session through React context. Mirrors lab-head-membership.ts one tier up.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";

/**
 * Mints a dept invite via the server (unified opaque-token invites) and returns
 * the shareable /dept/join#<token> link. No local signing key, so it works in a
 * folderless browser; the server authorizes the caller as the dept admin.
 *
 * @throws if the API rejects the mint.
 */
export async function mintInviteForDeptAdmin(params: {
  deptId: string;
  origin: string;
}): Promise<{ link: string }> {
  const res = await fetch("/api/dept/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deptId: params.deptId }),
  });
  if (!res.ok) {
    throw new Error(`mintInviteForDeptAdmin: mint rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("mintInviteForDeptAdmin: no token returned");
  return { link: `${params.origin}/dept/join#${data.token}` };
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

// Lab-wide search over the per-member index (Phase A search wiring, see
// docs/proposals/2026-06-17-hybrid-lab-mirror-index.md).
//
// This is the read side of the hybrid mirror: a PI searches the WHOLE lab by
// reading each member's tiny encrypted index file and matching the query against
// the lightweight entries, never pulling a content blob. A hit carries the
// owner, the type, a preview, and the eager flag (true = content already in the
// mirror, false = heavy, fetch on demand). The search PAGE renders these hits.
//
// Role-gated to the lab head, the same principle as readLabMembersWork (a member
// searches their own work through the existing local search). The composition
// (role gate, lab key open, roster, readLabIndexAcrossMembers) mirrors the
// lab-scoped read. Deps are injected so the ranking and gating are unit-testable.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { GetLabResult } from "./lab-do-client";
import type { LabKeyEnvelope } from "./lab-key";
import type { LabMember } from "./lab-membership";
import type { LabIndexEntry } from "./lab-index";

import { buildCurrentViewer } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import { readLabIndexAcrossMembers } from "./lab-index";

/** One index entry that matched, plus its relevance score. */
export interface LabSearchHit extends LabIndexEntry {
  score: number;
}

export interface LabIndexSearchResult {
  ok: boolean;
  /** Set when the search was refused (not a lab head, no lab, no identity). */
  error?: string;
  hits: LabSearchHit[];
}

export interface LabIndexSearchDeps {
  getViewer: typeof buildCurrentViewer;
  getLabId: (username: string) => Promise<string | undefined>;
  getIdentity: () => StoredIdentity | null;
  fetchLab: (labId: string) => Promise<GetLabResult | null>;
  openKey: (
    envelope: LabKeyEnvelope,
    username: string,
    x25519Priv: Uint8Array,
  ) => Uint8Array;
  readIndex: typeof readLabIndexAcrossMembers;
}

const defaultDeps: LabIndexSearchDeps = {
  getViewer: buildCurrentViewer,
  getLabId: async (username) => (await readUserSettings(username)).lab_id,
  getIdentity: getSessionIdentity,
  fetchLab: getLabRemote,
  openKey: openLabKeyCopy,
  readIndex: readLabIndexAcrossMembers,
};

/** Score an entry against a lowercased query. 0 means no match. */
export function scoreEntry(entry: LabIndexEntry, q: string): number {
  if (!q) return 1; // No query is a browse: everything is in scope.
  const title = entry.title.toLowerCase();
  const preview = entry.preview.toLowerCase();
  const tags = (entry.tags ?? []).map((t) => t.toLowerCase());
  let score = 0;
  if (title.includes(q)) score += 10;
  if (tags.some((t) => t.includes(q))) score += 5;
  if (preview.includes(q)) score += 2;
  return score;
}

/**
 * Search the whole lab through the per-member index. Gated on the lab-head role.
 * Returns ranked hits (title match outranks tag match outranks preview match),
 * each carrying its owner and eager flag. Never pulls record content.
 *
 * @param query       the search text. Empty lists everything (a browse).
 * @param opts        optional recordTypes / owner narrowing and a result limit.
 * @param deps        injected for testing; real collaborators are the defaults.
 */
export async function searchLabIndex(
  query: string,
  opts: { recordTypes?: string[]; owner?: string; limit?: number } = {},
  deps: Partial<LabIndexSearchDeps> = {},
): Promise<LabIndexSearchResult> {
  const d = { ...defaultDeps, ...deps };

  const viewer = await d.getViewer();
  if (viewer.account_type !== "lab_head") {
    return {
      ok: false,
      error: "lab-wide search requires the lab-head role",
      hits: [],
    };
  }
  const identity = d.getIdentity();
  if (!identity) return { ok: false, error: "no unlocked identity", hits: [] };
  const labId = await d.getLabId(viewer.username);
  if (!labId) {
    return { ok: false, error: "this account is not bound to a lab", hits: [] };
  }

  const remote = await d.fetchLab(labId);
  if (!remote || remote.envelopes.length === 0) {
    return {
      ok: false,
      error: "lab not found or has no key envelopes",
      hits: [],
    };
  }
  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  const labKey = d.openKey(
    current,
    viewer.username,
    identity.keys.encryption.privateKey,
  );
  const members = remote.record.members.map((m: LabMember) => m.username);

  const entries = await d.readIndex({ labId, members, labKey });

  const q = query.trim().toLowerCase();
  let scoped = entries;
  if (opts.recordTypes) {
    scoped = scoped.filter((e) => opts.recordTypes!.includes(e.recordType));
  }
  if (opts.owner) {
    scoped = scoped.filter((e) => e.owner === opts.owner);
  }

  const hits: LabSearchHit[] = [];
  for (const e of scoped) {
    const score = scoreEntry(e, q);
    if (q && score === 0) continue; // A query with no match drops out.
    hits.push({ ...e, score });
  }
  // Highest score first, then newest, then title for a stable order.
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
      a.title.localeCompare(b.title),
  );

  return { ok: true, hits: opts.limit ? hits.slice(0, opts.limit) : hits };
}

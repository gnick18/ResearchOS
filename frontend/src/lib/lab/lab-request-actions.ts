// Phase C UI actions: the PI sends a content request, the member lists and
// approves. Both compose the lab session (identity, lab key, roster) the same
// way the lab-scoped read and search do, then call the lab-requests primitives.
//
// The PI request is gated to the lab head. The member side is gated only on
// being in a lab (any member can receive and approve a request), and the member
// opens the lab key with THEIR OWN sealed copy.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { GetLabResult } from "./lab-do-client";
import type { LabKeyEnvelope } from "./lab-key";

import { buildCurrentViewer } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import {
  postContentRequest,
  listContentRequests,
  approveContentRequest,
  type LabContentRequest,
} from "./lab-requests";
import {
  createFileServiceGrantStore,
  type ApprovalGrantStore,
} from "./lab-approval-grants";

export interface LabRequestContext {
  username: string;
  accountType: string;
  labId: string;
  labKey: Uint8Array;
  identity: StoredIdentity;
}

export interface LabSessionCtxDeps {
  getViewer: typeof buildCurrentViewer;
  getLabId: (username: string) => Promise<string | undefined>;
  getIdentity: () => StoredIdentity | null;
  fetchLab: (labId: string) => Promise<GetLabResult | null>;
  openKey: (
    envelope: LabKeyEnvelope,
    username: string,
    x25519Priv: Uint8Array,
  ) => Uint8Array;
}

const defaultCtxDeps: LabSessionCtxDeps = {
  getViewer: buildCurrentViewer,
  getLabId: async (username) => (await readUserSettings(username)).lab_id,
  getIdentity: getSessionIdentity,
  fetchLab: getLabRemote,
  openKey: openLabKeyCopy,
};

/**
 * Resolve the caller's lab context (their lab key opened from their own sealed
 * copy, plus identity and labId). Returns a string error code when the caller
 * is not in a lab or has no unlocked identity.
 */
async function resolveLabContext(
  deps: LabSessionCtxDeps,
): Promise<LabRequestContext | { error: string }> {
  const viewer = await deps.getViewer();
  const identity = deps.getIdentity();
  if (!identity) return { error: "no unlocked identity" };
  const labId = await deps.getLabId(viewer.username);
  if (!labId) return { error: "this account is not bound to a lab" };
  const remote = await deps.fetchLab(labId);
  if (!remote || remote.envelopes.length === 0) {
    return { error: "lab not found or has no key envelopes" };
  }
  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  const labKey = deps.openKey(
    current,
    viewer.username,
    identity.keys.encryption.privateKey,
  );
  return {
    username: viewer.username,
    accountType: viewer.account_type,
    labId,
    labKey,
    identity,
  };
}

// ---------------------------------------------------------------------------
// PI side: send a content request.
// ---------------------------------------------------------------------------

export interface RequestLabContentDeps extends LabSessionCtxDeps {
  postRequest: typeof postContentRequest;
  now: () => number;
  makeId: () => string;
}

const defaultRequestDeps: RequestLabContentDeps = {
  ...defaultCtxDeps,
  postRequest: postContentRequest,
  now: () => Date.now(),
  makeId: () => crypto.randomUUID(),
};

/**
 * The lab head requests a member's heavy record. Writes a content request into
 * the member's prefix. Role-gated to the lab head.
 */
export async function requestLabContent(
  target: { owner: string; recordType: string; recordId: string },
  deps: Partial<RequestLabContentDeps> = {},
): Promise<{ ok: boolean; error?: string }> {
  const d = { ...defaultRequestDeps, ...deps };
  const ctx = await resolveLabContext(d);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (ctx.accountType !== "lab_head") {
    return { ok: false, error: "requesting content requires the lab-head role" };
  }
  try {
    await d.postRequest({
      labId: ctx.labId,
      member: target.owner,
      request: {
        id: d.makeId(),
        requester: ctx.username,
        recordType: target.recordType,
        recordId: target.recordId,
        requestedAt: d.now(),
      },
      labKey: ctx.labKey,
      signerEd25519Priv: ctx.identity.keys.signing.privateKey,
      signerEd25519Pub: ctx.identity.keys.signing.publicKey,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Member side: list and approve requests.
// ---------------------------------------------------------------------------

export interface MemberRequestDeps extends LabSessionCtxDeps {
  listRequests: typeof listContentRequests;
  approveRequest: typeof approveContentRequest;
  grantStore: ApprovalGrantStore;
  now: () => number;
}

function defaultMemberDeps(): MemberRequestDeps {
  return {
    ...defaultCtxDeps,
    listRequests: listContentRequests,
    approveRequest: approveContentRequest,
    grantStore: createFileServiceGrantStore(),
    now: () => Date.now(),
  };
}

/** List the requests the lab head has sent the current member. */
export async function loadMyContentRequests(
  deps: Partial<MemberRequestDeps> = {},
): Promise<{ ok: boolean; error?: string; requests: LabContentRequest[] }> {
  const d = { ...defaultMemberDeps(), ...deps };
  const ctx = await resolveLabContext(d);
  if ("error" in ctx) return { ok: false, error: ctx.error, requests: [] };
  try {
    const requests = await d.listRequests({
      labId: ctx.labId,
      owner: ctx.username,
      labKey: ctx.labKey,
      signerEd25519Priv: ctx.identity.keys.signing.privateKey,
      signerEd25519Pub: ctx.identity.keys.signing.publicKey,
    });
    return { ok: true, requests };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      requests: [],
    };
  }
}

/**
 * The member approves a request: records a TTL grant (the next sync promotes the
 * record into the mirror) and dismisses the request. The upload lands on the
 * member's next sync cycle.
 */
export async function approveMyContentRequest(
  request: LabContentRequest,
  deps: Partial<MemberRequestDeps> = {},
): Promise<{ ok: boolean; error?: string }> {
  const d = { ...defaultMemberDeps(), ...deps };
  const ctx = await resolveLabContext(d);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  try {
    await d.approveRequest({
      labId: ctx.labId,
      member: ctx.username,
      request,
      labKey: ctx.labKey,
      signerEd25519Priv: ctx.identity.keys.signing.privateKey,
      signerEd25519Pub: ctx.identity.keys.signing.publicKey,
      grantStore: d.grantStore,
      nowMs: d.now(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

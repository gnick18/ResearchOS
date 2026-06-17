// Content requests: the PI-to-member request channel of Phase C (hybrid lab
// mirror, docs/proposals/2026-06-17-hybrid-lab-mirror-index.md).
//
// A heavy record is indexed but not in the eager mirror. To see its full
// content the PI sends a request. The request rides on the EXISTING lab-data
// store (the relay allows any roster member to write to any owner's prefix), at
// a reserved key recordType "_request" under the OWNING MEMBER's prefix
// (`<labId>/<member>/_request/<requestId>`). The member lists their own _request
// prefix on login, sees the pending requests, and approves: that records an
// approval grant (which promotes the record into the next sync) and dismisses
// the request. Approve-only but visible, no silent decline.
//
// The request payload is lab-key ciphertext like every record, so the relay
// stays blind. Readers of member WORK skip the reserved _request type.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { putLabRecord, listLabRecords, getLabRecord } from "./lab-data-client";
import { isTombstone, makeTombstoneBytes } from "./lab-sync";
import {
  addGrant,
  pruneExpired,
  DEFAULT_GRANT_TTL_MS,
  type ApprovalGrant,
  type ApprovalGrantStore,
} from "./lab-approval-grants";

/** The reserved recordType the PI-to-member content requests live under. */
export const LAB_REQUEST_RECORD_TYPE = "_request";

/** One PI request for a member's heavy record. */
export interface LabContentRequest {
  /** Unique request id (also the recordId under the _request prefix). */
  id: string;
  /** The lab head who asked. */
  requester: string;
  /** The heavy record being requested. */
  recordType: string;
  recordId: string;
  /** Epoch ms when the request was made. */
  requestedAt: number;
}

/**
 * PI writes a content request into the member's prefix. The relay verifies the
 * signer is on the roster (not that signer equals owner), so the head may write
 * here. Encrypted under the lab key.
 */
export async function postContentRequest(params: {
  labId: string;
  member: string;
  request: LabContentRequest;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.member,
    recordType: LAB_REQUEST_RECORD_TYPE,
    recordId: params.request.id,
    plaintext: new TextEncoder().encode(JSON.stringify(params.request)),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

/** Parse `<labId>/<owner>/<recordType>/<recordId>` into its last two segments. */
function parseKey(key: string): { recordType: string; recordId: string } | null {
  const parts = key.split("/");
  if (parts.length < 4) return null;
  return { recordType: parts[2], recordId: parts.slice(3).join("/") };
}

/**
 * The member lists their own pending content requests. Decrypts each, skips
 * tombstones (dismissed requests), and returns the live ones newest-first.
 */
export async function listContentRequests(params: {
  labId: string;
  owner: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
}): Promise<LabContentRequest[]> {
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;

  const keys = await doList({
    labId: params.labId,
    prefix: `${params.owner}/${LAB_REQUEST_RECORD_TYPE}`,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });

  const out: LabContentRequest[] = [];
  for (const key of keys) {
    const parsed = parseKey(key);
    if (!parsed || parsed.recordType !== LAB_REQUEST_RECORD_TYPE) continue;
    let plaintext: Uint8Array;
    try {
      plaintext = await doGet({
        labId: params.labId,
        owner: params.owner,
        recordType: parsed.recordType,
        recordId: parsed.recordId,
        labKey: params.labKey,
      });
    } catch {
      continue; // a vanished or undecryptable request is skipped, not fatal
    }
    if (isTombstone(plaintext)) continue;
    try {
      const req = JSON.parse(new TextDecoder().decode(plaintext)) as LabContentRequest;
      if (req && req.id && req.recordType && req.recordId) out.push(req);
    } catch {
      // malformed request, skip
    }
  }
  out.sort((a, b) => b.requestedAt - a.requestedAt);
  return out;
}

/**
 * Dismiss a request by overwriting it with a tombstone, so it no longer shows
 * in the member's pending list. Used after approval.
 */
export async function dismissContentRequest(params: {
  labId: string;
  member: string;
  requestId: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  nowMs: number;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.member,
    recordType: LAB_REQUEST_RECORD_TYPE,
    recordId: params.requestId,
    plaintext: makeTombstoneBytes(params.nowMs),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

/**
 * The member approves a request: record an approval grant (so the next sync
 * promotes the heavy record into the eager mirror for the TTL window) and
 * dismiss the request. Returns the updated grant set. The actual upload happens
 * on the next sync run; the caller may trigger one immediately.
 *
 * Approve-only by design (the role grants the PI read over all lab data); the
 * member controls WHEN and that it is deliberate, not WHETHER.
 */
export async function approveContentRequest(params: {
  labId: string;
  member: string;
  request: LabContentRequest;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  grantStore: ApprovalGrantStore;
  nowMs: number;
  ttlMs?: number;
  putImpl?: typeof putLabRecord;
}): Promise<ApprovalGrant[]> {
  const ttl = params.ttlMs ?? DEFAULT_GRANT_TTL_MS;
  const existing = pruneExpired(
    await params.grantStore.load(params.member),
    params.nowMs,
  );
  const grants = addGrant(existing, {
    recordType: params.request.recordType,
    recordId: params.request.recordId,
    approvedUntil: params.nowMs + ttl,
    requestedBy: params.request.requester,
  });
  await params.grantStore.save(params.member, grants);

  await dismissContentRequest({
    labId: params.labId,
    member: params.member,
    requestId: params.request.id,
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    nowMs: params.nowMs,
    putImpl: params.putImpl,
  });

  return grants;
}

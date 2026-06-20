// Lab Manager member-change proposals (Lab Manager Phase 1, propose-and-ratify,
// docs/proposals/2026-06-20-lab-admin-delegation-and-co-pi.md).
//
// A Lab Manager cannot sign roster changes (the head is the sole signer), so an
// add or remove is a PROPOSAL the head ratifies. The proposal rides on the SAME
// lab-data store the content requests use (the relay lets any roster member write
// to any owner's prefix), at a reserved recordType "_member_proposal" under the
// HEAD's prefix (`<labId>/<head>/_member_proposal/<id>`). The manager writes the
// proposal into the head's prefix; the head lists their own prefix, reviews each,
// completes the real add/remove through the existing membership controls, and
// dismisses (tombstones) it. The head is never forced, so this is a nudge queue,
// not a silent mutation.
//
// The payload is lab-key ciphertext like every record, so the relay stays blind.
// Readers of member WORK skip the reserved _member_proposal type, exactly as they
// skip _request.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { putLabRecord, listLabRecords, getLabRecord } from "./lab-data-client";
import { isTombstone, makeTombstoneBytes } from "./lab-sync";

/** The reserved recordType manager member-change proposals live under. */
export const LAB_MEMBER_PROPOSAL_RECORD_TYPE = "_member_proposal";

/** What a manager is proposing. "remove" targets an existing member; "add" asks
 *  the head to invite someone (free-text handle or email, since the head owns the
 *  invite flow). */
export type LabMemberProposalKind = "add" | "remove";

/** One manager proposal for a member change, awaiting the head's ratification. */
export interface LabMemberProposal {
  /** Unique id (also the recordId under the _member_proposal prefix). */
  id: string;
  kind: LabMemberProposalKind;
  /** The manager who proposed it (a roster username). */
  proposer: string;
  /** For "remove": the existing member's username. For "add": empty (see target). */
  subjectUsername: string;
  /** For "add": the free-text handle / email the manager wants invited. Empty for
   *  "remove". The head resolves it through the normal invite flow on ratify. */
  target: string;
  /** Optional one-line reason from the manager. */
  note: string;
  /** Epoch ms when proposed. */
  proposedAt: number;
}

/** Parse `<labId>/<owner>/<recordType>/<recordId>` into its last two segments. */
function parseKey(key: string): { recordType: string; recordId: string } | null {
  const parts = key.split("/");
  if (parts.length < 4) return null;
  return { recordType: parts[2], recordId: parts.slice(3).join("/") };
}

/**
 * A manager writes a member-change proposal into the HEAD's prefix. The relay
 * verifies the signer is on the roster (not that signer equals owner), so a
 * manager may write here. Encrypted under the lab key the manager already holds.
 */
export async function postMemberProposal(params: {
  labId: string;
  head: string;
  proposal: LabMemberProposal;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.head,
    recordType: LAB_MEMBER_PROPOSAL_RECORD_TYPE,
    recordId: params.proposal.id,
    plaintext: new TextEncoder().encode(JSON.stringify(params.proposal)),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

/**
 * The head lists their own pending member-change proposals. Decrypts each, skips
 * tombstones (dismissed ones), and returns the live ones newest-first.
 */
export async function listMemberProposals(params: {
  labId: string;
  head: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
}): Promise<LabMemberProposal[]> {
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;

  const keys = await doList({
    labId: params.labId,
    prefix: `${params.head}/${LAB_MEMBER_PROPOSAL_RECORD_TYPE}`,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });

  const out: LabMemberProposal[] = [];
  for (const key of keys) {
    const parsed = parseKey(key);
    if (!parsed || parsed.recordType !== LAB_MEMBER_PROPOSAL_RECORD_TYPE) continue;
    let plaintext: Uint8Array;
    try {
      plaintext = await doGet({
        labId: params.labId,
        owner: params.head,
        recordType: parsed.recordType,
        recordId: parsed.recordId,
        labKey: params.labKey,
      });
    } catch {
      continue; // a vanished or undecryptable proposal is skipped, not fatal
    }
    if (isTombstone(plaintext)) continue;
    try {
      const p = JSON.parse(new TextDecoder().decode(plaintext)) as LabMemberProposal;
      if (p && p.id && (p.kind === "add" || p.kind === "remove")) out.push(p);
    } catch {
      // malformed proposal, skip
    }
  }
  out.sort((a, b) => b.proposedAt - a.proposedAt);
  return out;
}

/**
 * Dismiss a proposal by overwriting it with a tombstone, so it no longer shows in
 * the head's pending list. Used after the head completes (or declines) the change.
 * Either the head OR the original proposer may dismiss (both are roster members
 * the relay accepts as writers to this prefix).
 */
export async function dismissMemberProposal(params: {
  labId: string;
  head: string;
  proposalId: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  nowMs: number;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.head,
    recordType: LAB_MEMBER_PROPOSAL_RECORD_TYPE,
    recordId: params.proposalId,
    plaintext: makeTombstoneBytes(params.nowMs),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

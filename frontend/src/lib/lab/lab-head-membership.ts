// Lab tier Phase 8d: head-side membership helpers for the Settings UI.
//
// Thin wrappers that let a Settings panel mint an invite, read pending join
// requests, and finalize them WITHOUT threading the live lab session through
// React context. The head's unlocked identity (getSessionIdentity) plus the
// labId are enough: the lab key is opened on demand from the relay envelope the
// same way the login effect does it.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import { getLabRemote, appendRoleRemote } from "./lab-do-client";
import { openLabKeyCopy, setMemberAdmin } from "./lab-key";
import { verifyMembershipLog, type LabRecord } from "./lab-membership";
import { listLabAccepts, type StoredLabAccept } from "./lab-accept-client";
import { finalizeLabAccepts, type FinalizeOutcome } from "./lab-invite-flow";
import {
  reconcileDeferredSeals,
  type SealOutcome,
} from "./lab-deferred-seal-reconcile";
import {
  mintLabInvite,
  encodeInviteLink,
  DEFAULT_INVITE_TTL_MS,
  type LabInvitePayload,
} from "./lab-invite";

/**
 * Phase 4B. Mints a lab invite via the server (unified opaque-token invites) and
 * returns the shareable /lab/join#<token> link. No local signing key, so it works
 * in a folderless browser; the server records the signed-in head as the lab's
 * billing owner. This is the centralized membership path that mirrors dept +
 * institution. It mints MEMBERSHIP only; the lab DATA KEY is sealed later (4A),
 * client side, and never reaches the server.
 *
 * @throws if the API rejects the mint.
 */
export async function mintLabTokenForHead(params: {
  labId: string;
  origin: string;
}): Promise<{ link: string }> {
  const res = await fetch("/api/lab/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labId: params.labId }),
  });
  if (!res.ok) {
    throw new Error(`mintLabTokenForHead: mint rejected (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("mintLabTokenForHead: no token returned");
  return { link: `${params.origin}/lab/join#${data.token}` };
}

/** Mints a head invite and returns the payload + the shareable join link. The
 *  head's known lab name + PI title ride along as DISPLAY-ONLY fields (not signed)
 *  so the branded join welcome can paint instantly before its open profile fetch
 *  lands. */
export function mintInviteForHead(params: {
  labId: string;
  username: string;
  identity: StoredIdentity;
  origin: string;
  ttlMs?: number;
  /** Display only, cosmetic. The head's lab name. */
  labName?: string;
  /** Display only, cosmetic. The PI's title (Dr. / Prof. / ...). */
  piTitle?: string;
}): { invite: LabInvitePayload; link: string } {
  const invite = mintLabInvite({
    labId: params.labId,
    headUsername: params.username,
    headEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    headX25519Pub: encodePublicKey(params.identity.keys.encryption.publicKey),
    headEd25519Priv: params.identity.keys.signing.privateKey,
    expiresAt: Date.now() + (params.ttlMs ?? DEFAULT_INVITE_TTL_MS),
    labName: params.labName,
    piTitle: params.piTitle,
  });
  return { invite, link: encodeInviteLink(params.origin, invite) };
}

/** Opens the current-generation lab key for the head from the relay envelope. */
async function openLabKeyForHead(
  labId: string,
  username: string,
  identity: StoredIdentity,
): Promise<Uint8Array> {
  const remote = await getLabRemote(labId);
  if (!remote || !remote.envelopes.length) {
    throw new Error("lab not found or has no key envelopes");
  }
  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  return openLabKeyCopy(current, username, identity.keys.encryption.privateKey);
}

/** HEAD: reads pending join requests (head-signed). */
export async function loadPendingAccepts(
  labId: string,
  identity: StoredIdentity,
): Promise<StoredLabAccept[]> {
  return listLabAccepts(labId, identity.keys.signing.privateKey);
}

/** HEAD: verifies + adds every pending member, returns one outcome each. */
export async function finalizePendingAccepts(params: {
  labId: string;
  username: string;
  identity: StoredIdentity;
}): Promise<FinalizeOutcome[]> {
  const labKey = await openLabKeyForHead(
    params.labId,
    params.username,
    params.identity,
  );
  return finalizeLabAccepts({
    labId: params.labId,
    labKey,
    headEd25519Priv: params.identity.keys.signing.privateKey,
    headEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    headX25519Priv: params.identity.keys.encryption.privateKey,
  });
}

/**
 * Phase 4A, head side, eager entry point. Runs the deferred-seal reconciliation
 * from the Settings membership panel so the head does not have to perform a FULL
 * lab login (the only other place this fires) for token-joined members to receive
 * their sealed lab-key copy. Opens the head's lab key in memory the same way
 * finalizePendingAccepts does, then seals to any member who joined via a Phase 4B
 * server token and has since published an X25519 pubkey but has no copy yet.
 *
 * The lab key stays in memory and is NEVER serialized by this code; only
 * sealToRecipient output plus a head-signed public log entry leave the browser
 * (see lab-deferred-seal-reconcile.ts for the full security model). Returns one
 * outcome per candidate; callers may treat it as best-effort.
 */
export async function reconcilePendingSealsForHead(params: {
  labId: string;
  username: string;
  identity: StoredIdentity;
}): Promise<SealOutcome[]> {
  const labKey = await openLabKeyForHead(
    params.labId,
    params.username,
    params.identity,
  );
  return reconcileDeferredSeals({
    ctx: {
      labId: params.labId,
      labKey,
      headEd25519Priv: params.identity.keys.signing.privateKey,
    },
  });
}

/**
 * HEAD: promote a member to Lab Manager (admin) or demote them back (Lab Manager
 * Phase 1, docs/proposals/2026-06-20-lab-admin-delegation-and-co-pi.md).
 *
 * Fetches the current relay record, VERIFIES its head-signed log before trusting
 * the roster (the relay is blind, so the client owns verification), runs the pure
 * setMemberAdmin primitive to produce a new head-signed "role" entry, and publishes
 * it. A role change has no key effect, so nothing is sealed and the lab key is never
 * touched. Returns the updated record so the caller can reflect the new flag in the
 * UI immediately; a later roster pull re-materializes the flag into folders.
 *
 * @throws if the lab is missing, the fetched log fails verification, the target is
 *   the head or not a member (setMemberAdmin), or the relay rejects the append.
 */
export async function setLabManagerForHead(params: {
  labId: string;
  username: string;
  makeAdmin: boolean;
  identity: StoredIdentity;
}): Promise<{ record: LabRecord }> {
  const remote = await getLabRemote(params.labId);
  if (!remote || !remote.record) {
    throw new Error("setLabManagerForHead: lab not found");
  }
  const verified = verifyMembershipLog(remote.record);
  if (!verified.ok) {
    throw new Error(
      `setLabManagerForHead: refusing to act on an unverified roster (${verified.reason})`,
    );
  }
  const { record } = setMemberAdmin(
    remote.record,
    params.username,
    params.makeAdmin,
    params.identity.keys.signing.privateKey,
  );
  const entry = record.log[record.log.length - 1];
  const res = await appendRoleRemote(params.labId, entry);
  if (!res.ok) {
    throw new Error(
      `setLabManagerForHead: relay rejected the role append (HTTP ${res.status})`,
    );
  }
  return { record };
}

export type { SealOutcome };

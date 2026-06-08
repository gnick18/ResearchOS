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
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import { listLabAccepts, type StoredLabAccept } from "./lab-accept-client";
import { finalizeLabAccepts, type FinalizeOutcome } from "./lab-invite-flow";
import {
  mintLabInvite,
  encodeInviteLink,
  DEFAULT_INVITE_TTL_MS,
  type LabInvitePayload,
} from "./lab-invite";

/** Mints a head invite and returns the payload + the shareable join link. */
export function mintInviteForHead(params: {
  labId: string;
  username: string;
  identity: StoredIdentity;
  origin: string;
  ttlMs?: number;
}): { invite: LabInvitePayload; link: string } {
  const invite = mintLabInvite({
    labId: params.labId,
    headUsername: params.username,
    headEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    headX25519Pub: encodePublicKey(params.identity.keys.encryption.publicKey),
    headEd25519Priv: params.identity.keys.signing.privateKey,
    expiresAt: Date.now() + (params.ttlMs ?? DEFAULT_INVITE_TTL_MS),
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

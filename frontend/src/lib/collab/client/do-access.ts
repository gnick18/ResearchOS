// Collab DO access control, client-side signing helpers (storage-migration
// chunk 3). Pure functions that build the three Ed25519-signed artifacts the
// relay Durable Object verifies: a membership GRANT, a member REVOKE, and a
// per-connection CONNECT token. See the protocol in relay/src/worker.ts and
// docs/proposals/COLLAB_STORAGE_D1_DO_MIGRATION.md.
//
// IMPORTANT: this module is NOT wired into the live connect path or any UI yet.
// Wiring it into the share dialog and the WebSocket/snapshot connect path is a
// LATER chunk. Until a grant flow exists, no doc ever becomes enforced, so the
// whole gate stays dormant.
//
// Signing reuses the same scheme as the identity keys (@noble/curves Ed25519,
// hex-encoded public keys), so a signature produced here verifies under the
// DO's ed25519.verify(sigBytes, msgBytes, pubBytes).

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { encodePublicKey } from "@/lib/sharing/identity/keys";

/** A member entry in a grant payload. email is the canonical directory email,
 *  pubkey is the hex Ed25519 signing key, role is a free-form label. */
export interface GrantMember {
  email: string;
  pubkey: string;
  role: string;
}

/** The exact JSON body POSTed to /grant?session=<sid>. */
export interface GrantBody {
  owner: { email: string; pubkey: string };
  members: GrantMember[];
  issuedAt: number;
  signature: string;
}

/** The exact JSON body POSTed to /revoke?session=<sid>. */
export interface RevokeBody {
  owner: { email: string; pubkey: string };
  email: string;
  issuedAt: number;
  signature: string;
}

/** The exact JSON body POSTed to /members?session=<sid> (external-collab
 *  chunk 5). Owner-signed READ of the current member list. */
export interface MembersListBody {
  owner: { email: string; pubkey: string };
  issuedAt: number;
  signature: string;
}

/** The query params appended to a /ws or /snapshot connect URL. */
export interface ConnectToken {
  authEmail: string;
  authTs: string;
  authSig: string;
}

function signHex(message: string, privateKey: Uint8Array): string {
  const msg = new TextEncoder().encode(message);
  return bytesToHex(ed25519.sign(msg, privateKey));
}

/**
 * Builds a signed GRANT body. On the FIRST grant for a doc, members[] should
 * include the existing in-lab sharers as backfill so they are recorded as the
 * doc flips to enforced. The canonical signed message MUST match the DO exactly:
 *   grant\n${sessionId}\n${ownerEmail}\n${issuedAt}\n${JSON.stringify(members)}
 */
export function signGrant(params: {
  sessionId: string;
  ownerEmail: string;
  ownerSigningKey: { publicKey: Uint8Array; privateKey: Uint8Array };
  members: GrantMember[];
  issuedAt?: number;
}): GrantBody {
  const issuedAt = params.issuedAt ?? Date.now();
  const ownerPubkey = encodePublicKey(params.ownerSigningKey.publicKey);
  const message = `grant\n${params.sessionId}\n${params.ownerEmail}\n${issuedAt}\n${JSON.stringify(
    params.members,
  )}`;
  const signature = signHex(message, params.ownerSigningKey.privateKey);
  return {
    owner: { email: params.ownerEmail, pubkey: ownerPubkey },
    members: params.members,
    issuedAt,
    signature,
  };
}

/**
 * Builds a signed REVOKE body for a single member. The doc stays enforced.
 * Canonical message: revoke\n${sessionId}\n${ownerEmail}\n${issuedAt}\n${email}
 */
export function signRevoke(params: {
  sessionId: string;
  ownerEmail: string;
  ownerSigningKey: { publicKey: Uint8Array; privateKey: Uint8Array };
  email: string;
  issuedAt?: number;
}): RevokeBody {
  const issuedAt = params.issuedAt ?? Date.now();
  const ownerPubkey = encodePublicKey(params.ownerSigningKey.publicKey);
  const message = `revoke\n${params.sessionId}\n${params.ownerEmail}\n${issuedAt}\n${params.email}`;
  const signature = signHex(message, params.ownerSigningKey.privateKey);
  return {
    owner: { email: params.ownerEmail, pubkey: ownerPubkey },
    email: params.email,
    issuedAt,
    signature,
  };
}

/**
 * Builds a signed MEMBERS-list body (external-collab chunk 5). Owner-signed read
 * of the current member list for an enforced doc, so the owner's revoke UI can
 * list who has access. Canonical message:
 *   members\n${sessionId}\n${ownerEmail}\n${issuedAt}
 * The "members" verb keeps this signature from being replayable against /grant
 * or /revoke (which sign "grant\n..." / "revoke\n...").
 */
export function signMembersList(params: {
  sessionId: string;
  ownerEmail: string;
  ownerSigningKey: { publicKey: Uint8Array; privateKey: Uint8Array };
  issuedAt?: number;
}): MembersListBody {
  const issuedAt = params.issuedAt ?? Date.now();
  const ownerPubkey = encodePublicKey(params.ownerSigningKey.publicKey);
  const message = `members\n${params.sessionId}\n${params.ownerEmail}\n${issuedAt}`;
  const signature = signHex(message, params.ownerSigningKey.privateKey);
  return {
    owner: { email: params.ownerEmail, pubkey: ownerPubkey },
    issuedAt,
    signature,
  };
}

/**
 * Builds a per-connection CONNECT token (the authEmail/authTs/authSig query
 * params an enforced doc requires on /ws and /snapshot). The member signs with
 * their own signing key; the DO verifies against the pubkey it stored for that
 * email. Canonical message: connect\n${sessionId}\n${authEmail}\n${authTs}
 */
export function signConnectToken(params: {
  sessionId: string;
  email: string;
  signingKey: { privateKey: Uint8Array };
  ts?: number;
}): ConnectToken {
  const ts = params.ts ?? Date.now();
  const authTs = String(ts);
  const message = `connect\n${params.sessionId}\n${params.email}\n${authTs}`;
  const authSig = signHex(message, params.signingKey.privateKey);
  return { authEmail: params.email, authTs, authSig };
}

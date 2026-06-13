// Department tier Phase 1: the dept-admin-minted invite link (capability token).
//
// A department admin invites a lab head (PI) by sharing a LINK, the same shape as
// the lab head's member invite (lab-invite.ts), one tier up. The dept admin signs
// {deptId, nonce, expiresAt}; the lab head accepts by signing in, and the server
// records the membership (no key sealing, no DurableObject: the dept tier is org +
// billing only, not a shared-data crypto tier, so there is no lab key to seal).
//
// The signature proves the dept admin authored the invite. The accept route
// cross-checks adminEd25519Pub against the department record before trusting it
// (otherwise anyone could mint a self-signed invite with their own pubkey). The
// nonce is a single-use anchor; expiresAt is signed so a stale link cannot be
// silently extended. The payload rides in the URL hash fragment, which browsers
// never send to the server, so the token does not leak to logs or the Referer.
//
// Composes the project's audited Ed25519 (same scheme as lab-invite.ts). No new
// low-level crypto.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/** Default invite lifetime: 14 days (an institutional sign-off can be slow). */
export const DEFAULT_DEPT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** The dept-admin-signed invite payload, encoded into the link fragment. */
export interface DeptInvitePayload {
  deptId: string;
  /** Display only: the department name, shown to the PI before accepting. */
  deptName: string;
  /** Display only: the dept admin's username. */
  adminUsername: string;
  /** Hex Ed25519 admin pubkey. The accept route cross-checks this against the
   *  department record's admin before trusting the invite. */
  adminEd25519Pub: string;
  /** Hex, 32 random bytes. Unguessable, single-use anchor. */
  nonce: string;
  /** Millisecond epoch after which the invite is rejected. */
  expiresAt: number;
  /** Hex Ed25519 signature by the admin over canonicalDeptInviteMessage. */
  sig: string;
}

/**
 * The exact message the dept admin signs. Only the security-relevant fields are
 * signed (deptId + nonce + expiresAt); the display name + username are
 * cross-checked against the department record, not trusted from the link. The
 * "dept-invite" verb prefix domain-separates it from "lab-invite" so a lab invite
 * signature can never be replayed as a dept invite (or vice versa).
 */
export function canonicalDeptInviteMessage(p: {
  deptId: string;
  nonce: string;
  expiresAt: number;
}): string {
  return ["dept-invite", p.deptId, p.nonce, String(p.expiresAt)].join("\n");
}

/** Mints a dept-admin-signed invite. The admin's signing key is the only signer. */
export function mintDeptInvite(params: {
  deptId: string;
  deptName: string;
  adminUsername: string;
  adminEd25519Pub: string;
  adminEd25519Priv: Uint8Array;
  expiresAt: number;
  nonce?: string;
}): DeptInvitePayload {
  const nonce = params.nonce ?? bytesToHex(randomBytes(32));
  const message = new TextEncoder().encode(
    canonicalDeptInviteMessage({
      deptId: params.deptId,
      nonce,
      expiresAt: params.expiresAt,
    }),
  );
  const sig = bytesToHex(ed25519.sign(message, params.adminEd25519Priv));
  return {
    deptId: params.deptId,
    deptName: params.deptName,
    adminUsername: params.adminUsername,
    adminEd25519Pub: params.adminEd25519Pub,
    nonce,
    expiresAt: params.expiresAt,
    sig,
  };
}

/**
 * Verifies the invite's Ed25519 signature under the pubkey carried in the
 * payload. NOTE: this only proves the payload is internally consistent. The
 * accept route MUST also confirm payload.adminEd25519Pub equals the real admin
 * pubkey from the department record, else an attacker could mint a self-signed
 * invite with their own pubkey.
 */
export function verifyDeptInviteSignature(p: DeptInvitePayload): boolean {
  try {
    const message = new TextEncoder().encode(canonicalDeptInviteMessage(p));
    return ed25519.verify(hexToBytes(p.sig), message, hexToBytes(p.adminEd25519Pub));
  } catch {
    return false;
  }
}

/** True when the invite is expired relative to `now` (ms epoch). */
export function isDeptInviteExpired(p: { expiresAt: number }, now: number): boolean {
  return now >= p.expiresAt;
}

// ---------------------------------------------------------------------------
// Link encoding. base64url in the URL hash fragment (never sent to the server).
// ---------------------------------------------------------------------------

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Builds the full join link for a dept invite. Payload is in the hash fragment. */
export function encodeDeptInviteLink(origin: string, p: DeptInvitePayload): string {
  return `${origin}/dept/join#${b64urlEncode(JSON.stringify(p))}`;
}

/**
 * Parses a dept invite payload from a link's hash fragment (with or without a
 * leading "#"). Returns null on any malformed input or missing required field,
 * never throws.
 */
export function decodeDeptInviteFragment(fragment: string): DeptInvitePayload | null {
  try {
    const json = b64urlDecode(fragment.replace(/^#/, ""));
    const p = JSON.parse(json) as Partial<DeptInvitePayload>;
    if (
      typeof p.deptId !== "string" ||
      typeof p.deptName !== "string" ||
      typeof p.adminUsername !== "string" ||
      typeof p.adminEd25519Pub !== "string" ||
      typeof p.nonce !== "string" ||
      typeof p.sig !== "string" ||
      typeof p.expiresAt !== "number"
    ) {
      return null;
    }
    return p as DeptInvitePayload;
  } catch {
    return null;
  }
}

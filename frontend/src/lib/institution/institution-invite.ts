// Institution tier Phase 4: the institution-admin-minted invite link for a dept
// admin (capability token). Mirrors dept-invite.ts one tier up: an institution
// admin invites a department admin, who accepts by signing in, and the server
// links that admin's DEPARTMENT to the institution (no key sealing / no DO; org +
// billing only). "institution-invite" verb domain-separates it from the lab + dept
// invite verbs.
//
// Composes the project's audited Ed25519. No new low-level crypto.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/** Default invite lifetime: 14 days (an institutional sign-off can be slow). */
export const DEFAULT_INSTITUTION_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface InstitutionInvitePayload {
  institutionId: string;
  /** Display only: the institution name. */
  institutionName: string;
  /** Display only: the institution admin's username. */
  adminUsername: string;
  /** Hex Ed25519 admin pubkey, cross-checked against the institution record. */
  adminEd25519Pub: string;
  nonce: string;
  expiresAt: number;
  sig: string;
}

export function canonicalInstitutionInviteMessage(p: {
  institutionId: string;
  nonce: string;
  expiresAt: number;
}): string {
  return ["institution-invite", p.institutionId, p.nonce, String(p.expiresAt)].join("\n");
}

export function mintInstitutionInvite(params: {
  institutionId: string;
  institutionName: string;
  adminUsername: string;
  adminEd25519Pub: string;
  adminEd25519Priv: Uint8Array;
  expiresAt: number;
  nonce?: string;
}): InstitutionInvitePayload {
  const nonce = params.nonce ?? bytesToHex(randomBytes(32));
  const message = new TextEncoder().encode(
    canonicalInstitutionInviteMessage({
      institutionId: params.institutionId,
      nonce,
      expiresAt: params.expiresAt,
    }),
  );
  const sig = bytesToHex(ed25519.sign(message, params.adminEd25519Priv));
  return {
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    adminUsername: params.adminUsername,
    adminEd25519Pub: params.adminEd25519Pub,
    nonce,
    expiresAt: params.expiresAt,
    sig,
  };
}

/** NOTE: the accept route MUST also confirm adminEd25519Pub matches the
 *  institution record, else an attacker could self-sign with their own key. */
export function verifyInstitutionInviteSignature(p: InstitutionInvitePayload): boolean {
  try {
    const message = new TextEncoder().encode(canonicalInstitutionInviteMessage(p));
    return ed25519.verify(hexToBytes(p.sig), message, hexToBytes(p.adminEd25519Pub));
  } catch {
    return false;
  }
}

export function isInstitutionInviteExpired(
  p: { expiresAt: number },
  now: number,
): boolean {
  return now >= p.expiresAt;
}

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

export function encodeInstitutionInviteLink(
  origin: string,
  p: InstitutionInvitePayload,
): string {
  return `${origin}/institution/join#${b64urlEncode(JSON.stringify(p))}`;
}

export function decodeInstitutionInviteFragment(
  fragment: string,
): InstitutionInvitePayload | null {
  try {
    const json = b64urlDecode(fragment.replace(/^#/, ""));
    const p = JSON.parse(json) as Partial<InstitutionInvitePayload>;
    if (
      typeof p.institutionId !== "string" ||
      typeof p.institutionName !== "string" ||
      typeof p.adminUsername !== "string" ||
      typeof p.adminEd25519Pub !== "string" ||
      typeof p.nonce !== "string" ||
      typeof p.sig !== "string" ||
      typeof p.expiresAt !== "number"
    ) {
      return null;
    }
    return p as InstitutionInvitePayload;
  } catch {
    return null;
  }
}

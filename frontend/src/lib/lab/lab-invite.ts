// Lab tier Phase 8b: the head-minted invite link (capability token).
//
// The head invites a member by sharing a LINK, not by pushing to an email-keyed
// inbox. Addressing by email would break the moment the member accepts with a
// different provider/email than the head used (their inbox lives under the other
// email), which is exactly the case we must support. A link sidesteps that: the
// head mints a signed capability, shares it however they like, and the member
// accepts with whatever identity THEY choose. The accepted identity (and its
// OAuth email) is harvested back at accept time (see lab-accept.ts), so the
// roster always reflects the email the member actually authenticated with.
//
// The invite is a head-signed payload {labId, head pubkeys, nonce, expiresAt}.
//   - The Ed25519 signature proves the head authored it (the head verifies its
//     OWN signature at finalize, so no server state is needed to trust a nonce).
//   - The nonce is a 32-byte unguessable, single-use anchor.
//   - expiresAt is signed, so a stale link cannot be silently extended.
//   - headX25519Pub is carried so the member can seal their email to the head
//     (server-blind), and headEd25519Pub so the member can cross-check the
//     invite against the lab record fetched from the relay.
// It is carried in the URL HASH FRAGMENT, which browsers never send to the
// server, so the token does not leak into server logs or the Referer header.
//
// CRITICAL: composes the project's audited Ed25519 (the same scheme as
// lab-membership.ts). No new low-level crypto.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/** Default invite lifetime: 7 days. The head can override per invite. */
export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The head-signed invite payload, encoded into the link fragment. */
export interface LabInvitePayload {
  labId: string;
  /** Display only: the head's username, shown to the member before they accept. */
  headUsername: string;
  /** Display only: the lab's name, shown on the branded join welcome. NOT part of
   *  canonicalInviteMessage (cosmetic, exactly like headUsername); the relay's
   *  open /lab/profile/get is the source of truth, this is just an instant first
   *  paint before that fetch lands. Optional for backward compatibility. */
  labName?: string;
  /** Display only: the PI's title (Dr. / Prof. / ...). Cosmetic, see labName. */
  piTitle?: string;
  /** Hex Ed25519 head pubkey. The member cross-checks this against the lab
   *  record's head before trusting the invite. */
  headEd25519Pub: string;
  /** Hex X25519 head pubkey. The member seals their email to this so only the
   *  head can read it (the relay stays blind). */
  headX25519Pub: string;
  /** Hex, 32 random bytes. Unguessable, single-use anchor. */
  nonce: string;
  /** Millisecond epoch after which the invite is rejected. */
  expiresAt: number;
  /** Hex Ed25519 signature by the head over canonicalInviteMessage. */
  sig: string;
}

/**
 * The exact message the head signs for an invite. Only the security-relevant
 * fields are signed (labId + nonce + expiresAt); the display username and the
 * carried pubkeys are cross-checked against the lab record, not trusted from the
 * link. The "lab-invite" verb prefix domain-separates it from the membership-log
 * "lab-log" messages so an invite signature can never be replayed as a log entry.
 */
export function canonicalInviteMessage(p: {
  labId: string;
  nonce: string;
  expiresAt: number;
}): string {
  return ["lab-invite", p.labId, p.nonce, String(p.expiresAt)].join("\n");
}

/**
 * Mints a head-signed invite. The nonce is generated unless supplied (tests
 * pass a fixed nonce). The head's signing private key is the only signer.
 */
export function mintLabInvite(params: {
  labId: string;
  headUsername: string;
  headEd25519Pub: string;
  headX25519Pub: string;
  headEd25519Priv: Uint8Array;
  expiresAt: number;
  nonce?: string;
  /** Display only, cosmetic. Carried into the payload but NOT signed. */
  labName?: string;
  /** Display only, cosmetic. Carried into the payload but NOT signed. */
  piTitle?: string;
}): LabInvitePayload {
  const nonce = params.nonce ?? bytesToHex(randomBytes(32));
  const message = new TextEncoder().encode(
    canonicalInviteMessage({ labId: params.labId, nonce, expiresAt: params.expiresAt }),
  );
  const sig = bytesToHex(ed25519.sign(message, params.headEd25519Priv));
  const payload: LabInvitePayload = {
    labId: params.labId,
    headUsername: params.headUsername,
    headEd25519Pub: params.headEd25519Pub,
    headX25519Pub: params.headX25519Pub,
    nonce,
    expiresAt: params.expiresAt,
    sig,
  };
  // Only include the display fields when present, so an invite without branding
  // serializes to the same shape it did before this feature.
  if (params.labName) payload.labName = params.labName;
  if (params.piTitle) payload.piTitle = params.piTitle;
  return payload;
}

/**
 * Verifies the invite's Ed25519 signature under the pubkey carried in the
 * payload. NOTE: this only proves the payload is internally consistent. A caller
 * MUST also confirm payload.headEd25519Pub equals the real head pubkey from the
 * lab record (otherwise an attacker could mint a self-signed invite with their
 * own pubkey). verifyAccept (lab-accept.ts) does that cross-check.
 */
export function verifyInviteSignature(p: LabInvitePayload): boolean {
  try {
    const message = new TextEncoder().encode(canonicalInviteMessage(p));
    return ed25519.verify(hexToBytes(p.sig), message, hexToBytes(p.headEd25519Pub));
  } catch {
    return false;
  }
}

/** True when the invite is expired relative to `now` (ms epoch). */
export function isInviteExpired(p: { expiresAt: number }, now: number): boolean {
  return now >= p.expiresAt;
}

// ---------------------------------------------------------------------------
// Link encoding. The payload travels in the URL hash fragment (never sent to the
// server). base64url so it is URL-safe without percent-encoding.
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

/** Builds the full join link for an invite. The payload is in the hash fragment. */
export function encodeInviteLink(origin: string, p: LabInvitePayload): string {
  return `${origin}/lab/join#${b64urlEncode(JSON.stringify(p))}`;
}

/**
 * Parses an invite payload from a link's hash fragment (with or without a
 * leading "#"). Returns null on any malformed input or missing required field,
 * never throws.
 */
export function decodeInviteFragment(fragment: string): LabInvitePayload | null {
  try {
    const json = b64urlDecode(fragment.replace(/^#/, ""));
    const p = JSON.parse(json) as Partial<LabInvitePayload>;
    if (
      typeof p.labId !== "string" ||
      typeof p.nonce !== "string" ||
      typeof p.sig !== "string" ||
      typeof p.headEd25519Pub !== "string" ||
      typeof p.headX25519Pub !== "string" ||
      typeof p.headUsername !== "string" ||
      typeof p.expiresAt !== "number"
    ) {
      return null;
    }
    return p as LabInvitePayload;
  } catch {
    return null;
  }
}

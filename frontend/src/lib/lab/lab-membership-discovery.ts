// Lab membership discovery: query the relay for labs that this account belongs
// to server-side but has no local member folder for.
//
// This happens when:
//   - the member joined on another device,
//   - joined before LAB_AS_FOLDER_ENABLED was on,
//   - or reset their local folder set.
//
// FLAG: this module is inert when LAB_AS_FOLDER_ENABLED is off. All exported
// functions return [] immediately in that case.
//
// RELAY ENDPOINT: the relay-side endpoint /lab/discover-memberships requires a
// separate wrangler deploy and a new KV binding (LAB_MEMBERSHIP_INDEX) before it
// works in prod. The client degrades gracefully (returns []) on 404 so this PR is
// safe to ship before the relay deploy. See
// docs/proposals/2026-06-19-lab-membership-discovery-findings.md.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { LAB_AS_FOLDER_ENABLED } from "./lab-as-folder-config";

// ---------------------------------------------------------------------------
// Canonical message
// ---------------------------------------------------------------------------

/**
 * The exact canonical string the client signs and the relay verifies.
 * All three must agree byte for byte: this function, the relay handler, and the
 * test. Mirrors the pattern in lab-membership.ts and lab-do-client.ts.
 *
 * Format: "lab-discover-memberships\n<pubkey_hex>\n<issuedAt>"
 */
export function discoverMembershipsCanonicalMessage(
  pubkeyHex: string,
  issuedAt: number,
): Uint8Array {
  return new TextEncoder().encode(
    `lab-discover-memberships\n${pubkeyHex}\n${issuedAt}`,
  );
}

// ---------------------------------------------------------------------------
// Relay HTTP base (same helper as lab-do-client.ts)
// ---------------------------------------------------------------------------

function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Queries the relay for all labIds this account's Ed25519 pubkey is recorded in.
 *
 * Returns an empty array when:
 *   - LAB_AS_FOLDER_ENABLED is off (inert)
 *   - the relay endpoint is not yet deployed (404)
 *   - any network or parse error occurs
 *
 * Never throws.
 *
 * FLAG: this endpoint requires a relay-side addition and a separate wrangler
 * deploy before it works live in prod. See
 * docs/proposals/2026-06-19-lab-membership-discovery-findings.md.
 */
export async function discoverMyLabMemberships(params: {
  /** Hex-encoded Ed25519 public key for this account. */
  ed25519Pub: string;
  /** Raw Ed25519 private key (32 bytes) for signing the request. */
  ed25519Priv: Uint8Array;
}): Promise<string[]> {
  if (!LAB_AS_FOLDER_ENABLED) return [];

  const { ed25519Pub, ed25519Priv } = params;
  const issuedAt = Date.now();

  const message = discoverMembershipsCanonicalMessage(ed25519Pub, issuedAt);
  let signature: string;
  try {
    signature = bytesToHex(ed25519.sign(message, ed25519Priv));
  } catch {
    return [];
  }

  try {
    const url = `${relayHttpBase()}/lab/discover-memberships?pubkey=${encodeURIComponent(ed25519Pub)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    });

    // 404 = relay endpoint not yet deployed. Degrade gracefully.
    if (res.status === 404) return [];
    // Any other non-OK status: degrade gracefully.
    if (!res.ok) return [];

    const data = (await res.json()) as { labIds?: unknown };
    if (!Array.isArray(data.labIds)) return [];
    return data.labIds.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Convenience wrapper that reads the signing key from a `StoredIdentity`-shaped
 * object. The `keys.signing` field carries the raw Ed25519 keypair the same way
 * lab-member-activation.ts and lab-do-client.ts use it. Returns [] on any error.
 */
export async function discoverMyLabMembershipsForIdentity(identity: {
  keys: {
    signing: {
      publicKey: Uint8Array;
      privateKey: Uint8Array;
    };
  };
}): Promise<string[]> {
  if (!LAB_AS_FOLDER_ENABLED) return [];
  try {
    const pubHex = bytesToHex(identity.keys.signing.publicKey);
    return discoverMyLabMemberships({
      ed25519Pub: pubHex,
      ed25519Priv: identity.keys.signing.privateKey,
    });
  } catch {
    return [];
  }
}

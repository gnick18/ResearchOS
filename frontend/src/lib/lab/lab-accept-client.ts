// Lab tier Phase 8c: relay client for the lab join-accept queue.
//
// Three thin calls over the LabRecordDO's /lab/accept* routes:
//   postLabAccept    MEMBER side: post a signed accept (open write).
//   listLabAccepts   HEAD side: read pending accepts (head-signed).
//   dismissLabAccept HEAD side: remove one accept by member pubkey (head-signed).
//
// The head-signed reads/dismisses carry an issuedAt the DO checks for freshness
// (a 5-minute window) so a captured request cannot be replayed indefinitely.
// Mirrors the scheme + the relay-origin helper in lab-do-client.ts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { LAB_TIER_ENABLED } from "./config";
import type { LabAcceptPayload } from "./lab-accept";

function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

function ensureEnabled(): void {
  if (!LAB_TIER_ENABLED) {
    throw new Error("lab tier is disabled (LAB_TIER_ENABLED is false)");
  }
}

function signHex(message: string, privateKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(new TextEncoder().encode(message), privateKey));
}

/** A pending accept as the DO returns it on /lab/accept/list. */
export interface StoredLabAccept extends LabAcceptPayload {
  /** Server-stamped receipt time (ms epoch). */
  createdAt: number;
}

/**
 * MEMBER side. Posts a signed accept to the lab's queue. Open write (the member
 * is not yet in any roster); the head verifies + finalizes. Returns the raw
 * Response so the caller can branch on status.
 */
export async function postLabAccept(
  labId: string,
  accept: LabAcceptPayload,
): Promise<Response> {
  ensureEnabled();
  return fetch(`${relayHttpBase()}/lab/accept?lab=${encodeURIComponent(labId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  });
}

/**
 * HEAD side. Reads pending accepts. Signs "lab-accept-list\n<labId>\n<issuedAt>"
 * with the head's Ed25519 key so the DO can gate the read against the stored
 * head pubkey.
 *
 * @throws if the relay rejects the read (non-2xx).
 */
export async function listLabAccepts(
  labId: string,
  headEd25519Priv: Uint8Array,
): Promise<StoredLabAccept[]> {
  ensureEnabled();
  const issuedAt = Date.now();
  const signature = signHex(`lab-accept-list\n${labId}\n${issuedAt}`, headEd25519Priv);
  const res = await fetch(
    `${relayHttpBase()}/lab/accept/list?lab=${encodeURIComponent(labId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    },
  );
  if (!res.ok) {
    throw new Error(`listLabAccepts: relay returned ${res.status}`);
  }
  const j = (await res.json()) as { accepts?: StoredLabAccept[] };
  return j.accepts ?? [];
}

/**
 * HEAD side. Removes one pending accept by the member's pubkey after finalizing
 * it. Signs "lab-accept-dismiss\n<labId>\n<memberPubkey>\n<issuedAt>".
 */
export async function dismissLabAccept(
  labId: string,
  memberPubkey: string,
  headEd25519Priv: Uint8Array,
): Promise<Response> {
  ensureEnabled();
  const issuedAt = Date.now();
  const signature = signHex(
    `lab-accept-dismiss\n${labId}\n${memberPubkey}\n${issuedAt}`,
    headEd25519Priv,
  );
  return fetch(
    `${relayHttpBase()}/lab/accept/dismiss?lab=${encodeURIComponent(labId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberPubkey, issuedAt, signature }),
    },
  );
}

// External-collab chunk 3: per-recipient inbox client (recipient DISCOVERY of a
// live-collab grant). Three thin, signed orchestrations over the relay's inbox
// Durable Object (see relay/src/worker.ts, RecipientInbox).
//
//   pushInvite   the OWNER, after granting an outside user, writes an invite to
//                that user's inbox (signed with the owner's directory key).
//   listInvites  the RECIPIENT reads their own pending invites (signed with the
//                recipient's directory key; the DO checks the signing key against
//                the established recipient pubkey).
//   dismissInvite the RECIPIENT removes one invite (same recipient-signed gate).
//
// ADDRESSING. The inbox DO is named idFromName(emailHash), where emailHash =
// hashEmail(canonicalEmail, COLLAB_INBOX_ADDRESS_SALT). The salt is a PUBLIC
// domain-separation constant, NOT the server's directory pepper (which never
// reaches the browser). The address does not need to be secret; the inbox DO
// enforces every access rule by Ed25519 signature + trust-on-first-use, so the
// hash is only a routing key.
//
// SCOPE. This chunk only SURFACES pending invites. Nothing here materializes a
// local copy. Accept + materialize-to-folder is chunk 4. dismissInvite is
// included now (the accept/decline flows in chunk 4 will call it), but no UI
// wires it in this chunk.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { getCollabSignerEmail } from "./current-email";
import { COLLAB_INBOX_ADDRESS_SALT, COLLAB_RELAY_URL } from "@/lib/loro/config";

/** A pending invite as the inbox DO returns it on /inbox/list. */
export interface PendingInvite {
  collabDocId: string;
  sessionId: string;
  title: string | null;
  kind: string | null;
  fromEmail: string | null;
  fromName: string | null;
  /**
   * The sender's hex Ed25519 signing pubkey, recorded by the inbox DO from the
   * signed push (external-collab chunk 4). The recipient confirms this equals
   * the directory binding for fromEmail before accepting, so a spoofed fromEmail
   * cannot materialize a note. Null on an invite pushed before the column
   * existed; the accept flow treats null as unverifiable and refuses.
   */
  fromPubkey: string | null;
  createdAt: number;
}

/** The relay's HTTP origin. COLLAB_RELAY_URL is ws(s)://host; the inbox write
 *  endpoints are http(s)://host (scheme swapped), same convention as /snapshot
 *  and /grant. */
function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

function signHex(message: string, privateKey: Uint8Array): string {
  const msg = new TextEncoder().encode(message);
  return bytesToHex(ed25519.sign(msg, privateKey));
}

/** Derives the inbox address (emailHash) for a canonical email. Both the sender
 *  and the recipient compute this over the SAME public salt, so they name the
 *  same DO. */
export function inboxAddress(canonicalEmail: string): string {
  return hashEmail(canonicalEmail, COLLAB_INBOX_ADDRESS_SALT);
}

export interface PushInviteParams {
  /** The outside recipient's canonical directory email. */
  recipientEmail: string;
  /** The recipient's hex Ed25519 directory signing pubkey (from the lookup). */
  recipientPubkey: string;
  /** The collab doc id the recipient is being invited to. */
  collabDocId: string;
  /** The collab session id derived from the doc id. */
  sessionId: string;
  /** A human title for the invited note (shown in "Shared with me"). */
  title: string;
  /** The entity kind (e.g. "note"). */
  kind: string;
}

export type PushInviteResult =
  | { ok: true }
  | { ok: false; reason: "no-identity" | "request-failed" };

/**
 * OWNER side. Writes a signed invite to the recipient's inbox. The push is
 * signed with the owner's directory Ed25519 key so the recorded from-identity is
 * authentic. The recipient pubkey is carried so the inbox DO can establish it
 * trust-on-first-use (and reject any later attempt to rebind the inbox owner).
 *
 * Returns ok:false (without sending) when this device has no usable sharing
 * identity. Never throws on a network failure; it returns request-failed.
 */
export async function pushInvite(
  params: PushInviteParams,
): Promise<PushInviteResult> {
  const fromEmailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!fromEmailRaw || !signing?.privateKey || !signing?.publicKey) {
    return { ok: false, reason: "no-identity" };
  }
  const fromEmail = canonicalizeEmail(fromEmailRaw);
  const fromPubkey = encodePublicKey(signing.publicKey);

  const recipientCanonical = canonicalizeEmail(params.recipientEmail);
  const recipientEmailHash = inboxAddress(recipientCanonical);

  const issuedAt = Date.now();
  // from email + title + kind are signed so the sender identity and the
  // displayed invite are authenticated, not just that some valid key signed.
  const message = `inbox-push\n${recipientEmailHash}\n${params.recipientPubkey}\n${fromEmail}\n${params.collabDocId}\n${params.sessionId}\n${params.title ?? ""}\n${params.kind ?? ""}\n${issuedAt}`;
  const signature = signHex(message, signing.privateKey);

  const body = {
    from: { email: fromEmail, name: fromEmail, pubkey: fromPubkey },
    recipientEmailHash,
    recipientPubkey: params.recipientPubkey,
    invite: {
      collabDocId: params.collabDocId,
      sessionId: params.sessionId,
      title: params.title,
      kind: params.kind,
    },
    issuedAt,
    signature,
  };

  try {
    const res = await fetch(
      `${relayHttpBase()}/inbox/push?to=${encodeURIComponent(recipientEmailHash)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return { ok: false, reason: "request-failed" };
  } catch {
    return { ok: false, reason: "request-failed" };
  }
  return { ok: true };
}

/**
 * RECIPIENT side. Reads this device user's own pending invites. Signs an
 * inbox-list request with the recipient's directory key over their own inbox
 * address; the DO checks the signing key against the established recipient
 * pubkey. Returns an empty list when this device has no sharing identity (so the
 * caller can render the empty state without special-casing).
 */
export async function listInvites(): Promise<PendingInvite[]> {
  const emailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!emailRaw || !signing?.privateKey || !signing?.publicKey) {
    return [];
  }
  const email = canonicalizeEmail(emailRaw);
  const pubkey = encodePublicKey(signing.publicKey);
  const emailHash = inboxAddress(email);

  const issuedAt = Date.now();
  const message = `inbox-list\n${emailHash}\n${issuedAt}`;
  const signature = signHex(message, signing.privateKey);

  const res = await fetch(
    `${relayHttpBase()}/inbox/list?owner=${encodeURIComponent(emailHash)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, pubkey, issuedAt, signature }),
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { invites?: PendingInvite[] };
  return Array.isArray(data.invites) ? data.invites : [];
}

/**
 * RECIPIENT side. Removes one pending invite by collab doc id. Recipient-signed,
 * same gate as listInvites. Returns true on a 200. Used later by the chunk 4
 * accept/decline flows; no UI wires it in this chunk.
 */
export async function dismissInvite(collabDocId: string): Promise<boolean> {
  const emailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!emailRaw || !signing?.privateKey || !signing?.publicKey) {
    return false;
  }
  const email = canonicalizeEmail(emailRaw);
  const pubkey = encodePublicKey(signing.publicKey);
  const emailHash = inboxAddress(email);

  const issuedAt = Date.now();
  const message = `inbox-dismiss\n${emailHash}\n${collabDocId}\n${issuedAt}`;
  const signature = signHex(message, signing.privateKey);

  try {
    const res = await fetch(
      `${relayHttpBase()}/inbox/dismiss?owner=${encodeURIComponent(emailHash)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pubkey, collabDocId, issuedAt, signature }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

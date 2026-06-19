// External-collab chunk 2, PIECE B: owner-side grant flow.
//
// Adds an OUTSIDE ResearchOS user (someone not in the owner's folder) as a live
// collaborator on a note by sending a signed GRANT to the collab Durable Object
// (POST `${COLLAB_RELAY_URL}/grant?session=<sessionId>`). The DO verifies the
// owner's Ed25519 directory signature, records the members, and (on the FIRST
// grant) flips the doc to enforced. From then on, only members with a valid
// connect token can connect (see lib/collab/client/connect-token.ts, PIECE A).
//
// This is DISTINCT from the one-time E2E SendOutsideDialog (which sends a frozen
// encrypted copy). This path is live, editable collaboration.
//
// SCOPE (chunk 2): OWNER-SIDE ONLY. Recipient discovery, the "Shared with me"
// view, accept, and materialize-to-folder are chunks 3-4. So this is not yet
// end-to-end usable, which is why the whole flow is gated by EXTERNAL_COLLAB_ENABLED.
//
// FIRST-GRANT BACKFILL. Flipping a doc to enforced would lock out the existing
// in-lab sharers (they connect over the SAME relay session). So the FIRST grant
// MUST include those in-lab members as backfill, resolved to their directory
// (email, signing pubkey) the same way grant-on-share does (via each member's
// published _sharing_identity.json sidecar). The owner is recorded automatically
// by the DO (trust-on-first-use), so it is not added to members[] here.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { LoroDoc } from "loro-crdt";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SharedUser } from "@/lib/types";
import { getOrMintCollabDocId } from "./doc-id";
import { collabSessionFromDocId } from "@/lib/loro/collab/doc-id-session";
import { signGrant, signMembersList, signRevoke, type GrantMember } from "./do-access";
import { pushInvite } from "./inbox";
import { getCollabSignerEmail } from "./current-email";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { buildNotifyInvitePayload } from "@/lib/sharing/directory/signature";
import { encodePublicKey } from "@/lib/sharing/identity/keys";
import { isExternalCollabHostEntitled } from "./entitlement";
import { EXTERNAL_COLLAB_ENABLED, COLLAB_RELAY_URL } from "@/lib/loro/config";

/** A resolved outside collaborator, the canonical directory email + hex Ed25519
 *  signing pubkey returned by the directory lookup. */
export interface ResolvedOutsideUser {
  email: string;
  ed25519PublicKey: string;
}

/** The relay's HTTP origin. COLLAB_RELAY_URL is ws(s)://host; the /grant write
 *  endpoint is http(s)://host (scheme swapped), same convention as /snapshot. */
function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

/**
 * Looks up an outside ResearchOS user by email in the directory and returns
 * their canonical email + hex Ed25519 signing pubkey, or null when the email is
 * not registered. Reuses the same POST /api/directory/lookup route the one-time
 * send path uses to resolve a recipient.
 */
export async function lookupOutsideUser(
  email: string,
): Promise<ResolvedOutsideUser | null> {
  const res = await fetch("/api/directory/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    found?: boolean;
    ed25519PublicKey?: string;
  };
  if (!data.found || !data.ed25519PublicKey) return null;
  return {
    email: canonicalizeEmail(email),
    ed25519PublicKey: data.ed25519PublicKey,
  };
}

/**
 * Resolves the in-lab sharers (USERNAMES on the note's shared_with) to directory
 * members for the first-grant backfill. A member with no published
 * _sharing_identity.json sidecar (no email or no signing key) is skipped, the
 * same way grant-on-share skips an unregistered member. The whole-lab sentinel
 * "*" carries no specific person and is skipped.
 */
async function resolveInLabBackfill(
  sharedWith: SharedUser[] | null | undefined,
): Promise<GrantMember[]> {
  const members: GrantMember[] = [];
  const seen = new Set<string>();
  for (const s of sharedWith ?? []) {
    if (!s.username || s.username === "*") continue;
    let sidecar = null;
    try {
      sidecar = await readSharingIdentity(s.username);
    } catch {
      sidecar = null;
    }
    if (!sidecar?.email || !sidecar.ed25519PublicKey) continue;
    const email = canonicalizeEmail(sidecar.email);
    if (seen.has(email)) continue;
    seen.add(email);
    members.push({
      email,
      pubkey: sidecar.ed25519PublicKey,
      role: "member",
    });
  }
  return members;
}

export interface GrantExternalCollabParams {
  /** The note's live LoroDoc. The collab doc id is minted here if absent. */
  doc: LoroDoc;
  /** The resolved outside collaborator (from lookupOutsideUser). */
  outside: ResolvedOutsideUser;
  /** The note's current in-lab shared_with list, for first-grant backfill. */
  sharedWith?: SharedUser[] | null;
  /** The note's human title, carried into the recipient's inbox invite so the
   *  "Shared with me" surface can read "X invited you to collaborate on <title>"
   *  (external-collab chunk 3). Defaults to "Untitled note" when absent. */
  title?: string | null;
}

export type GrantExternalCollabResult =
  | { ok: true; docId: string }
  | { ok: false; reason: "no-identity" | "self" | "not-entitled" | "request-failed" };

/**
 * Grants an outside ResearchOS user live access to a note.
 *
 * Mints the collab doc id if absent, resolves the in-lab sharers for the
 * first-grant backfill, signs the grant with the owner's Ed25519 directory key,
 * and POSTs it to the collab DO. On the first grant the DO flips the doc to
 * enforced and records the owner (TOFU) plus everyone in members[].
 *
 * Returns ok:false (without sending) when this device has no published sharing
 * identity (cannot sign), when the owner is granting themselves, or when the
 * account is not entitled to host external live collab (a paid produce feature,
 * Solo and up). A free account keeps the one-time E2E copy send and can still
 * RECEIVE a live invite; only HOSTING is paid.
 */
export async function grantExternalCollab(
  params: GrantExternalCollabParams,
): Promise<GrantExternalCollabResult> {
  const { doc, outside, sharedWith, title } = params;

  const ownerEmailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!ownerEmailRaw || !signing?.privateKey || !signing?.publicKey) {
    return { ok: false, reason: "no-identity" };
  }
  const ownerEmail = canonicalizeEmail(ownerEmailRaw);

  if (canonicalizeEmail(outside.email) === ownerEmail) {
    return { ok: false, reason: "self" };
  }

  // Paid-tier gate (Grant 2026-06-18): hosting external LIVE collab is a paid
  // produce feature (Solo and up). We check BEFORE minting the collab doc id or
  // sending the grant, so a free account never flips a doc to enforced. The check
  // fails closed, so a transient failure refuses rather than letting a free
  // account through. The recipient/accept side and the one-time copy send are not
  // gated; only hosting is.
  if (!(await isExternalCollabHostEntitled())) {
    return { ok: false, reason: "not-entitled" };
  }

  const docId = getOrMintCollabDocId(doc);
  const { sessionId } = collabSessionFromDocId(docId);

  // First-grant backfill: every in-lab sharer plus the new outside user. The DO
  // records the owner automatically, so it is not listed here. We always send
  // the backfill, the DO upserts members idempotently, so a re-grant is safe.
  const backfill = await resolveInLabBackfill(sharedWith);
  const members: GrantMember[] = [
    ...backfill,
    {
      email: canonicalizeEmail(outside.email),
      pubkey: outside.ed25519PublicKey,
      role: "external",
    },
  ];

  const body = signGrant({
    sessionId,
    ownerEmail,
    ownerSigningKey: { publicKey: signing.publicKey, privateKey: signing.privateKey },
    members,
  });

  try {
    const res = await fetch(
      `${relayHttpBase()}/grant?session=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      return { ok: false, reason: "request-failed" };
    }
  } catch {
    return { ok: false, reason: "request-failed" };
  }

  // Recipient discovery (external-collab chunk 3). The grant locked the DO; now
  // tell the outside user it exists by writing a signed invite to their inbox.
  // This is best-effort, a failed push does not undo the grant (the owner can
  // re-grant, which re-pushes idempotently). NOTHING materializes locally here;
  // the recipient only sees a pending invite until they accept (chunk 4).
  try {
    await pushInvite({
      recipientEmail: canonicalizeEmail(outside.email),
      recipientPubkey: outside.ed25519PublicKey,
      collabDocId: docId,
      sessionId,
      title: title ?? "Untitled note",
      kind: "note",
    });
  } catch {
    // Push is non-fatal; the grant already succeeded.
  }

  // Optional email nudge (external-collab email notification). The recipient
  // already has the in-app inbox invite above; this only ADDS an email if the
  // recipient's published directory preference allows it (the server decides).
  // Strictly best-effort: an email failure must NEVER fail the grant, so we
  // await but swallow everything. Gated by the same flag as the rest of the arc.
  if (EXTERNAL_COLLAB_ENABLED) {
    try {
      await notifyInviteEmail({
        ownerEmail,
        ownerPubkey: encodePublicKey(signing.publicKey),
        ownerSigningPrivateKey: signing.privateKey,
        recipientEmail: canonicalizeEmail(outside.email),
        noteTitle: title ?? "Untitled note",
      });
    } catch {
      // Email is non-fatal; the grant and inbox push already succeeded.
    }
  }

  return { ok: true, docId };
}

/**
 * Best-effort: asks the server to send the recipient an email NUDGE about the
 * collaboration invite, IF the recipient opted in (the server reads their
 * published directory preference). The owner signs the canonical
 * `notify-invite\n<recipient>\n<title>\n<issuedAt>` bytes so the server can tie
 * the request to a real directory key. Never throws on a network or server
 * failure; the caller swallows the result either way.
 */
async function notifyInviteEmail(params: {
  ownerEmail: string;
  ownerPubkey: string;
  ownerSigningPrivateKey: Uint8Array;
  recipientEmail: string;
  noteTitle: string;
}): Promise<void> {
  const issuedAt = new Date().toISOString();
  const payload = buildNotifyInvitePayload({
    recipientEmail: params.recipientEmail,
    noteTitle: params.noteTitle,
    issuedAt,
  });
  const signature = bytesToHex(
    ed25519.sign(payload, params.ownerSigningPrivateKey),
  );

  await fetch("/api/collab/notify-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: { email: params.ownerEmail, pubkey: params.ownerPubkey },
      recipientEmail: params.recipientEmail,
      noteTitle: params.noteTitle,
      issuedAt,
      signature,
    }),
  });
}

// ---------------------------------------------------------------------------
// External-collab chunk 5: list current collaborators + revoke one.
// ---------------------------------------------------------------------------

/** One member row returned by the owner-signed /members read. */
export interface CollabMember {
  email: string;
  pubkey: string;
  role: string | null;
  addedAt: number | null;
  addedBy: string | null;
}

export type ListMembersResult =
  | { ok: true; members: CollabMember[] }
  | { ok: false; reason: "no-identity" | "request-failed" };

/**
 * OWNER side. Reads the current member list for a doc's collab session, so the
 * revoke UI can show who has live access. Owner-signed; the DO verifies the
 * signature against the stored owner pubkey and returns the members rows.
 *
 * Returns ok:false (without sending) when this device has no usable sharing
 * identity. Never throws on a network failure; it returns request-failed. An
 * OPEN (never-granted) doc has no owner established, so the DO answers 403 and
 * this returns request-failed, which the UI renders as "no external
 * collaborators yet".
 */
export async function listMembers(sessionId: string): Promise<ListMembersResult> {
  const ownerEmailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!ownerEmailRaw || !signing?.privateKey || !signing?.publicKey) {
    return { ok: false, reason: "no-identity" };
  }
  const ownerEmail = canonicalizeEmail(ownerEmailRaw);

  const body = signMembersList({
    sessionId,
    ownerEmail,
    ownerSigningKey: { publicKey: signing.publicKey, privateKey: signing.privateKey },
  });

  try {
    const res = await fetch(
      `${relayHttpBase()}/members?session=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return { ok: false, reason: "request-failed" };
    const data = (await res.json()) as { members?: CollabMember[] };
    return { ok: true, members: Array.isArray(data.members) ? data.members : [] };
  } catch {
    return { ok: false, reason: "request-failed" };
  }
}

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: "no-identity" | "request-failed" };

/**
 * OWNER side. Revokes one external collaborator's LIVE access by email. The DO
 * verifies the owner signature and deletes the member row. The doc stays
 * enforced; the rest of the members keep their access.
 *
 * IMPORTANT (Grant's locked decision): revoke only stops the recipient's live
 * access. It NEVER reaches into the recipient's folder to delete their note. The
 * recipient keeps their last snapshot as a read-only local copy; their client
 * detects the revoke at connect time (a 401 on the enforced session) and renders
 * a read-only banner. See lib/collab/client/revocation.ts.
 *
 * Returns ok:false (without sending) when this device has no usable sharing
 * identity. Never throws on a network failure; it returns request-failed.
 */
export async function revokeExternalCollab(params: {
  sessionId: string;
  email: string;
}): Promise<RevokeResult> {
  const ownerEmailRaw = getCollabSignerEmail();
  const identity = getSessionIdentity();
  const signing = identity?.keys?.signing;
  if (!ownerEmailRaw || !signing?.privateKey || !signing?.publicKey) {
    return { ok: false, reason: "no-identity" };
  }
  const ownerEmail = canonicalizeEmail(ownerEmailRaw);

  const body = signRevoke({
    sessionId: params.sessionId,
    ownerEmail,
    ownerSigningKey: { publicKey: signing.publicKey, privateKey: signing.privateKey },
    email: canonicalizeEmail(params.email),
  });

  try {
    const res = await fetch(
      `${relayHttpBase()}/revoke?session=${encodeURIComponent(params.sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return { ok: false, reason: "request-failed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "request-failed" };
  }
}

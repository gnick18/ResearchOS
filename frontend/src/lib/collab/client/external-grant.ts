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
import type { SharedUser } from "@/lib/types";
import { getOrMintCollabDocId } from "./doc-id";
import { collabSessionFromDocId } from "@/lib/loro/collab/doc-id-session";
import { signGrant, type GrantMember } from "./do-access";
import { getCollabSignerEmail } from "./current-email";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";

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
}

export type GrantExternalCollabResult =
  | { ok: true; docId: string }
  | { ok: false; reason: "no-identity" | "self" | "request-failed" };

/**
 * Grants an outside ResearchOS user live access to a note.
 *
 * Mints the collab doc id if absent, resolves the in-lab sharers for the
 * first-grant backfill, signs the grant with the owner's Ed25519 directory key,
 * and POSTs it to the collab DO. On the first grant the DO flips the doc to
 * enforced and records the owner (TOFU) plus everyone in members[].
 *
 * Returns ok:false (without sending) when this device has no published sharing
 * identity (cannot sign) or when the owner is granting themselves.
 */
export async function grantExternalCollab(
  params: GrantExternalCollabParams,
): Promise<GrantExternalCollabResult> {
  const { doc, outside, sharedWith } = params;

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

  return { ok: true, docId };
}

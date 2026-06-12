// External-collab chunk 4: recipient ACCEPT + MATERIALIZE-TO-FOLDER.
//
// This is the payoff path. When an outside ResearchOS user grants the recipient
// live access to a note (chunks 1-3), the recipient sees a pending invite in
// "Shared with me". Accepting here does three things, in order:
//
//   1. VERIFY THE SENDER BINDING (anti-spoof). The inbox push is Ed25519-signed,
//      so the recorded fromEmail + fromPubkey came from the SAME key. But a
//      holder of any keypair could still claim someone else's email. So before
//      trusting anything we look fromEmail up in the directory (the same
//      POST /api/directory/lookup the owner-grant path uses) and confirm the
//      directory's pubkey for that email EQUALS the invite's fromPubkey. If they
//      disagree, or the email is not registered, or the invite has no fromPubkey
//      (a pre-chunk-4 push), we REFUSE. Nothing materializes on a failed verify.
//
//   2. MATERIALIZE TO FOLDER. On a verified accept we write a real local note
//      into the recipient's folder via the EXISTING received-note machinery
//      (importNoteBundle from lib/sharing/note-transfer). The note lands in the
//      same place a received bundle lands (users/<recipient>/notes/<id>.json),
//      carries the provenance markers (received_from / _fingerprint / _at), and
//      crucially carries collab_doc_id in BOTH the JSON record AND (on first
//      open) the Loro meta map. The CONTENT starts empty; the existing collab
//      open path (NoteDetailPopup -> connectFromDocId -> /snapshot with the
//      always-on connect token) adopts the DO canonical and fills it on connect,
//      since the recipient is now a granted member.
//
//   3. DISMISS THE INVITE. After a successful materialize we remove the invite
//      from the inbox so it does not reappear.
//
// SCOPE. Notes only. Revoke + consent/abuse guards are chunk 5. This path is the
// first end-to-end external collaboration but CANNOT be orchestrator-verified
// (it needs two accounts + two browsers + the relay), so it relies on unit tests
// for the verify gate and a live two-browser test for the round trip.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { lookupOutsideUser } from "./external-grant";
import { dismissInvite, type PendingInvite } from "./inbox";
import { importNoteBundle } from "@/lib/sharing/note-transfer";
import type { ReadBundleResult } from "@/lib/sharing/bundle";

export type AcceptInviteResult =
  | { ok: true; noteId: number }
  | {
      ok: false;
      reason: "unverifiable" | "sender-mismatch" | "materialize-failed";
    };

/**
 * Verifies the sender binding for a pending invite.
 *
 * Looks fromEmail up in the directory and confirms the registered pubkey equals
 * the invite's fromPubkey (case-insensitive hex compare). Returns the resolved
 * canonical sender email on success, or a typed failure the caller surfaces as a
 * "could not verify sender" warning. This is the anti-spoof gate: a holder of
 * any keypair cannot claim someone else's email, because the directory binds the
 * email to ONE pubkey and the push recorded the key that actually signed it.
 *
 * EXPORTED for unit testing (matching pubkey passes, mismatched refuses).
 */
export async function verifySenderBinding(
  invite: PendingInvite,
): Promise<
  | { ok: true; senderEmail: string }
  | { ok: false; reason: "unverifiable" | "sender-mismatch" }
> {
  // A pre-chunk-4 invite carries no fromPubkey, and an invite with no fromEmail
  // cannot be looked up. Either way there is nothing to verify against, so we
  // refuse rather than trust an unauthenticated sender claim.
  if (!invite.fromEmail || !invite.fromPubkey) {
    return { ok: false, reason: "unverifiable" };
  }

  const resolved = await lookupOutsideUser(invite.fromEmail);
  if (!resolved) {
    // The claimed sender email is not in the directory, so we cannot confirm the
    // key binding. Refuse (could be a spoofed or stale email).
    return { ok: false, reason: "unverifiable" };
  }

  // The directory binds the email to exactly one signing pubkey. The invite's
  // fromPubkey must equal it, or the sender claim is forged. Compare normalized
  // hex so casing differences never cause a false mismatch.
  const directoryKey = resolved.ed25519PublicKey.toLowerCase();
  const invitedKey = invite.fromPubkey.toLowerCase();
  if (directoryKey !== invitedKey) {
    return { ok: false, reason: "sender-mismatch" };
  }

  return { ok: true, senderEmail: resolved.email };
}

/**
 * Builds the synthetic ReadBundleResult that importNoteBundle materializes. The
 * note CONTENT is intentionally empty (title from the invite, no entries): the
 * live document lives on the DO and the existing collab open path adopts the
 * canonical snapshot on connect. We only need importNoteBundle to write the
 * local record with the provenance markers + collab_doc_id, so the note exists
 * locally and auto-connects.
 *
 * valid is true because this is not a wire bundle we verified by SHA, it is a
 * locally-constructed placeholder gated by the sender-binding check above.
 * importNoteBundle throws InvalidBundleError on !valid, so this must be true.
 */
function buildMaterializeBundle(invite: PendingInvite): ReadBundleResult {
  return {
    valid: true,
    shareUuid: invite.collabDocId,
    version: 1,
    entityType: "note",
    entity: {
      title: invite.title ?? "Untitled note",
      description: "",
      is_running_log: false,
      entries: [],
      // The shared secret that lets the recipient join the SAME relay room. It
      // is carried into the local Note JSON by importNoteBundle, and seeded into
      // the Loro meta map on first open by NoteDetailPopup, so getCollabDocId
      // returns it and auto-connect fires.
      collab_doc_id: invite.collabDocId,
    },
    attachments: [],
    embeddedObjects: [],
    metadata: {},
  };
}

/**
 * Accepts a verified live-collab invite, the full gate-then-materialize flow.
 *
 *   verify sender binding -> materialize the local note -> dismiss the invite.
 *
 * On a failed verify NOTHING is written and the invite is NOT dismissed (the
 * recipient can re-evaluate or decline). On a successful materialize the note
 * lands in the recipient's folder (users/<recipient>/notes/<id>.json) with
 * received_from = the VERIFIED sender email and collab_doc_id set in both the
 * record and (on first open) the Loro meta, then the invite is dismissed.
 */
export async function acceptInvite(
  invite: PendingInvite,
  currentUser: string,
): Promise<AcceptInviteResult> {
  const verified = await verifySenderBinding(invite);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }

  let noteId: number;
  try {
    const bundle = buildMaterializeBundle(invite);
    // received_from is the VERIFIED sender email (not the raw invite claim), so
    // the provenance marker is trustworthy. The fingerprint slot carries the
    // verified pubkey, the same anti-spoof key we just confirmed.
    const result = await importNoteBundle(bundle, {
      currentUser,
      senderEmail: verified.senderEmail,
      senderFingerprint: invite.fromPubkey ?? "",
    });
    noteId = result.noteId;
  } catch (err) {
    console.error("[collab-accept] materialize failed", err);
    return { ok: false, reason: "materialize-failed" };
  }

  // Best-effort dismiss. The note is already on disk; a failed dismiss only
  // leaves the invite to reappear, it does not lose the materialized note.
  try {
    await dismissInvite(invite.collabDocId);
  } catch (err) {
    console.warn("[collab-accept] dismiss after materialize failed", err);
  }

  return { ok: true, noteId };
}

// Phase 3c chunk 2: grant-on-share helper.
//
// When a note is shared with someone, the collab doc id is minted (if absent)
// and grantCollabMember is called for each newly-added member. This registers
// them server-side so their openCollabDoc call succeeds when they open the note.
//
// The helper is called from NoteDetailPopup's onShared callback (after the
// share completes and the note is refetched). It computes the diff between the
// previous and next shared_with lists and calls grantCollabMember for each
// genuinely new recipient.
//
// The owner also needs to be a member (so THEY can push). We call
// grantCollabMember for the owner as well on the very first share (when the
// doc row does not exist yet, the grant route creates it and the owner becomes
// the first member).
//
// Best-effort: failures are logged and not thrown. A failed grant means the
// new member's first open returns 403, which reconcileOnOpen already handles
// gracefully (it logs and falls back to local state).

import { LoroDoc } from "loro-crdt";
import type { SharedUser } from "@/lib/types";
import { getOrMintCollabDocId } from "./doc-id";
import { grantCollabMember, NoLocalIdentityError, CollabError } from "./persistence";

/** Parameters for grantCollabOnShare. */
export interface GrantCollabOnShareParams {
  /** The note's live LoroDoc. The doc id is minted here if absent. */
  doc: LoroDoc;
  /** The note owner's email (the identity signing the grant requests). */
  ownerEmail: string;
  /**
   * The previous shared_with list (before the share dialog saved).
   * May be undefined/null for notes that were private.
   */
  previousSharedWith?: SharedUser[] | null;
  /**
   * The updated shared_with list (after the share dialog saved).
   * The diff between previous and next determines who is newly added.
   */
  nextSharedWith: SharedUser[];
}

/**
 * Mints the collab doc id if absent, then grants each newly-added recipient
 * access to the doc on the server. Also ensures the owner is registered as a
 * member on the first grant.
 *
 * Returns the docId that was used (or minted). Returns null when there is
 * nothing to do (no new members, sharing disabled, etc.).
 *
 * All network failures are swallowed (best-effort). A failed grant produces a
 * console.warn and does not affect local behavior.
 */
export async function grantCollabOnShare(
  params: GrantCollabOnShareParams,
): Promise<string | null> {
  const { doc, ownerEmail, previousSharedWith, nextSharedWith } = params;

  // Not shared with anyone, nothing to do.
  if (nextSharedWith.length === 0) return null;

  // The note IS shared (with anyone, including the whole-lab "*" sentinel), so
  // it is a collaborative doc. Mint the doc id unconditionally and idempotently.
  // This is what flips the note into auto-on-open collab. A whole-lab share has
  // no specific member email, so the earlier "only mint for new named members"
  // path skipped it and the note never got a doc id; minting here fixes that.
  const docId = getOrMintCollabDocId(doc);

  // Compute newly-added usernames (present in next, absent in previous).
  const prevSet = new Set((previousSharedWith ?? []).map((s) => s.username));
  const newMembers = nextSharedWith
    .map((s) => s.username)
    .filter((u) => u !== "*" && !prevSet.has(u)); // skip the whole-lab sentinel

  const isFirstShare = (previousSharedWith ?? []).length === 0;

  // On first share, grant the owner themselves so they can push.
  if (isFirstShare) {
    await tryGrant(docId, ownerEmail, ownerEmail);
  }

  // Grant each new member. Each call is independent so one failure does not
  // block the others.
  for (const memberEmail of newMembers) {
    await tryGrant(docId, ownerEmail, memberEmail);
  }

  return docId;
}

/** Calls grantCollabMember and swallows all errors (best-effort). */
async function tryGrant(
  docId: string,
  ownerEmail: string,
  memberEmail: string,
): Promise<void> {
  try {
    await grantCollabMember(docId, ownerEmail, memberEmail);
  } catch (err) {
    if (err instanceof NoLocalIdentityError) {
      console.warn("[collab] grant-on-share: no local identity; member will not be registered server-side");
    } else if (err instanceof CollabError) {
      console.warn("[collab] grant-on-share: server error", err.status, err.message);
    } else {
      console.warn("[collab] grant-on-share: unexpected error", err);
    }
  }
}

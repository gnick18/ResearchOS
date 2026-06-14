// Cloud-accounts Phase 4A: deferred lab-data-key sealing, the PURE decision core.
//
// Phase 4B lets a lab admit a MEMBER with no published X25519 pubkey yet (they
// joined via the unified server token, account-first, no device key). Membership
// (the server token / billing roster) and DATA-KEY ACCESS (the lab key sealed to
// the member's X25519 pubkey) are independent. This module holds the pure logic
// that decides, for a given member, which of those two they have, and which
// members an existing key-holder must now seal the lab key to.
//
// SECURITY MODEL (read this before touching anything here).
//   - The lab DATA KEY is end-to-end. It is NEVER sent to, stored by, or derivable
//     by the server. It reaches a member ONLY as a sealToRecipient sealed-box,
//     produced client-side by a member who ALREADY holds the key, addressed to the
//     recipient's X25519 PUBLIC key.
//   - This module touches NO key material at all. It is pure roster/pubkey/copy
//     bookkeeping. It takes only PUBLIC inputs (rosters, usernames, hex public
//     keys, which usernames already have a sealed copy) and returns decisions. It
//     imports no crypto and seals nothing; the orchestration (lab-deferred-seal-
//     reconcile.ts) does the actual client-side sealToRecipient with the live key.
//   - A member who is admitted before anyone can seal to them simply CANNOT decrypt
//     until the seal lands. That is a clearly-labeled "waiting for a labmate to
//     grant data access" state (DataKeyState below), never a silent failure and
//     never a soft-lock: the member is a real member and can leave at any time.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * A member's data-key access state, independent of their membership. The split is
 * the whole point of Phase 4: being a member (server token) and holding the sealed
 * lab key are two different things, and the UI must make a pending data key legible
 * rather than looking broken.
 *
 *   "active"          The member is in the head-signed roster AND has a sealed copy
 *                     of the current lab key. They can decrypt lab data now.
 *   "seal-pending"    The member is in the roster and HAS published an X25519
 *                     pubkey, but no sealed copy exists yet. A labmate who holds
 *                     the key just needs to seal to them. Show "waiting for a
 *                     labmate to grant data access".
 *   "key-pending"     The member is in the roster but has NOT published an X25519
 *                     pubkey yet (account-first, no device key). Nobody can seal to
 *                     them until they provision a device key (Phase 2). Show "set
 *                     up a device key to receive lab data access".
 *   "not-member"      Not in the roster at all.
 */
export type DataKeyState =
  | "active"
  | "seal-pending"
  | "key-pending"
  | "not-member";

/** A short, human-readable label + guidance for each DataKeyState, for the UI. */
export function describeDataKeyState(state: DataKeyState): {
  label: string;
  detail: string;
} {
  switch (state) {
    case "active":
      return {
        label: "Data access active",
        detail: "You can read and sync this lab's encrypted data.",
      };
    case "seal-pending":
      return {
        label: "Waiting for data access",
        detail:
          "You are a member. A labmate still needs to grant you data access, which happens end-to-end (the server never sees the lab key). This usually lands the next time a labmate opens the lab.",
      };
    case "key-pending":
      return {
        label: "Set up a device key",
        detail:
          "You are a member. Set up a device key on this device so a labmate can grant you data access end-to-end. Until then this lab's data cannot be decrypted here.",
      };
    case "not-member":
      return {
        label: "Not a member",
        detail: "You are not a member of this lab.",
      };
  }
}

/**
 * The minimal public facts about a member needed to classify their data-key state.
 * No private key material, ever.
 */
export interface MemberSealFacts {
  username: string;
  /**
   * The member's published X25519 public key (hex), or null/empty when they have
   * not provisioned a device key yet. For the head-signed roster this is the
   * member's x25519PublicKey; for a token-only member who has no pubkey it is
   * resolved from the directory (lookup by email) by the orchestration, and is
   * null when the directory has no binding for them yet.
   */
  publishedX25519Pub: string | null;
  /** True when the current-generation envelope already has a sealed copy for them. */
  hasSealedCopy: boolean;
  /** True when the member appears in the head-signed roster (or is the head). */
  inRoster: boolean;
}

/**
 * Classifies one member's data-key state from public facts alone. The order of
 * checks matters: not-a-member short-circuits, then an existing sealed copy means
 * active, then a published pubkey means a labmate can seal (seal-pending), else
 * the member must first publish a key (key-pending).
 */
export function classifyDataKeyState(facts: MemberSealFacts): DataKeyState {
  if (!facts.inRoster) return "not-member";
  if (facts.hasSealedCopy) return "active";
  if (facts.publishedX25519Pub && facts.publishedX25519Pub.length > 0) {
    return "seal-pending";
  }
  return "key-pending";
}

/**
 * One member an existing key-holder should seal the current lab key to: in the
 * roster, has a published X25519 pubkey, and has no sealed copy yet. (key-pending
 * members are deliberately excluded, there is nothing to seal to until they
 * publish a pubkey.)
 */
export interface SealTarget {
  username: string;
  /** The recipient's X25519 public key (hex) to sealToRecipient against. */
  x25519PublicKey: string;
}

/**
 * THE reconciliation decision. Given the public facts for every member, returns
 * exactly the members in "seal-pending" state, i.e. the ones a key-holder must now
 * seal the lab key to. Deterministic and side-effect-free, so it is safe to run on
 * every lab open and unit-testable in isolation. The orchestration then seals to
 * each returned target client-side and ships the sealed copy via a head-signed
 * add entry; the server still never sees the key.
 *
 * A member already active is skipped (idempotent: re-running after a seal lands
 * yields no targets for them). A key-pending member is skipped (no pubkey to seal
 * to). The head is never a target (the head always co-owns the key by
 * construction), but even if passed in, an "active" or self entry is filtered out
 * by the same rules.
 */
export function membersNeedingSeal(facts: MemberSealFacts[]): SealTarget[] {
  const targets: SealTarget[] = [];
  for (const f of facts) {
    if (classifyDataKeyState(f) !== "seal-pending") continue;
    // seal-pending guarantees a non-empty published pubkey, but narrow it for TS.
    if (!f.publishedX25519Pub) continue;
    targets.push({ username: f.username, x25519PublicKey: f.publishedX25519Pub });
  }
  return targets;
}

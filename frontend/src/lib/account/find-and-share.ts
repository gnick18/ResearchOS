// Cloud-accounts Phase 3 Chunk 3B: the find-and-share flag + delivery decision.
//
// Find-and-share merges two ops that are separate today: search the directory
// for a researcher (by @handle or name) and send them an encrypted share. The
// new UI surface is gated behind this flag so the current send flows are
// untouched until a deployment opts in.
//
// This module also holds the PURE delivery decision: given a recipient's
// resolved key state, choose whether to seal directly to their published X25519
// key (the registered relay sendShare path) or fall back to the one-time-key
// invite link (the recipient has an account but no published data key yet, the
// Phase 2 cloud-account-first case, or is not on ResearchOS at all). Keeping it
// pure lets it be unit-tested without crypto, the network, or React.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * DEFAULT-OFF: this surfaces a brand-new combined flow, so it stays dark until
 * explicitly enabled. Set NEXT_PUBLIC_FIND_AND_SHARE=1 (or "true") to turn it on.
 * NEXT_PUBLIC so the check runs client-side in the account UI.
 */
export function isFindAndShareEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FIND_AND_SHARE;
  return v === "1" || v === "true";
}

/** How a share will be delivered to a picked recipient. */
export type DeliveryMethod = "seal" | "one-time-link";

/**
 * The recipient's resolved key state, as the picker knows it before sending.
 * `hasPublishedKey` is true when a directory lookup (by email) or a directory
 * search result resolved a published X25519 public key for the recipient, false
 * otherwise (an account with no data key yet, or not on ResearchOS).
 */
export interface RecipientKeyState {
  hasPublishedKey: boolean;
}

/**
 * The delivery decision. A recipient with a published X25519 key can receive a
 * sealed share through the registered relay (sendShare), which is the
 * higher-assurance path. A recipient without one cannot be sealed to, so we fall
 * back to the one-time-key invite link the sender hands over out of band
 * (inviteShare), exactly as the existing send-by-email flow already does on a
 * directory miss.
 */
export function decideDeliveryMethod(state: RecipientKeyState): DeliveryMethod {
  return state.hasPublishedKey ? "seal" : "one-time-link";
}

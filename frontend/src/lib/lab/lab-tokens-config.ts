// Cloud-accounts Phase 4: the lab-tier unified-invite-token + deferred-sealing flag.
//
// Phase 4 brings the lab tier onto the SAME centralized, folderless, session-based
// membership path the dept and institution tiers already use (one server token,
// no device key needed to BECOME a member), and lets a lab admit an account-first
// member who has no published X25519 pubkey yet (the lab DATA KEY is sealed to
// them later, end-to-end, once they provision a key).
//
// DEFAULT-OFF kill switch (mirrors lib/account/account-first.ts but inverted: the
// new behavior is opt-in until verified). Set NEXT_PUBLIC_LAB_TOKENS_V2=1 (or
// "true") to turn it on. While off, the existing head-signed lab invite + accept
// handshake (lab-invite.ts / lab-invite-flow.ts) is the only membership path and
// is completely untouched. NEXT_PUBLIC so the entry/UI checks run client-side; the
// server routes read the same env so a half-on state is impossible.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Gates the lab-tier unified invite tokens (4B) and deferred lab-data-key sealing
 * (4A). Default false. Off means the current head-signed lab invite flow is the
 * only path and nothing in this phase can run.
 */
export function isLabTokensV2Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_LAB_TOKENS_V2;
  return v === "1" || v === "true";
}

export const LORO_PILOT_ENABLED = true;

/**
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md). Gates the
 * Loro-backed field-map model for purchase items (a structured record, not
 * text). Default OFF and independent of LORO_PILOT_ENABLED, so the foundation
 * (model + sidecar + handle) stays dormant until the read/write wiring chunks
 * ship and it is deliberately turned on. When off, openPurchaseDoc skips the
 * collab adopt path exactly as openTaskDoc gates on LORO_PILOT_ENABLED.
 */
export const PURCHASE_LORO_ENABLED = true;

/**
 * External live-collaboration sharing (docs/proposals/EXTERNAL_COLLAB_SHARING.md).
 * Gates the OWNER grant flow that activates the collab DO access lock for an
 * outside ResearchOS user. Default OFF: chunk 2 is owner-side only (no recipient
 * discovery / accept / materialize yet), so the path is not end-to-end usable.
 * Flipping a doc to enforced is a one-way action, so this stays dark until the
 * recipient side ships. The connect-token attach (PIECE A) is NOT gated by this.
 */
export const EXTERNAL_COLLAB_ENABLED = true;

/**
 * WebSocket URL for the collab relay. Defaults to the local wrangler dev
 * server for two-tab testing. Override with NEXT_PUBLIC_COLLAB_RELAY_URL for
 * staging / production deployments.
 *
 * Session connect builds `${COLLAB_RELAY_URL}/ws?session=<sessionId>`, which
 * matches the relay's /ws?session=<id> endpoint in relay/src/worker.ts.
 */
export const COLLAB_RELAY_URL =
  process.env.NEXT_PUBLIC_COLLAB_RELAY_URL ?? "ws://localhost:8787";

/**
 * Domain-separation salt for the per-recipient inbox address (external-collab
 * chunk 3). The inbox Durable Object is addressed by hashEmail(email, this), so
 * both the sender (who learns the recipient's email from the directory lookup)
 * and the recipient (who knows their own email) derive the SAME inbox key.
 *
 * This is deliberately a PUBLIC constant, not the server's DIRECTORY_HMAC_PEPPER
 * (which never reaches the browser). The inbox address does not need to be
 * secret. Every security property rests on the Ed25519 signatures the inbox DO
 * verifies plus the trust-on-first-use recipient pubkey, not on the address
 * being unguessable. Keeping it distinct from the directory pepper means the
 * inbox key cannot be cross-correlated with a directory row.
 */
export const COLLAB_INBOX_ADDRESS_SALT = "researchos-collab-inbox-v1";

export const LORO_PILOT_ENABLED = true;

/**
 * External live-collaboration sharing (docs/proposals/EXTERNAL_COLLAB_SHARING.md).
 * Gates the OWNER grant flow that activates the collab DO access lock for an
 * outside ResearchOS user. Default OFF: chunk 2 is owner-side only (no recipient
 * discovery / accept / materialize yet), so the path is not end-to-end usable.
 * Flipping a doc to enforced is a one-way action, so this stays dark until the
 * recipient side ships. The connect-token attach (PIECE A) is NOT gated by this.
 */
export const EXTERNAL_COLLAB_ENABLED = false;

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

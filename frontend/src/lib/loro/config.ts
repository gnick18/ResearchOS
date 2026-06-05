export const LORO_PILOT_ENABLED = false;

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

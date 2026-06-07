// External-collab chunk 2, PIECE A: connect-token attach for the live connect
// path.
//
// The collab Durable Object access gate (storage-migration chunk 3) is opt-in
// PER DOC. A doc stays OPEN (no auth needed) until its first /grant flips it to
// enforced='1'. An OPEN doc IGNORES any authEmail/authTs/authSig query params;
// an ENFORCED doc REQUIRES them and rejects a connect that lacks a valid member
// token. See relay/src/worker.ts (checkConnect).
//
// Therefore the safe behavior for EVERY connect (in-lab or external) is to
// ALWAYS attach a connect token when this device has a sharing identity, with
// no feature flag. For an open doc the params are dead weight the DO drops, so
// the existing in-lab path is byte-for-byte unchanged except for the extra
// (ignored) query string. For an enforced doc the params are exactly what keeps
// a legitimate member connected. Gating this on the external-collab flag would
// lock a flag-off in-lab member out of any doc someone else enforced, so the
// attach is intentionally NOT gated.
//
// SAFETY: signing must NEVER block or fail a connect. When no identity exists,
// or signing throws for any reason, this returns the empty string and the caller
// connects exactly as today. A device with no identity cannot be a member of an
// enforced doc anyway, so attaching nothing is correct.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { signConnectToken } from "./do-access";
import { getCollabSignerEmail } from "./current-email";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";

/**
 * Builds the connect-token query suffix for a relay /ws or /snapshot URL.
 *
 * Returns a string that always begins with "&" (e.g.
 * "&authEmail=...&authTs=...&authSig=...") when this device has a sharing
 * identity and the token signs cleanly, ready to append to a URL that already
 * carries a `session` param. Returns "" when there is no identity or signing
 * fails, in which case the caller appends nothing and connects as today.
 *
 * @param sessionId The relay session id (hex), the same value already in the
 *   connect URL's `session` param. The token is bound to this session id, so it
 *   must match exactly.
 */
export function buildConnectTokenSuffix(sessionId: string): string {
  try {
    const email = getCollabSignerEmail();
    if (!email) return "";

    const identity = getSessionIdentity();
    const signingKey = identity?.keys?.signing;
    if (!signingKey || !signingKey.privateKey) return "";

    const token = signConnectToken({
      sessionId,
      email,
      signingKey: { privateKey: signingKey.privateKey },
    });

    return (
      `&authEmail=${encodeURIComponent(token.authEmail)}` +
      `&authTs=${encodeURIComponent(token.authTs)}` +
      `&authSig=${encodeURIComponent(token.authSig)}`
    );
  } catch {
    // Never block a connect because token-signing failed. Open docs still work;
    // a device that cannot sign cannot be a member of an enforced doc anyway.
    return "";
  }
}

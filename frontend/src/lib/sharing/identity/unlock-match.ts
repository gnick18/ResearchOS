// Cross-boundary sharing, D1 provider-unlock decision (pure helper).
//
// D1 lets an account that has CLAIMED a global sharing identity unlock its
// folder-local account with "Sign in with Google or GitHub" when online, the
// local password staying as the offline fallback. The security-critical rule is
// that a provider sign-in only unlocks the ONE account whose claimed identity
// email matches the verified session email. Any other successful Google or
// GitHub login (a different person, a personal address, a stale session) must
// NOT unlock the account.
//
// The matching decision is extracted here as a pure function so the rule is
// explicit and unit-testable, separate from the OAuth-redirect plumbing in
// UserLoginScreen. Both sides go through canonicalizeEmail first so casing and
// surrounding whitespace never cause a false mismatch (or a false match).

import { canonicalizeEmail } from "@/lib/sharing/directory/email";

export type UnlockMatch =
  | { ok: true }
  // The provider returned no usable email (session expired or anonymous).
  | { ok: false; reason: "no-session-email" }
  // A verified email came back, but it is not the one this identity is claimed
  // under (wrong account, wrong person, or the account never claimed at all).
  | { ok: false; reason: "email-mismatch" };

/**
 * Decide whether a provider sign-in may unlock this account.
 *
 * @param sessionEmail the verified email from the OAuth session (raw, may be
 *   null/undefined when the session has no user).
 * @param claimedEmail the email recorded in the account's
 *   `_sharing_identity.json` sidecar (raw, may be null/undefined when the
 *   account has not claimed an identity).
 *
 * Returns `{ ok: true }` only when both canonicalize to a non-empty value and
 * those values are equal. Empty/missing on either side never unlocks.
 */
export function evaluateUnlockMatch(
  sessionEmail: string | null | undefined,
  claimedEmail: string | null | undefined,
): UnlockMatch {
  const session = canonicalizeEmail(sessionEmail ?? "");
  const claimed = canonicalizeEmail(claimedEmail ?? "");

  if (!session) {
    return { ok: false, reason: "no-session-email" };
  }
  if (!claimed || session !== claimed) {
    return { ok: false, reason: "email-mismatch" };
  }
  return { ok: true };
}

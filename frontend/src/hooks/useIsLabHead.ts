"use client";

import { useAccountType } from "./useAccountType";

/**
 * Identity model simplification, phase 2: the canonical "is the active user a
 * lab head (PI)" hook.
 *
 * Thin wrapper over `useAccountType` that returns the PI-role boolean directly,
 * so PI surfaces can read `useIsLabHead(user)` instead of spelling out
 * `useAccountType(user) === "lab_head"` at every call site. Standardizing the
 * role check on this hook is the Phase 2 groundwork; the wrapper is a pure
 * no-op over the existing hook (no new reads, no new subscriptions).
 *
 * Returns:
 *   - `undefined` while the underlying settings read is in flight (or right
 *     after a username change). This mirrors `useAccountType`'s loading state
 *     so callers that want to suppress PI chrome until the read settles can
 *     still distinguish "loading" from "definitely not a lab head".
 *   - `false` when there's no active user (signed-out) or the user is a member.
 *   - `true` once the read resolves to `lab_head`.
 *
 * Equivalence note: in a boolean context (`if (useIsLabHead(u))`,
 * `{useIsLabHead(u) && ...}`, `const isLabHead = useIsLabHead(u)`), the result
 * is interchangeable with `useAccountType(u) === "lab_head"`, because the
 * loading `undefined` and the signed-out `null` both fall to falsy exactly as
 * `undefined === "lab_head"` and `null === "lab_head"` do. Migrating a
 * truthiness check from one to the other is therefore behavior-preserving.
 */
export function useIsLabHead(
  username: string | null,
): boolean | undefined {
  const accountType = useAccountType(username);
  // Preserve the loading signal: undefined in, undefined out. Anything that has
  // resolved (a real "member"/"lab_head", or the signed-out null) collapses to
  // the lab_head boolean.
  if (accountType === undefined) return undefined;
  return accountType === "lab_head";
}

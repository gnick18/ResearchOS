// Lab tier Phase 5: account-type resolution.
//
// Determines whether the active user is a solo or lab account. Two inputs are
// combined: a PERSISTED MARKER (fast, no I/O, stored locally so the gate can
// render instantly) and a LIVE MEMBERSHIP CHECK (authoritative, async, wired to
// getLabRemote against the Lab Record DO in later slices). The marker is a
// cache so "lab" is visible before the network call; the membership check is
// the source of truth that can UPGRADE a solo account to lab if the marker is
// stale or missing.
//
// FAIL-SAFE POLICY: if the membership check rejects (network error, relay
// down, timeout), the function does NOT downgrade the account. It falls back to
// the persisted marker. A transient failure must never silently turn a paying
// lab account into a solo account and hide the sync engine from a member who is
// in the middle of an experiment. The doc comment on resolveAccountType spells
// this out explicitly for callers.
//
// FLAG NOTE: production callers must check LAB_TIER_ENABLED from "./config"
// before calling this function. When the flag is false, treat everyone as
// "solo". The function itself is flag-free so unit tests can exercise the
// resolution logic without mocking the config module.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** The two account types for Phase 5. */
export type LabAccountType = "solo" | "lab";

/**
 * Resolves whether the current user has a solo or lab account.
 *
 * The logic is:
 *   1. If persistedMarker is "lab", return "lab" immediately (cache hit,
 *      avoids a round-trip on every app open).
 *   2. Otherwise call checkLabMembership(). If it resolves true, return "lab"
 *      (live upgrade: the marker was missing or stale).
 *   3. If checkLabMembership() REJECTS, fall back to persistedMarker instead
 *      of throwing. A transient network failure must never silently downgrade a
 *      lab account to solo. Callers that care about the failure can wrap this
 *      function; this function itself prefers availability over accuracy on
 *      error.
 *   4. If checkLabMembership() resolves false and persistedMarker is null,
 *      return "solo".
 *
 * IMPORTANT: production callers must guard with LAB_TIER_ENABLED from
 * "./config". When the flag is false, short-circuit to "solo" before calling
 * this function so it is unreachable in the current prod build.
 *
 * @param params.persistedMarker the locally stored account type, or null if
 *   never persisted (new install, or stored value was cleared).
 * @param params.checkLabMembership async predicate that queries the Lab Record
 *   DO (via getLabRemote) to verify the current keypair is a member or head of
 *   any live lab. MUST NOT throw under normal conditions; may reject on network
 *   failure (handled as per fail-safe policy above).
 */
export async function resolveAccountType(params: {
  persistedMarker: LabAccountType | null;
  checkLabMembership: () => Promise<boolean>;
}): Promise<LabAccountType> {
  const { persistedMarker, checkLabMembership } = params;

  // Fast path: the persisted marker already says "lab".
  if (persistedMarker === "lab") {
    return "lab";
  }

  // Live check: ask the DO whether this keypair is a member.
  let isMember: boolean;
  try {
    isMember = await checkLabMembership();
  } catch {
    // FAIL-SAFE: a rejected promise (network error, relay down, etc.) must
    // not downgrade. Fall back to whatever the marker says. If the marker is
    // null we have no signal, so we fall through to "solo"; if it were "lab"
    // we would have already returned above, so null is the only option here.
    return persistedMarker ?? "solo";
  }

  if (isMember) {
    return "lab";
  }

  return persistedMarker ?? "solo";
}

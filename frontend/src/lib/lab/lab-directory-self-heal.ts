// Lab tier: idempotent directory self-heal for labs that were created before
// the name-gated write was fixed.
//
// Labs created while the old fire-and-forget code was live may never have
// received a directory_labs row, making them invisible to the admin roster and
// /network. This module provides a single function that a PI can call on login
// to guarantee the row exists. The POST to /api/directory/labs/publish is
// idempotent: re-sending for a lab that already has a row is safe and cheap
// (the endpoint upserts, so duplicates are not created). Only the PI (lab head)
// should call this; non-head members have no permission to publish directory rows.
//
// Usage: fire-and-forget inside lab-session-effects.ts openLabKey() after the
// isHead check, guarded by a session-scoped Set so it runs at most once per lab
// per page load.
//
// No emojis, no em-dashes, no mid-sentence colons.

export interface EnsureLabDirectoryRowParams {
  /** The stable, opaque lab id. */
  labId: string;
  /** The PI's OAuth-verified email, used only for logging/debugging (not sent). */
  oauthEmail: string;
  /**
   * The PI's display name to use as piDisplayName in the directory row. When
   * available, a non-empty string produces a richer directory listing.
   */
  piDisplayName?: string;
  /**
   * The lab name, if known. When undefined or empty, the endpoint will use the
   * existing row's name (upsert keeps the existing value if the name field is
   * absent or empty). An explicit name overrides the stored one.
   */
  labName?: string;
  /** Optional institution, forwarded to the directory row. */
  institution?: string | null;
}

/**
 * Fires an idempotent upsert to /api/directory/labs/publish to ensure the lab
 * has a directory_labs row. Returns true when the upsert landed (2xx), false
 * otherwise. The caller is expected to swallow the return value and never throw
 * from this path (it is always best-effort).
 *
 * A missing or non-2xx response is not re-thrown so the caller can use a simple
 * void fire-and-forget pattern. The caller's catch block handles all errors.
 */
export async function ensureLabDirectoryRow(
  params: EnsureLabDirectoryRowParams,
): Promise<boolean> {
  const { labId, piDisplayName, labName, institution } = params;
  try {
    const res = await fetch("/api/directory/labs/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        labId,
        // Send the name only when we have one; the endpoint preserves the
        // existing name when the field is absent, so a self-heal that runs
        // without a name will not blank out a name the PI set previously.
        ...(labName?.trim() ? { name: labName.trim() } : {}),
        institution: institution ?? null,
        piDisplayName: piDisplayName ?? "",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

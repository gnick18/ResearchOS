// frontend/src/lib/deposit/owner-orcid.ts
//
// Phase 2 of the thin-account-settings-home refactor: a single accessor for the
// depositing owner's ORCID that PREFERS the cloud account profile
// (account_profiles.links.orcid via GET /api/account/profile, the canonical
// identity store) and FALLS BACK to the local _user_metadata.json value when the
// cloud value is absent. That keeps offline / solo deposits working exactly as
// they do today (with the cloud orcid empty the fallback returns the same local
// value), while a user who has set their ORCID once in their cloud profile no
// longer has to re-enter it per folder.
//
// Browser-only: both deposit prefill callers run client-side, so the cloud read
// is a plain fetch. Any failure (offline, signed out, 4xx/5xx) resolves to null
// and the caller's local fallback takes over, so this never throws and never
// regresses the no-cloud path.
//
// No em-dashes, no emojis. No new on-disk field is written here.

/**
 * The caller's cloud account ORCID, or null when none is set or the cloud is
 * unreachable. Reads GET /api/account/profile and returns links.orcid. Never
 * throws; a missing profile, an error response, or a network failure all map to
 * null so the local fallback stays in control.
 */
export async function fetchCloudOwnerOrcid(): Promise<string | null> {
  try {
    const res = await fetch("/api/account/profile");
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      profile?: { links?: { orcid?: string | null } | null } | null;
    };
    const orcid = data.profile?.links?.orcid;
    return typeof orcid === "string" && orcid.trim() ? orcid : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the owner's ORCID, cloud-preferred with a local fallback. Pass the
 * local _user_metadata.json value (ownerEntry.orcid) as `localOrcid`; this
 * returns the cloud value when present, else the local value, else null. The
 * cloud read is fetched here so callers stay one line.
 */
export async function resolveOwnerOrcid(
  localOrcid: string | null | undefined,
): Promise<string | null> {
  const cloud = await fetchCloudOwnerOrcid();
  if (cloud) return cloud;
  return localOrcid ?? null;
}

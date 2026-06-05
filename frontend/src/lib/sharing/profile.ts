// Cross-boundary sharing, client-side profile API.
//
// Thin wrappers around the three profile routes built in section 17 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md:
//
//   GET    /api/directory/profile  — fetch own profile (OAuth session required)
//   POST   /api/directory/profile  — publish/update profile (session + sig)
//   DELETE /api/directory/profile  — remove profile (session + sig)
//   GET    /api/directory/search   — search by name/affiliation (session required)
//
// Each write route requires TWO proofs:
//   1. An Auth.js OAuth session (proves email identity).
//   2. An Ed25519 signature over the canonical payload (proves key control).
//
// The payload format used here MUST match the server's buildProfilePayload()
// in lib/sharing/directory/signature.ts. Format (key=value, newline-joined):
//   "researchos.directory.profile.v1\naction={action}\ndisplayName={v}\n
//    affiliation={v}\norcid={v}\nissuedAt={v}"
// Null / undefined fields are encoded as the literal string "null" (not ""),
// matching the server convention. The profile and delete-profile actions both
// use this envelope so the server can reconstruct the same bytes and verify.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { loadIdentity } from "./identity/storage";

// ---------------------------------------------------------------------------
// Shared types (mirror the server-side DirectoryProfile / ProfileSearchResult)
// ---------------------------------------------------------------------------

export interface ProfileData {
  displayName: string;
  affiliation: string | null;
  orcid: string | null;
}

export interface PublishedProfile extends ProfileData {
  fingerprint: string;
  /** The verified institutional domain (e.g. "wisc.edu"), or null when the
   * OAuth login was on a consumer email (gmail, outlook, etc.). */
  affiliationDomain: string | null;
  updatedAt?: string;
}

export interface ProfileSearchResult extends PublishedProfile {
  x25519PublicKey: string;
  ed25519PublicKey: string;
}

// ---------------------------------------------------------------------------
// Payload builder — must stay in sync with the server's buildProfilePayload()
// ---------------------------------------------------------------------------

type ProfileAction = "profile" | "delete-profile";

// Mirrors PROFILE_VERSION in lib/sharing/directory/signature.ts exactly.
const PROFILE_VERSION = "researchos.directory.profile.v1";

function buildProfilePayloadBytes(
  action: ProfileAction,
  data: {
    displayName?: string;
    affiliation?: string | null;
    orcid?: string | null;
    issuedAt: string;
  },
): Uint8Array {
  // Null / undefined → literal "null" to match the server's encoding.
  const enc = (v: string | null | undefined) => v ?? "null";
  const lines = [
    PROFILE_VERSION,
    `action=${action}`,
    `displayName=${enc(data.displayName)}`,
    `affiliation=${enc(data.affiliation)}`,
    `orcid=${enc(data.orcid)}`,
    `issuedAt=${data.issuedAt}`,
  ];
  return new TextEncoder().encode(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Fetch own profile
// ---------------------------------------------------------------------------

/**
 * Returns the caller's published profile, or null if none has been published.
 * Requires an active OAuth session; returns null on 401/404/network errors.
 */
export async function fetchMyProfile(): Promise<PublishedProfile | null> {
  try {
    const res = await fetch("/api/directory/profile");
    if (res.status === 404 || res.status === 401) return null;
    if (!res.ok) return null;
    return (await res.json()) as PublishedProfile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Publish / update profile
// ---------------------------------------------------------------------------

export interface ProfileResult {
  ok: boolean;
  error?: string;
}

/**
 * Publishes or updates the researcher profile for the current user. Requires:
 *   - An active OAuth session (the route reads the server-side session).
 *   - The Ed25519 private key in IndexedDB on this device.
 *
 * Returns { ok: true } on success, { ok: false, error } on failure.
 */
export async function publishProfile(
  data: ProfileData,
): Promise<ProfileResult> {
  const identity = await loadIdentity();
  if (!identity) {
    return {
      ok: false,
      error:
        "Your signing key is not on this device. Restore it first.",
    };
  }

  const issuedAt = new Date().toISOString();
  const payload = buildProfilePayloadBytes("profile", { ...data, issuedAt });
  const sigBytes = ed25519.sign(payload, identity.keys.signing.privateKey);
  const signature = bytesToHex(sigBytes);

  try {
    const res = await fetch("/api/directory/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: data.displayName,
        affiliation: data.affiliation ?? null,
        orcid: data.orcid ?? null,
        signature,
        issuedAt,
      }),
    });
    if (res.status === 401) {
      return {
        ok: false,
        error: "Sign in first to publish your profile.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: "Could not publish your profile. Try again." };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Network error while publishing. Check your connection.",
    };
  }
}

// ---------------------------------------------------------------------------
// Remove profile
// ---------------------------------------------------------------------------

/**
 * Removes the published profile while leaving the identity binding intact.
 * Requires the same two-lock gate as publishProfile.
 */
export async function unpublishProfile(): Promise<ProfileResult> {
  const identity = await loadIdentity();
  if (!identity) {
    return {
      ok: false,
      error:
        "Your signing key is not on this device. Restore it first.",
    };
  }

  const issuedAt = new Date().toISOString();
  const payload = buildProfilePayloadBytes("delete-profile", { issuedAt });
  const sigBytes = ed25519.sign(payload, identity.keys.signing.privateKey);
  const signature = bytesToHex(sigBytes);

  try {
    const res = await fetch("/api/directory/profile", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, issuedAt }),
    });
    if (res.status === 401) {
      return { ok: false, error: "Sign in first to remove your profile." };
    }
    if (!res.ok) {
      return { ok: false, error: "Could not remove your profile. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error. Check your connection." };
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Searches the researcher directory by name or affiliation. Requires an
 * active OAuth session. Returns at most 20 results.
 *
 * The results include the public keys needed to seal a share, but never an
 * email address — so search is a discovery tool, not an address harvester.
 */
export async function searchResearchers(
  query: string,
): Promise<ProfileSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `/api/directory/search?q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results: ProfileSearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

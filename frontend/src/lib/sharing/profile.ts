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
  pinnedWorks: string[];
  hiddenWorks: string[];
  /**
   * Whether the user wants an email nudge when someone invites them to
   * collaborate (external-collab). Defaults to true; the user can opt out in
   * Settings -> Sharing. This is published into the signed directory profile so
   * the server can read it at invite-send time (the sender triggers the email,
   * but the recipient's preference decides whether it goes out).
   */
  notifyOnCollabInvite: boolean;
  /**
   * Badge snapshot ids (badges phase 2). Published so the server-rendered public
   * profile can show earned and pinned badges without reading the local folder
   * (which is inaccessible server-side). Absent lists default to [] and publish
   * an empty snapshot, rendering nothing on the public page (back-compat safe).
   */
  earnedBadgeIds: string[];
  pinnedBadgeIds: string[];
}

export interface PublishedProfile
  extends Omit<ProfileData, "notifyOnCollabInvite" | "earnedBadgeIds" | "pinnedBadgeIds"> {
  /**
   * The recipient's notify preference as published. Optional on the wire because
   * a profile stored before this field existed has no value; readers coerce a
   * missing value to the default (true) via withNotifyDefault.
   */
  notifyOnCollabInvite?: boolean;
  fingerprint: string;
  /** The verified institutional domain (e.g. "wisc.edu"), or null when the
   * OAuth login was on a consumer email (gmail, outlook, etc.). */
  affiliationDomain: string | null;
  updatedAt?: string;
  /**
   * Badge ids are optional on the published profile wire type because an old
   * row or an old API response may omit them. The public render defaults to []
   * for missing values (empty snapshot = no badges shown). Back-compat safe.
   */
  earnedBadgeIds?: string[];
  pinnedBadgeIds?: string[];
}

export interface ProfileSearchResult extends PublishedProfile {
  x25519PublicKey: string;
  ed25519PublicKey: string;
}

// Re-export the OrcidWork type for the client. The runtime module
// (lib/orcid/works) is server-only (uses process.env + the ORCID API), but a
// `type`-only import is erased at compile time, so no server code ships to the
// browser.
import type { OrcidWork } from "@/lib/orcid/works";
export type { OrcidWork };

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
    pinnedWorks?: string[];
    hiddenWorks?: string[];
    notifyOnCollabInvite?: boolean;
    earnedBadgeIds?: string[];
    pinnedBadgeIds?: string[];
    issuedAt: string;
  },
): Uint8Array {
  // Null / undefined → literal "null" to match the server's encoding.
  const enc = (v: string | null | undefined) => v ?? "null";
  // The notify preference defaults to true (mirrors the server) and only
  // appears for the profile (upsert) action, so a delete payload's bytes are
  // unchanged from before this field existed.
  const notify = data.notifyOnCollabInvite ?? true;
  const lines = [
    PROFILE_VERSION,
    `action=${action}`,
    `displayName=${enc(data.displayName)}`,
    `affiliation=${enc(data.affiliation)}`,
    `orcid=${enc(data.orcid)}`,
    `pinned=${(data.pinnedWorks ?? []).join(",")}`,
    `hidden=${(data.hiddenWorks ?? []).join(",")}`,
  ];
  if (action === "profile") {
    lines.push(`notifyOnCollabInvite=${notify ? "true" : "false"}`);
    // Badge lines (badges phase 2). Absent = empty list = "". An older client
    // that omits these fields sends "" for both, which the server reconstructs
    // identically (it also defaults to []), so old signatures keep validating.
    // The position (after notifyOnCollabInvite, before issuedAt) is fixed and
    // MUST stay byte-identical with buildProfilePayload in signature.ts.
    lines.push(`earnedBadges=${(data.earnedBadgeIds ?? []).join(",")}`);
    lines.push(`pinnedBadges=${(data.pinnedBadgeIds ?? []).join(",")}`);
  }
  lines.push(`issuedAt=${data.issuedAt}`);
  return new TextEncoder().encode(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Fingerprint URL helpers
//
// The canonical fingerprint is a space-grouped hex string ("abcd ef12 3456
// 7890"). For clean, shareable profile URLs we use a compact, space-free form
// in the path (/researchers/abcdef1234567890). The server expands it back to
// the canonical form for the exact-match lookup, so the two are perfect
// inverses (the grouping is fixed at 4-char blocks).
// ---------------------------------------------------------------------------

/** Strips the spaces from a grouped fingerprint for use in a URL. */
export function compactFingerprint(fp: string): string {
  return fp.replace(/\s+/g, "").toLowerCase();
}

/** Re-inserts the 4-char grouping into a compact fingerprint. */
export function expandFingerprint(compact: string): string {
  const clean = compact.replace(/\s+/g, "").toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    groups.push(clean.slice(i, i + 4));
  }
  return groups.join(" ");
}

// ---------------------------------------------------------------------------
// Fetch a profile by fingerprint (public, exact-match, non-enumerable)
// ---------------------------------------------------------------------------

/**
 * Fetches a single published profile by its compact (space-free) fingerprint.
 * Public: no OAuth session required, so a profile URL is shareable. Returns
 * null if no profile is published for that fingerprint or on any error. Never
 * exposes an email.
 */
export async function fetchProfileByFingerprint(
  compactFp: string,
): Promise<PublishedProfile | null> {
  try {
    const res = await fetch(
      `/api/directory/researcher?fp=${encodeURIComponent(compactFp)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { profile: PublishedProfile | null };
    return data.profile ? withNotifyDefault(data.profile) : null;
  } catch {
    return null;
  }
}

/**
 * Backward-safe read of the notify preference. A profile published before the
 * field existed has no notifyOnCollabInvite, which must read as the default
 * (true). Returns a copy with the field always populated so the rest of the UI
 * can treat it as a plain boolean.
 */
function withNotifyDefault(p: PublishedProfile): PublishedProfile {
  return {
    ...p,
    notifyOnCollabInvite: p.notifyOnCollabInvite ?? true,
  };
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
    return withNotifyDefault((await res.json()) as PublishedProfile);
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
        pinnedWorks: data.pinnedWorks,
        hiddenWorks: data.hiddenWorks,
        notifyOnCollabInvite: data.notifyOnCollabInvite,
        earnedBadgeIds: data.earnedBadgeIds,
        pinnedBadgeIds: data.pinnedBadgeIds,
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
// ORCID publications (public works, via the /api/orcid/works proxy)
// ---------------------------------------------------------------------------

/**
 * Fetches a researcher's public ORCID works through our server proxy (ORCID's
 * API is not CORS-open, so the browser cannot call it directly). Returns an
 * empty list on any error, publications are a nice-to-have, never load-bearing.
 */
export async function fetchOrcidPublications(
  orcid: string,
): Promise<OrcidWork[]> {
  try {
    const res = await fetch(
      `/api/orcid/works?orcid=${encodeURIComponent(orcid)}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { works?: OrcidWork[] };
    return data.works ?? [];
  } catch {
    return [];
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

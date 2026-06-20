// Cross-boundary sharing, researcher profile route (section 17).
//
// GET  /api/directory/profile  — returns the current session user's own profile,
//                                or 404 if they have not published one.
// POST /api/directory/profile  — creates or updates the profile.
//   Body: { displayName, affiliation?, orcid?, signature, issuedAt }
//   Gate: OAuth session (proven email OR ORCID iD) + Ed25519 signature over the
//         profile payload.
// DELETE /api/directory/profile — removes the profile (binding stays intact).
//   Body: { signature, issuedAt }
//   Gate: same two-lock pattern as POST.
//
// The route reads the Auth.js session email or orcidId (never from the body),
// derives the email_hash (either directly from the email or via the ORCID link
// table), looks up the binding to get the fingerprint and stored Ed25519 key,
// then verifies the client's Ed25519 signature before any write. The
// affiliation_domain badge is derived server-side from the session email domain;
// for ORCID-only sessions there is no email so affiliationDomain stays null.
// Email never appears in any response.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, plus the AUTH_* vars used by the session.

import { hexToBytes } from "@noble/hashes/utils.js";

import { auth } from "@/lib/sharing/auth";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  buildProfilePayload,
  verifyBindingSignature,
} from "@/lib/sharing/directory/signature";
import {
  deleteProfile,
  ensureOrcidSchema,
  ensureProfileSchema,
  ensureSchema,
  getBindingByHash,
  getEmailHashByOrcid,
  getProfileByFingerprint,
  upsertProfile,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseProfileBody } from "@/lib/sharing/directory/validation";
import { extractVerifiedDomain } from "@/lib/sharing/directory/affiliationDomain";
import type { Session } from "next-auth";

export const runtime = "nodejs";

// One generic failure for any rejected write, the caller cannot distinguish
// a malformed body from a bad signature from a missing binding.
const GENERIC_FAILURE = { error: "profile update failed" } as const;

// ---------------------------------------------------------------------------
// resolveEmailHash — shared by GET, POST, and DELETE.
//
// An email session resolves directly (hash the email). An ORCID-only session
// looks up the ORCID link table. Returns null when the session has neither.
// ---------------------------------------------------------------------------

export async function resolveEmailHash(
  session: Session | null,
): Promise<string | null> {
  const sessionEmail = session?.user?.email;
  if (sessionEmail) {
    return hashEmail(canonicalizeEmail(sessionEmail), getPepper());
  }
  const orcidId = session?.orcidId;
  if (orcidId) {
    await ensureOrcidSchema();
    return getEmailHashByOrcid(orcidId);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET — return the session user's own profile
// ---------------------------------------------------------------------------

export async function GET(_request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const session = await auth();
  if (!session?.user?.email && !session?.orcidId) {
    return json(401, { error: "unauthorized" });
  }

  const emailHash = await resolveEmailHash(session);
  if (!emailHash) {
    return json(401, { error: "unauthorized" });
  }

  await ensureSchema();
  const binding = await getBindingByHash(emailHash);
  if (!binding) {
    return json(404, { error: "not found" });
  }

  await ensureProfileSchema();
  const profile = await getProfileByFingerprint(binding.fingerprint);
  if (!profile) {
    return json(404, { error: "not found" });
  }

  return json(200, profile);
}

// ---------------------------------------------------------------------------
// POST — create or update profile
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const session = await auth();
  if (!session?.user?.email && !session?.orcidId) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseProfileBody(body);
  if (!parsed) {
    return json(400, GENERIC_FAILURE);
  }

  const emailHash = await resolveEmailHash(session);
  if (!emailHash) {
    return json(401, { error: "unauthorized" });
  }

  await ensureSchema();
  const binding = await getBindingByHash(emailHash);
  if (!binding) {
    // No binding means no claimed identity; a profile requires one.
    return json(400, GENERIC_FAILURE);
  }

  // Reconstruct the signed payload the client signed and verify the signature
  // against the Ed25519 public key stored in the binding.
  const payload = buildProfilePayload({
    action: "profile",
    displayName: parsed.displayName,
    affiliation: parsed.affiliation,
    orcid: parsed.orcid,
    pinnedWorks: parsed.pinnedWorks,
    hiddenWorks: parsed.hiddenWorks,
    notifyOnCollabInvite: parsed.notifyOnCollabInvite,
    earnedBadgeIds: parsed.earnedBadgeIds,
    pinnedBadgeIds: parsed.pinnedBadgeIds,
    issuedAt: parsed.issuedAt,
  });

  let sigOk = false;
  try {
    sigOk = verifyBindingSignature(
      payload,
      hexToBytes(parsed.signature),
      hexToBytes(binding.ed25519PublicKey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return json(400, GENERIC_FAILURE);
  }

  // Derive the verified domain from the session email server-side. For ORCID-
  // only sessions there is no session email so affiliationDomain stays null;
  // the user can still type an affiliation but it will be unverified.
  const sessionEmail = session?.user?.email ?? null;
  const affiliationDomain = sessionEmail
    ? extractVerifiedDomain(sessionEmail)
    : null;

  await ensureProfileSchema();
  await upsertProfile({
    fingerprint: binding.fingerprint,
    displayName: parsed.displayName,
    affiliation: parsed.affiliation,
    affiliationDomain,
    orcid: parsed.orcid,
    pinnedWorks: parsed.pinnedWorks,
    hiddenWorks: parsed.hiddenWorks,
    notifyOnCollabInvite: parsed.notifyOnCollabInvite,
    earnedBadgeIds: parsed.earnedBadgeIds,
    pinnedBadgeIds: parsed.pinnedBadgeIds,
  });

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// DELETE — remove profile
// ---------------------------------------------------------------------------

export async function DELETE(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const session = await auth();
  if (!session?.user?.email && !session?.orcidId) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  if (typeof body !== "object" || body === null) {
    return json(400, GENERIC_FAILURE);
  }
  const b = body as Record<string, unknown>;

  const { signature, issuedAt } = b;
  if (
    typeof signature !== "string" ||
    !/^[0-9a-f]{128}$/.test(signature) ||
    typeof issuedAt !== "string"
  ) {
    return json(400, GENERIC_FAILURE);
  }

  const emailHash = await resolveEmailHash(session);
  if (!emailHash) {
    return json(401, { error: "unauthorized" });
  }

  await ensureSchema();
  const binding = await getBindingByHash(emailHash);
  if (!binding) {
    return json(400, GENERIC_FAILURE);
  }

  // Verify the delete signature against the stored Ed25519 key.
  const payload = buildProfilePayload({
    action: "delete-profile",
    issuedAt,
  });

  let sigOk = false;
  try {
    sigOk = verifyBindingSignature(
      payload,
      hexToBytes(signature),
      hexToBytes(binding.ed25519PublicKey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return json(400, GENERIC_FAILURE);
  }

  await ensureProfileSchema();
  await deleteProfile(binding.fingerprint);

  return json(200, { ok: true });
}

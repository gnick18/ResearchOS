// Cross-boundary sharing, directory request-body validation (Phase 1b-ii).
//
// Pure parsing and shape checks for the three route bodies, plus the response
// shaping for a lookup hit. Kept here, separate from the route handlers, so the
// validation logic is unit-testable without a live DB, Redis, or mailer. The
// routes call these and translate a null/failure into a generic error.

/** A loose email shape check, enough to reject obvious garbage before hashing. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A 6-digit numeric OTP, the shape generateOtp produces. */
const OTP_RE = /^\d{6}$/;

/** Lowercase hex, the encoding every public key and signature uses on the wire. */
const HEX_RE = /^[0-9a-f]+$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Max length for a profile display name collected at signup (mirrors parseProfileBody). */
const DISPLAY_NAME_MAX = 100;

/**
 * Parses the OPTIONAL display name a bind body may carry so a researcher profile
 * is created at signup (account = profile). Absent or blank is null (the bind
 * still proceeds, a profile just is not auto-created). A present value is trimmed
 * and length-capped, never rejected, since it is optional non-security metadata,
 * not covered by the binding signature.
 */
function parseOptionalDisplayName(v: unknown): string | null {
  if (!isNonEmptyString(v)) return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, DISPLAY_NAME_MAX);
}

/**
 * Validates a `{ email }` body (signup and lookup share this). Returns the
 * trimmed email on success or null if the field is missing or not a plausible
 * email. Canonicalization (lowercasing) is the caller's job via canonicalizeEmail.
 */
export function parseEmailBody(body: unknown): { email: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const email = (body as Record<string, unknown>).email;
  if (!isNonEmptyString(email)) return null;
  const trimmed = email.trim();
  if (!EMAIL_RE.test(trimmed)) return null;
  return { email: trimmed };
}

/** The fields a verify request must carry. */
export interface VerifyBody {
  email: string;
  otp: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  keyBackupBlob: string | null;
  signature: string;
  issuedAt: string;
  /** Optional display name, so the bind also creates the researcher profile. */
  displayName: string | null;
}

/**
 * Validates a verify body. Requires a plausible email, a 6-digit OTP, two
 * hex-encoded public keys, a hex signature, and an ISO-8601 issuedAt timestamp
 * (the server needs issuedAt to reconstruct the exact bytes the client signed,
 * see buildBindingPayload). keyBackupBlob is optional (an opaque client blob),
 * coerced to null when absent. Returns null on any shape failure so the route
 * returns a single generic error.
 */
export function parseVerifyBody(body: unknown): VerifyBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.email)) return null;
  const email = b.email.trim();
  if (!EMAIL_RE.test(email)) return null;

  if (!isNonEmptyString(b.otp) || !OTP_RE.test(b.otp)) return null;

  if (!isNonEmptyString(b.x25519PublicKey) || !HEX_RE.test(b.x25519PublicKey)) {
    return null;
  }
  if (!isNonEmptyString(b.ed25519PublicKey) || !HEX_RE.test(b.ed25519PublicKey)) {
    return null;
  }
  if (!isNonEmptyString(b.signature) || !HEX_RE.test(b.signature)) return null;

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt)) return null;

  let keyBackupBlob: string | null = null;
  if (b.keyBackupBlob !== undefined && b.keyBackupBlob !== null) {
    if (!isNonEmptyString(b.keyBackupBlob)) return null;
    keyBackupBlob = b.keyBackupBlob;
  }

  return {
    email,
    otp: b.otp,
    x25519PublicKey: b.x25519PublicKey,
    ed25519PublicKey: b.ed25519PublicKey,
    keyBackupBlob,
    signature: b.signature,
    issuedAt: b.issuedAt,
    displayName: parseOptionalDisplayName(b.displayName),
  };
}

/** The fields a key-rotation request carries. */
export interface RotateBody {
  email: string;
  newX25519PublicKey: string;
  newEd25519PublicKey: string;
  signature: string;
  issuedAt: string;
  keyBackupBlob: string | null;
}

/**
 * Validates a rotate body. A rotation publishes a NEW key pair for an already
 * registered email, authorized by a signature from the CURRENT (old) Ed25519
 * key (the route verifies that signature against the stored key). Requires a
 * plausible email, the two new hex public keys, a hex signature, and a
 * round-tripping ISO-8601 issuedAt (the bytes the client signed, reconstructed
 * by buildBindingPayload over the NEW keys). keyBackupBlob is an optional opaque
 * client blob, coerced to null when absent. There is no OTP, the current key
 * holder's signature is the proof. Returns null on any shape failure so the
 * route returns a single generic error.
 */
export function parseRotateBody(body: unknown): RotateBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.email)) return null;
  const email = b.email.trim();
  if (!EMAIL_RE.test(email)) return null;

  if (
    !isNonEmptyString(b.newX25519PublicKey) ||
    !HEX_RE.test(b.newX25519PublicKey)
  ) {
    return null;
  }
  if (
    !isNonEmptyString(b.newEd25519PublicKey) ||
    !HEX_RE.test(b.newEd25519PublicKey)
  ) {
    return null;
  }
  if (!isNonEmptyString(b.signature) || !HEX_RE.test(b.signature)) return null;

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt)) return null;

  let keyBackupBlob: string | null = null;
  if (b.keyBackupBlob !== undefined && b.keyBackupBlob !== null) {
    if (!isNonEmptyString(b.keyBackupBlob)) return null;
    keyBackupBlob = b.keyBackupBlob;
  }

  return {
    email,
    newX25519PublicKey: b.newX25519PublicKey,
    newEd25519PublicKey: b.newEd25519PublicKey,
    signature: b.signature,
    issuedAt: b.issuedAt,
    keyBackupBlob,
  };
}

/** The fields an OAuth key-bind request carries. */
export interface OAuthBindBody {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  keyBackupBlob: string | null;
  signature: string;
  issuedAt: string;
  /** Optional display name, so the bind also creates the researcher profile. */
  displayName: string | null;
}

/**
 * Validates an OAuth-bind body. This is the OAuth equivalent of parseVerifyBody,
 * but it carries NO email and NO otp. The verified email comes from the Auth.js
 * session in the route handler, never from the request body, so a caller cannot
 * bind keys to an address they have not proven they own. Requires two hex public
 * keys, a hex signature, and a round-tripping ISO-8601 issuedAt (the bytes the
 * client signed, reconstructed by buildBindingPayload). keyBackupBlob is an
 * optional opaque client blob, coerced to null when absent. Returns null on any
 * shape failure so the route returns a single generic error.
 */
export function parseOAuthBindBody(body: unknown): OAuthBindBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.x25519PublicKey) || !HEX_RE.test(b.x25519PublicKey)) {
    return null;
  }
  if (!isNonEmptyString(b.ed25519PublicKey) || !HEX_RE.test(b.ed25519PublicKey)) {
    return null;
  }
  if (!isNonEmptyString(b.signature) || !HEX_RE.test(b.signature)) return null;

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt)) return null;

  let keyBackupBlob: string | null = null;
  if (b.keyBackupBlob !== undefined && b.keyBackupBlob !== null) {
    if (!isNonEmptyString(b.keyBackupBlob)) return null;
    keyBackupBlob = b.keyBackupBlob;
  }

  return {
    x25519PublicKey: b.x25519PublicKey,
    ed25519PublicKey: b.ed25519PublicKey,
    keyBackupBlob,
    signature: b.signature,
    issuedAt: b.issuedAt,
    displayName: parseOptionalDisplayName(b.displayName),
  };
}

/**
 * Accepts a value as an ISO-8601 timestamp only if it round-trips, the string
 * parses to a real date AND re-serializes to the same string. This rejects junk
 * like "not-a-date" (NaN) and loose forms Date would coerce, so the signed
 * issuedAt the client sends matches what buildBindingPayload re-encodes.
 */
function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

/** The public-facing shape of a successful lookup, the backup blob never leaks. */
export interface LookupResult {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
}

/**
 * Shapes a stored binding into the lookup response, dropping the email hash and
 * the backup blob so a lookup only ever returns what a sender needs to seal to
 * and verify against.
 */
export function shapeLookupResult(binding: {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
}): LookupResult {
  return {
    x25519PublicKey: binding.x25519PublicKey,
    ed25519PublicKey: binding.ed25519PublicKey,
    fingerprint: binding.fingerprint,
  };
}

// ---------------------------------------------------------------------------
// Profile body validation (section 17)
// ---------------------------------------------------------------------------

/** ORCID iD format: 4 groups of 4 digits, last char may be X. */
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/**
 * The body a client sends when creating or updating a researcher profile.
 * The signature covers the profile payload so only the key-holder can publish
 * their own row. The server derives affiliationDomain from the OAuth session
 * email, so it is not in this body.
 */
export interface ProfileBody {
  displayName: string;
  affiliation: string | null;
  orcid: string | null;
  pinnedWorks: string[];
  hiddenWorks: string[];
  /**
   * Whether the user wants an email nudge when invited to collaborate. A body
   * that omits the field defaults to true, which matches the default-true
   * encoding in buildProfilePayload, so an older client's signature still
   * verifies.
   */
  notifyOnCollabInvite: boolean;
  /**
   * Badge snapshot ids (badges phase 2). Optional arrays that default to []
   * when absent, so an older client that does not send these fields still
   * produces a body that parses and stores an empty snapshot. Badge ids are
   * arbitrary non-numeric strings (e.g. "first-experiment"), so the numeric
   * put-code validation used for works does not apply.
   */
  earnedBadgeIds: string[];
  pinnedBadgeIds: string[];
  signature: string;
  issuedAt: string;
}

/**
 * Validates a profile body. Returns null on any shape or constraint failure so
 * the route returns a single generic error. Rules:
 *   displayName: required, max 100 chars.
 *   affiliation: optional, max 200 chars if present.
 *   orcid: optional, must match ORCID format if present.
 *   signature: required, lowercase hex, exactly 128 chars (64-byte Ed25519 sig).
 *   issuedAt: required, round-tripping ISO-8601.
 */
export function parseProfileBody(body: unknown): ProfileBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.displayName)) return null;
  const displayName = (b.displayName as string).trim();
  if (displayName.length === 0 || displayName.length > 100) return null;

  let affiliation: string | null = null;
  if (b.affiliation !== undefined && b.affiliation !== null) {
    if (!isNonEmptyString(b.affiliation)) return null;
    const trimmed = (b.affiliation as string).trim();
    if (trimmed.length > 200) return null;
    affiliation = trimmed;
  }

  let orcid: string | null = null;
  if (b.orcid !== undefined && b.orcid !== null) {
    if (!isNonEmptyString(b.orcid)) return null;
    const trimmed = (b.orcid as string).trim();
    if (!ORCID_RE.test(trimmed)) return null;
    orcid = trimmed;
  }

  // pinnedWorks and hiddenWorks: optional, default to []. When present must be
  // an array of numeric-string put-codes, max 200 entries each.
  const PUT_CODE_RE = /^\d+$/;
  let pinnedWorks: string[] = [];
  if (Array.isArray(b.pinnedWorks)) {
    const arr = b.pinnedWorks as unknown[];
    if (arr.length <= 200 && arr.every((v) => typeof v === "string" && PUT_CODE_RE.test(v as string))) {
      pinnedWorks = arr as string[];
    }
  }

  let hiddenWorks: string[] = [];
  if (Array.isArray(b.hiddenWorks)) {
    const arr = b.hiddenWorks as unknown[];
    if (arr.length <= 200 && arr.every((v) => typeof v === "string" && PUT_CODE_RE.test(v as string))) {
      hiddenWorks = arr as string[];
    }
  }

  if (
    !isNonEmptyString(b.signature) ||
    !HEX_RE.test(b.signature as string) ||
    (b.signature as string).length !== 128
  ) {
    return null;
  }

  if (!isNonEmptyString(b.issuedAt) || !isIsoTimestamp(b.issuedAt as string)) {
    return null;
  }

  // notifyOnCollabInvite: optional boolean, default true. A non-boolean present
  // value is rejected (a malformed body), but an absent value is the default so
  // an older client that never sends it is accepted.
  let notifyOnCollabInvite = true;
  if (b.notifyOnCollabInvite !== undefined) {
    if (typeof b.notifyOnCollabInvite !== "boolean") return null;
    notifyOnCollabInvite = b.notifyOnCollabInvite;
  }

  // Badge id arrays (badges phase 2). Optional; absent or non-array defaults to
  // []. Badge ids are non-empty strings (no numeric constraint like put-codes).
  // Cap at 200 entries each so a malicious oversized array cannot bloat storage.
  const BADGE_ID_RE = /^[a-z0-9-]+$/;
  let earnedBadgeIds: string[] = [];
  if (Array.isArray(b.earnedBadgeIds)) {
    const arr = b.earnedBadgeIds as unknown[];
    if (arr.length <= 200 && arr.every((v) => typeof v === "string" && BADGE_ID_RE.test(v as string))) {
      earnedBadgeIds = arr as string[];
    }
  }

  let pinnedBadgeIds: string[] = [];
  if (Array.isArray(b.pinnedBadgeIds)) {
    const arr = b.pinnedBadgeIds as unknown[];
    if (arr.length <= 200 && arr.every((v) => typeof v === "string" && BADGE_ID_RE.test(v as string))) {
      pinnedBadgeIds = arr as string[];
    }
  }

  return {
    displayName,
    affiliation,
    orcid,
    pinnedWorks,
    hiddenWorks,
    notifyOnCollabInvite,
    earnedBadgeIds,
    pinnedBadgeIds,
    signature: b.signature as string,
    issuedAt: b.issuedAt as string,
  };
}

/**
 * Validates the ?q= search query parameter. Returns the trimmed string on
 * success, or null if the value is absent, too short (< 2 chars), or too long
 * (> 100 chars).
 */
export function parseSearchQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const trimmed = q.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return null;
  return trimmed;
}

/**
 * Validates the ?slug= param for the public institution page. The institution
 * slug IS the verified email domain (e.g. wisc.edu), since institutions are
 * derived from domain clusters. Returns the lowercased domain on success, or
 * null if absent, malformed, or out of range. Accepts only domain-shaped strings
 * (letters, digits, dots, hyphens) containing at least one dot, which also blocks
 * path traversal and injection in the slug.
 */
export function parseInstitutionSlug(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 100) return null;
  if (!/^[a-z0-9.-]+$/.test(trimmed)) return null;
  if (!trimmed.includes(".")) return null;
  // Reject leading/trailing dots or hyphens and empty labels (e.g. "a..b").
  if (/^[.-]|[.-]$|\.\./.test(trimmed)) return null;
  return trimmed;
}

/** The fields the ORCID email-capture verify route carries. */
export interface OrcidEmailVerifyBody {
  email: string;
  otp: string;
}

/**
 * Validates the ORCID email-capture verify body, `{ email, otp }`. The ORCID
 * capture step has NO key material and NO signature (unlike parseVerifyBody), the
 * ORCID session itself is the account-side proof and the OTP proves the user
 * controls the email. Requires a plausible email and a 6-digit numeric OTP.
 * Returns null on any shape failure so the route returns a single generic error.
 */
export function parseOrcidEmailVerifyBody(
  body: unknown,
): OrcidEmailVerifyBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.email)) return null;
  const email = b.email.trim();
  if (!EMAIL_RE.test(email)) return null;
  if (!isNonEmptyString(b.otp) || !OTP_RE.test(b.otp)) return null;
  return { email, otp: b.otp };
}

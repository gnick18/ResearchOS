// Pure, driver-free profile validation + types.
//
// These live apart from account-profile.ts (which imports the Neon driver) so a
// client component can reuse the same validators as a pre-submit gate without
// pulling @neondatabase/serverless into the browser bundle. account-profile.ts
// re-exports everything here, so server callers keep importing from one place.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** Typed external links surfaced on the researcher profile. Unset links are null. */
export interface ProfileLinks {
  orcid: string | null;
  researchgate: string | null;
  website: string | null;
}

/** The empty links object, returned whenever a row has no links set. */
export const EMPTY_LINKS: ProfileLinks = {
  orcid: null,
  researchgate: null,
  website: null,
};

/**
 * Phase 3 Chunk 3A avatar cap. A thumbnail-sized avatar fits comfortably under
 * this; we reject anything larger server-side so a row stays small and the
 * profile read stays cheap. Measured on the raw data-URL string length.
 */
export const AVATAR_MAX_BYTES = 96 * 1024;

/** The image MIME types we accept for an avatar data URL. */
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Validates an avatar value for storage. Accepts null (clear) or a data URL
 * whose MIME is an allowed image type and whose total string length is within
 * AVATAR_MAX_BYTES. Returns null when valid, else a human reason. Pure, so it is
 * unit-tested and reused as both a client pre-gate and the server cap.
 */
export function validateAvatar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "The avatar must be an image data URL.";
  const v = value.trim();
  if (v === "") return null;
  const match = /^data:([a-z/+.-]+);base64,/i.exec(v);
  if (!match) return "The avatar must be a base64 image data URL.";
  if (!AVATAR_MIME.has(match[1].toLowerCase())) {
    return "Use a PNG, JPEG, or WEBP image.";
  }
  if (v.length > AVATAR_MAX_BYTES) {
    return "That image is too large. Pick one under 64 KB.";
  }
  return null;
}

/** Bio length cap. A short tagline, not a CV; the CV lives in the data folder. */
export const BIO_MAX_CHARS = 280;

/**
 * Validates a bio for storage. Accepts null/undefined (clear/leave) or a string
 * within BIO_MAX_CHARS after trim. Returns null when valid, else a reason. Pure.
 */
export function validateBio(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "Your bio must be text.";
  if (value.trim().length > BIO_MAX_CHARS) {
    return `Keep your bio under ${BIO_MAX_CHARS} characters.`;
  }
  return null;
}

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i;

/**
 * Normalizes + validates the typed links. Trims each field, coerces "" to null,
 * and checks shape: ORCID as the bare 0000-0000-0000-0000 form (an orcid.org URL
 * is reduced to it), ResearchGate + website as http(s) URLs. Returns the cleaned
 * links on success or a human reason string on the first invalid field. Pure.
 */
export function normalizeLinks(
  value: unknown,
): { ok: true; links: ProfileLinks } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, links: { ...EMPTY_LINKS } };
  if (typeof value !== "object") return { ok: false, error: "Links must be an object." };
  const v = value as Record<string, unknown>;

  const clean = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "");

  // ORCID: accept the bare hyphenated id or an orcid.org URL, store the bare id.
  let orcid: string | null = null;
  const orcidRaw = clean(v.orcid);
  if (orcidRaw) {
    const bare = orcidRaw.replace(/^https?:\/\/(www\.)?orcid\.org\//i, "").replace(/\/$/, "");
    if (!ORCID_RE.test(bare)) {
      return { ok: false, error: "Enter an ORCID as 0000-0000-0000-0000." };
    }
    orcid = bare.toUpperCase();
  }

  const httpField = (
    raw: unknown,
    label: string,
  ): { ok: true; value: string | null } | { ok: false; error: string } => {
    const s = clean(raw);
    if (!s) return { ok: true, value: null };
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return { ok: false, error: `Enter a full ${label} URL starting with https://.` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: `Enter a full ${label} URL starting with https://.` };
    }
    return { ok: true, value: url.toString() };
  };

  const rg = httpField(v.researchgate, "ResearchGate");
  if (!rg.ok) return rg;
  const site = httpField(v.website, "website");
  if (!site.ok) return site;

  return { ok: true, links: { orcid, researchgate: rg.value, website: site.value } };
}

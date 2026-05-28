/**
 * ORCID iD helpers (metadata implementation bot, 2026-05-28).
 *
 * ORCID iDs are 16-digit identifiers grouped 4-4-4-4 with hyphens, e.g.
 * `0000-0002-1825-0097`. The final character is a check digit computed with
 * the ISO/IEC 7064:2003 MOD 11-2 algorithm and may be the letter `X`
 * (representing the value 10). The canonical storage form in ResearchOS is
 * the bare hyphenated string with NO `https://orcid.org/` URL prefix.
 *
 * These helpers are pure and dependency-free so they can run in any
 * environment (node test suite, jsdom component tests, the browser UI).
 * Validation is intentionally a SOFT signal — callers surface a non-blocking
 * warning, they never refuse a save.
 */

/**
 * Strips a pasted ORCID down to its 16 significant characters (15 digits +
 * the trailing check character, which may be `X`).
 *
 * Paste-tolerant: accepts a full `https://orcid.org/xxxx-xxxx-xxxx-xxxx`
 * URL (with or without scheme / `www.` / trailing slash), a no-hyphen run of
 * 16 characters, or the already-hyphenated form. Returns the 16-character
 * upper-cased core, or `null` when the input doesn't contain exactly 16
 * ORCID characters.
 *
 * This does NOT validate the checksum — it only extracts the core so
 * `normalizeOrcid` can re-group it and `isValidOrcid` can verify it.
 */
export function extractOrcidCore(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (s.length === 0) return null;
  // Drop a leading orcid.org URL prefix (scheme optional, www optional).
  // Everything up to and including "orcid.org/" is discarded; the path that
  // follows is the iD. We do this with a case-insensitive replace rather than
  // URL parsing so a bare "orcid.org/0000-..." (no scheme) is handled too.
  s = s.replace(/^.*orcid\.org\//i, "");
  // Keep only digits and the X check char (upper-cased), discarding hyphens,
  // spaces, and any stray punctuation a user might paste.
  const core = s.toUpperCase().replace(/[^0-9X]/g, "");
  if (core.length !== 16) return null;
  // `X` is only ever legal as the final (check) character.
  if (core.slice(0, 15).includes("X")) return null;
  return core;
}

/**
 * Normalizes a pasted ORCID (URL form, no-hyphen form, or hyphenated form)
 * to the canonical bare hyphenated 16-character string. Returns `null` when
 * the input can't be coerced to 16 ORCID characters.
 *
 * Does NOT enforce the checksum — an input with a wrong check digit still
 * normalizes (so the UI can store what the user typed and show a soft
 * warning beside it). Use `isValidOrcid` for the checksum gate.
 */
export function normalizeOrcid(input: string | null | undefined): string | null {
  const core = extractOrcidCore(input);
  if (core === null) return null;
  return `${core.slice(0, 4)}-${core.slice(4, 8)}-${core.slice(8, 12)}-${core.slice(12, 16)}`;
}

/**
 * Computes the ISO/IEC 7064:2003 MOD 11-2 check character for the first 15
 * digits of an ORCID core. Returns "0".."9" or "X".
 *
 * Algorithm (per the ORCID spec):
 *   total = 0
 *   for each of the 15 leading digits d:  total = (total + d) * 2
 *   remainder = total % 11
 *   result = (12 - remainder) % 11
 *   checkDigit = result === 10 ? "X" : String(result)
 */
export function orcidCheckDigit(first15Digits: string): string {
  let total = 0;
  for (let i = 0; i < first15Digits.length; i++) {
    const d = first15Digits.charCodeAt(i) - 48; // '0' === 48
    total = (total + d) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  return result === 10 ? "X" : String(result);
}

/**
 * True iff the input is a structurally valid ORCID iD whose MOD 11-2 check
 * digit matches. Accepts any of the paste forms `extractOrcidCore` handles.
 * Empty / null / non-ORCID-shaped input returns `false`.
 *
 * SOFT signal only: callers warn, they never block a save on a `false` here.
 */
export function isValidOrcid(input: string | null | undefined): boolean {
  const core = extractOrcidCore(input);
  if (core === null) return false;
  const expected = orcidCheckDigit(core.slice(0, 15));
  return expected === core.charAt(15);
}

/**
 * Builds the public ORCID record URL for a canonical (or paste-form) iD, or
 * `null` when the input can't be normalized. Used by the Settings UI for the
 * "view record" external link once the iD validates.
 */
export function orcidRecordUrl(input: string | null | undefined): string | null {
  const normalized = normalizeOrcid(input);
  if (normalized === null) return null;
  return `https://orcid.org/${normalized}`;
}

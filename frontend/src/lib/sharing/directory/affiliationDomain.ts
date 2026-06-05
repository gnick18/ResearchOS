// Cross-boundary sharing, verified affiliation domain extraction (section 17).
//
// An OAuth-verified email whose domain is NOT on the consumer-provider blocklist
// earns a verified institutional badge (e.g. wisc.edu, nih.gov, ox.ac.uk).
// Consumer accounts (gmail, outlook, etc.) get affiliationDomain = null.
//
// The list intentionally covers major free-tier providers across regions.
// If the domain is not on the list it is assumed to be institutional; there is
// no false-negative risk beyond a slightly overgenerous badge for niche
// consumer providers, which is acceptable.

/**
 * Consumer-domain blocklist: email domains that are personal or free-tier and
 * should NOT earn an institutional affiliation badge. Institutional domains
 * (.edu, .ac.uk, .gov, etc.) are absent from this list and receive the badge.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "live.com",
  "msn.com",
  "me.com",
  "mac.com",
  "aol.com",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.net",
]);

/**
 * Extracts the verified institutional domain from an OAuth session email.
 *
 * Returns the domain string (e.g. "wisc.edu") when the email belongs to an
 * institutional provider, or null when it belongs to a consumer provider or
 * the email is malformed. The return value is stored verbatim in
 * directory_profiles.affiliation_domain and drives the "verified at X" badge.
 */
export function extractVerifiedDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return CONSUMER_DOMAINS.has(domain) ? null : domain;
}

// Public institution-profile client (social layer, Phase B foundation / B1).
//
// Consumes Popup Unifier's not-yet-built public institution endpoint for the
// /institution/[slug] page. The directory schema + endpoint live in
// lib/sharing/directory/* + app/api/directory/* (POPUP-OWNED); this file only
// CALLS the endpoint and shapes the result. The member list (B2) is Popup's
// directory read; until it ships, a 404 is treated as "not live yet"
// (DirectoryUnavailable) and the page shows a calm "coming online" placeholder.
//
// Listed-only members, never an email, by contract (same as public-search).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { type PublicResearcher } from "@/lib/social/public-search";

export interface PublicInstitution {
  slug: string;
  /** Canonical display name from the endpoint (e.g. "UW-Madison"). */
  name: string;
  /** Verified email domain that clusters into this institution, if known. */
  domain: string | null;
  logoUrl: string | null;
  departments: string[];
  /** Total listed members, or null when the directory read is not live yet. */
  memberCount: number | null;
  /** Listed members (opt-out honored, never email). Empty until B2 ships. */
  members: PublicResearcher[];
}

/** Thrown when the public institution endpoint is not deployed yet (404). */
export class DirectoryUnavailable extends Error {
  constructor() {
    super("public institution directory is not available yet");
    this.name = "DirectoryUnavailable";
  }
}

/**
 * Best-effort display name from a slug, used ONLY as a fallback before the
 * endpoint resolves the canonical name. Turns "uw-madison" into "Uw Madison".
 * The real, correctly-cased name comes from the endpoint, so this never
 * overwrites a resolved name.
 */
export function humanizeInstitutionSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeMember(raw: unknown): PublicResearcher | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fingerprint = asString(r.fingerprint);
  const displayName = asString(r.displayName);
  if (!fingerprint || !displayName) return null;
  return {
    fingerprint,
    displayName,
    affiliation: asString(r.affiliation),
    verifiedDomain: asString(r.verifiedDomain),
    orcid: asString(r.orcid),
  };
}

/**
 * Fetches a public institution profile by slug. Returns null when no institution
 * matches. Throws DirectoryUnavailable if the endpoint is not deployed yet, or a
 * generic Error on any other failure.
 */
export async function fetchPublicInstitution(
  slug: string,
): Promise<PublicInstitution | null> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;

  const res = await fetch(
    `/api/directory/institution?slug=${encodeURIComponent(s)}`,
  );
  if (res.status === 404) throw new DirectoryUnavailable();
  if (!res.ok) throw new Error(`institution lookup failed (${res.status})`);

  const data = (await res.json().catch(() => ({}))) as {
    found?: boolean;
    institution?: Record<string, unknown>;
  };
  if (!data.found || !data.institution) return null;

  const inst = data.institution;
  const members = Array.isArray(inst.members)
    ? inst.members.map(normalizeMember).filter((m): m is PublicResearcher => m !== null)
    : [];
  const departments = Array.isArray(inst.departments)
    ? inst.departments.map(asString).filter((d): d is string => d !== null)
    : [];

  return {
    slug: s,
    name: asString(inst.name) ?? humanizeInstitutionSlug(s),
    domain: asString(inst.domain),
    logoUrl: asString(inst.logoUrl),
    departments,
    memberCount:
      typeof inst.memberCount === "number" ? inst.memberCount : members.length || null,
    members,
  };
}

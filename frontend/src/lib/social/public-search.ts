// Public researcher-network search client (social layer, Phase A / A2).
//
// Consumes Popup Unifier's public, harvest-safe, listed-only directory search
// endpoint for the login-free /network hub. The directory schema + the endpoint
// itself live in lib/sharing/directory/* and app/api/directory/* (POPUP-OWNED);
// this file only CALLS the endpoint and shapes the result for the hub UI. It
// never touches that tree.
//
// Until Popup ships GET /api/directory/public-search the route does not exist,
// so a 404 is treated as "not live yet" (DirectorySearchUnavailable) and the UI
// shows a calm "coming online" note instead of an error. The moment the endpoint
// lands the hub lights up with no further change here.
//
// Result fields are listed-only and contain NO email, by contract.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export interface PublicResearcher {
  /** Space-grouped key fingerprint, the stable id for the shareable profile. */
  fingerprint: string;
  displayName: string;
  affiliation: string | null;
  /** Verified-domain badge (e.g. "wisc.edu"), or null when unverified. */
  verifiedDomain: string | null;
  /** Bare ORCID id (0000-0000-0000-0000) when present, else null. */
  orcid: string | null;
}

/** Thrown when the public-search endpoint is not deployed yet (404). */
export class DirectorySearchUnavailable extends Error {
  constructor() {
    super("public researcher search is not available yet");
    this.name = "DirectorySearchUnavailable";
  }
}

/** Minimum query length, mirrors the in-app researcher search (anti-harvest). */
export const MIN_QUERY_LENGTH = 2;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeResult(raw: unknown): PublicResearcher | null {
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
 * Searches the public researcher directory by name or affiliation. Returns the
 * listed-only matches (never an email). Returns [] for a too-short query.
 * Throws DirectorySearchUnavailable if the endpoint is not deployed yet, or a
 * generic Error on any other failure.
 */
export async function searchResearchersPublic(
  query: string,
): Promise<PublicResearcher[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const res = await fetch(
    `/api/directory/public-search?q=${encodeURIComponent(q)}`,
  );
  if (res.status === 404) throw new DirectorySearchUnavailable();
  if (!res.ok) throw new Error(`directory search failed (${res.status})`);

  const data = (await res.json().catch(() => ({}))) as {
    results?: unknown;
  };
  const list = Array.isArray(data.results) ? data.results : [];
  return list.map(normalizeResult).filter((r): r is PublicResearcher => r !== null);
}

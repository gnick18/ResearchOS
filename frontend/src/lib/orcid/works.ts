// ORCID Public API, server-side works fetcher.
//
// Two-step flow (client_credentials, no user token):
//   1. Mint a /read-public token once (module singleton, long-lived).
//   2. GET {PUB_HOST}/v3.0/{orcid}/works with that bearer token.
//
// parseOrcidWorks is a pure function so it can be unit-tested independently of
// the network. fetchOrcidWorks wraps it and is the integration entry point.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrcidWork {
  putCode: string;
  title: string;
  journal: string | null;
  year: string | null;
  type: string | null;
  doi: string | null;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Env helpers (lazy, never at module load so tsc/build do not require secrets)
// ---------------------------------------------------------------------------

function resolveHosts(): { issuer: string; pubHost: string } {
  const issuer = process.env.AUTH_ORCID_ISSUER ?? "https://orcid.org";
  if (issuer.includes("sandbox")) {
    return {
      issuer: "https://sandbox.orcid.org",
      pubHost: "https://pub.sandbox.orcid.org",
    };
  }
  return {
    issuer: "https://orcid.org",
    pubHost: "https://pub.orcid.org",
  };
}

// ---------------------------------------------------------------------------
// Read-public token cache (module singleton)
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;

async function getReadPublicToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const clientId = process.env.AUTH_ORCID_ID;
  const clientSecret = process.env.AUTH_ORCID_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_ORCID_ID / AUTH_ORCID_SECRET are not set.");
  }

  const { issuer } = resolveHosts();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "/read-public",
    grant_type: "client_credentials",
  });

  const res = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`ORCID token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("ORCID token response missing access_token");
  }

  cachedToken = data.access_token;
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Pure parser — safe against missing/null fields in ORCID v3.0 works JSON
// ---------------------------------------------------------------------------

/** Safely extracts a string value from an unknown path, returning null if anything is missing or not a string. */
function safeStr(val: unknown): string | null {
  if (typeof val === "string" && val.trim() !== "") return val.trim();
  return null;
}

export function parseOrcidWorks(raw: unknown): OrcidWork[] {
  if (!raw || typeof raw !== "object") return [];

  const r = raw as Record<string, unknown>;
  const groups = Array.isArray(r["group"]) ? (r["group"] as unknown[]) : [];

  const works: OrcidWork[] = [];
  const seenPutCodes = new Set<string>();

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const g = group as Record<string, unknown>;

    const summaries = Array.isArray(g["work-summary"])
      ? (g["work-summary"] as unknown[])
      : [];

    // Use only the FIRST summary in each group (the preferred one).
    const summary = summaries[0];
    if (!summary || typeof summary !== "object") continue;
    const s = summary as Record<string, unknown>;

    // put-code (stable key)
    const putCodeRaw = s["put-code"];
    const putCode = String(putCodeRaw ?? "");
    if (!putCode || seenPutCodes.has(putCode)) continue;
    seenPutCodes.add(putCode);

    // title
    const titleObj = s["title"] as Record<string, unknown> | undefined;
    const titleInner = titleObj?.["title"] as Record<string, unknown> | undefined;
    const title = safeStr(titleInner?.["value"]);
    if (!title) continue; // skip works with no title

    // journal / venue
    const journalObj = s["journal-title"] as Record<string, unknown> | undefined;
    const journal = safeStr(journalObj?.["value"]);

    // type
    const type = safeStr(s["type"]);

    // year
    const pubDateObj = s["publication-date"] as Record<string, unknown> | undefined;
    const yearObj = pubDateObj?.["year"] as Record<string, unknown> | undefined;
    const year = safeStr(yearObj?.["value"]);

    // DOI and URL from external-ids
    let doi: string | null = null;
    let url: string | null = null;

    const extIdsObj = s["external-ids"] as Record<string, unknown> | undefined;
    const extIdList = Array.isArray(extIdsObj?.["external-id"])
      ? (extIdsObj!["external-id"] as unknown[])
      : [];

    for (const extId of extIdList) {
      if (!extId || typeof extId !== "object") continue;
      const e = extId as Record<string, unknown>;
      if (e["external-id-type"] !== "doi") continue;

      doi = safeStr(e["external-id-value"]);
      // prefer normalized value, fall back to url value
      const normObj = e["external-id-normalized"] as Record<string, unknown> | undefined;
      const urlObj = e["external-id-url"] as Record<string, unknown> | undefined;
      url =
        safeStr(normObj?.["value"])
          ? `https://doi.org/${safeStr(normObj!["value"])}`
          : safeStr(urlObj?.["value"]);
      break;
    }

    // Fall back to work-summary url if no DOI url was found
    if (!url) {
      const workUrlObj = s["url"] as Record<string, unknown> | undefined;
      url = safeStr(workUrlObj?.["value"]);
    }

    works.push({ putCode, title, journal, year, type, doi, url });
  }

  // Sort year descending (null years go to bottom)
  works.sort((a, b) => {
    if (a.year === null && b.year === null) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year.localeCompare(a.year);
  });

  return works;
}

// ---------------------------------------------------------------------------
// Network fetch (non-throwing — publications are a nice-to-have)
// ---------------------------------------------------------------------------

const MAX_WORKS = 25;

export async function fetchOrcidWorks(orcid: string): Promise<OrcidWork[]> {
  try {
    const token = await getReadPublicToken();
    const { pubHost } = resolveHosts();
    const res = await fetch(`${pubHost}/v3.0/${encodeURIComponent(orcid)}/works`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      // A 401 likely means the cached token was revoked; clear it so next
      // request will re-mint.
      if (res.status === 401) cachedToken = null;
      return [];
    }
    const raw: unknown = await res.json();
    const works = parseOrcidWorks(raw);
    return works.slice(0, MAX_WORKS);
  } catch {
    return [];
  }
}

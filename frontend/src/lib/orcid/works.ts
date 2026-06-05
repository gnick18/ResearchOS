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

/** Normalizes a title for duplicate detection, lowercase, alphanumeric-only. */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Whether a work looks like a preprint (so we drop it in favor of the published
 * version when both share a title). Signals, an explicit preprint type, a known
 * preprint-server DOI prefix (bioRxiv/medRxiv 10.1101, chemRxiv 10.26434, arXiv
 * 10.48550, Research Square 10.21203, Preprints.org 10.20944), or a preprint
 * host in the url.
 */
function isPreprintWork(w: OrcidWork): boolean {
  if (w.type && w.type.toLowerCase() === "preprint") return true;
  if (w.doi && /^10\.(1101|26434|48550|21203|20944|31234|31219)\b/.test(w.doi)) {
    return true;
  }
  if (
    w.url &&
    /(biorxiv|medrxiv|chemrxiv|arxiv|researchsquare|preprints?\.org)/i.test(w.url)
  ) {
    return true;
  }
  return false;
}

/** A correction/corrigendum/erratum notice (it points at another paper). */
const CORRECTION_RE = /^\s*(author\s+|publisher\s+)?(correction|corrigendum|erratum)\b/i;

function isCorrection(w: OrcidWork): boolean {
  return CORRECTION_RE.test(w.title);
}

/** The body of a correction title, the part after the "Correction:" prefix. */
function correctionBody(title: string): string {
  const colon = title.indexOf(":");
  const rest = colon >= 0 ? title.slice(colon + 1) : title.replace(CORRECTION_RE, "");
  return normalizeTitle(rest);
}

/**
 * Collapses obvious duplicates so a profile shows one entry per paper:
 *   1. Preprint/published pairs that share an effectively identical title, we
 *      keep the most canonical version (non-preprint over preprint, then one
 *      with a journal, then the most recent year).
 *   2. A "Correction:/Corrigendum:/Erratum:" record when the main paper it
 *      refers to is also present, the main paper's full title appears inside
 *      the correction title, so we drop the correction and show only the paper.
 * Only obvious matches collapse, an exact normalized title for pass 1, and the
 * whole main title contained in the correction for pass 2, so distinct papers
 * are never merged, and an orphan correction (no main paper present) is kept.
 */
function dedupeWorks(works: OrcidWork[]): OrcidWork[] {
  // Pass 1, exact-title collapse.
  const groups = new Map<string, OrcidWork[]>();
  for (const w of works) {
    const key = normalizeTitle(w.title);
    const existing = groups.get(key);
    if (existing) existing.push(w);
    else groups.set(key, [w]);
  }

  let kept: OrcidWork[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    group.sort((a, b) => {
      const ca = isCorrection(a) ? 1 : 0;
      const cb = isCorrection(b) ? 1 : 0;
      if (ca !== cb) return ca - cb; // corrections last
      const pa = isPreprintWork(a) ? 1 : 0;
      const pb = isPreprintWork(b) ? 1 : 0;
      if (pa !== pb) return pa - pb; // non-preprint first
      const ja = a.journal ? 0 : 1;
      const jb = b.journal ? 0 : 1;
      if (ja !== jb) return ja - jb; // has-journal first
      return (b.year ?? "0000").localeCompare(a.year ?? "0000"); // newest first
    });
    kept.push(group[0]);
  }

  // Pass 2, drop a correction whose main paper is also present.
  const mainTitles = kept
    .filter((w) => !isCorrection(w))
    .map((w) => normalizeTitle(w.title))
    .filter((t) => t.length >= 12);
  kept = kept.filter((w) => {
    if (!isCorrection(w)) return true;
    const body = correctionBody(w.title);
    return !mainTitles.some((t) => body.includes(t)); // drop if it corrects a shown paper
  });

  return kept;
}

/**
 * Orders works for display: pinned codes float to the top in pin order,
 * hidden codes are excluded entirely, and the remainder is sorted newest first.
 */
export function orderWorks(
  works: OrcidWork[],
  pinned: string[],
  hidden: string[],
): OrcidWork[] {
  const hiddenSet = new Set(hidden);
  const pinIndex = new Map(pinned.map((pc, i) => [pc, i] as const));
  return works
    .filter((w) => !hiddenSet.has(w.putCode))
    .slice()
    .sort((a, b) => {
      const pa = pinIndex.has(a.putCode) ? pinIndex.get(a.putCode)! : Infinity;
      const pb = pinIndex.has(b.putCode) ? pinIndex.get(b.putCode)! : Infinity;
      if (pa !== pb) return pa - pb; // pinned first, in pin order
      return (b.year ?? "0000").localeCompare(a.year ?? "0000"); // else newest first
    });
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

  // Collapse obvious preprint/published duplicates (same title), then sort
  // year descending (null years go to bottom).
  const deduped = dedupeWorks(works);
  deduped.sort((a, b) => {
    if (a.year === null && b.year === null) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year.localeCompare(a.year);
  });

  return deduped;
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

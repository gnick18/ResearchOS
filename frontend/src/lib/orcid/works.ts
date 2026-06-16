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

/** One author on a work, with an ORCID iD when ORCID has one for them. */
export interface OrcidContributor {
  name: string;
  orcid: string | null;
}

export interface OrcidWork {
  putCode: string;
  title: string;
  journal: string | null;
  year: string | null;
  type: string | null;
  doi: string | null;
  url: string | null;
  // Author list. Empty when ORCID has no contributors for the work (the common
  // case for the works-summary endpoint, which omits them). Never null, so the
  // panel can always map over it safely.
  contributors: OrcidContributor[];
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
 * Pulls the author list out of a work record's `contributors` block. Resilient,
 * a missing block, a non-array, or entries without a credit-name all collapse
 * to an empty list rather than throwing. The works-SUMMARY endpoint has no
 * contributors block, so this returns [] there; only the full work detail (the
 * bulk endpoint) carries authors.
 */
function parseContributors(s: Record<string, unknown>): OrcidContributor[] {
  const block = s["contributors"] as Record<string, unknown> | undefined;
  const list = Array.isArray(block?.["contributor"])
    ? (block!["contributor"] as unknown[])
    : [];

  const out: OrcidContributor[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;

    const nameObj = cc["credit-name"] as Record<string, unknown> | undefined;
    const name = safeStr(nameObj?.["value"]);
    if (!name) continue; // an unnamed contributor is not displayable, skip it

    // contributor-orcid -> path is the bare 0000-... iD when present.
    const oObj = cc["contributor-orcid"] as Record<string, unknown> | undefined;
    const orcid = safeStr(oObj?.["path"]) ?? safeStr(oObj?.["uri"]);

    out.push({ name, orcid: normalizeOrcidId(orcid) });
  }
  return out;
}

/** Reduces an ORCID path or URI to the bare 0000-0000-0000-0000 iD, or null. */
function normalizeOrcidId(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/);
  return m ? m[0] : null;
}

/** Normalizes a person name for the conservative no-iD fallback match. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One author in the display list, flagged when it is the profile owner. */
export interface MarkedContributor extends OrcidContributor {
  isOwner: boolean;
}

/**
 * Marks which entry in a work's author list is the profile owner.
 *
 * Primary match, the owner's ORCID iD equals a contributor's iD. This is exact
 * and unambiguous, so it always wins.
 *
 * Fallback, only when NO contributor on the work carries any iD at all (so an
 * iD match is impossible) do we fall back to a normalized-name comparison
 * against the supplied owner name. This is deliberately conservative, if any
 * contributor has an iD we trust the iDs alone and never guess by name, which
 * avoids bolding a same-named-but-different person.
 */
export function markOwnerInContributors(
  contributors: OrcidContributor[],
  ownerOrcid: string,
  ownerName?: string | null,
): MarkedContributor[] {
  const owner = normalizeOrcidId(ownerOrcid);
  const anyHasId = contributors.some((c) => c.orcid !== null);

  // iD match path (used whenever any contributor carries an iD).
  if (anyHasId || !ownerName) {
    let matched = false;
    return contributors.map((c) => {
      const isOwner = !matched && owner !== null && c.orcid === owner;
      if (isOwner) matched = true;
      return { ...c, isOwner };
    });
  }

  // No-iD fallback, conservative normalized-name match (first match only).
  const wantName = normalizeName(ownerName);
  let matched = false;
  return contributors.map((c) => {
    const isOwner = !matched && wantName !== "" && normalizeName(c.name) === wantName;
    if (isOwner) matched = true;
    return { ...c, isOwner };
  });
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

    // The works-summary endpoint omits contributors, so this is normally [].
    // When this same parser is fed a full work record (the bulk detail
    // endpoint), parseContributors picks the authors up.
    const contributors = parseContributors(s);

    works.push({ putCode, title, journal, year, type, doi, url, contributors });
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
    const works = parseOrcidWorks(raw).slice(0, MAX_WORKS);

    // The works-SUMMARY response above omits contributors (authors). Rather
    // than firing one detail request per work, we make ONE bulk-detail call,
    // /works/{putCode1,putCode2,...} (ORCID allows up to 100 put-codes), which
    // returns full work records including contributors. So the whole panel
    // costs at most 2 ORCID calls regardless of work count. If the bulk call
    // fails we keep the summaries as-is (contributors stay []), so authors are
    // simply not shown rather than the panel breaking.
    return await enrichWithContributors(orcid, works, token, pubHost);
  } catch {
    return [];
  }
}

/**
 * Fills in each work's `contributors` via a single bulk-detail ORCID call.
 * Non-throwing, on any failure it returns the works unchanged.
 */
async function enrichWithContributors(
  orcid: string,
  works: OrcidWork[],
  token: string,
  pubHost: string,
): Promise<OrcidWork[]> {
  if (works.length === 0) return works;
  try {
    // ORCID caps a bulk read at 100 put-codes; MAX_WORKS keeps us well under.
    const putCodes = works.map((w) => w.putCode).join(",");
    const res = await fetch(
      `${pubHost}/v3.0/${encodeURIComponent(orcid)}/works/${putCodes}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      if (res.status === 401) cachedToken = null;
      return works;
    }
    const raw: unknown = await res.json();
    const byCode = parseBulkContributors(raw);
    if (byCode.size === 0) return works;
    return works.map((w) =>
      byCode.has(w.putCode)
        ? { ...w, contributors: byCode.get(w.putCode)! }
        : w,
    );
  } catch {
    return works;
  }
}

/**
 * Parses a /works/{putCodes} bulk response into a put-code -> contributors map.
 * Shape, { bulk: [ { work: <full work record> }, ... ] }. Resilient to missing
 * pieces, anything unparseable is simply skipped.
 */
function parseBulkContributors(raw: unknown): Map<string, OrcidContributor[]> {
  const out = new Map<string, OrcidContributor[]>();
  if (!raw || typeof raw !== "object") return out;

  const bulk = (raw as Record<string, unknown>)["bulk"];
  if (!Array.isArray(bulk)) return out;

  for (const entry of bulk) {
    if (!entry || typeof entry !== "object") continue;
    const work = (entry as Record<string, unknown>)["work"];
    if (!work || typeof work !== "object") continue;
    const w = work as Record<string, unknown>;

    const putCode = String(w["put-code"] ?? "");
    if (!putCode) continue;

    out.set(putCode, parseContributors(w));
  }
  return out;
}

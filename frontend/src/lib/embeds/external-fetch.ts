// Markdown embed hybrid, Phase 7 (P7-4). External embed network fetchers.
//
// All fetches are browser-CORS-safe:
//   Europe PMC (ebi.ac.uk/europepmc) - CORS-open, resolves both DOI and PMID.
//   PubChem PUG-REST (pubchem.ncbi.nlm.nih.gov/rest/pug) - CORS-open, verified live.
//   Link-preview via favicon + Open Graph meta - fetched via a bare URL; browsers
//     enforce CORS on fetch() so most pages will block the full HTML fetch. We degrade
//     gracefully to just the domain + favicon (favicon at /favicon.ico is usually
//     accessible without CORS). See the CORS note in fetchLinkPreview below.
//
// None of these require a server proxy. The doi.org content-negotiation endpoint
// redirects to the publisher and would require a proxy (publishers block CORS), so we
// route ALL citation lookups through Europe PMC which has a proper API.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { europePmcPapers, mapEpmcResult } from "@/lib/chemistry/literature";
import type { Paper } from "@/lib/chemistry/literature";
import { fetchCompoundByCid } from "@/lib/chemistry/pubchem";
import type { CiteCache, StructureCache, LinkCache } from "./external-cache";

// ── Citation fetch (Europe PMC) ────────────────────────────────────────────────

/**
 * Fetch citation metadata for a DOI or PMID via Europe PMC. Returns a CiteCache
 * entry on success, null on any failure (CORS block, no result, network error).
 *
 * Europe PMC resolves both DOI and PMID queries in a single endpoint via the
 * `query` parameter: `doi:10.1021/...` or `ext_id:12345678 src:med`. This is the
 * same path the chemistry literature companion already uses (europePmcPapers),
 * so we reuse its infrastructure for consistency.
 */
export async function fetchCiteMetadata(
  doiOrPmid: string,
  isPmid: boolean,
): Promise<CiteCache | null> {
  try {
    const query = isPmid ? `ext_id:${doiOrPmid} src:med` : `doi:${doiOrPmid}`;
    const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
    const res = await fetch(
      `${EPMC}?query=${encodeURIComponent(query)}&format=json&pageSize=1&resultType=core`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      resultList?: { result?: unknown[] };
    };
    const results = data.resultList?.result ?? [];
    if (results.length === 0) return null;
    const paper: Paper = mapEpmcResult(results[0] as Parameters<typeof mapEpmcResult>[0]);
    if (!paper.title) return null;
    return {
      kind: "cite",
      title: paper.title,
      authors: paper.authors,
      journal: paper.journal,
      year: paper.year,
      doi: paper.doi,
      url: paper.url,
      cachedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Structure fetch (PubChem) ──────────────────────────────────────────────────

/**
 * Fetch compound metadata for a PubChem CID. Returns a StructureCache entry on
 * success, null on failure. Uses the existing fetchCompoundByCid path so the
 * property list and coercion are shared with the chemistry workbench importer.
 */
export async function fetchStructureMetadataByCid(
  cid: number,
): Promise<StructureCache | null> {
  try {
    const compound = await fetchCompoundByCid(cid);
    if (!compound) return null;
    return {
      kind: "structure",
      name: compound.name,
      formula: compound.formula,
      mol_weight: compound.mol_weight,
      cid: compound.cid,
      smiles: "",  // SMILES not available from property lookup; filled by RDKit at render time
      inchikey: compound.inchikey,
      pngUrl: compound.pngUrl,
      cachedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Build a minimal StructureCache entry from a raw SMILES string. No network
 * fetch required; name + formula are not available from a bare SMILES, so we
 * use "Unknown structure" as the display name and leave formula blank. RDKit
 * in the renderer will compute the canonical form and draw the depiction.
 */
export function buildStructureCacheFromSmiles(smiles: string): StructureCache {
  return {
    kind: "structure",
    name: "Unknown structure",
    formula: "",
    mol_weight: null,
    cid: null,
    smiles,
    inchikey: "",
    pngUrl: null,
    cachedAt: new Date().toISOString(),
  };
}

// ── Link preview fetch ─────────────────────────────────────────────────────────

/**
 * Attempt a link-preview fetch. We try two strategies:
 *
 * 1. Fetch the page HTML with fetch() and parse Open Graph / title tags. This
 *    WILL fail for most cross-origin pages because they do not send CORS headers.
 *    We catch the TypeError silently and fall through to strategy 2.
 * 2. Construct a `/favicon.ico` URL from the origin and return a link card with
 *    just the domain + favicon. Favicon requests do not require CORS because the
 *    <img> element (not fetch()) can load them.
 *
 * The caller should always expect a minimal result. This function never throws.
 */
export async function fetchLinkPreview(url: string): Promise<LinkCache> {
  const domain = extractDomain(url);
  const faviconUrl = domain ? `https://${domain}/favicon.ico` : null;

  // Strategy 1: try fetching the HTML. Most pages block this via CORS, but
  // same-site pages (e.g. local dev server links) may succeed.
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const html = await res.text();
      const title = parseOgTitle(html) || parseHtmlTitle(html) || domain || url;
      return {
        kind: "link",
        title,
        domain: domain ?? url,
        faviconUrl,
        cachedAt: new Date().toISOString(),
      };
    }
  } catch {
    // CORS or network error: degrade to domain-only card.
  }

  // Strategy 2: domain-only fallback.
  return {
    kind: "link",
    title: domain ?? url,
    domain: domain ?? url,
    faviconUrl,
    cachedAt: new Date().toISOString(),
  };
}

/** Extract the hostname from a URL string. Returns null on malformed input. */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Parse the og:title meta content from raw HTML. Returns null when absent. */
function parseOgTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  return m ? decodeHtmlEntities(m[1]) : null;
}

/** Parse the <title> tag from raw HTML. Returns null when absent. */
function parseHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

/** Decode common HTML entities in a title string. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

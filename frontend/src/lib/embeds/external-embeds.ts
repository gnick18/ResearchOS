// Markdown embed hybrid, Phase 7 (P7-4). External embed parsing + URL detection.
//
// An external embed is a markdown link whose href is a real external URL with an
// optional `#ros=<view>` fragment, e.g. `[Smith 2021](https://doi.org/10.1021/jacs.1c00001#ros=cite)`.
// The raw stays a real clickable link (a reader without ResearchOS gets a working URL),
// but inside ResearchOS the renderer recognizes the URL pattern and draws a rich card.
//
// This module is the FORMAT + PARSER layer only. It does not render or fetch anything.
// The renderer (ExternalEmbed.tsx) and the cache (external-cache.ts) consume these types.
//
// Supported external kinds (Option A, all four):
//   cite      DOI (https://doi.org/... or doi:...) or PubMed (PMID or pubmed URL)
//             -> citation card (title, authors, journal, year)
//   structure PubChem CID URL (pubchem.ncbi.nlm.nih.gov/compound/<cid>)
//             or a loose SMILES (bare string detected by SMILES heuristic)
//             -> structure card via RDKit, with Add to my library action
//   link      Bare external URL
//             -> link-preview fallback card (favicon + title + domain)
//
// View tokens are inferred from the URL pattern when generic. A link with no `#ros=`
// fragment still gets auto-inferred, so authors can omit the fragment and the card
// still renders. A `#ros=cite` on a DOI URL confirms cite; `#ros=link` on any URL
// forces the link-preview fallback.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

/** The three external embed kinds. */
export type ExternalEmbedKind = "cite" | "structure" | "link";

/** The parsed result of a recognized external embed link. */
export interface ExternalEmbedDescriptor {
  /** The raw href (including any `#ros=` fragment). Used as the cache key. */
  href: string;
  /** The external URL without fragment (the real link a browser follows). */
  url: string;
  /** The inferred or explicit render kind. */
  kind: ExternalEmbedKind;
  /** For `cite` kind: the DOI (normalized, without doi: prefix) or the PMID. */
  doiOrPmid?: string;
  /** True when `doiOrPmid` is a PMID (numeric string), false when it is a DOI. */
  isPmid?: boolean;
  /** For `structure` kind: the PubChem CID as a number, or null when a SMILES. */
  pubchemCid?: number;
  /** For `structure` kind: a loose SMILES string, present when not a PubChem URL. */
  smiles?: string;
}

// ── URL pattern matchers ────────────────────────────────────────────────────────

/**
 * Recognize a DOI. Accepts:
 *   https://doi.org/10.1021/jacs.1c00001
 *   http://doi.org/10.1021/jacs.1c00001
 *   doi:10.1021/jacs.1c00001
 *   10.1021/jacs.1c00001   (bare DOI, starts with 10.)
 *
 * Returns the normalized DOI (without prefix) or null.
 */
export function detectDoi(raw: string): string | null {
  const s = raw.trim();
  // https://doi.org/ or http://doi.org/
  const httpDoiMatch = s.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)/i);
  if (httpDoiMatch) return decodeURIComponent(httpDoiMatch[1]);
  // doi: prefix
  const doiPrefixMatch = s.match(/^doi:(.+)/i);
  if (doiPrefixMatch) return doiPrefixMatch[1].trim();
  // Bare DOI (starts with 10.)
  const bareDoiMatch = s.match(/^(10\.\d{4,}\/\S+)/);
  if (bareDoiMatch) return bareDoiMatch[1];
  return null;
}

/**
 * Recognize a PubMed ID. Accepts:
 *   https://pubmed.ncbi.nlm.nih.gov/12345678
 *   https://www.ncbi.nlm.nih.gov/pubmed/12345678
 *   pmid:12345678
 *
 * Returns the PMID string or null.
 */
export function detectPmid(raw: string): string | null {
  const s = raw.trim();
  // https://pubmed.ncbi.nlm.nih.gov/<id>
  const pubmedMatch = s.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
  if (pubmedMatch) return pubmedMatch[1];
  // https://www.ncbi.nlm.nih.gov/pubmed/<id>
  const ncbiMatch = s.match(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d+)/i);
  if (ncbiMatch) return ncbiMatch[1];
  // pmid: prefix
  const pmidPrefixMatch = s.match(/^pmid:(\d+)/i);
  if (pmidPrefixMatch) return pmidPrefixMatch[1];
  return null;
}

/**
 * Recognize a PubChem compound URL.
 *   https://pubchem.ncbi.nlm.nih.gov/compound/2519
 *   https://pubchem.ncbi.nlm.nih.gov/compound/caffeine
 *
 * Returns the CID number when the path segment is numeric, or null when it is a
 * name (we cannot resolve a name without a network call, so callers should treat
 * a null as "not a PubChem CID URL", not as "not a PubChem URL").
 */
export function detectPubchemCid(raw: string): number | null {
  const s = raw.trim();
  const m = s.match(/^https?:\/\/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/i);
  if (!m) return null;
  const cid = Number(m[1]);
  return Number.isFinite(cid) && cid > 0 ? cid : null;
}

/**
 * Heuristic SMILES detector. A SMILES is a compact line notation that does not
 * look like a URL; real SMILES contain atoms (C, N, O, S, P, F, Cl, Br, I) and
 * structural notation. We reject strings that look like URLs or plain words, and
 * require at least one ring/bond/branch character or an atom symbol sequence.
 *
 * This is intentionally conservative (false negatives are safer than false
 * positives). A string that trips the heuristic but is not valid SMILES will
 * produce an error in RDKit, which we degrade gracefully in the renderer.
 */
export function detectSmiles(raw: string): boolean {
  const s = raw.trim();
  // Reject URLs and empty strings.
  if (!s || s.startsWith("http") || s.startsWith("doi:") || s.startsWith("pmid:")) {
    return false;
  }
  // Must not contain spaces (SMILES are single tokens).
  if (/\s/.test(s)) return false;
  // Must contain at least one common SMILES atom or structural character.
  // Ring closure digits, branches, bonds, aromatic atoms.
  const smilesPattern = /[CNOSPFBrClIcnops]|[\(\)\[\]=@#%+\-]/;
  return smilesPattern.test(s) && s.length >= 3;
}

/**
 * Infer the external embed kind from a URL or bare string, ignoring any `#ros=`
 * fragment (that is handled by the caller). Returns the kind and any extracted
 * identifiers. Returns null when the input is not external (no scheme, or an
 * internal app route that is handled by the object embed lane).
 *
 * The caller passes the href-without-fragment (the path part).
 */
export function inferExternalKind(
  urlWithoutFragment: string,
): Pick<ExternalEmbedDescriptor, "kind" | "doiOrPmid" | "isPmid" | "pubchemCid" | "smiles"> | null {
  const s = urlWithoutFragment.trim();
  if (!s) return null;

  // DOI
  const doi = detectDoi(s);
  if (doi) return { kind: "cite", doiOrPmid: doi, isPmid: false };

  // PubMed
  const pmid = detectPmid(s);
  if (pmid) return { kind: "cite", doiOrPmid: pmid, isPmid: true };

  // PubChem CID URL
  const cid = detectPubchemCid(s);
  if (cid != null) return { kind: "structure", pubchemCid: cid };

  // SMILES (bare string, no URL scheme, no leading slash which would be an app path)
  if (!s.startsWith("http") && !s.startsWith("//") && !s.startsWith("/") && !s.startsWith(".") && detectSmiles(s)) {
    return { kind: "structure", smiles: s };
  }

  // Must be a real URL to be an external embed at all.
  // Reject non-http(s) schemes (mailto, file, ftp, etc.) and internal routes.
  if (!s.startsWith("http://") && !s.startsWith("https://")) return null;

  // Any http(s) URL that was not recognized above is a bare link preview.
  return { kind: "link" };
}

/**
 * Check whether a href is an external embed (vs. an internal object route or a
 * plain anchor). External = has http/https scheme OR is a recognized doi:/pmid:
 * prefix OR starts with 10. (bare DOI). This check is run BEFORE the internal
 * object route parser so external URLs short-circuit cleanly.
 *
 * Does NOT parse the `#ros=` fragment (parseExternalEmbed handles that).
 */
export function isExternalHref(href: string): boolean {
  const s = href.trim();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  if (/^doi:/i.test(s) || /^pmid:/i.test(s)) return true;
  // Bare DOI
  if (/^10\.\d{4,}\//.test(s)) return true;
  return false;
}

/**
 * Parse a markdown link href into an ExternalEmbedDescriptor. Returns null when
 * the href is not an external embed (an internal object route, an anchor, a
 * non-http scheme, etc.) or when no kind can be inferred.
 *
 * The `#ros=<view>` fragment is respected: if present it overrides the inferred
 * kind (e.g. `#ros=link` on a DOI URL forces the link preview). When absent the
 * kind is inferred from the URL pattern.
 */
export function parseExternalEmbed(
  href: string | null | undefined,
): ExternalEmbedDescriptor | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw) return null;

  // Split the `#ros=` fragment off.
  const hashIdx = raw.indexOf("#");
  const urlPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";

  // The explicit `#ros=` view, if any.
  let explicitKind: ExternalEmbedKind | null = null;
  if (fragment) {
    const params = new URLSearchParams(fragment);
    const rosView = params.get("ros");
    if (rosView === "cite" || rosView === "structure" || rosView === "link") {
      explicitKind = rosView;
    }
  }

  // A bare SMILES is not a URL, so it only becomes an embed when the author
  // opts in with `#ros=structure` (avoids reading arbitrary alone-paragraph
  // text as a molecule). This must be checked before the external-href gate.
  if (explicitKind === "structure" && !isExternalHref(urlPart) && detectSmiles(urlPart)) {
    return { href: raw, url: urlPart, kind: "structure", smiles: urlPart };
  }

  // Only proceed when the href looks external (avoids re-processing internal routes).
  if (!isExternalHref(urlPart)) return null;

  const inferred = inferExternalKind(urlPart);
  // A recognized external href with a bad inferred kind still deserves a link card.
  const base = inferred ?? (isExternalHref(urlPart) ? { kind: "link" as const } : null);
  if (!base) return null;

  const kind: ExternalEmbedKind = explicitKind ?? base.kind;

  return {
    href: raw,
    url: urlPart,
    kind,
    doiOrPmid: base.doiOrPmid,
    isPmid: base.isPmid,
    pubchemCid: base.pubchemCid,
    smiles: base.smiles,
  };
}

/**
 * Build the canonical external embed markdown for insertion into a note, e.g.:
 *   `[Smith et al. 2021](https://doi.org/10.1021/jacs.1c00001#ros=cite)`
 *
 * When `caption` is empty the URL itself is used as the link text (still a valid
 * markdown link). Adding `#ros=<kind>` is optional but recommended so the card
 * always renders correctly even if the URL pattern is ambiguous.
 */
export function buildExternalEmbedMarkdown(
  url: string,
  caption: string,
  kind: ExternalEmbedKind,
): string {
  const text = caption || url;
  const escaped = text.replace(/\[/g, "\\[").replace(/]/g, "\\]");
  return `[${escaped}](${url}#ros=${kind})`;
}

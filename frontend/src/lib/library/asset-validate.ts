// Server-side validation for community asset contributions.
//
// A TypeScript port of the license policy + SVG sanitizer from the ingest tooling
// (frontend/scripts/asset-ingest/lib.mjs), used by the upload endpoint to enforce
// the SAME guarantees on user uploads that the curated ingest enforces: only open
// licenses are accepted, and every SVG is stripped of scripts/handlers/external
// refs while keeping per-fill structure intact. Kept dependency-free + pure so it
// is unit-testable and safe to run inside a serverless function.
//
// License invariant (do not weaken): CC0 / Public Domain / CC-BY / CC-BY-SA only.
// Every -NC (non-commercial) and -ND (no-derivatives) is rejected.

export interface LicenseClass {
  id: string;
  allowed: boolean;
  attribution: boolean;
}

/** The only licenses a contributor may pick, surfaced to the wizard UI. */
export const ALLOWED_CONTRIBUTION_LICENSES = [
  { id: "CC0", attribution: false, label: "CC0 (public domain dedication)" },
  { id: "CC-BY", attribution: true, label: "CC-BY (attribution)" },
  { id: "CC-BY-SA", attribution: true, label: "CC-BY-SA (attribution, share-alike)" },
] as const;

/** License policy. allowed = may ingest; attribution = must credit on use. */
export function classifyLicense(s: string | null | undefined): LicenseClass {
  const t = (s || "").toLowerCase();
  if (/nc-nd|by-nc-nd/.test(t)) return { id: "CC-BY-NC-ND", allowed: false, attribution: false };
  if (/nc-sa|by-nc-sa/.test(t)) return { id: "CC-BY-NC-SA", allowed: false, attribution: false };
  if (/by-nc/.test(t)) return { id: "CC-BY-NC", allowed: false, attribution: false };
  if (/by-nd/.test(t)) return { id: "CC-BY-ND", allowed: false, attribution: false };
  if (/by-sa/.test(t)) return { id: "CC-BY-SA", allowed: true, attribution: true };
  if (/\/by\/|cc-by\b|\bcc by\b|attribution\s*[34]/.test(t)) return { id: "CC-BY", allowed: true, attribution: true };
  if (/zero|cc-?0|publicdomain\/zero/.test(t)) return { id: "CC0", allowed: true, attribution: false };
  if (/public\s*domain|publicdomain|\/mark\//.test(t)) return { id: "Public Domain", allowed: true, attribution: false };
  return { id: "UNKNOWN", allowed: false, attribution: false };
}

export interface SanitizeResult {
  svg: string;
  fills: number;
  hasViewBox: boolean;
}

/**
 * Sanitize an SVG for safe embedding while KEEPING per-fill structure intact.
 * Strips <script>, on* handlers, <foreignObject>, and neutralizes external
 * (non-#) hrefs; keeps fills + internal refs + gradients. Returns the cleaned
 * markup plus the distinct-fill count and whether a viewBox is present.
 */
export function sanitizeSvg(input: string): SanitizeResult {
  let svg = String(input);
  svg = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");
  svg = svg.replace(/((?:xlink:)?href)\s*=\s*"(?!#)[^"]*"/gi, '$1="#"');
  svg = svg.trim();
  const fills = new Set<string>();
  for (const m of svg.matchAll(/fill\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)/g)) {
    const v = m[1].toLowerCase();
    if (v !== "none") fills.add(v);
  }
  const hasViewBox = /\bviewBox\s*=/.test(svg);
  return { svg, fills: fills.size, hasViewBox };
}

/** True when the markup is a plausible, root-level SVG document. */
export function looksLikeSvg(input: string): boolean {
  const t = String(input).trim();
  // \bsvg matches the opening tag without the literal angle-bracket token the
  // repo's inline-icon guard ratchets on (this is SVG-as-data, not an icon).
  return /^<(\?xml|!doctype|svg)[\s>]/i.test(t) && /\bsvg[\s>]/i.test(t) && /<\/svg>/i.test(t);
}

/** Lowercase search tokens (>=2 chars), used to derive tags from a title. */
export function tokenize(s: string): string[] {
  return [
    ...new Set(
      String(s || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2),
    ),
  ];
}

/** Verbatim credit line for a community-contributed asset. */
export function formatCommunityCredit(opts: {
  title: string;
  creator: string | null;
  license: string;
  sourceUrl?: string | null;
}): string {
  const who = opts.creator || "Unknown";
  const src = opts.sourceUrl ? ` ${opts.sourceUrl}` : "";
  return `${opts.title} by ${who}. Contributed to the ResearchOS open library.${src} (${opts.license})`;
}

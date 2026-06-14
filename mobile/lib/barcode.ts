// GS1 / GTIN barcode parsing for the package scan flow (smart-match layer 2).
//
// Pure, offline, deterministic. Two jobs:
//   1. Normalize whatever a scanner (or a typed code) hands us to a canonical
//      GTIN-14 with a validated check digit, so the same physical product
//      matches regardless of how it was encoded (UPC-A 12, EAN-13, EAN-8,
//      GTIN-14) or how a lab member typed the stored barcode.
//   2. Pull the structured fields out of a GS1-128 / GS1 DataMatrix payload
//      (the application identifiers a vendor prints on a reagent box): the
//      embedded GTIN, lot number, expiry, serial, and production date. Plus a
//      best-effort GS1-prefix region hint for the issuing member organization.
//
// This NEVER invents data. The region is the GS1 prefix's issuing region, NOT a
// claim about where the product was made, and it is labelled that way. Mapping a
// prefix to an actual manufacturer NAME needs an external GEPIR lookup, which is
// a separate (gated) layer. House style: no em-dashes, no emojis, no mid-sentence
// colons.

export type BarcodeAI = {
  /** Lot / batch number, GS1 AI (10). */
  lot?: string;
  /** Expiry date as printed, GS1 AI (17), normalized to YYYY-MM-DD. */
  expiry?: string;
  /** Production date, GS1 AI (11), normalized to YYYY-MM-DD. */
  produced?: string;
  /** Serial number, GS1 AI (21). */
  serial?: string;
};

export type ParsedBarcode = {
  /** The exact string handed in, trimmed. */
  raw: string;
  /** Canonical 14-digit GTIN, or null when the input is not a valid GTIN
   *  (e.g. a vendor catalog number like "F4135"). */
  gtin14: string | null;
  /** True when gtin14 passed GS1 mod-10 check-digit validation. */
  valid: boolean;
  /** Whether the payload carried GS1-128 application identifiers. */
  isGs1: boolean;
  /** Parsed application identifiers, present only for GS1-128 payloads. */
  ai: BarcodeAI;
  /** GS1 prefix (first 3 digits of the GTIN-13) when derivable. */
  gs1Prefix: string | null;
  /** Human region hint for the GS1 prefix, e.g. "United States / Canada". */
  region: string | null;
};

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/** GS1 mod-10 check digit over a digit string WITHOUT its trailing check digit.
 *  Weights alternate 3,1,3,1... applied from the rightmost data digit. */
function gs1CheckDigit(dataDigits: string): number {
  let sum = 0;
  // Walk right to left over the data digits. Rightmost data digit gets weight 3.
  for (let i = dataDigits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(dataDigits[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/** Validate a full GTIN (8/12/13/14 digits) by its trailing check digit. */
function isValidGtin(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  return gs1CheckDigit(body) === check;
}

/**
 * Normalize a raw GTIN-bearing code to canonical GTIN-14.
 * Accepts GTIN-8 / UPC-A (12) / EAN-13 / GTIN-14. Returns null when the input
 * is not all-digits of a valid GTIN length, or when the check digit fails.
 * The leading zero-pad makes every encoding of the same product collapse to one
 * key, so "036000291452" (UPC-A) and "0036000291452" (EAN-13) match.
 */
export function normalizeGtin(raw: string): string | null {
  const d = onlyDigits(raw);
  if (d.length !== 8 && d.length !== 12 && d.length !== 13 && d.length !== 14) {
    return null;
  }
  if (!isValidGtin(d)) return null;
  return d.padStart(14, '0');
}

/** GS1 prefix ranges, mapped to the issuing member organization region. Compact
 *  table covering the common ranges; anything else falls back to "GS1 member".
 *  Keyed by the first 3 digits of the GTIN-13. */
function regionForPrefix(prefix3: number): string {
  const p = prefix3;
  if (p <= 19) return 'United States / Canada';
  if (p >= 20 && p <= 29) return 'Restricted (in-store)';
  if (p >= 30 && p <= 39) return 'United States (drugs)';
  if (p >= 40 && p <= 49) return 'Restricted (in-store)';
  if (p >= 50 && p <= 59) return 'Coupons';
  if (p >= 60 && p <= 139) return 'United States / Canada';
  if (p >= 300 && p <= 379) return 'France / Monaco';
  if (p >= 380 && p <= 380) return 'Bulgaria';
  if (p >= 383 && p <= 383) return 'Slovenia';
  if (p >= 385 && p <= 385) return 'Croatia';
  if (p >= 387 && p <= 387) return 'Bosnia and Herzegovina';
  if (p >= 400 && p <= 440) return 'Germany';
  if (p >= 450 && p <= 459) return 'Japan';
  if (p >= 460 && p <= 469) return 'Russia';
  if (p >= 470 && p <= 471) return 'Kyrgyzstan / Taiwan';
  if (p >= 474 && p <= 474) return 'Estonia';
  if (p >= 475 && p <= 479) return 'Latvia / Azerbaijan / Lithuania';
  if (p >= 480 && p <= 480) return 'Philippines';
  if (p >= 485 && p <= 489) return 'Armenia / Georgia / Mongolia';
  if (p >= 490 && p <= 499) return 'Japan';
  if (p >= 500 && p <= 509) return 'United Kingdom';
  if (p >= 520 && p <= 521) return 'Greece';
  if (p >= 528 && p <= 528) return 'Lebanon';
  if (p >= 529 && p <= 529) return 'Cyprus';
  if (p >= 531 && p <= 535) return 'North Macedonia / Malta';
  if (p >= 539 && p <= 539) return 'Ireland';
  if (p >= 540 && p <= 549) return 'Belgium / Luxembourg';
  if (p >= 560 && p <= 560) return 'Portugal';
  if (p >= 569 && p <= 569) return 'Iceland';
  if (p >= 570 && p <= 579) return 'Denmark';
  if (p >= 590 && p <= 590) return 'Poland';
  if (p >= 594 && p <= 594) return 'Romania';
  if (p >= 599 && p <= 599) return 'Hungary';
  if (p >= 600 && p <= 601) return 'South Africa';
  if (p >= 608 && p <= 609) return 'Bahrain / Mauritius';
  if (p >= 611 && p <= 611) return 'Morocco';
  if (p >= 613 && p <= 613) return 'Algeria';
  if (p >= 615 && p <= 616) return 'Nigeria / Kenya';
  if (p >= 618 && p <= 626) return 'Africa / Middle East';
  if (p >= 627 && p <= 629) return 'Kuwait / Saudi Arabia / UAE';
  if (p >= 640 && p <= 649) return 'Finland';
  if (p >= 690 && p <= 699) return 'China';
  if (p >= 700 && p <= 709) return 'Norway';
  if (p >= 729 && p <= 729) return 'Israel';
  if (p >= 730 && p <= 739) return 'Sweden';
  if (p >= 740 && p <= 745) return 'Central America';
  if (p >= 746 && p <= 746) return 'Dominican Republic';
  if (p >= 750 && p <= 750) return 'Mexico';
  if (p >= 754 && p <= 755) return 'Canada';
  if (p >= 759 && p <= 759) return 'Venezuela';
  if (p >= 760 && p <= 769) return 'Switzerland / Liechtenstein';
  if (p >= 770 && p <= 771) return 'Colombia';
  if (p >= 773 && p <= 773) return 'Uruguay';
  if (p >= 775 && p <= 775) return 'Peru';
  if (p >= 777 && p <= 777) return 'Bolivia';
  if (p >= 778 && p <= 779) return 'Argentina';
  if (p >= 780 && p <= 780) return 'Chile';
  if (p >= 784 && p <= 784) return 'Paraguay';
  if (p >= 786 && p <= 786) return 'Ecuador';
  if (p >= 789 && p <= 790) return 'Brazil';
  if (p >= 800 && p <= 839) return 'Italy';
  if (p >= 840 && p <= 849) return 'Spain';
  if (p >= 850 && p <= 850) return 'Cuba';
  if (p >= 858 && p <= 858) return 'Slovakia';
  if (p >= 859 && p <= 859) return 'Czech Republic';
  if (p >= 860 && p <= 860) return 'Serbia';
  if (p >= 865 && p <= 865) return 'Mongolia';
  if (p >= 867 && p <= 867) return 'North Korea';
  if (p >= 868 && p <= 869) return 'Turkey';
  if (p >= 870 && p <= 879) return 'Netherlands';
  if (p >= 880 && p <= 880) return 'South Korea';
  if (p >= 884 && p <= 884) return 'Cambodia';
  if (p >= 885 && p <= 885) return 'Thailand';
  if (p >= 888 && p <= 888) return 'Singapore';
  if (p >= 890 && p <= 890) return 'India';
  if (p >= 893 && p <= 893) return 'Vietnam';
  if (p >= 896 && p <= 896) return 'Pakistan';
  if (p >= 899 && p <= 899) return 'Indonesia';
  if (p >= 900 && p <= 919) return 'Austria';
  if (p >= 930 && p <= 939) return 'Australia';
  if (p >= 940 && p <= 949) return 'New Zealand';
  if (p >= 950 && p <= 950) return 'GS1 Global';
  if (p >= 955 && p <= 955) return 'Malaysia';
  if (p >= 958 && p <= 958) return 'Macau';
  if (p >= 977 && p <= 977) return 'Serial publication (ISSN)';
  if (p >= 978 && p <= 979) return 'Bookland (ISBN)';
  if (p >= 980 && p <= 980) return 'Refund receipt';
  if (p >= 981 && p <= 984) return 'Coupon';
  if (p >= 990 && p <= 999) return 'Coupon';
  return 'GS1 member';
}

/** Derive the GS1 prefix + region hint from a canonical GTIN-14. */
function prefixInfo(gtin14: string): { prefix: string; region: string } | null {
  // The prefix lives in the GTIN-13 view (drop the packaging-indicator digit).
  const gtin13 = gtin14.replace(/^0/, '');
  if (gtin13.length < 3) return null;
  const prefix3 = Number(gtin13.slice(0, 3));
  if (Number.isNaN(prefix3)) return null;
  return { prefix: gtin13.slice(0, 3), region: regionForPrefix(prefix3) };
}

// Fixed-length GS1 application identifiers we care about (digits after the AI).
const FIXED_AI: Record<string, number> = { '01': 14, '11': 6, '17': 6 };
// Variable-length AIs we care about (run to the next FNC1 / group separator).
const VAR_AI = new Set(['10', '21']);

/** Normalize a GS1 YYMMDD date to YYYY-MM-DD. DD may be "00" (meaning end of
 *  month); we keep it literal so we never fabricate a day the label did not
 *  state. Two-digit year is windowed to 2000-2099. */
function gs1Date(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Parse a GS1-128 / GS1 DataMatrix element string into application identifiers.
 * Handles both human "(01)...(17)...(10)..." form and the raw FNC1-delimited
 * form (FNC1 arrives as ASCII GS, char 29, or sometimes a literal "]C1"/"]d2"
 * symbology prefix). Returns null when no AI structure is detected.
 */
export function parseGs1Element(input: string): BarcodeAI | null {
  const GS = String.fromCharCode(29);
  // Strip a leading symbology identifier and normalize parens form to a flat
  // stream with FNC1 separators between elements.
  let s = input.replace(/^\](C1|d2|Q3|e0)/i, '');
  const hasParens = /\(\d{2,4}\)/.test(s);
  if (hasParens) {
    // "(01)0001...(10)LOT" -> insert a separator before each "(" so variable
    // AIs terminate cleanly, then drop the parens.
    s = s.replace(/\((\d{2,4})\)/g, (_m, ai) => `${GS}${ai}`);
    if (s.startsWith(GS)) s = s.slice(1);
  }
  if (!/^\d{2}/.test(s.replace(new RegExp(`^${GS}`), ''))) return null;

  const ai: BarcodeAI = {};
  let found = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const code = s.slice(i, i + 2);
    if (FIXED_AI[code] != null) {
      const len = FIXED_AI[code];
      const val = s.slice(i + 2, i + 2 + len);
      if (val.length < len) break;
      if (code === '01') {
        const g = normalizeGtin(val);
        if (g) {
          found = true;
          // GTIN from AI (01) is consumed by the caller via re-parse; we record
          // nothing in ai for it (it is a GTIN, not a lot/expiry field).
        }
      } else if (code === '17') {
        ai.expiry = gs1Date(val);
        found = found || ai.expiry != null;
      } else if (code === '11') {
        ai.produced = gs1Date(val);
        found = found || ai.produced != null;
      }
      i += 2 + len;
      continue;
    }
    if (VAR_AI.has(code)) {
      let end = s.indexOf(GS, i + 2);
      if (end === -1) end = n;
      const val = s.slice(i + 2, end);
      if (code === '10') ai.lot = val || undefined;
      if (code === '21') ai.serial = val || undefined;
      found = found || val.length > 0;
      i = end;
      continue;
    }
    // Unknown AI, cannot safely advance a variable field, stop parsing.
    break;
  }
  return found ? ai : null;
}

/** Pull the AI (01) GTIN out of a GS1 element string, if present. */
function gs1EmbeddedGtin(input: string): string | null {
  const GS = String.fromCharCode(29);
  let s = input.replace(/^\](C1|d2|Q3|e0)/i, '');
  s = s.replace(/\((\d{2,4})\)/g, (_m, ai) => `${GS}${ai}`);
  const m = s.match(new RegExp(`(?:^|${GS})01(\\d{14})`));
  return m ? normalizeGtin(m[1]) : null;
}

/**
 * Parse any scanned/typed barcode payload into a structured result. The single
 * entry point for the scan flow.
 */
export function parseBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();
  const out: ParsedBarcode = {
    raw: trimmed,
    gtin14: null,
    valid: false,
    isGs1: false,
    ai: {},
    gs1Prefix: null,
    region: null,
  };
  if (!trimmed) return out;

  // GS1-128 element string (parens or FNC1) takes priority, it carries its own
  // GTIN plus lot/expiry.
  const looksGs1 = /\(\d{2,4}\)/.test(trimmed) || trimmed.includes(String.fromCharCode(29)) || /^\](C1|d2|Q3|e0)/i.test(trimmed);
  if (looksGs1) {
    const embedded = gs1EmbeddedGtin(trimmed);
    const ai = parseGs1Element(trimmed);
    if (embedded || ai) {
      out.isGs1 = true;
      out.gtin14 = embedded;
      out.valid = embedded != null;
      out.ai = ai ?? {};
      if (embedded) {
        const info = prefixInfo(embedded);
        if (info) {
          out.gs1Prefix = info.prefix;
          out.region = info.region;
        }
      }
      return out;
    }
  }

  // Plain GTIN / UPC / EAN.
  const gtin = normalizeGtin(trimmed);
  if (gtin) {
    out.gtin14 = gtin;
    out.valid = true;
    const info = prefixInfo(gtin);
    if (info) {
      out.gs1Prefix = info.prefix;
      out.region = info.region;
    }
  }
  return out;
}

/**
 * True when two barcode strings denote the same product. Both are normalized to
 * a canonical GTIN and compared; when either side is not a valid GTIN (a vendor
 * catalog number, a demo placeholder) we fall back to an exact trimmed-string
 * match so non-GTIN codes still work exactly as before.
 */
export function barcodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const sa = a.trim();
  const sb = b.trim();
  if (!sa || !sb) return false;
  const ga = normalizeGtin(sa) ?? gs1EmbeddedGtin(sa);
  const gb = normalizeGtin(sb) ?? gs1EmbeddedGtin(sb);
  if (ga && gb) return ga === gb;
  return sa === sb;
}

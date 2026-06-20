// Unified slug registry, pure library (lab-domains Phase 1).
//
// Every paying lab gets <labslug>.research-os.com (the cookie-isolated public lab
// origin; old research-os.app/<labslug> links 301 there). Slugs live in ONE global
// namespace shared with @handles and institution slugs, so a lab can never claim
// a value that already routes somewhere (a top-level page, a researcher handle,
// an institution). This module is the PURE, DB-free core: normalization, the
// reserved-word set, availability, and institution-aware suggestions. The Neon
// persistence lives in slug-registry-db.ts and the DB layer enforces global
// uniqueness; this file is fully unit-testable with no connection string.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * What kind of thing owns a slug in the unified namespace. Every row in the
 * registry is exactly one of these:
 *   - lab         a paying lab's companion-site slug (<labslug>.research-os.com)
 *   - handle      a researcher @handle (account_profiles.handle), seeded so a
 *                 lab cannot claim a name a person already uses
 *   - institution a derived institution slug (verified email domain), seeded
 *                 for the same reason
 *   - reserved    a system route segment or reserved word (never claimable)
 */
export type SlugKind = "lab" | "handle" | "institution" | "reserved";

/**
 * Length bounds for a slug. Mirrors the @handle bounds (3-30) so the shared
 * namespace is consistent: a lab slug and a handle are interchangeable as far as
 * the URL router is concerned, so they share the same shape.
 */
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 30;

// ---------------------------------------------------------------------------
// RESERVED_SLUGS derivation
// ---------------------------------------------------------------------------
//
// Derived 2026-06-16 by listing every top-level directory under
// frontend/src/app (each is a Next.js App-Router route segment, so the URL
// research-os.app/<segment> already resolves to that page and MUST NOT be
// claimable as a lab slug), then adding a set of system words that are not yet
// routes but we want to keep free (auth, ops, docs, vanity). The app-dir list
// was captured with:
//
//   ls -1 frontend/src/app   (directories only, minus __tests__)
//
// If a NEW top-level route directory is added under frontend/src/app it MUST be
// added to APP_ROUTE_SEGMENTS below (and seeded as kind=reserved via the DB
// layer), or a lab could claim a slug that collides with the new route. There is
// a guard test (slug-registry.test.ts) that fails if the two drift, by reading
// the directory listing at test time.
//
// Non-route files in frontend/src/app (error.tsx, layout.tsx, page.tsx,
// globals.css, icon.svg, favicon.ico, *.png, page-landing-redirect.ts) are NOT
// route segments and are intentionally excluded.

/**
 * Every top-level App-Router route segment under frontend/src/app as of
 * 2026-06-16. Each resolves at research-os.app/<segment>, so none can be a lab
 * slug. Kept as a frozen literal (not read from the filesystem at runtime,
 * because this is a pure browser-safe module) and guarded by a drift test.
 */
export const APP_ROUTE_SEGMENTS: readonly string[] = [
  "about",
  "accept",
  "account",
  "activity",
  "admin",
  "ai",
  "api",
  "app",
  "approvals",
  "buisness", // existing (misspelled) route dir, kept verbatim so it stays reserved
  "business",
  "calendar",
  "chemistry",
  "chemistry-embed-check",
  "class-materials",
  "datahub",
  "demo",
  "department",
  "departments",
  "dept",
  "dev",
  "dev-gate",
  "dev-join",
  "dev-lab",
  "experiments",
  "figures",
  "funding",
  "gantt",
  "institution",
  "inventory",
  "lab",
  "lab-experiments",
  "lab-inbox",
  "lab-notes",
  "lab-overview",
  "lab-work",
  "labs",
  "library",
  "links",
  "maintenance",
  "methods",
  "network",
  "open-source",
  "pcr",
  "people",
  "phylo",
  "pricing",
  "privacy",
  "profile",
  "purchases",
  "researchers",
  "results",
  "search",
  "sequences",
  "settings",
  "sharing-setup-test",
  "showcase",
  "sponsors",
  "supplies",
  "terms",
  "thanks",
  "transparency",
  "trash",
  "u",
  "welcome",
  "wiki",
  "workbench",
];

/**
 * System words that are not (yet) route directories but must stay unclaimable:
 * auth flows, ops/status surfaces, doc/help vanity URLs, and the obvious vanity
 * impostor names. Kept separate from APP_ROUTE_SEGMENTS so the route-drift test
 * only checks the route list, not these deliberate extras.
 */
export const SYSTEM_RESERVED_WORDS: readonly string[] = [
  "admin",
  "dev",
  "login",
  "signin",
  "signup",
  "logout",
  "account",
  "help",
  "docs",
  "support",
  "status",
  "root",
  "system",
  "app",
  "www",
  "mail",
  "static",
  "assets",
  "public",
  "billing",
  "checkout",
  "pay",
  "auth",
  "oauth",
  "callback",
  "404",
  "500",
  "favicon",
  "robots",
  "sitemap",
];

/**
 * The full reserved-slug set: every top-level route segment plus the system
 * words, normalized through normalizeSlug so the comparison is apples-to-apples
 * with a user's normalized input. Some words appear in both source lists; the
 * Set de-duplicates. Entries that do not survive normalization (e.g. "404",
 * "500" become "" after the digit-only... no, digits are allowed) are kept as
 * normalized. A multi-segment route like "chemistry-embed-check" normalizes to
 * itself and stays reserved.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(
  [...APP_ROUTE_SEGMENTS, ...SYSTEM_RESERVED_WORDS]
    .map((s) => normalizeSlug(s))
    .filter((s) => s.length > 0),
);

// ---------------------------------------------------------------------------
// normalizeSlug
// ---------------------------------------------------------------------------

/**
 * Canonicalizes raw user input into the stored slug form:
 *   - lowercased and trimmed
 *   - a leading "@" is stripped (handle paste tolerance)
 *   - any run of characters outside [a-z0-9-] becomes a single dash
 *   - repeated dashes collapse to one
 *   - leading and trailing dashes are stripped
 *   - the result is truncated to SLUG_MAX_LENGTH (then re-stripped of a trailing
 *     dash the cut may have exposed)
 *
 * Returns "" when nothing usable remains. This is a normalizer, NOT a validator:
 * it never throws and never reports a reason. Use isValidSlug / isSlugAvailable
 * for the yes/no decision. Pure and idempotent (normalizeSlug(normalizeSlug(x))
 * === normalizeSlug(x)).
 */
export function normalizeSlug(input: string): string {
  if (!input || typeof input !== "string") return "";
  let s = input.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^@+/, "");
  // Map any non [a-z0-9] run to a single dash. Underscores collapse to dashes
  // too, so the namespace stays dash-only even though @handles allow "_".
  s = s.replace(/[^a-z0-9]+/g, "-");
  // Collapse repeated dashes the previous step could not (it already collapses
  // runs, but defensively handle an input that arrived pre-dashed).
  s = s.replace(/-{2,}/g, "-");
  // Strip leading/trailing dashes.
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > SLUG_MAX_LENGTH) {
    s = s.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
  }
  return s;
}

/**
 * Whether a NORMALIZED slug is structurally valid: it equals its own normal
 * form and is within the length bounds. Returns null when valid, else a short
 * human reason. Does NOT consult reserved words or taken slugs (those are
 * separate concerns in isSlugAvailable) so a caller can distinguish "malformed"
 * from "unavailable".
 */
export function validateSlug(raw: string): string | null {
  const s = normalizeSlug(raw);
  if (s.length < SLUG_MIN_LENGTH) {
    return `Slugs need at least ${SLUG_MIN_LENGTH} characters.`;
  }
  if (s.length > SLUG_MAX_LENGTH) {
    return `Slugs can be at most ${SLUG_MAX_LENGTH} characters.`;
  }
  if (s !== normalizeSlug(raw)) {
    // Unreachable in practice (s IS normalizeSlug(raw)); kept for clarity.
    return "Use lowercase letters, numbers, and single dashes.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * The available-slugs decision against two caller-supplied sets:
 *   - reserved   the reserved-word set (defaults to RESERVED_SLUGS)
 *   - taken      the set of slugs already in the registry (handles, institutions,
 *                other labs); the DB layer supplies this from a single query
 *
 * Returns true only when the slug is structurally valid, NOT reserved, and NOT
 * already taken. Pure: the caller is responsible for loading `taken` from the DB
 * (slug-registry-db.isSlugTaken / loadTakenSlugs) so this function stays
 * unit-testable.
 */
export function isSlugAvailable(
  slug: string,
  opts: { reserved?: ReadonlySet<string>; taken?: ReadonlySet<string> } = {},
): boolean {
  const s = normalizeSlug(slug);
  if (validateSlug(s) !== null) return false;
  const reserved = opts.reserved ?? RESERVED_SLUGS;
  if (reserved.has(s)) return false;
  const taken = opts.taken ?? new Set<string>();
  if (taken.has(s)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// suggestSlugs (institution-aware, deterministic)
// ---------------------------------------------------------------------------

/**
 * Short, slug-safe abbreviation of an institution short-name or domain, used as
 * a suggestion suffix. "University of Wisconsin-Madison" via its short name
 * "wisc" -> "wisc"; a domain "wisc.edu" -> "wisc"; "uwmadison.edu" -> "uwmadison".
 * Strips a leading "www." and the public suffix (.edu/.ac.uk/...), keeps the
 * first label. Returns "" when nothing usable remains.
 */
function institutionSuffix(shortName?: string, domain?: string): string[] {
  const out: string[] = [];
  const pushNorm = (v: string | undefined) => {
    if (!v) return;
    const n = normalizeSlug(v);
    if (n && !out.includes(n)) out.push(n);
  };

  // A short name like "wisc" or "UW-Madison" -> normalized slug.
  pushNorm(shortName);

  if (domain) {
    let d = domain.trim().toLowerCase();
    d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
    d = d.split("/")[0].split("?")[0].split("#")[0];
    d = d.replace(/^www\./, "");
    const labels = d.split(".").filter(Boolean);
    if (labels.length > 0) {
      // The most specific non-suffix label. For "wisc.edu" -> "wisc"; for
      // "cs.stanford.edu" -> "stanford" is harder, so we take the label just
      // before the public suffix when there are >=2 labels, else the first.
      const COMMON_SUFFIXES = new Set([
        "edu", "ac", "uk", "com", "org", "net", "gov", "de", "fr", "ca", "au",
        "jp", "cn", "ch", "nl", "se", "es", "it",
      ]);
      // Walk from the end, skip known suffix labels, take the first real label.
      let pick = labels[0];
      for (let i = labels.length - 1; i >= 0; i -= 1) {
        if (!COMMON_SUFFIXES.has(labels[i])) {
          pick = labels[i];
          break;
        }
      }
      pushNorm(pick);
    }
  }

  return out;
}

/**
 * Deterministic, institution-aware slug suggestions for a desired slug that is
 * unavailable. The order is stable so the same inputs always produce the same
 * list (no randomness, no DB), which keeps the picker UI and tests predictable:
 *
 *   1. <desired>-<instShort>     (e.g. "smithlab-wisc")
 *   2. <desired>-<instDomain>    (e.g. "smithlab-uwmadison")  when distinct
 *   3. <desired>2, <desired>3    numeric bumps
 *   4. <firstInitial+last>-lab style fallback is NOT inferable from a slug, so
 *      we instead offer "<desired>-lab" and "lab-<desired>" as generic variants
 *
 * The example in the proposal ("smithlab" -> ["smithlab-wisc","smithlab-uwmadison",
 * "smithlab2","jsmith-lab"]) is satisfied by 1+2+3 plus a "-lab" variant; we
 * cannot synthesize "jsmith-lab" from "smithlab" alone (no person name in the
 * input), so the generic "-lab" variants stand in for that slot.
 *
 * Every returned suggestion is normalized, valid, distinct, and not equal to the
 * (taken) desired slug. When `taken`/`reserved` sets are passed, suggestions
 * that would themselves be unavailable are filtered out, so the list only ever
 * contains claimable options. Capped at `limit` (default 6).
 */
export function suggestSlugs(
  desiredSlug: string,
  opts: {
    institutionShortName?: string;
    institutionDomain?: string;
    reserved?: ReadonlySet<string>;
    taken?: ReadonlySet<string>;
    limit?: number;
  } = {},
): string[] {
  const base = normalizeSlug(desiredSlug);
  const limit = opts.limit ?? 6;
  const reserved = opts.reserved ?? RESERVED_SLUGS;
  const taken = opts.taken ?? new Set<string>();
  if (!base) return [];

  const suffixes = institutionSuffix(
    opts.institutionShortName,
    opts.institutionDomain,
  );

  // Build candidates in priority order:
  //   1. institution-suffixed (short name, then domain label)
  //   2. the two generic "-lab" / "lab-" variants
  //   3. numeric bumps as the deep fallback
  // The generic variants come BEFORE the numeric bumps so a reasonable named
  // alternative surfaces within the default limit even when several numeric
  // bumps are also free.
  const candidates: string[] = [];
  for (const suf of suffixes) {
    if (suf && suf !== base) candidates.push(`${base}-${suf}`);
  }
  candidates.push(`${base}2`);
  candidates.push(`${base}-lab`);
  candidates.push(`lab-${base}`);
  for (let i = 3; i <= 9; i += 1) {
    candidates.push(`${base}${i}`);
  }

  const seen = new Set<string>([base]);
  const out: string[] = [];
  for (const raw of candidates) {
    const s = normalizeSlug(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    // Skip anything structurally invalid (e.g. truncated past the cap) or not
    // claimable, so suggestions are always actionable.
    if (validateSlug(s) !== null) continue;
    if (!isSlugAvailable(s, { reserved, taken })) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// reserve / release validation (DB module implements persistence)
// ---------------------------------------------------------------------------

/** The validated payload the DB layer needs to reserve a slug. */
export interface ReserveSlugInput {
  slug: string;
  kind: SlugKind;
  ownerKey?: string | null;
  ref?: string | null;
}

/**
 * Pure validation for a reserve request, run BEFORE the DB write. Normalizes the
 * slug and checks the kind, length, and reserved-word rules. A reservation may
 * target a reserved slug ONLY when kind === "reserved" (that is how the seeder
 * registers system route segments); any other kind claiming a reserved slug is
 * rejected. Returns the normalized input on success or an error string.
 */
export function validateReserve(
  input: ReserveSlugInput,
): { ok: true; value: Required<Pick<ReserveSlugInput, "slug" | "kind">> & ReserveSlugInput } | { ok: false; error: string } {
  const slug = normalizeSlug(input.slug);
  const kinds: SlugKind[] = ["lab", "handle", "institution", "reserved"];
  if (!kinds.includes(input.kind)) {
    return { ok: false, error: `Unknown slug kind "${String(input.kind)}".` };
  }
  const structural = validateSlug(slug);
  if (structural !== null) return { ok: false, error: structural };
  if (input.kind !== "reserved" && RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: "That slug is reserved." };
  }
  return {
    ok: true,
    value: {
      slug,
      kind: input.kind,
      ownerKey: input.ownerKey ?? null,
      ref: input.ref ?? null,
    },
  };
}

/**
 * Pure validation for a release request. A release only needs a well-formed
 * slug; ownership is enforced by the DB layer (release is scoped to the owner
 * key). Returns the normalized slug or an error.
 */
export function validateRelease(
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const s = normalizeSlug(slug);
  const structural = validateSlug(s);
  if (structural !== null) return { ok: false, error: structural };
  return { ok: true, slug: s };
}

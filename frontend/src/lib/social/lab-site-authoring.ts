// Lab companion-site authoring, pure authz + request shapes (lab-domains Phase
// 3a, social lane).
//
// The PURE, IO-free core of the write/authoring path so the authorization rules
// can be unit-tested without Next.js, a session, or a database. The route
// handlers (app/api/social/lab-site/*) do the IO (read the session, derive the
// caller owner key, look up the site, call isLabPublishEntitled) and feed the
// results to authorizeWrite() here, which returns a single allow/deny verdict.
//
// The three checks every write must pass (fail closed on each):
//   1. signed in    a caller owner key was resolved from the session (never the
//                   body). No key => 401 unauthorized.
//   2. owns the lab the caller owner key equals the lab_owner_key being written.
//                   For create-site the lab IS the caller (a lab is keyed by its
//                   billing owner key, ownerKeyForEmail), so this is identity by
//                   construction; for page writes the existing site's owner must
//                   match the caller. Mismatch => 403 forbidden.
//   3. entitled     isLabPublishEntitled(callerOwnerKey) === true (active paid
//                   lab tier). Not entitled => 403 forbidden.
//
// This module imports NOTHING from lib/sharing/identity, lib/sharing/directory
// schema, or lib/billing write paths. It takes already-resolved primitives.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * The authorization verdict for a single write. "allow" means all three checks
 * passed; otherwise `status` is the HTTP status the route should return and
 * `error` a short machine-stable code. The reason is also returned so tests (and
 * future telemetry) can assert exactly WHICH check failed without parsing prose.
 */
export type WriteAuthz =
  | { kind: "allow" }
  | {
      kind: "deny";
      status: 401 | 403;
      error: "unauthorized" | "forbidden";
      reason: "not-signed-in" | "not-owner" | "not-entitled";
    };

/**
 * The pure authorization decision shared by every authenticated lab-site write.
 *
 *   - callerOwnerKey  the owner key derived from the SESSION (ownerKeyForEmail),
 *                     or null when the request carries no usable session. Never
 *                     taken from the request body.
 *   - targetOwnerKey  the lab_owner_key the write targets. For create-site this
 *                     equals callerOwnerKey by construction (a lab is its owner
 *                     key); for page writes it is the existing site's owner.
 *   - entitled        the resolved isLabPublishEntitled(callerOwnerKey) result.
 *
 * Fails closed in order signed-in -> owner -> entitled, so a not-signed-in
 * caller is always a 401 and a signed-in-but-wrong-lab caller is a 403 BEFORE
 * the entitlement is even consulted (no information leak about another lab's
 * billing state).
 */
export function authorizeWrite(args: {
  callerOwnerKey: string | null;
  targetOwnerKey: string | null;
  entitled: boolean;
}): WriteAuthz {
  const caller = args.callerOwnerKey;
  if (!caller) {
    return {
      kind: "deny",
      status: 401,
      error: "unauthorized",
      reason: "not-signed-in",
    };
  }
  // A page write must target the caller's own lab. create-site passes
  // targetOwnerKey === callerOwnerKey so this is satisfied by construction.
  if (!args.targetOwnerKey || args.targetOwnerKey !== caller) {
    return {
      kind: "deny",
      status: 403,
      error: "forbidden",
      reason: "not-owner",
    };
  }
  if (!args.entitled) {
    return {
      kind: "deny",
      status: 403,
      error: "forbidden",
      reason: "not-entitled",
    };
  }
  return { kind: "allow" };
}

// ---------------------------------------------------------------------------
// Request-body validation (pure)
// ---------------------------------------------------------------------------

/** Hard cap on a page title (defensive; the DB column is unbounded text). */
export const PAGE_TITLE_MAX = 200;

/** Hard cap on a markdown body (defensive bound, generous for a static page). */
export const PAGE_BODY_MAX = 200_000;

/** A validated create-site request body. */
export interface CreateSiteBody {
  slug: string;
  /** Optional institution hint to seed better slug suggestions on a conflict. */
  institutionShortName?: string;
  institutionDomain?: string;
}

/** A validated upsert-page request body. */
export interface UpsertPageBody {
  path: string;
  title: string;
  bodyMd: string;
}

/** A validated publish-page request body. */
export interface PublishPageBody {
  path: string;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

/**
 * Validates the create-site body. The slug is left RAW here (normalization +
 * availability is the route's job via the registry); we only confirm a non-empty
 * string was supplied and trim the optional institution hints. Returns null when
 * the shape is wrong so the route returns a 400.
 */
export function parseCreateSiteBody(body: unknown): CreateSiteBody | null {
  const b = asRecord(body);
  if (!b) return null;
  if (typeof b.slug !== "string" || b.slug.trim().length === 0) return null;
  const out: CreateSiteBody = { slug: b.slug };
  if (typeof b.institutionShortName === "string" && b.institutionShortName.trim()) {
    out.institutionShortName = b.institutionShortName.trim();
  }
  if (typeof b.institutionDomain === "string" && b.institutionDomain.trim()) {
    out.institutionDomain = b.institutionDomain.trim();
  }
  return out;
}

/**
 * Validates the upsert-page body. path may be "" (the home page). title and
 * bodyMd must be strings within their caps. Path normalization is deferred to
 * the DB layer (normalizePagePath) so traversal/edge cases are handled in one
 * place; here we only bound the lengths and reject the wrong types.
 */
export function parseUpsertPageBody(body: unknown): UpsertPageBody | null {
  const b = asRecord(body);
  if (!b) return null;
  if (typeof b.path !== "string") return null;
  if (typeof b.title !== "string" || b.title.length > PAGE_TITLE_MAX) return null;
  if (typeof b.bodyMd !== "string" || b.bodyMd.length > PAGE_BODY_MAX) return null;
  return { path: b.path, title: b.title, bodyMd: b.bodyMd };
}

/** Validates the publish-page body (just a path, which may be ""). */
export function parsePublishPageBody(body: unknown): PublishPageBody | null {
  const b = asRecord(body);
  if (!b) return null;
  if (typeof b.path !== "string") return null;
  return { path: b.path };
}

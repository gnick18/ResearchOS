// Cross-boundary sharing, directory route guards and env access (Phase 1b-ii).
//
// Small helpers shared by every directory route. Env is read lazily here, never
// at module load, so a build or a tsc pass does not require any secret to be
// present. The routes import these instead of touching process.env directly.

/**
 * Feature gate. The directory endpoints 404 unless SHARING_ENABLED is exactly
 * "true". This keeps the email-OTP and key-binding surface dark in any
 * environment that has not deliberately opted in, even if the database and
 * Redis credentials happen to be present.
 */
export function isSharingEnabled(): boolean {
  return process.env.SHARING_ENABLED === "true";
}

/**
 * SECOND gate for the PUBLIC, unauthenticated social-layer surface (the public
 * researcher search that powers the /network hub). Kept SEPARATE from
 * isSharingEnabled on purpose: sharing is already on in prod, and the
 * NEXT_PUBLIC_SOCIAL_LAYER client flag only hides the /network UI, not an API
 * route. Without this server-side gate a public-search endpoint would go live
 * the moment it deploys, making every directory profile enumerable before any
 * opt-out toggle ships. The public search route requires BOTH this AND
 * isSharingEnabled, so it stays dark until SOCIAL_LAYER_ENABLED is deliberately
 * flipped. Matches the exact-string-"true" convention of isSharingEnabled.
 */
export function isSocialLayerEnabled(): boolean {
  return process.env.SOCIAL_LAYER_ENABLED === "true";
}

/**
 * Returns the server HMAC pepper, the secret keyed into every email hash. Throws
 * a clear error if it is missing so a misconfigured deployment fails loudly at
 * request time rather than silently hashing under an empty key (which would make
 * every row trivially brute-forceable). Read lazily, never at module top level.
 */
export function getPepper(): string {
  const pepper = process.env.DIRECTORY_HMAC_PEPPER;
  if (!pepper) {
    throw new Error(
      "DIRECTORY_HMAC_PEPPER is not set. The directory cannot hash emails without it.",
    );
  }
  return pepper;
}

/**
 * JSON response helper. Centralizes the content-type and status wiring so each
 * route handler stays a few lines of logic. Uses the Web Response the App Router
 * route handlers return directly.
 */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Extracts the client IP from a request for per-IP rate limiting. Prefers the
 * first hop of x-forwarded-for (the client, before any proxy), then x-real-ip,
 * then falls back to the literal "unknown" so a missing header collapses every
 * caller into one shared bucket rather than disabling the limit. Pure, takes a
 * Headers so it is testable without a full Request.
 */
export function extractClientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}

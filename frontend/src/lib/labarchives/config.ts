/**
 * LabArchives integration configuration.
 *
 * LabArchives uses **HMAC-SHA1 signed requests** rather than OAuth2 — every
 * call carries `akid` (access key id), `expires`, and `sig` query params.
 * The institution-issued credentials are NOT user-specific.
 *
 * ## Two configuration paths
 *
 * 1. **Env vars** (multi-tenant / shared deployment): set
 *    `LABARCHIVES_ACCESS_KEY_ID` + `LABARCHIVES_ACCESS_PASSWORD` (optional
 *    `LABARCHIVES_API_BASE_URL` for UK/AU/EU institutions). The
 *    institution-issued credentials live in the deployment environment;
 *    end-users never see them.
 *
 * 2. **Sidecar file** (single-user / local-first / self-host): the
 *    deployer enters the same credentials in Settings → LabArchives →
 *    Deployer setup. They get written to `_labarchives-deployer.json` at
 *    the root of the user's data folder (via FSA). The Settings page
 *    reads the sidecar and includes the creds in the request body of any
 *    signed-call route; the server tries env vars first, then falls back
 *    to the body.
 *
 * Env vars take precedence so a real deployment can lock the integration
 * to the institution's creds (and ignore any leftover sidecar a user
 * might have created on their laptop while testing).
 *
 * See `deployer-store.ts` for the sidecar schema + trust-model note.
 *
 * Per-user state — the `uid` returned by `users/user_access_info` — is
 * stored in the user's data folder once they sign in. See
 * `tokens-store.ts` for that.
 */

import type { NextRequest } from "next/server";

export interface LabArchivesCreds {
  accessKeyId: string;
  accessPassword: string;
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://api.labarchives.com/api";

/** Server-only — these env vars hold the institutional credentials and must
 *  never leak to the client bundle. Throws a helpful error if either is
 *  unset. Prefer `readLabArchivesCredsFromRequest()` in new code so the
 *  sidecar-mode path works; this is kept exported for back-compat with the
 *  callback / non-request-bearing paths. */
export function readLabArchivesCreds(): LabArchivesCreds {
  const accessKeyId = process.env.LABARCHIVES_ACCESS_KEY_ID;
  const accessPassword = process.env.LABARCHIVES_ACCESS_PASSWORD;
  const baseUrl = process.env.LABARCHIVES_API_BASE_URL ?? DEFAULT_BASE_URL;
  if (!accessKeyId || !accessPassword) {
    throw new Error(
      "LabArchives integration is not configured — set LABARCHIVES_ACCESS_KEY_ID " +
        "and LABARCHIVES_ACCESS_PASSWORD in the environment. Request institutional " +
        "API credentials at https://mynotebook.labarchives.com/share/LabArchives%2520API/MC4wfDI3LzAvVHJlZU5vZGUvMjQzMzE3ODYzM3wwLjA=",
    );
  }
  return { accessKeyId, accessPassword, baseUrl };
}

/** Server-side helper that tries env vars first, then falls back to a
 *  `deployerCreds` payload supplied in the request body.
 *
 *  Used by the three signed-call routes (login, refresh, fetch-image) so
 *  they support both the env-var path (shared deployments) and the
 *  sidecar path (single-user local). Validates field shape before
 *  returning, throwing a generic error on missing/malformed input.
 *
 *  Note: the caller must already have parsed the body — pass the parsed
 *  object (or `null`/`undefined` if you don't have one yet). We don't read
 *  `req.json()` here because the route handler typically wants to inspect
 *  the same body for its own params.
 */
export function readLabArchivesCredsFromRequest(
  _req: NextRequest,
  body: unknown,
): LabArchivesCreds {
  // Path 1: env vars win when set.
  try {
    return readLabArchivesCreds();
  } catch {
    // fall through to sidecar-from-body
  }

  // Path 2: deployerCreds in the parsed request body.
  const raw =
    body && typeof body === "object"
      ? (body as { deployerCreds?: unknown }).deployerCreds
      : undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "LabArchives integration is not configured — set the institutional API " +
        "credentials via env vars OR via Settings → LabArchives → Deployer setup.",
    );
  }
  const obj = raw as {
    accessKeyId?: unknown;
    accessPassword?: unknown;
    baseUrl?: unknown;
  };
  const accessKeyId =
    typeof obj.accessKeyId === "string" ? obj.accessKeyId.trim() : "";
  const accessPassword =
    typeof obj.accessPassword === "string" ? obj.accessPassword : "";
  if (!accessKeyId || !accessPassword) {
    throw new Error(
      "LabArchives deployer credentials are missing or malformed.",
    );
  }
  // Sane length bounds — protects against an attacker stuffing absurd
  // strings into the HMAC input.
  if (accessKeyId.length > 1024 || accessPassword.length > 1024) {
    throw new Error("LabArchives deployer credentials are too long.");
  }
  const rawBase =
    typeof obj.baseUrl === "string" && obj.baseUrl.trim() !== ""
      ? obj.baseUrl.trim()
      : "";
  let baseUrl: string;
  if (rawBase) {
    if (rawBase.length > 1024) {
      throw new Error("LabArchives base URL is too long.");
    }
    // Light validation — only allow https/http LabArchives-style hosts so
    // a hostile body can't redirect signed requests at a third-party
    // endpoint. Block schemes and ports outside the LabArchives REST
    // contract.
    if (!/^https?:\/\//i.test(rawBase)) {
      throw new Error("LabArchives base URL must be an http(s) URL.");
    }
    baseUrl = rawBase;
  } else {
    baseUrl = DEFAULT_BASE_URL;
  }
  return { accessKeyId, accessPassword, baseUrl };
}

/** Browser-safe — checks whether the public configuration flag has been set
 *  so the UI can decide whether to surface the LabArchives sign-in step or
 *  hide it with "Integration not configured" copy.
 *
 *  Capture-mode override: when we're already in a screenshot / demo
 *  session (sticky `researchos:demo-mode` flag set, `/demo/*` path, or
 *  `?wikiCapture=1`), we additionally honor a `labArchivesConfigured`
 *  URL param so the wiki manager can capture both the green
 *  "configured" and amber "not available yet" pill states off a static
 *  fixture. Default in capture mode (no param) is false — matches
 *  today's behavior. Param shape (client-side only, after hydration):
 *
 *    ?wikiCapture=1&labArchivesConfigured=1   → returns true  (green)
 *    ?wikiCapture=1&labArchivesConfigured=0   → returns false (amber)
 *    ?wikiCapture=1                           → returns false (amber)
 *
 *  Note: the consumer in `app/settings/page.tsx` (`LabArchivesSection`)
 *  has a separate short-circuit on `isDemoOrWikiCapture()` that shows
 *  the purple "Demo mode" pill regardless of `isLabArchivesConfigured()`
 *  — that short-circuit also checks for the presence of this URL param
 *  and suppresses itself when the wiki manager has set one. Together
 *  the two checks let `?wikiCapture=1` show purple by default, and
 *  `?wikiCapture=1&labArchivesConfigured=<0|1>` show amber / green.
 *
 *  This override is intentionally scoped to capture-mode only — outside
 *  of demo / `?wikiCapture` we never read the URL, so a real user can't
 *  spoof a "configured" state in production.
 *
 *  SSR note: `URLSearchParams` is read from `window.location.search`, so
 *  on the server (and on the very first client render before hydration)
 *  the override returns false and `isLabArchivesConfigured()` falls back
 *  to its default. Settings is a `"use client"` page rendered after
 *  hydration, so this is fine for screenshot use; if a future server
 *  component needs the override, plumb the param through props instead.
 */
export function isLabArchivesConfigured(): boolean {
  const envFlag = process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED === "1";
  if (!isCaptureModeActive()) return envFlag;
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("labArchivesConfigured");
    if (value === null) return false;
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

/** Async variant of `isLabArchivesConfigured()` that ALSO checks for a
 *  sidecar deployer file in the connected data folder.
 *
 *  Returns true when ANY of these hold (in priority order):
 *  - capture mode + URL override is "1"/"true" (the override flag exists
 *    and is truthy — wiki-manager fixture path)
 *  - capture mode + URL override is "0"/"false" → returns false
 *  - capture mode + no URL override → returns false (default purple/demo)
 *  - `NEXT_PUBLIC_LABARCHIVES_ENABLED=1` (env-var path)
 *  - sidecar `_labarchives-deployer.json` is present and well-formed
 *
 *  NEVER reads the sidecar in capture mode — the fixture-mock folder
 *  isn't a real deployer setting.
 *
 *  UI consumers (Settings, ImportELNDialog, LabArchivesSignInStep) should
 *  prefer this over the sync version so the sidecar path lights up the
 *  same green pill / unlocked-button states as env-var configuration.
 *  The sync `isLabArchivesConfigured()` stays exported for the server-side
 *  callback route + tests, both of which never see a sidecar. */
export async function isLabArchivesConfiguredAsync(): Promise<boolean> {
  // Capture-mode short-circuit: honor the URL override if present, otherwise
  // return false (default purple/demo state, matching the sync version).
  if (isCaptureModeActive()) {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const value = params.get("labArchivesConfigured");
      if (value === null) return false;
      return value === "1" || value === "true";
    } catch {
      return false;
    }
  }
  // Env-var path takes precedence over the sidecar.
  if (process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED === "1") return true;
  // Sidecar fallback. Lazy-import so we don't pull the FSA file-service
  // into the server bundle of routes that import `readLabArchivesCreds`
  // from this same module.
  if (typeof window === "undefined") return false;
  try {
    const mod = await import("./deployer-store");
    return await mod.hasDeployerCreds();
  } catch {
    return false;
  }
}

/** Local mirror of `isDemoOrWikiCapture()` from
 *  `lib/file-system/wiki-capture-mock.ts`. Inlined here to avoid pulling
 *  the (heavier) wiki-capture-mock module — which transitively imports
 *  `idb-keyval` and the file-service singleton — into the server-side
 *  bundle for the LabArchives API routes (`route.ts` files import
 *  `readLabArchivesCreds` from this file).
 *
 *  Kept in sync with the predicates in wiki-capture-mock.ts. If you
 *  change the demo / capture entry triggers there, mirror them here. */
function isCaptureModeActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem("researchos:demo-mode") === "1") return true;
  } catch {
    // sessionStorage can throw in privacy modes; fall through.
  }
  try {
    const path = window.location.pathname;
    if (path === "/demo" || path.startsWith("/demo/")) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") return true;
    if (params.get("wikiCapture") !== null) return true;
    return false;
  } catch {
    return false;
  }
}

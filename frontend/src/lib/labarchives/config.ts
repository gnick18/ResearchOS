/**
 * LabArchives integration configuration.
 *
 * LabArchives uses **HMAC-SHA1 signed requests** rather than OAuth2 — every
 * call carries `akid` (access key id), `expires`, and `sig` query params.
 * The institution-issued credentials are NOT user-specific; they go in
 * environment variables, exactly like the Google/Microsoft OAuth client
 * secrets.
 *
 *     LABARCHIVES_ACCESS_KEY_ID=...
 *     LABARCHIVES_ACCESS_PASSWORD=...
 *     # Optional, defaults to api.labarchives.com:
 *     LABARCHIVES_API_BASE_URL=https://api.labarchives.com/api
 *
 * Per-user state — the `uid` returned by `users/user_access_info` — is
 * stored in the user's data folder once they sign in. See
 * `tokens-store.ts` for that.
 */

interface LabArchivesCreds {
  accessKeyId: string;
  accessPassword: string;
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://api.labarchives.com/api";

/** Server-only — these env vars hold the institutional credentials and must
 *  never leak to the client bundle. Throws a helpful error if either is
 *  unset. */
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

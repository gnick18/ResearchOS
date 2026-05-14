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
        "API credentials at https://www.labarchives.com/labarchives-knowledge-base/api/",
    );
  }
  return { accessKeyId, accessPassword, baseUrl };
}

/** Browser-safe — checks whether the public configuration flag has been set
 *  so the UI can decide whether to surface the LabArchives sign-in step or
 *  hide it with "Integration not configured" copy. */
export function isLabArchivesConfigured(): boolean {
  return process.env.NEXT_PUBLIC_LABARCHIVES_ENABLED === "1";
}

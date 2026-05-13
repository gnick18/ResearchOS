/**
 * Shared OAuth provider configuration.
 *
 * Client IDs and secrets come from environment variables — the open-source
 * repo ships with no credentials baked in. For the hosted Vercel deployment
 * set them under Project Settings → Environment Variables; for self-hosted
 * dev, drop them into `frontend/.env.local`:
 *
 *     GOOGLE_OAUTH_CLIENT_ID=...
 *     GOOGLE_OAUTH_CLIENT_SECRET=...
 *     MICROSOFT_OAUTH_CLIENT_ID=...
 *     MICROSOFT_OAUTH_CLIENT_SECRET=...
 *
 * One OAuth client per provider can carry both the production redirect
 * (https://research-os-xi.vercel.app/api/auth/<provider>/callback) and the
 * localhost redirect (http://localhost:3000/api/auth/<provider>/callback).
 */

export interface ProviderConfig {
  /** Lower-cased provider key; matches the URL path segment. */
  key: "google" | "outlook";
  authUrl: string;
  tokenUrl: string;
  /** Scopes to request. Write-capable scopes by default so two-way sync
   *  works once tokens are saved. */
  scopes: string[];
  /** Whether the provider supports PKCE. Both Google and Microsoft do; we
   *  always use it. */
  usesPkce: true;
  /** Extra parameters the auth URL must carry to get refresh tokens. */
  extraAuthParams?: Record<string, string>;
}

export const GOOGLE_CONFIG: ProviderConfig = {
  key: "google",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "openid",
    "email",
    // calendar.events is the narrowest read+write scope that lets us
    // create / update / delete events without granting access to the
    // user's free/busy or ACLs. It's "restricted" in Google's tiering,
    // which means the unverified-app screen is shown until brand
    // verification clears — fine for beta.
    "https://www.googleapis.com/auth/calendar.events",
    // Calendar list read access so we can show the user which of their
    // sub-calendars to subscribe to ("primary", "Work", "Holidays in US").
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
  usesPkce: true,
  // Without `access_type=offline` Google omits the refresh token. Without
  // `prompt=consent` Google omits it on subsequent connects too.
  extraAuthParams: {
    access_type: "offline",
    prompt: "consent",
  },
};

export const MICROSOFT_CONFIG: ProviderConfig = {
  key: "outlook",
  // The "common" tenant lets work, school, and personal accounts all sign
  // in through the same app registration.
  authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: [
    "openid",
    "email",
    "offline_access", // Required for a refresh token.
    "Calendars.ReadWrite",
  ],
  usesPkce: true,
};

export function configFor(provider: "google" | "outlook"): ProviderConfig {
  return provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;
}

/** Resolve the right redirect URI for the current environment. We register
 *  both prod + localhost redirects on the OAuth app so the same client id
 *  works in either context. */
export function redirectUriFor(
  provider: "google" | "outlook",
  origin: string,
): string {
  return `${origin}/api/auth/${provider}/callback`;
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Server-side only — these read env vars that should never leak to the
 *  client bundle. Throws a helpful error if the var is unset so callers
 *  can surface a clear "set GOOGLE_OAUTH_CLIENT_ID to enable" hint. */
export function readClientCreds(
  provider: "google" | "outlook",
): ClientCredentials {
  const prefix = provider === "google" ? "GOOGLE_OAUTH" : "MICROSOFT_OAUTH";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new Error(
      `${provider} OAuth is not configured — set ${prefix}_CLIENT_ID and ` +
        `${prefix}_CLIENT_SECRET in the environment.`,
    );
  }
  return { clientId, clientSecret };
}

/** Browser-safe lookup — only checks whether the *public* configuration
 *  flag has been set, so the UI can choose between "Connect" and a
 *  "Provider not configured" hint without ever holding the secret. The
 *  public flag is just `NEXT_PUBLIC_<PROVIDER>_OAUTH_ENABLED=1`. */
export function isProviderConfigured(provider: "google" | "outlook"): boolean {
  if (provider === "google") {
    return process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "1";
  }
  return process.env.NEXT_PUBLIC_MICROSOFT_OAUTH_ENABLED === "1";
}

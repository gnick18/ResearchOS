/**
 * Server-side OAuth helpers shared by the Google and Microsoft routes.
 *
 * Both providers use the Authorization Code with PKCE flow:
 *
 *   1. `loginRedirectUrl(...)` — builds the consent URL the browser is sent
 *      to. The caller also sets a short-lived HTTP-only cookie carrying the
 *      PKCE verifier + CSRF state.
 *
 *   2. `exchangeCode(...)` — server-to-server POST that swaps the code +
 *      verifier for tokens. Server-side so the client secret never reaches
 *      the browser bundle.
 *
 *   3. `refreshAccessToken(...)` — same shape, but using a stored refresh
 *      token. Surfaced as `/api/auth/<provider>/refresh` so the browser can
 *      lazily refresh from anywhere.
 *
 * No third-party SDK — Google and Microsoft are both standard OAuth2/OIDC
 * endpoints, and `fetch` does the job.
 */

import { redirectUriFor, type ProviderConfig } from "./oauth-config";

const VERIFIER_BYTES = 32;

/** Base64url-encode (no padding) a `Uint8Array`. */
function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a fresh PKCE pair using the platform `crypto`. The verifier is
 *  the high-entropy secret stored in an HTTP-only cookie; the challenge is
 *  what's sent up to the provider. */
export async function makePkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const buf = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(buf);
  const verifier = base64Url(buf);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Random URL-safe token used as CSRF state. Pairs with a cookie that the
 *  callback compares to the `state` query param. */
export function makeState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
  id_token?: string;
}

/** Build the consent URL the browser is redirected to. */
export function loginRedirectUrl(
  config: ProviderConfig,
  origin: string,
  clientId: string,
  state: string,
  challenge: string,
): string {
  const u = new URL(config.authUrl);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUriFor(config.key, origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", config.scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

/** Exchange an auth code + verifier for tokens. Server-to-server only —
 *  the request body carries the client secret. */
export async function exchangeCode(
  config: ProviderConfig,
  origin: string,
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriFor(config.key, origin),
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: verifier,
  });
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Use a stored refresh token to mint a fresh access token. Some providers
 *  also rotate the refresh token; callers should keep the new one if
 *  present in the response. */
export async function refreshAccessToken(
  config: ProviderConfig,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Best-effort: decode the OIDC `id_token` payload (middle JWT segment) to
 *  pull out the email. We never verify the signature here — Google/MS just
 *  handed it back to us over TLS — and we only use it for display. */
export function decodeIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
    const json = atob(pad);
    const parsed = JSON.parse(json) as { email?: string; preferred_username?: string };
    return parsed.email ?? parsed.preferred_username ?? null;
  } catch {
    return null;
  }
}

/** Returns the response HTML used at the end of a successful OAuth dance.
 *  The browser opened the auth flow in a popup; we post the tokens back to
 *  the opener so the main tab can persist them via FSA, then close the
 *  popup. Falls back to a plain success page when there's no opener (the
 *  user opened the auth flow in a normal tab somehow). */
export function callbackSuccessHtml(payload: object): string {
  const json = JSON.stringify(payload);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 2rem; text-align: center; color: #1f2937; }
  .ok { color: #047857; }
</style></head>
<body>
  <h2 class="ok">✓ Connected</h2>
  <p>You can close this window.</p>
  <script>
    (function () {
      var msg = { source: "researchos-oauth", payload: ${json} };
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(msg, window.location.origin);
        }
      } catch (_) { /* ignore */ }
      setTimeout(function () { window.close(); }, 300);
    })();
  </script>
</body></html>`;
}

/** Error page rendered when the OAuth dance fails — also postMessages so
 *  the parent tab can surface the error inline instead of leaving the user
 *  guessing why nothing happened. */
export function callbackErrorHtml(message: string): string {
  const json = JSON.stringify({ error: message });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 2rem; text-align: center; color: #1f2937; }
  .err { color: #b91c1c; }
  pre { background: #f3f4f6; padding: 0.5rem; border-radius: 6px; overflow: auto; text-align: left; }
</style></head>
<body>
  <h2 class="err">Sign-in failed</h2>
  <pre>${escapeHtml(message)}</pre>
  <p>You can close this window.</p>
  <script>
    (function () {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { source: "researchos-oauth", payload: ${json} },
            window.location.origin,
          );
        }
      } catch (_) { /* ignore */ }
    })();
  </script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

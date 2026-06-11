"use client";

// Whether OAuth-based publishing (sign in with Google/GitHub/ORCID/LinkedIn to
// claim a findable directory profile) is available in this deployment.
//
// OAuth only works when the deployer has configured AUTH_SECRET + provider
// credentials AND turned sharing on. In dev (no AUTH_ env) and in prod with
// sharing off, clicking a provider dead-ends at NextAuth's /api/auth/error 500.
// Under the local-keypair-first identity model (IDENTITY_OAUTH_ONLY.md), the
// ACCOUNT is a local keypair created offline; OAuth publish is an OPTIONAL extra.
// So when it is not available we simply do not OFFER it, the local account +
// passkey + recovery code + email-OTP paths still work.
//
// Gated on NEXT_PUBLIC_SHARING_ENABLED so the check runs client-side. The
// deployer sets it to "true" alongside the server SHARING_ENABLED only once OAuth
// is actually configured. Unset (dev) => false => no OAuth UI, no dead ends.

export function isOAuthPublishAvailable(): boolean {
  // Real sharing build, OR the dev mock provider (lets the link flow be tested
  // on localhost with no real OAuth creds; see auth.ts devMockProvider).
  return (
    process.env.NEXT_PUBLIC_SHARING_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_AUTH_DEV_MOCK === "1"
  );
}

// Whether the dev-only mock sign-in is active. When true the shared provider
// buttons render a single working "Dev mock" button instead of the real
// providers (which still dead-end without creds).
export function isDevMockAuth(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_DEV_MOCK === "1";
}

// STRICT gate for surfaces that must stay hidden until REAL OAuth exists (e.g.
// the login-screen footer's inline provider buttons, which call the real
// providers directly and would dead-end). The dev mock does NOT turn these on.
export function isRealSharingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SHARING_ENABLED === "true";
}

// Whether to OFFER the Microsoft (Entra ID) sign-in button. Microsoft is gated
// on its OWN flag, separate from the other providers, because it needs its own
// Azure app registration. The deployer registers a multitenant Entra app, sets
// AUTH_MICROSOFT_ENTRA_ID_ID/SECRET (the server provider then mounts on its own
// gate in auth.ts), and flips NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED to "true" so the
// client shows the button. Until then the button stays hidden, so it never
// dead-ends at /api/auth/error. Always paired with the surface's own
// OAuth-available gate, so it only shows where the other providers already do.
export function isMicrosoftAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED === "true";
}

// Google and GitHub are the default providers, OFFERED wherever the real OAuth UI
// shows (sharing enabled). A deployment that has NOT configured one of them (for
// example a local dev wired only for Microsoft) can hide its button by setting
// the matching flag to "false", so clicking it never dead-ends at
// /api/auth/error. Default ON, so every existing deployment that already relies
// on Google/GitHub keeps showing them without setting a new flag.
export function isGoogleAuthEnabled(): boolean {
  return (
    isRealSharingEnabled() &&
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED !== "false"
  );
}

export function isGithubAuthEnabled(): boolean {
  return (
    isRealSharingEnabled() &&
    process.env.NEXT_PUBLIC_AUTH_GITHUB_ENABLED !== "false"
  );
}

// Whether to OFFER the operator access-code field on the operator sign-in card.
// Opt-in: the deployer sets OPERATOR_ACCESS_CODE (the secret, server-only) and
// flips NEXT_PUBLIC_OPERATOR_CODE_ENABLED to "true" so the field shows. Until
// then the field stays hidden and only the OAuth buttons appear.
export function isOperatorCodeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OPERATOR_CODE_ENABLED === "true";
}

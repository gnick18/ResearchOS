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
  return process.env.NEXT_PUBLIC_SHARING_ENABLED === "true";
}

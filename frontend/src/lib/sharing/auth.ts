// Cross-boundary sharing, Auth.js (NextAuth v5) configuration.
//
// Lets a user prove they own an email address by signing in with Google or
// GitHub, an alternative to the existing custom 6-digit email OTP (which stays
// as a fallback and is untouched). The OAuth-verified email is read from the
// session in the oauth-bind route, which binds the user's published public keys
// to that email. Section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// Env this reads (all auto-resolved by Auth.js / the providers, never passed
// explicitly):
//   AUTH_SECRET                    signing secret for the JWT session
//   AUTH_GOOGLE_ID                 Google OAuth client id
//   AUTH_GOOGLE_SECRET             Google OAuth client secret
//   AUTH_GITHUB_ID                 GitHub OAuth client id
//   AUTH_GITHUB_SECRET             GitHub OAuth client secret
//   AUTH_LINKEDIN_ID               LinkedIn OAuth client id
//   AUTH_LINKEDIN_SECRET           LinkedIn OAuth client secret
//   AUTH_MICROSOFT_ENTRA_ID_ID     Microsoft Entra application id (optional)
//   AUTH_MICROSOFT_ENTRA_ID_SECRET Microsoft Entra client secret (optional)
//   AUTH_ORCID_ID                  ORCID OIDC client id (optional)
//   AUTH_ORCID_SECRET              ORCID OIDC client secret (optional)
//   AUTH_ORCID_ISSUER              ORCID issuer URL (optional, defaults to
//                                  https://orcid.org; set to
//                                  https://sandbox.orcid.org for local testing)
//
// LinkedIn uses Sign In with LinkedIn via OpenID Connect, and returns a verified
// email, which is all the oauth-bind route needs.
//
// Microsoft Entra is wired in only when its credentials are present, so the app
// can ship the other providers before the Entra app registration exists. It is
// left on its default `common` tenant issuer, so any work, school, or personal
// Microsoft account can sign in once it is enabled. To turn it on, register a
// multitenant Entra app and set AUTH_MICROSOFT_ENTRA_ID_ID/SECRET; it activates
// with no code change here, only the wizard button needs re-adding.
//
// ORCID is wired in only when AUTH_ORCID_ID is present. ORCID OIDC uses
// client_secret_post (not the default client_secret_basic) and does not
// advertise PKCE. We disable PKCE (checks: ["state"]) to match ORCID's
// published discovery doc. ORCID never returns an email in the id_token; the
// sub claim is the 16-digit ORCID iD (e.g. 0000-0002-1825-0097). We thread it
// through the JWT so routes can resolve the account via the orcid_links table.
//
// We use a JWT session (no DB adapter), so the verified email and orcidId ride
// in the stateless token rather than a server-side session table. trustHost is
// on because the app runs behind Vercel's proxy.

import NextAuth from "next-auth";
import { lookupEmailByOrcid } from "@/lib/sharing/directory/db";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import LinkedIn from "next-auth/providers/linkedin";
import Credentials from "next-auth/providers/credentials";

// DEV-ONLY mock provider so the third-party link flow can be exercised on
// localhost without real OAuth credentials. STRICTLY gated: it only mounts when
// AUTH_DEV_MOCK=1 AND this is not a production build, so it can never ship. It
// authorizes any email handed to it (or AUTH_DEV_MOCK_EMAIL) and returns a
// verified-email session, which is all the sharing-claim flow reads. Real
// Google/GitHub are wired the same way once their creds exist; this just lets
// us test passkey-then-link end to end today. (2026-06-07)
const devMockProvider =
  process.env.AUTH_DEV_MOCK === "1" && process.env.NODE_ENV !== "production"
    ? [
        Credentials({
          id: "devmock",
          name: "Dev mock sign-in",
          credentials: { email: {} },
          authorize(creds) {
            const email =
              (typeof creds?.email === "string" && creds.email.trim()) ||
              process.env.AUTH_DEV_MOCK_EMAIL ||
              "dev@researchos.test";
            return { id: email, email, name: email.split("@")[0] };
          },
        }),
      ]
    : [];

// Extend the built-in Session type with our custom fields so TypeScript knows
// that session.orcidId and session.provider are valid accesses.
// We do not augment the JWT interface here because @auth/core/jwt is not
// directly resolvable through the bundler module resolution; instead the
// jwt callbacks use index-access writes (valid because JWT extends
// Record<string, unknown>) and explicit casts when reading.
declare module "next-auth" {
  interface Session {
    orcidId?: string;
    provider?: string;
  }
}

// Gate EVERY OAuth provider on its client id, not just Entra/ORCID below. A
// provider whose AUTH_*_ID/SECRET are undefined throws at config time and takes
// the whole auth handler down, which 500s every getSession() call. Google,
// GitHub, and LinkedIn used to mount unconditionally, so a dev environment with
// no OAuth creds broke the auth route (the lab-session boot probe surfaced it).
// Prod has the creds, so the providers mount there exactly as before; dev
// without creds simply omits them and falls back to the devmock provider.
const google = process.env.AUTH_GOOGLE_ID ? [Google] : [];
const github = process.env.AUTH_GITHUB_ID ? [GitHub] : [];
const linkedin = process.env.AUTH_LINKEDIN_ID ? [LinkedIn] : [];

// Only include Entra when configured. A provider with undefined client
// credentials would throw at config time and take the whole auth setup down.
const microsoftEntra = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  ? [MicrosoftEntraID]
  : [];

// ORCID OIDC provider, gated on AUTH_ORCID_ID. Config matches ORCID's live
// OpenID Connect discovery doc (https://orcid.org/.well-known/openid-configuration):
//   - scopes_supported: openid only (no email)
//   - token_endpoint_auth_methods_supported: client_secret_post
//   - code_challenge_methods_supported: not advertised (no PKCE)
//   - sub claim = the 16-digit ORCID iD
//
// OPERATOR NOTE: if the sandbox callback returns an invalid-request or PKCE
// error, check and/or adjust `checks` (e.g. try ["state", "nonce"]). This
// cannot be verified by unit tests and requires a live ORCID sandbox run.
const orcidProvider = process.env.AUTH_ORCID_ID
  ? [
      {
        id: "orcid",
        name: "ORCID",
        type: "oidc" as const,
        issuer:
          process.env.AUTH_ORCID_ISSUER || "https://orcid.org",
        clientId: process.env.AUTH_ORCID_ID,
        clientSecret: process.env.AUTH_ORCID_SECRET,
        authorization: { params: { scope: "openid" } },
        client: { token_endpoint_auth_method: "client_secret_post" as const },
        // ORCID does not advertise PKCE. Disable it to avoid an
        // unsupported_transform_algorithm error from the ORCID token endpoint.
        checks: ["state"] as ("state" | "pkce" | "nonce")[],
        idToken: true,
        profile(profile: {
          sub: string;
          name?: string;
          given_name?: string;
          family_name?: string;
        }) {
          const name =
            profile.name ||
            [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
            profile.sub;
          return { id: profile.sub, name, email: null };
        },
      },
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...google,
    ...github,
    ...linkedin,
    ...microsoftEntra,
    ...orcidProvider,
    ...devMockProvider,
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider) token.provider = account.provider;
      if (account?.provider === "orcid" && profile?.sub) {
        token.orcidId = profile.sub as string;
      }
      // ORCID never returns an email (the sub is the ORCID iD), so the token has
      // an orcidId but no email at this point. ResearchOS keys every account on a
      // plaintext email, so if this ORCID iD already has a verified email on file
      // (from a previous capture, stored encrypted in directory_orcid_links), we
      // resolve it here and set it on the token so session.user.email is
      // populated and the normal account flow proceeds transparently. When there
      // is no binding yet, the token email stays empty and the capture step
      // handles it. This runs on EVERY jwt pass that has an orcidId but no email
      // (not only the sign-in pass), so the FIRST session read after a successful
      // capture picks the email up without forcing a full re-login.
      //
      // Resilient: any failure is swallowed (DB down, secret missing, decode
      // error) and the email is simply left empty, never throwing out of the
      // callback (which would 500 every getSession call).
      const orcidId =
        typeof token.orcidId === "string" ? token.orcidId : null;
      if (orcidId && !token.email) {
        try {
          const resolved = await lookupEmailByOrcid(orcidId);
          if (resolved) token.email = resolved;
        } catch {
          // Resolution is best-effort; leave the email empty so the capture step
          // runs rather than breaking the sign-in.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.provider)
        (session as { provider?: string }).provider = token.provider as string;
      if (token.orcidId)
        (session as { orcidId?: string }).orcidId = token.orcidId as string;
      // Thread the resolved email (set above when an ORCID binding exists) onto
      // session.user.email so every reader (oauth-bind, the account flow, billing)
      // sees the account identity. For Google / Microsoft / LinkedIn the email is
      // already on the token from the provider, so this is a no-op overwrite with
      // the same value; for ORCID it is the resolved binding or empty.
      if (token.email && session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
  },
});

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
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import LinkedIn from "next-auth/providers/linkedin";

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
  providers: [Google, GitHub, LinkedIn, ...microsoftEntra, ...orcidProvider],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider) token.provider = account.provider;
      if (account?.provider === "orcid" && profile?.sub) {
        token.orcidId = profile.sub as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.provider)
        (session as { provider?: string }).provider = token.provider as string;
      if (token.orcidId)
        (session as { orcidId?: string }).orcidId = token.orcidId as string;
      return session;
    },
  },
});

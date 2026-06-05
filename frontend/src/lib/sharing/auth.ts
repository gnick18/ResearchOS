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
// We use a JWT session (no DB adapter), so the verified email rides in the
// stateless token rather than a server-side session table. trustHost is on
// because the app runs behind Vercel's proxy.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import LinkedIn from "next-auth/providers/linkedin";

// Only include Entra when configured. A provider with undefined client
// credentials would throw at config time and take the whole auth setup down.
const microsoftEntra = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  ? [MicrosoftEntraID]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google, GitHub, LinkedIn, ...microsoftEntra],
  session: { strategy: "jwt" },
  trustHost: true,
});

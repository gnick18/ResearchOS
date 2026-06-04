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
//   AUTH_SECRET            signing secret for the JWT session
//   AUTH_GOOGLE_ID         Google OAuth client id
//   AUTH_GOOGLE_SECRET     Google OAuth client secret
//   AUTH_GITHUB_ID         GitHub OAuth client id
//   AUTH_GITHUB_SECRET     GitHub OAuth client secret
//
// We use a JWT session (no DB adapter), so the verified email rides in the
// stateless token rather than a server-side session table. trustHost is on
// because the app runs behind Vercel's proxy.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google, GitHub],
  session: { strategy: "jwt" },
  trustHost: true,
});

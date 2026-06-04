// Cross-boundary sharing, Auth.js (NextAuth v5) catch-all route handler.
//
// Exposes the OAuth endpoints (sign-in, callback, session, csrf, signout) that
// Google and GitHub redirect through. The handlers come straight from the shared
// NextAuth config in @/lib/sharing/auth.
//
// This is a catch-all on /api/auth. There are no other route files under
// /api/auth, so it shadows nothing. If a more-specific static route is ever
// added under /api/auth (for example /api/auth/labarchives/login), the App
// Router resolves the more-specific static segment before this sibling
// catch-all, so the two coexist.
//
// nodejs runtime, the OAuth flow and the JWT signing rely on Node crypto.

import { handlers } from "@/lib/sharing/auth";

export const { GET, POST } = handlers;
export const runtime = "nodejs";

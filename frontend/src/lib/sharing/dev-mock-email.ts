"use client";

// DEV-ONLY: let the tester choose which email the mock sign-in authenticates as.
//
// The dev-mock provider (auth.ts devMockProvider) authorizes any email handed to
// it, but the UI never passed one, so every dev-mock sign-in resolved to the one
// fixed AUTH_DEV_MOCK_EMAIL. That makes two browser contexts (normal + incognito)
// the SAME account, which blocks any multi-account flow, notably the C2 "PI
// re-admits a member who reset their key" verify (needs a distinct PI and member).
//
// This prompts for the email at sign-in time and forwards it as a signIn() option;
// next-auth passes the extra field straight to the credentials authorize() (the
// same path real OAuth's verified email takes). The chosen email is remembered per
// browser so each context keeps its identity across re-signs.
//
// Gated TWO ways so real OAuth and prod are byte-identical: it only acts when the
// provider IS "devmock" AND the dev-mock flag is on (isDevMockAuth, a
// NEXT_PUBLIC_AUTH_DEV_MOCK check). For every other provider it returns {} so
// callers can spread it unconditionally.

import { isDevMockAuth } from "@/lib/sharing/oauth-availability";

const STORAGE_KEY = "researchos:dev-mock-email";

/**
 * For the dev-mock provider, ask the tester which email to sign in as and return
 * it as signIn() options to merge in ({ email }). Returns {} for any non-mock
 * provider or when dev-mock is off, so callers can spread it unconditionally.
 * Returns null only if the tester cancels the prompt (caller should abort the
 * sign-in rather than fall back to the fixed default).
 */
export function resolveDevMockSignInOptions(
  provider: string,
): { email?: string } | null {
  if (provider !== "devmock" || !isDevMockAuth()) return {};
  if (typeof window === "undefined") return {};

  let last = "";
  try {
    last = window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    // localStorage unavailable (private mode); fall through with empty default.
  }

  const entered = window.prompt(
    "Dev mock sign-in: which email should this account be?\n" +
      "Use distinct emails in different windows to test multi-account flows " +
      "(e.g. pi@researchos.test in one, member@researchos.test in another).",
    last || "dev@researchos.test",
  );
  if (entered === null) return null; // tester cancelled

  const email = entered.trim();
  if (!email) return {}; // empty -> let the server fall back to AUTH_DEV_MOCK_EMAIL

  try {
    window.localStorage.setItem(STORAGE_KEY, email);
  } catch {
    // best-effort remember; sign-in still proceeds with the chosen email.
  }
  return { email };
}

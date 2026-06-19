"use client";

// ORCID-login email-capture, the routing hook (section 18.7).
//
// Tells the entry flow whether the current signed-in ORCID session still needs to
// capture an email. ORCID OIDC returns no email, so a fresh ORCID sign-in lands
// with an orcidId but no session.user.email, which breaks the account flow (it
// keys on a verified email). When this resolves to true, providers.tsx routes the
// visitor to OrcidEmailCapture ahead of the folder/account gate, instead of
// dropping them into the broken no-email account state.
//
// It reads the NextAuth session (the app mounts no SessionProvider, so getSession
// is imperative, matching useHasCloudSession) for the cheap, common cases, and
// confirms an ORCID-but-no-email session against the server status route (which
// also re-checks the encrypted binding, catching a binding written this same
// load). Fail-safe, any error resolves to "does not need email" so a transient
// failure never traps a non-ORCID user or strands the loader, the downstream
// account flow still gates on a real email.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";

/**
 * Whether the current ORCID session needs an email captured. null while the check
 * is in flight (so the caller can hold briefly rather than flash the wrong gate).
 */
export function useOrcidNeedsEmail(): boolean | null {
  const [needs, setNeeds] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        const session = await getSession();
        const provider = (session as { provider?: string } | null)?.provider;
        const orcidId = (session as { orcidId?: string } | null)?.orcidId;
        const email = session?.user?.email ?? null;

        // Not an ORCID session, nothing to capture.
        if (provider !== "orcid" && !orcidId) {
          if (alive) setNeeds(false);
          return;
        }
        // ORCID session that already resolved an email (the jwt callback found a
        // binding), no capture needed.
        if (email) {
          if (alive) setNeeds(false);
          return;
        }

        // ORCID session with no email on the token. Confirm with the server, which
        // re-decrypts the binding so a capture finished this load reads as done.
        const res = await fetch("/api/directory/orcid-email/status", {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          if (alive) setNeeds(false);
          return;
        }
        const data = (await res.json()) as {
          orcid?: boolean;
          needsEmail?: boolean;
        };
        if (alive) setNeeds(Boolean(data.orcid) && Boolean(data.needsEmail));
      } catch {
        // Fail-safe, do not trap anyone on an error.
        if (alive) setNeeds(false);
      }
    }

    void check();
    return () => {
      alive = false;
    };
  }, []);

  return needs;
}

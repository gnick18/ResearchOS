"use client";

import { useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { isMicrosoftAuthEnabled } from "@/lib/sharing/oauth-availability";

/**
 * Operator sign-in block for the /admin pages. The /api/admin/* endpoints gate
 * on the Auth.js (NextAuth) session email being in ADMIN_EMAILS, but there was
 * no way to START that OAuth flow from the operator pages, so a fresh browser
 * could never get in. This shows who you are currently signed in as and lets you
 * sign in (or switch accounts) with a third-party provider, then return here.
 * Sign in with the account whose email is on the ADMIN_EMAILS allow-list.
 */
export default function OperatorSignIn() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          headers: { accept: "application/json" },
        });
        const data = (await res.json()) as {
          user?: { email?: string | null } | null;
        } | null;
        if (!cancelled) setEmail(data?.user?.email ?? null);
      } catch {
        if (!cancelled) setEmail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const callbackUrl =
    typeof window !== "undefined" ? window.location.pathname : "/admin";

  // Local dev has no real OAuth keys; a Credentials "devmock" provider signs you
  // in as AUTH_DEV_MOCK_EMAIL. Exposed only when the public flag is on (it never
  // mounts in a production build), so the Google/GitHub buttons are the real path.
  const devMockOn = process.env.NEXT_PUBLIC_AUTH_DEV_MOCK === "1";

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface-raised p-4">
      <p className="text-body font-medium text-foreground">Operator sign-in</p>
      <p className="text-meta text-foreground-muted mt-0.5 leading-relaxed">
        {email
          ? `Signed in as ${email}. If that is not your operator account (the one in ADMIN_EMAILS), switch below.`
          : email === null
            ? "You are not signed in. Sign in with the account whose email is on the ADMIN_EMAILS allow-list."
            : "Checking your session..."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {devMockOn && (
          <button
            type="button"
            onClick={() => void signIn("devmock", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2 text-body font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          >
            Dev sign-in (local)
          </button>
        )}
        <button
          type="button"
          onClick={() => void signIn("google", { callbackUrl })}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
        >
          Sign in with Google
        </button>
        {isMicrosoftAuthEnabled() && (
          <button
            type="button"
            onClick={() => void signIn("microsoft-entra-id", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
          >
            Sign in with Microsoft
          </button>
        )}
        <button
          type="button"
          onClick={() => void signIn("github", { callbackUrl })}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
        >
          Sign in with GitHub
        </button>
        {email && (
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl })}
            className="text-meta font-medium text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}

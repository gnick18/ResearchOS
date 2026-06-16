"use client";

import { useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import {
  isGithubAuthEnabled,
  isGoogleAuthEnabled,
  isMicrosoftAuthEnabled,
  isOperatorCodeEnabled,
} from "@/lib/sharing/oauth-availability";

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

  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);

  const submitCode = async () => {
    const value = code.trim();
    if (!value) return;
    setCodeBusy(true);
    setCodeErr(null);
    try {
      const res = await fetch("/api/admin/operator-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      if (res.ok) {
        // The signed cookie is set; reload so the server gate re-evaluates and
        // drops us straight into the operator page.
        window.location.reload();
        return;
      }
      setCodeErr(
        res.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : "That code did not work.",
      );
    } catch {
      setCodeErr("Could not reach the server. Try again.");
    } finally {
      setCodeBusy(false);
    }
  };

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
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-3.5 py-2 text-body font-medium text-amber-800 hover:bg-amber-100"
          >
            Dev sign-in (local)
          </button>
        )}
        {isGoogleAuthEnabled() && (
          <button
            type="button"
            onClick={() => void signIn("google", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
          >
            Sign in with Google
          </button>
        )}
        {isMicrosoftAuthEnabled() && (
          <button
            type="button"
            onClick={() => void signIn("microsoft-entra-id", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
          >
            Sign in with Microsoft
          </button>
        )}
        {isGithubAuthEnabled() && (
          <button
            type="button"
            onClick={() => void signIn("github", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-body font-medium text-foreground hover:bg-surface-sunken"
          >
            Sign in with GitHub
          </button>
        )}
        {email && (
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl })}
            className="text-meta font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        )}
      </div>

      {isOperatorCodeEnabled() && (
        <div className="mt-3 border-t border-border pt-3">
          <label className="text-meta text-foreground-muted">
            Or enter your operator access code
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCode();
              }}
              placeholder="Access code"
              autoComplete="off"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground"
            />
            <button
              type="button"
              disabled={codeBusy || !code.trim()}
              onClick={submitCode}
              className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
            >
              {codeBusy ? "Checking..." : "Enter"}
            </button>
          </div>
          {codeErr ? (
            <p className="mt-1 text-meta text-rose-600 dark:text-rose-300">{codeErr}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

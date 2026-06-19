"use client";

// ORCID-login email-capture step (section 18.7).
//
// ORCID OpenID Connect returns no email, only the 16-digit ORCID iD. ResearchOS
// keys every account on a verified plaintext email (the billing owner, the
// directory hash), so a fresh ORCID sign-in with no email on file lands HERE
// before the account/folder flow. The user enters an email, we send a 6-digit
// OTP (POST /api/directory/orcid-email/start), they enter the code
// (POST /api/directory/orcid-email/verify), and on success the verified email is
// bound to their ORCID iD (encrypted at rest) so future ORCID logins resolve it
// transparently. We then force a session refresh and call onDone so the account
// flow can proceed with a populated session email.
//
// This step is intentionally NOT freely dismissable, an account cannot exist
// without an email, so there is no "skip" that lands the user in the app. To
// avoid a soft-lock it offers a visible escape from every state, sign out and
// start over, and (when provided) back out to the sign-in picker to use a
// provider that returns an email instead. Either is a clean exit, never a dead
// end.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, Icon components
// (no inline svg).

import { useCallback, useState } from "react";
import { getSession, signOut } from "next-auth/react";

import LightOnly from "@/components/LightOnly";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import {
  CheckIcon,
  MailIcon,
  OrcidIcon,
  WarningIcon,
} from "@/components/sharing/icons";

import WelcomeMascot from "@/components/onboarding/WelcomeMascot";
import LandingBackdrop from "./LandingBackdrop";

type Step = "email" | "code";

const INPUT_CLASS =
  "w-full px-3 py-2 bg-surface-raised/10 border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body";

interface OrcidEmailCaptureProps {
  /**
   * Called once the email is verified and bound to the ORCID iD, after a session
   * refresh, so the parent can re-route into the now-unblocked account flow.
   */
  onDone: () => void;
  /**
   * Visible escape, sign out entirely and return to the front door. Optional, the
   * component falls back to next-auth signOut when not provided.
   */
  onSignOut?: () => void;
  /**
   * Visible escape, back out to the sign-in picker to use a provider that returns
   * an email (Google / Microsoft / GitHub) instead of finishing ORCID capture.
   */
  onUseDifferentMethod?: () => void;
}

export default function OrcidEmailCapture({
  onDone,
  onSignOut,
  onUseDifferentMethod,
}: OrcidEmailCaptureProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = useCallback(async () => {
    setError(null);
    const canonical = canonicalizeEmail(email);
    if (!canonical || !canonical.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/directory/orcid-email/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: canonical }),
      });
      if (res.status === 401) {
        setError("Your sign-in expired. Please sign in with ORCID again.");
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        return;
      }
      if (!res.ok) {
        setError("Could not send the code. Check the address and try again.");
        return;
      }
      setStep("code");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [email]);

  const verifyCode = useCallback(async () => {
    setError(null);
    const canonical = canonicalizeEmail(email);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/directory/orcid-email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: canonical, otp: code }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        return;
      }
      if (!res.ok) {
        // One generic message, matching the route's single generic failure (a bad
        // or expired code both read the same way to the user).
        setError("That code did not match. Request a new one and try again.");
        return;
      }
      // Bound. Force the NextAuth token to refresh so the jwt callback resolves
      // the freshly stored email onto the session, then hand back to the parent.
      try {
        await getSession();
      } catch {
        // A refresh hiccup is non-fatal, the binding is written and the next
        // session read picks it up. Proceed to the parent either way.
      }
      onDone();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [email, code, onDone]);

  const handleSignOut = useCallback(() => {
    if (onSignOut) {
      onSignOut();
      return;
    }
    void signOut({ callbackUrl: "/" });
  }, [onSignOut]);

  return (
    <LightOnly>
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-16">
        <LandingBackdrop />

        <div className="relative z-[1] flex w-full max-w-sm flex-col">
          <div className="mb-3 flex flex-col items-center text-center">
            <WelcomeMascot />
            <div className="mt-3 flex items-center gap-2">
              <OrcidIcon className="h-5 w-5" />
              <h1 className="text-[22px] font-extrabold tracking-tight text-brand-ink">
                One more step
              </h1>
            </div>
            <p className="mt-1.5 max-w-[40ch] text-[12.5px] leading-relaxed text-foreground-muted">
              ORCID confirmed who you are, but it does not share an email.
              ResearchOS keys your account and your billing to a verified email,
              so add one now and we will remember it the next time you sign in
              with ORCID.
            </p>
          </div>

          {error ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {step === "email" ? (
            <div>
              <label
                htmlFor="orcid-capture-email"
                className="mb-1.5 block text-[12.5px] font-medium text-foreground"
              >
                Email address
              </label>
              <div className="relative mb-4">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
                  <MailIcon className="h-4 w-4" />
                </span>
                <input
                  id="orcid-capture-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) void sendCode();
                  }}
                  placeholder="you@university.edu"
                  className={`${INPUT_CLASS} pl-9`}
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy}
                className="ros-btn-raise w-full rounded-[10px] bg-brand-action px-3 py-2.5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
              >
                {busy ? "Sending code..." : "Send verification code"}
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-[12.5px] text-foreground-muted">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-foreground">
                  {canonicalizeEmail(email)}
                </span>
                . Enter it below to finish.
              </p>
              <label
                htmlFor="orcid-capture-code"
                className="mb-1.5 block text-[12.5px] font-medium text-foreground"
              >
                Verification code
              </label>
              <input
                id="orcid-capture-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void verifyCode();
                }}
                placeholder="000000"
                className={`${INPUT_CLASS} mb-4 text-center text-title tracking-[0.4em]`}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void verifyCode()}
                disabled={busy}
                className="ros-btn-raise flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-action px-3 py-2.5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
              >
                {busy ? (
                  "Verifying..."
                ) : (
                  <>
                    <CheckIcon className="h-4 w-4" />
                    Verify and continue
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
                className="mt-2 w-full py-1.5 text-[12.5px] text-foreground-muted hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-1.5 border-t border-border pt-4 text-center">
            {onUseDifferentMethod ? (
              <button
                type="button"
                onClick={onUseDifferentMethod}
                className="text-[12.5px] text-foreground-muted hover:text-foreground"
              >
                Sign in a different way instead
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSignOut}
              className="text-[12.5px] text-foreground-muted hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </LightOnly>
  );
}

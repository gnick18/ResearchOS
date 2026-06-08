"use client";

// Lab tier Phase 8d: the member-facing join page.
//
// A member opens the head's invite link, which carries the invite in the URL
// hash fragment. This page shows who invited them, then (once they have an
// unlocked identity + an OAuth session) posts a signed accept. The head adds
// them from Settings -> Lab Mode. The bound email is whatever provider the
// member signs in with here.
//
// Not-onboarded members (no folder/identity yet) are pointed to set that up
// first; the full invite-to-onboard flow is Phase 8e.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  decodeInviteFragment,
  isInviteExpired,
  type LabInvitePayload,
} from "@/lib/lab/lab-invite";
import { acceptLabInvite } from "@/lib/lab/lab-invite-flow";

type Phase = "idle" | "working" | "sent" | "error";

export default function LabJoinPage() {
  const { currentUser } = useCurrentUser();
  const [invite, setInvite] = useState<LabInvitePayload | null>(null);
  const [parsed, setParsed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frag = window.location.hash.replace(/^#/, "");
    setInvite(frag ? decodeInviteFragment(frag) : null);
    setParsed(true);
  }, []);

  const accept = async () => {
    if (!invite) return;
    setPhase("working");
    setMessage("");
    try {
      const identity = getSessionIdentity();
      if (!identity || !currentUser) {
        setPhase("error");
        setMessage(
          "Open ResearchOS, connect your data folder, and unlock it first, then reopen this link.",
        );
        return;
      }
      let sess = await getSession();
      if (!sess?.user?.email) {
        await signIn(undefined, { callbackUrl: window.location.href });
        sess = await getSession();
      }
      const email = sess?.user?.email;
      if (!email) {
        setPhase("error");
        setMessage("Sign-in did not complete. Try again.");
        return;
      }
      const r = await acceptLabInvite(invite, {
        username: currentUser,
        identity,
        oauthEmail: email,
      });
      if (r.ok) {
        setPhase("sent");
        setMessage(email);
      } else {
        setPhase("error");
        setMessage(r.reason);
      }
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-lg">
        <h1 className="text-heading font-semibold text-foreground">
          Join a lab
        </h1>

        {!parsed && (
          <p className="mt-3 text-body text-foreground-muted">Loading invite...</p>
        )}

        {parsed && !invite && (
          <p className="mt-3 text-body text-foreground-muted leading-relaxed">
            This invite link is invalid or incomplete. Ask the lab head to send
            you a fresh link.
          </p>
        )}

        {parsed && invite && isInviteExpired(invite, Date.now()) && (
          <p className="mt-3 text-body text-foreground-muted leading-relaxed">
            This invite has expired. Ask <b>{invite.headUsername}</b> for a new
            link.
          </p>
        )}

        {parsed && invite && !isInviteExpired(invite, Date.now()) && (
          <>
            <p className="mt-3 text-body text-foreground-muted leading-relaxed">
              <b className="text-foreground">{invite.headUsername}</b> invited you
              to join their lab on ResearchOS. Accepting requests to join; the
              lab head adds you, and your lab work syncs end-to-end encrypted.
            </p>

            {phase === "sent" ? (
              <div className="mt-6 rounded-md border border-border bg-surface-raised p-4">
                <p className="text-body font-medium text-foreground">
                  Request sent
                </p>
                <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
                  You asked to join as <b>{message}</b>. {invite.headUsername}{" "}
                  will add you from their lab settings. You can close this tab.
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={accept}
                  disabled={phase === "working"}
                  className="mt-6 w-full rounded-md bg-sky-600 px-4 py-3 text-body font-medium text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {phase === "working" ? "Sending request..." : "Accept invite"}
                </button>
                <p className="mt-3 text-meta text-foreground-subtle leading-relaxed">
                  You sign in with any provider you like; that verified email is
                  what gets bound to your membership, whatever address the link
                  was sent to.
                </p>
              </>
            )}

            {phase === "error" && (
              <p className="mt-4 text-meta text-red-500 leading-relaxed" role="alert">
                {message}
              </p>
            )}

            {!currentUser && (
              <p className="mt-4 text-meta text-foreground-subtle leading-relaxed">
                New to ResearchOS?{" "}
                <Link href="/" className="text-sky-500 underline">
                  Set up your workspace
                </Link>{" "}
                first, then reopen this link.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

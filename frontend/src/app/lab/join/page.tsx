"use client";

// Lab tier Phase 8d/8e: the member-facing join page.
//
// A member opens the head's invite link (the invite rides in the URL hash). The
// page shows who invited them, then:
//   - if they have no workspace yet (Phase 8e): it stashes the invite and points
//     them to set one up; the app-wide LabInviteResume banner brings them back
//     here afterward (no need to find the link again).
//   - once they have an unlocked identity: "Accept invite" posts a signed accept
//     (signing in with any provider; that verified email is bound).
//   - after the head approves: "Enter lab" sets their lab_id and drops them in.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  decodeInviteFragment,
  isInviteExpired,
  type LabInvitePayload,
} from "@/lib/lab/lab-invite";
import { acceptLabInvite } from "@/lib/lab/lab-invite-flow";
import { checkAndEnterLab } from "@/lib/lab/lab-member-activation";
import {
  stashInviteFragment,
  readStashedInviteFragment,
  clearStashedInvite,
} from "@/lib/lab/lab-invite-stash";

type Phase = "idle" | "working" | "sent" | "entering" | "pending" | "error";

const primaryBtn =
  "w-full rounded-md bg-brand-action px-4 py-3 text-body font-medium text-white hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryBtn =
  "w-full rounded-md border border-border bg-surface px-4 py-3 text-meta font-medium text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed";

export default function LabJoinPage() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const [invite, setInvite] = useState<LabInvitePayload | null>(null);
  const [parsed, setParsed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hashFrag = window.location.hash.replace(/^#/, "");
    // Prefer the link's hash; fall back to a stash (e.g. after onboarding).
    const frag = hashFrag || readStashedInviteFragment() || "";
    const decoded = frag ? decodeInviteFragment(frag) : null;
    // Persist a valid, unexpired invite so it survives the onboarding redirects.
    if (decoded && !isInviteExpired(decoded, Date.now())) {
      stashInviteFragment(frag);
    }
    setInvite(decoded);
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
        setMessage("Set up your workspace and unlock it first.");
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

  const enterLab = async () => {
    if (!invite) return;
    const identity = getSessionIdentity();
    if (!identity || !currentUser) {
      setPhase("error");
      setMessage("Set up your workspace and unlock it first.");
      return;
    }
    setPhase("entering");
    setMessage("");
    try {
      const r = await checkAndEnterLab({
        labId: invite.labId,
        username: currentUser,
        identity,
      });
      if (r.entered) {
        clearStashedInvite();
        router.push("/");
      } else {
        setPhase("pending");
        setMessage(r.message);
      }
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-lg">
        <h1 className="text-heading font-semibold text-foreground">Join a lab</h1>

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
              to join their lab on ResearchOS. Your lab work syncs end-to-end
              encrypted; you keep your own local copy.
            </p>

            {/* Not onboarded yet: set up a workspace first (invite is stashed). */}
            {!currentUser ? (
              <div className="mt-6 space-y-3">
                <Link href="/" className={`block text-center ${primaryBtn}`}>
                  Set up ResearchOS to join
                </Link>
                <p className="text-meta text-foreground-subtle leading-relaxed">
                  Connect a data folder and create your identity. We will bring
                  you right back here to accept, no need to find this link again.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {phase === "sent" && (
                  <div className="rounded-md border border-border bg-surface-raised p-4">
                    <p className="text-body font-medium text-foreground">
                      Request sent
                    </p>
                    <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
                      You asked to join as <b>{message}</b>.{" "}
                      {invite.headUsername} will approve you. Once they do, click
                      &quot;Enter lab&quot;.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={accept}
                  disabled={phase === "working" || phase === "entering"}
                  className={primaryBtn}
                >
                  {phase === "working" ? "Sending request..." : "Accept invite"}
                </button>
                <button
                  type="button"
                  onClick={enterLab}
                  disabled={phase === "working" || phase === "entering"}
                  className={secondaryBtn}
                >
                  {phase === "entering" ? "Checking..." : "Enter lab"}
                </button>

                {phase === "pending" && (
                  <p className="text-meta text-foreground-muted leading-relaxed">
                    {message}
                  </p>
                )}
                {phase === "error" && (
                  <p
                    className="text-meta text-red-500 leading-relaxed"
                    role="alert"
                  >
                    {message}
                  </p>
                )}
                <p className="text-meta text-foreground-subtle leading-relaxed">
                  You sign in with any provider you like; that verified email is
                  bound to your membership, whatever address the link was sent to.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

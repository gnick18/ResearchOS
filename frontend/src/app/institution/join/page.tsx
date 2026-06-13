"use client";

// Institution tier Phase 4: the department admin's accept screen for an
// institution invite link.
//
// The institution admin shares /institution/join#<payload>. This page decodes the
// payload, shows the deal plainly (the institution pays for the department's labs;
// the institution admin sees dept + lab + account names and usage totals, never
// research data; the dept admin keeps control + can leave), and on Accept posts to
// /api/institution/join. The invite is stashed in sessionStorage so it survives a
// sign-in round trip (the hash fragment can be dropped on an OAuth redirect).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import {
  decodeInstitutionInviteFragment,
  type InstitutionInvitePayload,
} from "@/lib/institution/institution-invite";

const STASH = "institution-invite-pending";

export default function InstitutionJoinPage() {
  const [invite, setInvite] = useState<InstitutionInvitePayload | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "working" | "done" | "error" | "bad" | "needsDept"
  >("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    // Prefer the live fragment; fall back to a stash left before a sign-in hop.
    let p = decodeInstitutionInviteFragment(window.location.hash || "");
    if (!p) {
      try {
        const raw = sessionStorage.getItem(STASH);
        if (raw) p = JSON.parse(raw) as InstitutionInvitePayload;
      } catch {
        /* ignore */
      }
    }
    if (!p) {
      setState("bad");
      return;
    }
    try {
      sessionStorage.setItem(STASH, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    setInvite(p);
    setState("ready");
  }, []);

  const accept = async () => {
    if (!invite) return;
    setState("working");
    const session = await getSession();
    if (!session?.user?.email) {
      // Sign in, then come back here; the stash carries the invite across.
      await signIn(undefined, { callbackUrl: "/institution/join" });
      return;
    }
    try {
      const res = await fetch("/api/institution/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        institutionName?: string;
        deptName?: string;
        error?: string;
        needsDepartment?: boolean;
      };
      if (res.ok && data.ok) {
        try {
          sessionStorage.removeItem(STASH);
        } catch {
          /* ignore */
        }
        setMsg(data.institutionName ?? invite.institutionName);
        setState("done");
      } else if (data.needsDepartment) {
        setState("needsDept");
      } else {
        setMsg(data.error ?? `Could not join (HTTP ${res.status})`);
        setState("error");
      }
    } catch {
      setMsg("Network error. Try again.");
      setState("error");
    }
  };

  const wrap =
    "min-h-screen flex items-center justify-center bg-surface-sunken p-4 text-foreground";
  const card =
    "w-full max-w-md rounded-2xl border border-border bg-surface-raised shadow-xl overflow-hidden";

  if (state === "bad") {
    return (
      <div className={wrap}>
        <div className={`${card} p-6`}>
          <h1 className="text-title font-semibold">Invalid invitation</h1>
          <p className="mt-2 text-meta text-foreground-muted">
            This institution invite link is malformed or incomplete. Ask the
            institution admin to send you a fresh link.
          </p>
        </div>
      </div>
    );
  }
  if (state === "loading" || !invite) {
    return (
      <div className={wrap}>
        <p className="text-meta text-foreground-muted">Loading invitation&hellip;</p>
      </div>
    );
  }
  if (state === "needsDept") {
    return (
      <div className={wrap}>
        <div className={`${card} p-6`}>
          <h1 className="text-title font-semibold text-foreground">
            Create your department first
          </h1>
          <p className="mt-2 text-meta text-foreground-muted">
            An institution sponsors departments, and each department sponsors its
            labs. Set up your department, then reopen this link to join{" "}
            {invite.institutionName}.
          </p>
          <a
            href="/department"
            className="mt-4 inline-block rounded-md bg-brand-action px-4 py-2 text-meta font-semibold text-white"
          >
            Set up department
          </a>
        </div>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className={wrap}>
        <div className={`${card} p-6`}>
          <h1 className="text-title font-semibold text-foreground">
            Your department joined {msg}
          </h1>
          <p className="mt-2 text-meta text-foreground-muted">
            Your department&rsquo;s labs are now sponsored by the institution. You
            keep full control of your department and its labs. You can leave anytime
            from Settings.
          </p>
          <a
            href="/"
            className="mt-4 inline-block rounded-md bg-brand-action px-4 py-2 text-meta font-semibold text-white"
          >
            Go to ResearchOS
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <div className={card}>
        <div className="border-b border-border bg-gradient-to-br from-indigo-500/10 to-violet-500/10 px-6 py-5">
          <p className="text-meta font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            Institution invitation
          </p>
          <h1 className="mt-1 text-title font-bold text-foreground">
            Join {invite.institutionName}
          </h1>
        </div>
        <div className="px-6 py-5">
          <p className="text-body">
            {invite.adminUsername} invited <b>your department</b> to be sponsored by
            the institution.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-meta text-foreground-muted">
            <li>
              The institution <b>pays for your department&rsquo;s labs</b> on its
              invoice. Your department stops being billed on its own.
            </li>
            <li>
              You keep <b>full control of your department and its labs</b>. The
              institution admin never sees any research data.
            </li>
            <li>
              They can see your <b>department, lab, and account names plus
              storage/activity totals</b> so they can size the shared plan.
            </li>
            <li>
              You can <b>leave anytime</b>. Your department reverts to billing on its
              own, nothing is deleted.
            </li>
          </ul>
          {state === "error" && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-meta text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              {msg}
            </p>
          )}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={state === "working"}
              onClick={() => void accept()}
              className="flex-1 rounded-lg bg-brand-action px-4 py-2.5 text-body font-semibold text-white disabled:opacity-50"
            >
              {state === "working" ? "Joining…" : "Accept & join"}
            </button>
            <a
              href="/"
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-center text-body font-medium text-foreground-muted"
            >
              Decline
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

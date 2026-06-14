"use client";

// Institution tier: the department admin's accept screen for an institution
// invite link.
//
// The institution admin shares /institution/join#<token> (an opaque server-issued
// invite token). This page PEEKS the token (GET /api/institution/invite) to show
// the institution name + the deal plainly (the institution pays for the
// department's labs; the institution admin sees dept + lab + account names and
// usage totals, never research data; the dept admin keeps control + can leave),
// and on Accept redeems it (POST /api/institution/join). The token is stashed in
// sessionStorage so it survives a sign-in round trip.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";

const STASH = "institution-invite-pending";

export default function InstitutionJoinPage() {
  const [token, setToken] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string>("");
  const [state, setState] = useState<
    "loading" | "ready" | "working" | "done" | "error" | "bad" | "needsDept"
  >("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    // Prefer the live fragment; fall back to a stash left before a sign-in hop.
    let t = window.location.hash.replace(/^#/, "").trim();
    if (!t) {
      try {
        t = sessionStorage.getItem(STASH) ?? "";
      } catch {
        /* ignore */
      }
    }
    if (!t) {
      setState("bad");
      return;
    }
    try {
      sessionStorage.setItem(STASH, t);
    } catch {
      /* ignore */
    }
    setToken(t);
    void (async () => {
      try {
        const res = await fetch(
          `/api/institution/invite?token=${encodeURIComponent(t)}`,
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          institutionName?: string;
          expired?: boolean;
          used?: boolean;
        };
        if (!res.ok || !data.ok || !data.institutionName) {
          setState("bad");
          return;
        }
        setInstitutionName(data.institutionName);
        if (data.used) {
          setMsg("This invite link has already been used. Ask the admin for a fresh one.");
          setState("error");
        } else if (data.expired) {
          setMsg("This invite link has expired. Ask the admin for a fresh one.");
          setState("error");
        } else {
          setState("ready");
        }
      } catch {
        setState("bad");
      }
    })();
  }, []);

  const accept = async () => {
    if (!token) return;
    setState("working");
    const session = await getSession();
    if (!session?.user?.email) {
      // Sign in, then come back here; the stash carries the token across.
      await signIn(undefined, { callbackUrl: "/institution/join" });
      return;
    }
    try {
      const res = await fetch("/api/institution/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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
        setMsg(data.institutionName ?? institutionName);
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
            This institution invite link is not valid. Ask the institution admin to
            send you a fresh link.
          </p>
        </div>
      </div>
    );
  }
  if (state === "loading") {
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
            {institutionName || "the institution"}.
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
            Join {institutionName || "this institution"}
          </h1>
        </div>
        <div className="px-6 py-5">
          <p className="text-body">
            You have been invited for <b>your department</b> to be sponsored by the
            institution.
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

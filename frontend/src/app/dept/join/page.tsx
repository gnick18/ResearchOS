"use client";

// Department tier: the lab head's accept screen for a dept invite link.
//
// The dept admin shares /dept/join#<token>. The token is an opaque server-issued
// invite (unified invite-tokens). This page PEEKS the token (GET /api/dept/invite)
// to show the department name + the deal plainly (the dept pays for the lab's
// storage; the admin sees account names + usage totals, never research data; the
// PI keeps control + can leave), and on Accept redeems it (POST /api/dept/join).
// The token is stashed in sessionStorage so it survives a sign-in round trip (the
// hash fragment can be dropped on an OAuth redirect).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";

const STASH = "dept-invite-pending";

export default function DeptJoinPage() {
  const [token, setToken] = useState<string | null>(null);
  const [deptName, setDeptName] = useState<string>("");
  const [state, setState] = useState<
    "loading" | "ready" | "working" | "done" | "error" | "bad"
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
    // Peek the token to show what it grants before the recipient signs in.
    void (async () => {
      try {
        const res = await fetch(`/api/dept/invite?token=${encodeURIComponent(t)}`);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          deptName?: string;
          expired?: boolean;
          used?: boolean;
        };
        if (!res.ok || !data.ok || !data.deptName) {
          setState("bad");
          return;
        }
        setDeptName(data.deptName);
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
      await signIn(undefined, { callbackUrl: "/dept/join" });
      return;
    }
    try {
      const res = await fetch("/api/dept/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deptName?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        try {
          sessionStorage.removeItem(STASH);
        } catch {
          /* ignore */
        }
        setMsg(data.deptName ?? deptName);
        setState("done");
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
            This department invite link is not valid. Ask the department admin to
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
  if (state === "done") {
    return (
      <div className={wrap}>
        <div className={`${card} p-6`}>
          <h1 className="text-title font-semibold text-foreground">
            You joined {msg}
          </h1>
          <p className="mt-2 text-meta text-foreground-muted">
            Your lab&rsquo;s cloud storage is now sponsored by the department. You
            keep full control of your data and members. You can leave anytime from
            Settings.
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
        <div className="border-b border-border bg-gradient-to-br from-violet-500/10 to-sky-500/10 px-6 py-5">
          <p className="text-meta font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
            Department invitation
          </p>
          <h1 className="mt-1 text-title font-bold text-foreground">
            Join {deptName || "this department"}
          </h1>
        </div>
        <div className="px-6 py-5">
          <p className="text-body">
            You have been invited for <b>your lab</b> to be sponsored by the
            department.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-meta text-foreground-muted">
            <li>
              The department <b>pays for your lab&rsquo;s cloud storage</b> on its
              invoice. You and your members stop being billed individually.
            </li>
            <li>
              You keep <b>full control of your data and members</b>. The admin
              never sees your notes, experiments, or files.
            </li>
            <li>
              They can see your <b>account names and storage/activity totals</b> so
              they can size the shared plan, and that your lab is in the department.
            </li>
            <li>
              You can <b>leave anytime</b>. Your lab reverts to billing on its own,
              nothing is deleted.
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

"use client";

// Cloud-accounts Phase 1 (Chunk A): the folderless account home.
//
// What a signed-in user sees with NO data folder connected. The account is the
// cloud identity (OAuth session + directory profile); the data folder is an
// optional, post-login attachment. This surface shows the account-level things
// that need no folder (profile, billing, org portals, settings) and a prominent
// "connect your data folder" call to action. It renders inside PortalShell, so it
// is only reached when signed in; PortalShell shows the sign-in gate otherwise.
//
// @handle + a real profile card land in Chunk B; for now the email is the label.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";
import { useFileSystem } from "@/lib/file-system/file-system-context";

interface QuickLink {
  href: string;
  label: string;
  desc: string;
}

const LINKS: QuickLink[] = [
  { href: "/department", label: "Department admin", desc: "Sponsor your labs on one invoice." },
  { href: "/institution", label: "Institution admin", desc: "Cover your departments, roll up usage." },
  { href: "/researchers", label: "Researcher directory", desc: "Find researchers and share with them." },
];

export default function AccountHome() {
  const [email, setEmail] = useState<string | null>(null);
  const { isConnected, connect } = useFileSystem();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSession().then((s) => {
      if (alive) setEmail(s?.user?.email ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onConnect = async () => {
    setConnecting(true);
    try {
      await connect();
      // A folder is now attached; drop the user into the app.
      window.location.assign("/");
    } catch {
      // Picker cancelled or unsupported browser; stay on the account home.
      setConnecting(false);
    }
  };

  const initial = (email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="space-y-5">
      {/* Profile card (Chunk B fills in @handle, name, affiliation, avatar). */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-brand-purple text-lg font-extrabold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-title font-bold text-foreground">
            {email ?? "Your account"}
          </div>
          <div className="text-meta text-foreground-muted">
            Your ResearchOS account, available on any device. Your research data
            stays on your own computer.
          </div>
        </div>
      </div>

      {/* Connect-your-data CTA (the optional, post-login folder attach). */}
      {!isConnected && (
        <div className="rounded-2xl border border-brand-action/30 bg-brand-action/5 p-5">
          <h2 className="text-body font-bold text-foreground">Connect your data folder</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Your notes, experiments, and files live in a folder on this computer,
            never on our servers. Connect one to start working. You can do this any
            time, from any device that has your data.
          </p>
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={connecting}
            className="mt-3 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            {connecting ? "Opening…" : "Connect a data folder"}
          </button>
        </div>
      )}

      {/* Account-level surfaces that need no folder. */}
      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-muted">
          Your account
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-action"
            >
              <span className="flex items-center gap-2 text-body font-semibold text-foreground">
                {l.label}
                <span aria-hidden className="text-brand-action">
                  &rarr;
                </span>
              </span>
              <span className="text-meta text-foreground-muted">{l.desc}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
